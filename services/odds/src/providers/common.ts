/** Shared transform helpers for mapping provider payloads to the common model. */
import type { Outcome } from "../odds/models";

/**
 * Map a provider's h2h outcome label to our (home/away/draw) selection key.
 *
 * Providers label moneyline outcomes by team name (The Odds API) or by the
 * literal "Home"/"Away"/"Draw" (API-Football). Handle both.
 */
export function outcomeFor(
  name: string,
  homeTeam: string,
  awayTeam: string,
): Outcome | null {
  const label = name.trim();
  const lowered = label.toLowerCase();
  if (lowered === "draw") {
    return "draw";
  }
  if (lowered === "home" || label === homeTeam) {
    return "home";
  }
  if (lowered === "away" || label === awayTeam) {
    return "away";
  }
  return null;
}
