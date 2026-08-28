export type Outcome = "home" | "away" | "draw";

/**
 * Market keys we know how to model. New bet types extend this union; only `h2h`
 * projects onto the (home/away/draw) wire contract — see `h2hOdds`.
 */
export type MarketKey = "h2h" | "totals" | "spreads";

export const H2H: MarketKey = "h2h";
export const TOTALS: MarketKey = "totals";
export const SPREADS: MarketKey = "spreads";

/**
 * One outcome within a market, with its decimal odds.
 *
 * `key` is stable within the market (`home`/`away`/`draw` for h2h,
 * `over`/`under` for totals, …); `point` carries the line for spread/total
 * markets and is null for h2h.
 */
export interface Selection {
  key: string;
  name: string;
  odds: number;
  point?: number | null;
}

export interface Market {
  key: MarketKey;
  selections: Selection[];
}

/**
 * Provider-agnostic representation of a sports event and its markets.
 *
 * `eventId` is our canonical id (`${origin}:${sourceEventId}`); `origin` is the
 * provider that produced it; the `event_source_map` table records the link back
 * to the provider's original ids.
 */
export interface CanonicalEvent {
  eventId: string;
  origin: string;
  sourceEventId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  /** Unix ms. */
  commenceTime?: number | null;
  markets: Market[];
  /** Unix ms. */
  updatedAt: number;
  outcome?: Outcome | null;
  /** Unix ms. */
  resolvedAt?: number | null;

  // Source-side identity hints the storage entity resolver uses to link this
  // event to canonical sport/league/team rows. Providers populate what they
  // expose; absent ones fall back to name-based matching. Not persisted on the
  // event row itself.
  sportGroup?: string | null;
  leagueKey?: string | null;
  leagueName?: string | null;
  country?: string | null;
  homeTeamKey?: string | null;
  awayTeamKey?: string | null;

  // Canonical display names, populated on the read path (GET /odds/events) by
  // joining the linked sport/league/team rows. Null when an entity link is
  // unresolved; callers fall back to the raw `sport`/`homeTeam`/`awayTeam`.
  // `leagueName` above doubles as the canonical league name on reads.
  sportTitle?: string | null;
  /** Canonical league id, populated on the read path; null when unlinked. */
  leagueId?: number | null;
  homeTeamName?: string | null;
  awayTeamName?: string | null;
}

/**
 * A canonical sport: its stable slug and human-readable title.
 *
 * `slug` is what GET /odds/events filters on (`?sport=<slug>`, matched against
 * `odds_current.sport_slug`); `title` is the display label.
 */
export interface CanonicalSport {
  slug: string;
  title: string;
}

/**
 * A canonical league: its stable id, name, and the sport it belongs to.
 *
 * `id` is what GET /odds/events filters on (`?league=<id>`, matched against
 * `odds_current.league_id`); `sportSlug` ties the league to its parent sport.
 */
export interface CanonicalLeague {
  id: number;
  name: string;
  sportSlug: string;
}

export interface EventResult {
  eventId: string;
  sport: string;
  outcome: Outcome;
  /** Unix ms. */
  resolvedAt: number;
}

export function market(event: CanonicalEvent, key: string): Market | undefined {
  return event.markets.find((m) => m.key === key);
}

/**
 * Project the h2h market to (home, away, draw) decimal odds.
 *
 * Returns null when the event carries no h2h market — callers then skip the
 * (home/away/draw) wire publish but still persist the flexible model.
 */
export function h2hOdds(
  event: CanonicalEvent,
): [number, number, number] | null {
  const h2h = market(event, H2H);
  if (h2h === undefined) {
    return null;
  }
  const byKey = new Map(h2h.selections.map((s) => [s.key, s.odds]));
  const home = byKey.get("home");
  const away = byKey.get("away");
  if (home === undefined || away === undefined) {
    return null;
  }
  return [home, away, byKey.get("draw") ?? 0];
}
