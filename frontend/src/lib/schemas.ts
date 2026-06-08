import { z } from "zod";

export const OutcomeSchema = z.enum(["home", "away", "draw"]);
export type Outcome = z.infer<typeof OutcomeSchema>;

export const OddsEventSchema = z.object({
  eventId: z.string().min(1),
  sport: z.string().min(1),
  homeTeam: z.string().min(1),
  awayTeam: z.string().min(1),
  homeOdds: z.number().positive(),
  awayOdds: z.number().positive(),
  drawOdds: z.number().nonnegative().default(0),
  updatedAt: z.number().int().positive(),
  // Scheduled kickoff (Unix ms); null/absent when the provider doesn't supply
  // one. Hydrate-only — live ticks don't carry it.
  commenceTime: z.number().int().positive().nullish(),
  outcome: OutcomeSchema.nullable().optional(),
  resolvedAt: z.number().int().positive().nullable().optional(),
  origin: z.string(),
  // Canonical display names from the odds service's sport/league/team entities;
  // null/absent when an entity link is unresolved (UI falls back to the raw
  // sport/homeTeam/awayTeam above). Hydrate-only — live ticks don't carry them.
  sportName: z.string().nullish(),
  // Canonical league id (what GET /odds filters on, `?league=<id>`); null/absent
  // when the league link is unresolved.
  leagueId: z.number().int().positive().nullish(),
  leagueName: z.string().nullish(),
  homeTeamName: z.string().nullish(),
  awayTeamName: z.string().nullish(),
});

export type OddsEvent = z.infer<typeof OddsEventSchema>;

// A canonical sport for the dashboard filter bar: `slug` is what GET /odds
// filters on (`?sport=<slug>`); `name` is the chip label.
export const SportSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
});

export type Sport = z.infer<typeof SportSchema>;

// A canonical league for the dashboard's league filter bar: `id` is what GET
// /odds filters on (`?league=<id>`); `name` is the chip label. `sportSlug` ties
// the league to its parent sport (a league belongs to exactly one sport), which
// the dashboard uses to auto-select the sport chip when a league is picked.
export const LeagueSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  sportSlug: z.string().min(1),
});

export type League = z.infer<typeof LeagueSchema>;
