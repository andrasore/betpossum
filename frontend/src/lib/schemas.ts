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
});

export type OddsEvent = z.infer<typeof OddsEventSchema>;
