"use client";

import useSWR from "swr";
import { fetchLeagues } from "@/lib/api";
import { type League, LeagueSchema } from "@/lib/schemas";

// The canonical leagues backing the dashboard's league filter chips. Scoped to
// the selected sport (`sport` = its slug); undefined lists every sport's
// leagues. Public (no auth) and effectively static for a session, so a plain
// SWR fetch is enough — no socket. The key embeds the sport so switching sports
// re-fetches the scoped list.
export function useLeagues(sport?: string) {
  const swr = useSWR<League[]>(
    sport ? `leagues:${sport}` : "leagues",
    async () => {
      const leagues = await fetchLeagues(sport);
      return leagues.flatMap((l) => {
        const result = LeagueSchema.safeParse(l);
        return result.success ? [result.data] : [];
      });
    },
  );

  return swr.data ?? [];
}
