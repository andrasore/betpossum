# CLAUDE.md — Notifications Service (NestJS + socket.io)

Guidance for working in `services/notifications`. See the root `CLAUDE.md` and
`ARCHITECTURE.md` for context.

## Commands

```bash
pnpm --filter @betting/notifications run start:dev   # nest start --watch
```

Typecheck, build, test and `schema:gen` from the **repo root** (`pnpm typecheck`
/ `pnpm build` / `pnpm test` / `pnpm schema:gen`), never from this workspace —
generated bindings and Turbo caching assume the root run. Lint is Biome.

## What this service does

The only service the browser holds an open socket to. It's a **stateless relay**
— no DB, no business logic:

1. Accepts socket.io connections, verifies the Keycloak JWT during the handshake,
   and joins each socket into a room named after its `sub` claim.
2. Binds an exclusive auto-delete queue to the `notifications` fanout exchange;
   for each `NotificationEvent` it re-emits the inner JSON `payload` to the
   target user's room (or broadcasts when `userId` is empty).

## Layout (`src/`)

- `relay/relay.gateway.ts` — the `@WebSocketGateway`; `afterInit` installs the
  handshake middleware, `handleConnection` does the room join.
- `relay/relay.service.ts` — RabbitMQ subscriber; parses the envelope and emits.
- `relay/socket-events.ts` — the `SOCKET_EVENT` map from `NotificationEvent.kind`
  to the socket.io event name.
- `auth/token-verifier.service.ts` — JWKS-backed RS256 verification.
- `messaging/` — the amqplib wrapper (fanout exchanges, JSON bodies).
- `health/` — `GET /health`, the container healthcheck endpoint.

## Non-obvious conventions

- **Keep it dumb.** No persistence, no business decisions. If you're tempted to
  add state or logic here, it almost certainly belongs in Core instead. The
  service exists so the frontend has a fan-out point that survives Core
  restarts.
- **Reject handshakes with `next(new Error(...))`, never `client.disconnect()`.**
  The SPA (`frontend/src/lib/websocket.ts`) triggers its silent token refresh
  from `connect_error`; a server-side disconnect fires `disconnect` instead and
  breaks refresh without breaking anything visibly. That is why the JWT check
  lives in socket.io middleware rather than in `handleConnection`.
- **The wire payload is the envelope's inner `payload`, emitted as JSON.**
  `relay.service.ts` emits `event.payload`; the frontend validates it with the
  matching generated Zod schema. Adding a notification type = add a message
  `$def` + `kind` enum value in `/schemas`, then a `SOCKET_EVENT` entry here.
- **Per-user rooms are keyed on the JWT `sub`.** Same claim Core uses as the
  user id, so a `NotificationEvent.userId` routes straight to the right socket.
- **Default namespace, default `/socket.io` path, `cors.origin: "*"`.** nginx
  routes on the path and the SPA connects to the default namespace, so neither
  may change. The wildcard origin is Engine.IO's server-side Origin allowlist,
  not browser CORS — behind nginx the browser Origin never matches the upstream
  Host, so the default check would 403 every handshake. The JWT is the real
  boundary.
- **The `notifications` exchange is transient and `noAck`.** Messages published
  while this service is down are dropped, by design. Declaring it durable would
  fail with `PRECONDITION_FAILED` against Core's and Odds' publishers.
- **A token is verified once, at handshake.** A socket whose token later expires
  keeps its room until it disconnects. That is the existing behaviour; changing
  it is a deliberate decision, not a cleanup.
- **Single instance.** socket.io rooms live in process memory, so scaling out
  needs sticky routing or a socket.io message-queue adapter first.
