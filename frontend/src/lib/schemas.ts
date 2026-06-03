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
  outcome: OutcomeSchema.nullable().optional(),
  resolvedAt: z.number().int().positive().nullable().optional(),
  origin: z.string(),
  // Canonical display names from the odds service's sport/league/team entities;
  // null/absent when an entity link is unresolved (UI falls back to the raw
  // sport/homeTeam/awayTeam above). Hydrate-only — live ticks don't carry them.
  sportName: z.string().nullish(),
  leagueName: z.string().nullish(),
  homeTeamName: z.string().nullish(),
  awayTeamName: z.string().nullish(),
});

export type OddsEvent = z.infer<typeof OddsEventSchema>;
