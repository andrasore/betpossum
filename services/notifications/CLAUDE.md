# CLAUDE.md — Notifications Service (FastAPI + python-socketio)

Guidance for working in `services/notifications`. See the root `CLAUDE.md` and
`ARCHITECTURE.md` for context.

## Commands

```bash
pnpm --filter @betting/notifications run init       # uv sync --extra dev (.venv from uv.lock)
pnpm --filter @betting/notifications run typecheck   # pyright (strict)
pnpm --filter @betting/notifications run lint         # ruff
```

No `build` script (Python workspace). `schema:gen` regenerates `src/generated`
(Pydantic models) from `/schemas`.

## What this service does

The only service the browser holds an open socket to. It's a **stateless relay**
— no DB, no business logic:

1. Accepts socket.io connections, verifies the Keycloak JWT on `connect`, and
   joins each socket into a room named after its `sub` claim.
2. Binds an exclusive auto-delete queue to the `notifications` fanout exchange;
   for each `NotificationEvent` it re-emits the inner JSON `payload` to the
   target user's room (or broadcasts when `userId` is empty).

## Layout (`src/`)

- `app.py` — socket.io `AsyncServer` wrapped over FastAPI; `connect` handler
  does the JWT check + room join; `lifespan` spawns the subscriber task.
- `subscriber.py` — RabbitMQ consumer; the `SOCKET_EVENT` map translates each
  `NotificationEvent.kind` discriminator to the socket.io event name.

## Non-obvious conventions

- **Keep it dumb.** No persistence, no business decisions. If you're tempted to
  add state or logic here, it almost certainly belongs in Core instead. The
  service exists so the frontend has a fan-out point that survives Core
  restarts.
- **The wire payload is the envelope's inner `payload`, emitted as JSON.**
  `subscriber.py` emits `event.payload` (a dict — socket.io serialises it);
  the frontend validates it with the matching generated Zod schema. Adding a
  notification type = add a message `$def` + `kind` enum value in `/schemas`,
  then a `SOCKET_EVENT` entry here.
- **Per-user rooms are keyed on the JWT `sub`.** Same claim Core uses as the
  user id, so a `NotificationEvent.user_id` routes straight to the right socket.
- **Pyright strict; per-line ignores only** (`# pyright: ignore[rule]`). The
  socketio stubs are incomplete, hence the existing inline ignores — keep them
  scoped, never file-wide.
