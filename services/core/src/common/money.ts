// Money is an integer count of cents everywhere in this service — DTOs, the
// `bets` table, the wire contracts, and the TigerBeetle ledger. Dollars exist
// only as a display string in the browser. `odds` is a ratio, not money, so it
// stays a float.

/** $1,000,000. Bounds `stakeCents`/`amountCents` so no product below can
 *  overflow a 4-byte column or leave the safe-integer range. */
export const MAX_STAKE_CENTS = 100_000_000;

/** Decimal odds are a payout multiplier, so anything <= 1 is not a bet. */
export const MIN_ODDS = 1.01;
export const MAX_ODDS = 1000;

/**
 * Profit on a winning bet — the system's single rounding site, because
 * `stakeCents * (odds - 1)` is the one genuinely fractional quantity in the
 * money path. Half-up, and never below zero.
 */
export function profitCents(stakeCents: number, odds: number): number {
  return Math.max(0, Math.round(stakeCents * (odds - 1)));
}
