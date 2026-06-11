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

  socket.on("connect_error", () => {
    if (socket?.active) {
      // `socket.active` is true for a transport/network failure (gateway down,
      // blip): socket.io is already auto-reconnecting, so leave it be
      return;
    }
    void refresh();
  });

  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
