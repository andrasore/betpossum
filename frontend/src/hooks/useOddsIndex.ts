"use client";

import useSWR from "swr";
import { OddsEventSchema } from "@/generated/events";
import { fetchOdds } from "@/lib/api";
import type { OddsEvent } from "@/types";

// A static lookup of every event keyed by `eventId`, used to enrich a user's
// bets (which carry only `eventId`) with team/league/sport names. The unfiltered
// GET /odds returns all events including resolved ones — resolved events stay in
// the odds store — so historical bets resolve too. Unlike `useOdds`, this is a
// plain SWR fetch with no live socket subscription: history doesn't tick.
export function useOddsIndex(
  sessionKey: string | null,
): Map<string, OddsEvent> {
  const { data } = useSWR<Map<string, OddsEvent>>(
    sessionKey ? "odds-index" : null,
    async () => {
      const events = await fetchOdds();
      const parsed = events.map((e) => OddsEventSchema.parse(e));
      return new Map(parsed.map((e) => [e.eventId, e]));
    },
  );

  return data ?? new Map();
}
