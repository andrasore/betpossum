"use client";

import { signIn } from "next-auth/react";
import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

async function fetchSocketToken(): Promise<string> {
  const res = await fetch("/api/socket-token", { cache: "no-store" });
  if (!res.ok) throw new Error(`socket-token failed: ${res.status}`);
  const { token } = (await res.json()) as { token: string };
  return token;
}

export function getSocket(): Socket {
  if (socket) return socket;

  socket = io({
    // socket.io re-invokes this on every (re)connect, so the BFF can mint
    // a freshly-refreshed token if the previous one expired.
    auth: (cb) => {
      fetchSocketToken()
        .then((token) => cb({ token }))
        .catch(() => cb({ token: "" }));
    },
    transports: ["websocket"],
  });

  let refreshing = false;
  socket.on("connect", () => {
    refreshing = false;
  });
  socket.on("connect_error", () => {
    if (refreshing) return;
    refreshing = true;
    // A connect_error that survives a token refresh means the session is
    // dead; bounce the user through sign-in.
    fetchSocketToken().catch(() => {
      void signIn("keycloak");
    });
  });

  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
