# Architecture

## Overview

This is a distributed sports betting application built for demonstration
purposes. It uses a polyglot service architecture — NestJS for the real-time
core, FastAPI for the odds ingestion service, Flask + Flask-SocketIO for the
notifications service, and Next.js for the frontend. Services communicate
asynchronously via RabbitMQ fanout exchanges using protobuf-serialised
messages.

---

## Stack
    
| Layer            | Technology                                      |
|------------------|-------------------------------------------------|
| Frontend         | Next.js (React, TailwindCSS, SWR / React Query) |
| Edge proxy       | Nginx (path-based routing only)                 |
| Core API         | NestJS (Node.js) — includes the wallet module   |
| Odds Service     | FastAPI (Python, asyncio)                       |
| Notifications    | Flask + Flask-SocketIO (Python, eventlet)       |
| Identity         | Keycloak (OIDC, realm `betting`)                |
| Messaging        | RabbitMQ (fanout exchanges)                     |
| Message format   | Protocol Buffers (protobuf)                     |
| Primary DB       | PostgreSQL                                      |
| Financial ledger | TigerBeetle                                     |
| External data    | The Odds API / SportsDB (free tier)             |

---

## Services

### Edge proxy (Nginx)
Nginx is the sole browser-facing port and fronts *everything* — the frontend
and the public backend endpoints — so the browser only ever sees one origin.
This eliminates CORS and any need for runtime URL injection in the client
bundle. It still does path-based routing only and is **not** a smart API
gateway.

Path routing:

| Prefix         | Upstream                          | Notes                     |
|----------------|-----------------------------------|---------------------------|
| `/socket.io/*` | Notifications                     | WebSocket upgrade         |
| `/odds`        | Odds Service                      | Public, unauthenticated   |
| `/` (default)  | Frontend (Next.js)                | Includes HMR WebSocket    |

Responsibilities:
- Path-based routing as above
- WebSocket connection upgrade for both the live event feed (`/socket.io/`)
  and Turbopack's HMR (`/_next/*`)
- Bumped `proxy_buffer_size` on the frontend location so NextAuth's
  callback `Set-Cookie` (JWT-bearing) doesn't overflow the default 4k
  header buffer

Explicitly **not** responsibilities of the proxy:
- **Authentication / authorisation** — each service verifies its own JWTs.
- **Rate limiting** — handled per-service if at all.
- **Server-to-server traffic** — the BFF (`/api/proxy/*` inside Next) talks
  to Core directly via the docker network, not back through nginx. Routing
  internal calls through the public-facing proxy would create a frontend ↔
  nginx loop and is explicitly avoided.

Keycloak is *not* behind nginx — it has its own port (`8090` dev / `18090`
e2e). The browser → Keycloak hop is just a login redirect, no CORS
implications, so the split is harmless.

### Keycloak — Identity provider
Keycloak owns all authentication. The realm `betting` defines two roles —
`admin` (gates admin pages) and `user` (default for everyone) — plus two
clients: a public `betting-frontend` (PKCE, used by the SPA) and a
confidential `betting-core` (service-account access to the admin API for
user-info lookups). Keycloak ships with its own dedicated Postgres instance.

### NestJS — Core API
The primary application service. Responsibilities:
- Bet placement and settlement logic
- Wallet / ledger operations against TigerBeetle (in-process module)
- Subscribes to the `odds.updated` exchange and re-publishes UI events to the
  `notifications` exchange
- Publishes UI events (balance updates, bet status changes, broadcast odds)
  to the `notifications` exchange for the notifications service to deliver

Internally the wallet logic lives as a Nest module within the core service and
is invoked by the bets module via direct method calls — no broker hop for
money movement.

### Flask + Flask-SocketIO — Notifications Service
The only service the browser holds an open socket to. Responsibilities:
- Accepts socket.io connections, verifies the JWT on `connect`, and joins each
  socket into a room named after its `sub` claim
- Binds an exclusive auto-delete queue to the `notifications` fanout exchange;
  for each `NotificationEvent` it emits the carried JSON payload to the target
  user's room (or broadcasts if `user_id` is empty)

