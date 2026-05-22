"use client";

import { useEffect, useState } from "react";
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
        if (cancelled) return;
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
    socket.on("odds.updated", (raw: unknown) => {
      const result = OddsEventSchema.safeParse(raw);
      if (!result.success) {
        console.warn("[useOdds] Invalid odds event:", result.error.flatten());
        return;
      }
      const event = result.data;
      setOdds((prev) => new Map(prev).set(event.eventId, event));
    });

    return () => {
      cancelled = true;
      socket.off("odds.updated");
    };
  }, [loggedIn]);

  return Array.from(odds.values());
}
