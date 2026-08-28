import type { League, OddsEvent, Sport } from "../generated/events";
import {
  type CanonicalEvent,
  type CanonicalLeague,
  type CanonicalSport,
  h2hOdds,
} from "./models";

// The wire shapes (`OddsEvent`/`Sport`/`League`) are generated from
// schemas/json/rest.json — the single source of truth shared with the frontend.
// These mappers project the internal canonical models onto them; missing
// canonical names stay null and the frontend falls back to the raw sport/team
// fields.
//
// Every optional field is written explicitly rather than left `undefined`:
// JSON.stringify drops undefined keys, and the frontend (and its Zod schemas)
// expect the key present with a null value.

export function eventToResponse(event: CanonicalEvent): OddsEvent {
  const [homeOdds, awayOdds, drawOdds] = h2hOdds(event) ?? [0, 0, 0];
  return {
    eventId: event.eventId,
    origin: event.origin,
    sport: event.sport,
    homeTeam: event.homeTeam,
    awayTeam: event.awayTeam,
    homeOdds,
    awayOdds,
    drawOdds,
    updatedAt: event.updatedAt,
    commenceTime: event.commenceTime ?? null,
    outcome: event.outcome ?? null,
    resolvedAt: event.resolvedAt ?? null,
    sportName: event.sportTitle ?? null,
    leagueId: event.leagueId ?? null,
    leagueName: event.leagueName ?? null,
    homeTeamName: event.homeTeamName ?? null,
    awayTeamName: event.awayTeamName ?? null,
  } as OddsEvent;
}

export function sportToResponse(sport: CanonicalSport): Sport {
  return { slug: sport.slug, name: sport.title };
}

export function leagueToResponse(league: CanonicalLeague): League {
  return { id: league.id, name: league.name, sportSlug: league.sportSlug };
}
