"use client";

import useSWRImmutable from "swr/immutable";
import { type League, LeagueSchema } from "@/generated/events";
import { fetchLeagues } from "@/lib/api";

// The canonical leagues backing the dashboard's league filter chips. Scoped to
// the selected sport (`sport` = its slug); undefined lists every sport's
// leagues. Public (no auth) and effectively static for a session, so a plain
// SWR fetch is enough — no socket. The key embeds the sport so switching sports
// re-fetches the scoped list.
export function useLeagues(sport?: string) {
  const swr = useSWRImmutable<League[]>(
    sport ? `leagues:${sport}` : "leagues",
    async () => {
      const leagues = await fetchLeagues(sport);
      return leagues.map((l) => LeagueSchema.parse(l));
    },
  );

  return swr.data ?? [];
}
