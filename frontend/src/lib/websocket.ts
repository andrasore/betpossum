"use client";

import { io, type Socket } from "socket.io-client";
import { getAccessToken, refresh } from "./auth";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) {
    return socket;
  }

  socket = io({
    // Re-evaluated by socket.io on every (re)connect — if the access token
    // has been replaced after a refresh, the new value gets picked up.
    auth: (cb) => cb({ token: getAccessToken() ?? "" }),
    transports: ["websocket"],
  });

  let recovering = false;
  socket.on("connect", () => {
    recovering = false;
  });
  socket.on("connect_error", () => {
    if (recovering) {
      return;
    }
    recovering = true;
    // Likely token expiry. Trigger a redirect-based refresh.
    refresh();
  });

  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
