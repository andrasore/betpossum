"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { InsufficientBalanceNotification } from "@/generated/events";
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
      toast.error("Insufficient balance", {
        description: `Stake £${msg.stake.toFixed(2)} exceeds your balance of £${msg.balance.toFixed(2)}.`,
      });
    };
    socket.on("insufficient.balance", handler);
    return () => {
      socket.off("insufficient.balance", handler);
    };
  }, [token]);
}
