'use client';

import { io, Socket } from 'socket.io-client';
import { logout, refreshAccessToken } from '@/lib/keycloak';

let socket: Socket | null = null;

function resolveWsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.hostname}:8080`;
}

export function getSocket(): Socket {
  if (socket) return socket;

  socket = io(resolveWsUrl(), {
    // auth as a function is re-invoked on every (re)connect attempt, so a
    // post-refresh attempt automatically picks up the new token.
    auth: (cb) => cb({ token: localStorage.getItem('token') }),
    transports: ['websocket'],
  });

  // Only refresh once per disconnected period — reset on successful connect.
  let refreshing: Promise<unknown> | null = null;
  socket.on('connect', () => { refreshing = null; });
  socket.on('connect_error', () => {
    if (refreshing) return;
    refreshing = refreshAccessToken().catch(() => {
      logout();
    });
  });

  return socket;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
