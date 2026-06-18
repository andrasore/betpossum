"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { OddsEventSchema, OddsUpdatedEventSchema } from "@/generated/events";
import { fetchOdds } from "@/lib/api";
import { getSocket } from "@/lib/websocket";
import type { OddsEvent } from "@/types";

// REST hydrate is public; the live-update socket still requires a session,
// so we only subscribe when logged in. `sport` is the canonical slug and
// `league` the canonical id to filter by (undefined = no filter on that axis);
// changing either re-keys the SWR fetch and re-hydrates from the server.
export function useOdds(loggedIn: boolean, sport?: string, league?: number) {
  const { data, isLoading, mutate } = useSWR<Map<string, OddsEvent>>(
    ["odds", sport, league],
    async () => {
      const events = await fetchOdds(sport, league);
      const parsed = events.map((e) => OddsEventSchema.parse(e));
      return new Map(parsed.map((e) => [e.eventId, e]));
    },
    {
      keepPreviousData: true
    }
  );

  useEffect(() => {
    if (!loggedIn) {
      return;
    }

    const socket = getSocket();
    socket.on("odds.updated", (data: unknown) => {
      const update = OddsUpdatedEventSchema.parse(data);
      // A tick is a delta (changing odds only); identity and canonical names
      // come from the hydrate. Merge onto the cached event so those survive,
      // writing back to the SWR cache without triggering a revalidation.
      void mutate(
        (prev) => {
          const existing = prev?.get(update.eventId);
          // No hydrated event yet → nothing to render from a bare delta; the
          // next hydrate will bring this event in with its identity/names.
          if (!existing) {
            return prev;
          }
          return new Map(prev).set(update.eventId, {
            ...existing,
            ...update,
          });
        },
        { revalidate: false },
      );
    });

    return () => {
      socket.off("odds.updated");
    };
  }, [loggedIn, mutate]);

  return { odds: Array.from((data ?? new Map()).values()), isLoading };
}
