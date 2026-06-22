// A single bot player: holds its session + locally-tracked balance and decides
// what to bet. Token refresh is lazy (just before use) since the daemon outlives
// the 30-minute access-token lifetime.

import { getBalance, type OddsEvent, placeBet, type Selection } from "./api.js";
import type { Config } from "./config.js";
import { refreshSession, type Session } from "./keycloak.js";

interface Candidate {
  selection: Selection;
  odds: number;
}

function bettableSelections(event: OddsEvent): Candidate[] {
  const out: Candidate[] = [];
  if (event.homeOdds > 0) {
    out.push({ selection: "home", odds: event.homeOdds });
  }
  if (event.awayOdds > 0) {
    out.push({ selection: "away", odds: event.awayOdds });
  }
  if (event.drawOdds !== undefined && event.drawOdds > 0) {
    out.push({ selection: "draw", odds: event.drawOdds });
  }
  return out;
}

function isBettable(event: OddsEvent): boolean {
  if (event.outcome) {
    return false;
  }
  if (event.homeOdds <= 0) {
    return false;
  }
  // Prefer events that haven't kicked off yet; treat missing time as open.
  if (event.commenceTime != null && event.commenceTime <= Date.now()) {
    return false;
  }
  return true;
}

// Pick a selection weighted by implied probability (1/odds) so bots lean toward
// favourites rather than betting uniformly.
function weightedPick(candidates: Candidate[]): Candidate {
  const weights = candidates.map((c) => 1 / c.odds);
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      return candidates[i];
    }
  }
  return candidates[candidates.length - 1];
}

export class Bot {
  readonly username: string;
  readonly sub: string;
  private session: Session;
  private balance: number;

  constructor(
    username: string,
    sub: string,
    session: Session,
    balance: number,
  ) {
    this.username = username;
    this.sub = sub;
    this.session = session;
    this.balance = balance;
  }

  private async token(cfg: Config): Promise<string> {
    if (Date.now() > this.session.expiresAt - 60_000) {
      this.session = await refreshSession(cfg, this.session);
    }
    return this.session.accessToken;
  }

  async syncBalance(cfg: Config): Promise<void> {
    this.balance = await getBalance(cfg, await this.token(cfg));
  }

  // Place one bet on a randomly chosen open event, sized as a fraction of the
  // current balance. Returns a short log line on success, or null if it skipped.
  async betOnce(cfg: Config, events: OddsEvent[]): Promise<string | null> {
    const open = events.filter(isBettable);
    if (open.length === 0) {
      return null;
    }
    if (this.balance < cfg.minStake) {
      return null;
    }
    const event = open[Math.floor(Math.random() * open.length)];
    const candidates = bettableSelections(event);
    if (candidates.length === 0) {
      return null;
    }
    const choice = weightedPick(candidates);

    const span = cfg.maxStakeFraction - cfg.minStakeFraction;
    const fraction = cfg.minStakeFraction + Math.random() * span;
    let stake = Math.round(this.balance * fraction * 100) / 100;
    if (stake < cfg.minStake) {
      stake = cfg.minStake;
    }
    if (stake > this.balance) {
      return null;
    }

    await placeBet(cfg, await this.token(cfg), {
      eventId: event.eventId,
      selection: choice.selection,
      odds: choice.odds,
      stake,
    });
    // Stake is now held; reflect it locally so subsequent ticks size correctly.
    this.balance = Math.round((this.balance - stake) * 100) / 100;
    return `${this.username} bet $${stake} on ${choice.selection} @ ${choice.odds} (${event.eventId})`;
  }
}