The service is stateless — no DB, no business logic — and exists purely so the
frontend has a fan-out point that doesn't depend on Core staying up to keep
sockets healthy.

### FastAPI — Odds Service
Lightweight async service responsible for ingesting odds from an external
provider. Responsibilities:
- Runs an `asyncio` polling loop (using `aiohttp`) against the external sports
  data API
- Normalises the incoming odds payload into a consistent internal schema
- Persists current odds to Postgres
- Publishes `OddsUpdatedEvent` messages to the `odds.updated` fanout exchange
- Serves the public `GET /odds` HTTP endpoint used by the frontend to
  hydrate the live markets board on first paint (live updates after that
  arrive via the notifications socket)

> **Note:** This service does not calculate odds. It is purely an ingestion and
> normalisation layer over an external feed.

---

## Inter-service Communication

Cross-process traffic flows over RabbitMQ fanout exchanges with **Protocol
Buffer** payloads — `.proto` schema files serve as the contract. The wallet
logic is colocated inside Core as a Nest module; bets call the wallet via
direct in-process method calls.

The frontend talks to Core and Odds over HTTP and to Notifications over a
socket.io connection — all through the Nginx proxy on a single origin.
Authenticated calls go via the Next.js BFF (`/api/proxy/*`), which attaches
the Keycloak access token server-side and forwards to Core directly (the
browser never sees the token). The `/odds` hydrate is public and hits the
gateway without auth.

Each exchange is a `fanout` type. Subscribers declare their own anonymous
exclusive auto-delete queue and bind it to the exchange — semantically
equivalent to publish/subscribe: every running subscriber gets a copy, and
messages sent while no subscriber is connected are dropped.

### Exchanges and event types

| Exchange        | Publisher    | Subscribers   | Payload             |
|-----------------|--------------|---------------|---------------------|
| `odds.updated`  | Odds Service | Core API      | `OddsUpdatedEvent`  |
| `notifications` | Core API     | Notifications | `NotificationEvent` |

`NotificationEvent` is a thin envelope: `user_id` (empty = broadcast), `event`
(socket.io event name), and `payload` (JSON-encoded data the frontend
consumes verbatim). It is fire-and-forget — Core does not wait for a reply.

### Why protobuf over JSON?
- Smaller payload size — important for high-frequency odds updates
- Schema is a first-class contract; breaking changes are caught at compile time
- Faster serialisation / deserialisation

---

## Data Storage

### PostgreSQL
Owned exclusively by the Core API service. Stores:
- Local user records (id only — primary key matches the Keycloak `sub`;
  email and name are fetched on demand from Keycloak)
- Bet history and state
- Sports events and market definitions
- Current odds (written by the Odds service, read by Core)

Keycloak runs against its own separate Postgres instance.

### TigerBeetle
Owned exclusively by Core's wallet module. Stores:
- All account balances
- Every debit and credit as an immutable double-entry transfer
- Provides strong consistency and crash-safety guarantees for financial data

### RabbitMQ
Shared infrastructure, used as the inter-service event bus (see
"Inter-service Communication" above). The management UI is exposed on
`localhost:15672` in dev (user `betting`, password `betting_dev`).

---

## External Dependencies

| Dependency              | Used by      | Purpose                                            |
|-------------------------|--------------|----------------------------------------------------|
| The Odds API / SportsDB | Odds Service | Source of truth for all sports odds and event data |

---

## Deployment

Each service is intended to run as an independent Docker container. A
`docker-compose.yml` at the repo root should wire up all services, RabbitMQ,
PostgreSQL, and TigerBeetle for local development.

Suggested repo structure:

```
/
├── frontend/          # Next.js
├── nginx/             # Edge proxy config
├── services/
│   ├── core/          # NestJS — includes wallet/TigerBeetle module
│   ├── notifications/ # Flask + Flask-SocketIO (browser-facing WS)
│   └── odds/          # FastAPI
├── proto/             # Shared .proto schema definitions
├── docker-compose.yml
└── ARCHITECTURE.md
```

> Proto definitions live in a shared top-level `/proto` directory so all
> services can reference the same schemas without duplication.
