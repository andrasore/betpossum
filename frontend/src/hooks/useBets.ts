"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { BetSettledNotificationSchema } from "@/generated/events";
import { fetchBets } from "@/lib/api";
import { getSocket } from "@/lib/websocket";
import type { Bet, OddsEvent } from "@/types";
import { useOddsIndex } from "./useOddsIndex";

export function useBets(token: string | null) {
  const swr = useSWR<Bet[]>(token ? "bets" : null, () => fetchBets());
  // Settlement notifications carry only `betId`; team names live on the odds
  // feed. Reuse the shared (unfiltered) odds index — the same join the bets
  // table uses — so the win/lose toast can name the matchup.
  const oddsIndex = useOddsIndex(token);

  // Hold the latest bets/odds in refs so the settlement handler can read them
  // without the socket effect resubscribing whenever either updates.
  const betsRef = useRef(swr.data);
  betsRef.current = swr.data;
  const oddsRef = useRef(oddsIndex);
  oddsRef.current = oddsIndex;

  const { mutate } = swr;
  useEffect(() => {
    if (!token) {
      return;
    }
    const socket = getSocket();
    const revalidate = () => {
      void mutate();
    };
    // Settlement refreshes the table and pops a win/lose toast naming the
    // matchup. `payout` is profit only (matches Bet.payout semantics); 0 on a
    // loss. The matchup is omitted if the bet's event isn't in the odds index.
    const onSettled = (data: unknown) => {
      revalidate();
      const result = BetSettledNotificationSchema.parse(data);
      const { betId, won, payout } = result;
      const bet = betsRef.current?.find((b) => b.id === betId);
      const event = bet ? oddsRef.current.get(bet.eventId) : undefined;
      createToast(won, payout, event);
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
  }, [token, mutate]);

  return swr;
}

function createToast(won: boolean, payout: number, event?: OddsEvent) {
  const matchup = event
    ? `${event.homeTeamName ?? event.homeTeam} vs ${event.awayTeamName ?? event.awayTeam}`
    : null;
  if (won) {
    toast.success(
      matchup
        ? `Bet won! ${matchup} +£${payout.toFixed(2)}`
        : `Bet won! +£${payout.toFixed(2)}`,
    );
  } else {
    toast.error(matchup ? `Bet lost — ${matchup}` : "Bet lost");
  }
}
