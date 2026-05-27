"use client";

import { useEffect, useState } from "react";
import { BalanceUpdatedNotification } from "@/generated/events";
import { fetchBalance } from "@/lib/api";
import { getSocket } from "@/lib/websocket";

export function useBalance(token: string | null) {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    fetchBalance()
      .then(setBalance)
      .catch(() => {});

    const socket = getSocket();
    socket.on("balance.updated", (raw: ArrayBuffer) => {
      const msg = BalanceUpdatedNotification.fromBinary(new Uint8Array(raw));
      setBalance(msg.balance);
    });
    return () => {
      socket.off("balance.updated");
    };
  }, [token]);

  return balance;
}
