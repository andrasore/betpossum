"use client";

import { useEffect, useState } from "react";
import { OddsUpdatedEventSchema } from "@/generated/events";
import { fetchOdds } from "@/lib/api";
import { OddsEventSchema } from "@/lib/schemas";
import { getSocket } from "@/lib/websocket";
import type { OddsEvent } from "@/types";

// REST hydrate is public; the live-update socket still requires a session,
// so we only subscribe when logged in.
export function useOdds(loggedIn: boolean) {
  const [odds, setOdds] = useState<Map<string, OddsEvent>>(new Map());

  useEffect(() => {
    let cancelled = false;

    fetchOdds()
      .then((events) => {
        if (cancelled) {
          return;
        }
        const parsed = events.flatMap((e) => {
          const result = OddsEventSchema.safeParse(e);
          return result.success ? [result.data] : [];
        });
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
      const result = OddsUpdatedEventSchema.safeParse(data);
      if (!result.success) {
        return;
      }
      // A tick is a delta (changing odds only); identity and canonical names
      // come from the hydrate. Merge onto the existing event so those survive.
      setOdds((prev) => {
        const existing = prev.get(result.data.eventId);
        // No hydrated event yet → nothing to render from a bare delta; the next
        // hydrate will bring this event in with its identity/names.
        if (!existing) {
          return prev;
        }
        return new Map(prev).set(result.data.eventId, {
          ...existing,
          ...result.data,
        });
      });
    });

    return () => {
      cancelled = true;
      socket.off("odds.updated");
    };
  }, [loggedIn]);

  return Array.from(odds.values());
}
