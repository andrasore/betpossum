"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { InsufficientBalanceNotificationSchema } from "@/generated/events";
import { getSocket } from "@/lib/websocket";

export function useInsufficientBalanceToast(token: string | null) {
  useEffect(() => {
    if (!token) {
      return;
    }
    const socket = getSocket();
    const handler = (data: unknown) => {
      const result = InsufficientBalanceNotificationSchema.safeParse(data);
      if (!result.success) {
        return;
      }
      const msg = result.data;
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
