"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { BetSettledNotificationSchema } from "@/generated/events";
import { fetchBets } from "@/lib/api";
import { getSocket } from "@/lib/websocket";
import type { Bet } from "@/types";

export function useBets(token: string | null) {
  const swr = useSWR<Bet[]>(token ? "bets" : null, () => fetchBets());

  useEffect(() => {
    if (!token) {
      return;
    }
    const socket = getSocket();
    const revalidate = () => {
      void swr.mutate();
    };
    // Settlement refreshes the table and pops a win/lose toast. `payout` is
    // profit only (matches Bet.payout semantics); 0 on a loss.
    const onSettled = (data: unknown) => {
      revalidate();
      const result = BetSettledNotificationSchema.safeParse(data);
      if (!result.success) {
        return;
      }
      const { won, payout } = result.data;
      if (won) {
        toast.success(`Bet won! +£${payout.toFixed(2)}`);
      } else {
        toast.error("Bet lost");
      }
    };

    socket.on("bet.held", revalidate);
    socket.on("bet.settled", onSettled);
    // Cover the gap if a settlement happened while the socket was disconnected.
    socket.on("connect", revalidate);

    return () => {
      socket.off("bet.held", revalidate);
      socket.off("bet.settled", onSettled);
      socket.off("connect", revalidate);
    };
  }, [token, swr]);

  return swr;
}
