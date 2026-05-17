'use client';

import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

function resolveWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.hostname}:8080`;
}

export function getSocket(token: string): Socket {
  if (!socket) {
    socket = io(resolveWsUrl(), {
      auth: { token },
      transports: ['websocket'],
    });
  }
  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
