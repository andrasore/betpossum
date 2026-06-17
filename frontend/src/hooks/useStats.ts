"use client";

import { useEffect } from "react";
import useSWR, { type KeyedMutator } from "swr";
import { fetchLeaderboard, fetchPnlSeries, fetchStatsSummary } from "@/lib/api";
import { getSocket } from "@/lib/websocket";
import type { LeaderboardEntry, PnlPoint, StatsSummary } from "@/types";

// Stats are derived from settled bets, so they only change on settlement.
// Revalidate on the per-user `bet.settled` socket event (and on reconnect, to
// cover a settlement that landed while the socket was down).
function useSettlementRevalidation<T>(
  mutate: KeyedMutator<T>,
  token: string | null,
): void {
  useEffect(() => {
    if (!token) {
      return;
    }
    const socket = getSocket();
    const revalidate = () => {
      void mutate();
    };
    socket.on("bet.settled", revalidate);
    socket.on("connect", revalidate);
    return () => {
      socket.off("bet.settled", revalidate);
      socket.off("connect", revalidate);
    };
  }, [token, mutate]);
}

export function usePnlSeries(token: string | null) {
  const swr = useSWR<PnlPoint[]>(token ? "stats/pnl" : null, () =>
    fetchPnlSeries(),
  );
  useSettlementRevalidation(swr.mutate, token);
  return swr;
}

export function useStatsSummary(token: string | null) {
  const swr = useSWR<StatsSummary>(token ? "stats/summary" : null, () =>
    fetchStatsSummary(),
  );
  useSettlementRevalidation(swr.mutate, token);
  return swr;
}

export function useLeaderboard(token: string | null) {
  // Public — loads even when logged out (the dashboard sidebar shows it always).
  const swr = useSWR<LeaderboardEntry[]>("stats/leaderboard", () =>
    fetchLeaderboard(),
  );
  useSettlementRevalidation(swr.mutate, token);
  return swr;
}
