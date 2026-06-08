"use client";

import useSWR from "swr";
import { fetchSports } from "@/lib/api";
import { type Sport, SportSchema } from "@/lib/schemas";

// The canonical sports backing the dashboard filter chips. Public (no auth) and
// effectively static for a session, so a plain SWR fetch is enough — no socket.
export function useSports() {
  const swr = useSWR<Sport[]>("sports", async () => {
    const sports = await fetchSports();
    return sports.flatMap((s) => {
      const result = SportSchema.safeParse(s);
      return result.success ? [result.data] : [];
    });
  });

  return swr.data ?? [];
}
