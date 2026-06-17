"use client";

import { useEffect } from "react";
import useSWR from "swr";
import { BalanceUpdatedNotificationSchema } from "@/generated/events";
import { fetchBalance } from "@/lib/api";
import { getSocket } from "@/lib/websocket";

export function useBalance(token: string | null) {
  const { data, mutate } = useSWR<number>(token ? "balance" : null, () =>
    fetchBalance(),
  );

  useEffect(() => {
    if (!token) {
      return;
    }
    const socket = getSocket();
    const onBalance = (raw: unknown) => {
      void mutate(BalanceUpdatedNotificationSchema.parse(raw).balance, {
        revalidate: false,
      });
    };
    socket.on("balance.updated", onBalance);
    return () => {
      socket.off("balance.updated", onBalance);
    };
  }, [token, mutate]);

  return data ?? null;
}
