"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { fetchBets } from "@/lib/api";
import { getSocket } from "@/lib/websocket";
import type { Bet } from "@/types";

export function useBets(token: string | null) {
  const swr = useSWR<Bet[]>(token ? "bets" : null, () => fetchBets());

  useEffect(() => {
    if (!token) return;
    const socket = getSocket();
    const revalidate = () => {
      void swr.mutate();
    };

    socket.on("bet.held", revalidate);
    socket.on("bet.settled", revalidate);
    // Cover the gap if a settlement happened while the socket was disconnected.
    socket.on("connect", revalidate);

    return () => {
      socket.off("bet.held", revalidate);
      socket.off("bet.settled", revalidate);
      socket.off("connect", revalidate);
    };
  }, [token, swr]);

  return swr;
}
