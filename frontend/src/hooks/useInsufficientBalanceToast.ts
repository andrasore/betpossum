"use client";

import { useEffect } from "react";
import { InsufficientBalanceNotification } from "@/generated/events";
import { toaster } from "@/lib/toaster";
import { getSocket } from "@/lib/websocket";

export function useInsufficientBalanceToast(token: string | null) {
  useEffect(() => {
    if (!token) {
      return;
    }
    const socket = getSocket();
    const handler = (raw: ArrayBuffer) => {
      const msg = InsufficientBalanceNotification.fromBinary(
        new Uint8Array(raw),
      );
      toaster.create({
        type: "error",
        title: "Insufficient balance",
        description: `Stake £${msg.stake.toFixed(2)} exceeds your balance of £${msg.balance.toFixed(2)}.`,
      });
    };
    socket.on("insufficient.balance", handler);
    return () => {
      socket.off("insufficient.balance", handler);
    };
  }, [token]);
}
