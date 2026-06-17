"use client";

import useSWR from "swr";
import { type Sport, SportSchema } from "@/generated/events";
import { fetchSports } from "@/lib/api";

// The canonical sports backing the dashboard filter chips. Public (no auth) and
// effectively static for a session, so a plain SWR fetch is enough — no socket.
export function useSports() {
  const swr = useSWR<Sport[]>("sports", async () => {
    const sports = await fetchSports();
    return sports.map((s) => SportSchema.parse(s));
  });

  return swr.data ?? [];
}
