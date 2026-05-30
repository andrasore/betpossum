# CLAUDE.md — Notifications Service (FastAPI + python-socketio)

Guidance for working in `services/notifications`. See the root `CLAUDE.md` and
`ARCHITECTURE.md` for context.

## Commands

```bash
pnpm --filter @betting/notifications run init       # .venv + pip install -e .[dev]
pnpm --filter @betting/notifications run typecheck   # pyright (strict)
pnpm --filter @betting/notifications run lint         # ruff
```

No `build` script (Python workspace). `proto:gen` regenerates `src/generated`
from `/proto`.

## What this service does

The only service the browser holds an open socket to. It's a **stateless relay**
— no DB, no business logic:

1. Accepts socket.io connections, verifies the Keycloak JWT on `connect`, and
   joins each socket into a room named after its `sub` claim.
2. Binds an exclusive auto-delete queue to the `notifications` fanout exchange;
   for each `NotificationEvent` it re-emits the inner protobuf body to the
   target user's room (or broadcasts when `user_id` is empty).

## Layout (`src/`)

- `app.py` — socket.io `AsyncServer` wrapped over FastAPI; `connect` handler
  does the JWT check + room join; `lifespan` spawns the subscriber task.
- `subscriber.py` — RabbitMQ consumer; the `SOCKET_EVENT` map translates each
  `NotificationEvent.body` oneof variant to the socket.io event name.

## Non-obvious conventions

- **Keep it dumb.** No persistence, no business decisions. If you're tempted to
  add state or logic here, it almost certainly belongs in Core instead. The
  service exists so the frontend has a fan-out point that survives Core
  restarts.
- **The wire payload is the inner protobuf, not JSON.** `subscriber.py` emits
  `getattr(event, variant).SerializeToString()`; the frontend decodes the
  binary frame with the matching generated message type. Adding a notification
  type = add a oneof variant in `/proto`, then a `SOCKET_EVENT` entry here.
- **Per-user rooms are keyed on the JWT `sub`.** Same claim Core uses as the
  user id, so a `NotificationEvent.user_id` routes straight to the right socket.
- **Pyright strict; per-line ignores only** (`# pyright: ignore[rule]`). The
  socketio stubs are incomplete, hence the existing inline ignores — keep them
  scoped, never file-wide.
