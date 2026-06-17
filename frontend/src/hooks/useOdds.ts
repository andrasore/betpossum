"use client";

import { useEffect, useState } from "react";
import { OddsEventSchema, OddsUpdatedEventSchema } from "@/generated/events";
import { fetchOdds } from "@/lib/api";
import { getSocket } from "@/lib/websocket";
import type { OddsEvent } from "@/types";

// REST hydrate is public; the live-update socket still requires a session,
// so we only subscribe when logged in. `sport` is the canonical slug and
// `league` the canonical id to filter by (undefined = no filter on that axis);
// changing either re-hydrates from the server.
export function useOdds(loggedIn: boolean, sport?: string, league?: number) {
  const [odds, setOdds] = useState<Map<string, OddsEvent>>(new Map());

  useEffect(() => {
    let cancelled = false;

    fetchOdds(sport, league)
      .then((events) => {
        if (cancelled) {
          return;
        }
        const parsed = events.map((e) => OddsEventSchema.parse(e));
        setOdds(new Map(parsed.map((e) => [e.eventId, e])));
      })
      .catch((err) => console.warn("[useOdds] hydrate failed", err));

    if (!loggedIn) {
      return () => {
        cancelled = true;
      };
    }

    const socket = getSocket();
    socket.on("odds.updated", (data: unknown) => {
      const update = OddsUpdatedEventSchema.parse(data);
      // A tick is a delta (changing odds only); identity and canonical names
      // come from the hydrate. Merge onto the existing event so those survive.
      setOdds((prev) => {
        const existing = prev.get(update.eventId);
        // No hydrated event yet → nothing to render from a bare delta; the next
        // hydrate will bring this event in with its identity/names.
        if (!existing) {
          return prev;
        }
        return new Map(prev).set(update.eventId, {
          ...existing,
          ...update,
        });
      });
    });

    return () => {
      cancelled = true;
      socket.off("odds.updated");
    };
  }, [loggedIn, sport, league]);

  return Array.from(odds.values());
}
