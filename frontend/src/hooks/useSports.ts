"use client";

import useSWRImmutable from "swr/immutable";
import { type Sport, SportSchema } from "@/generated/events";
import { fetchSports } from "@/lib/api";

// The canonical sports backing the dashboard filter chips. Public (no auth) and
// effectively static for a session, so fetch once and don't revalidate — the
// immutable variant disables revalidate-on-focus/reconnect/stale.
export function useSports() {
  const swr = useSWRImmutable<Sport[]>("sports", async () => {
    const sports = await fetchSports();
    return sports.map((s) => SportSchema.parse(s));
  });

  return swr.data ?? [];
}
