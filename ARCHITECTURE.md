# Architecture

## Overview

This is a distributed sports betting application built for demonstration
purposes. It uses a polyglot service architecture — NestJS for the real-time
core, FastAPI for the odds ingestion service, Flask + Flask-SocketIO for the
notifications service, and Next.js for the frontend. Services communicate
asynchronously via Redis pub/sub using protobuf-serialised messages.

---

## Stack
    
| Layer            | Technology                                      |
|------------------|-------------------------------------------------|
| Frontend         | Next.js (React, TailwindCSS, SWR / React Query) |
| Edge proxy       | Nginx (path-based routing only)                 |
| Core API         | NestJS (Node.js) — includes the wallet module   |
| Odds Service     | FastAPI (Python, asyncio)                       |
| Notifications    | Flask + Flask-SocketIO (Python, eventlet)       |
| Messaging        | Redis pub/sub                                   |
| Message format   | Protocol Buffers (protobuf)                     |
| Primary DB       | PostgreSQL                                      |
| Financial ledger | TigerBeetle                                     |
| Cache            | Redis                                           |
| External data    | The Odds API / SportsDB (free tier)             |

---

## Services

### Edge proxy (Nginx)
Nginx sits in front of the services and does path-based routing only — it is
**not** a smart API gateway. Any service that exposes HTTP endpoints needed by
the frontend is reachable through it.

Responsibilities:
- Path-based routing: `/socket.io/*` → Notifications, everything else → Core
- WebSocket connection upgrade (for the live odds, balance, and bet feeds)

Explicitly **not** responsibilities of the proxy:
- **Authentication / authorisation** — each service verifies its own JWTs.
- **Rate limiting** — handled per-service if at all.

### NestJS — Core API
The primary application service. Responsibilities:
- User registration, authentication (JWT / OAuth)
- Bet placement and settlement logic
- Wallet / ledger operations against TigerBeetle (in-process module)
- Subscribes to the odds Redis channel and re-publishes UI events to the
  notifications channel
- Publishes UI events (balance updates, bet status changes, broadcast odds)
  to Redis for the notifications service to deliver

Internally the wallet logic lives as a Nest module within the core service and
is invoked by the bets module via direct method calls — no Redis hop for
money movement.

### Flask + Flask-SocketIO — Notifications Service
The only service the browser holds an open socket to. Responsibilities:
- Accepts socket.io connections, verifies the JWT on `connect`, and joins each
  socket into a room named after its `sub` claim
- Subscribes to the Redis `notifications` channel; for each `NotificationEvent`
  it emits the carried JSON payload to the target user's room (or broadcasts
  if `user_id` is empty)

The service is stateless — no DB, no business logic — and exists purely so the
frontend has a fan-out point that doesn't depend on Core staying up to keep
sockets healthy.

### FastAPI — Odds Service
Lightweight async service responsible for ingesting odds from an external
provider. Responsibilities:
- Runs an `asyncio` polling loop (using `aiohttp`) against the external sports
  data API
- Normalises the incoming odds payload into a consistent internal schema
- Writes current odds to Redis for low-latency reads by other services
- Publishes `odds.updated` events to the Redis pub/sub channel

> **Note:** This service does not calculate odds. It is purely an ingestion and
> normalisation layer over an external feed.

---

## Inter-service Communication

Cross-process traffic flows over Redis pub/sub with **Protocol Buffer**
payloads — `.proto` schema files serve as the contract. The wallet logic is
colocated inside Core as a Nest module; bets call the wallet via direct
in-process method calls.

The frontend talks to Core over HTTP and to Notifications over a socket.io
connection (both through the Nginx proxy).

### Channels and event types

| Channel         | Publisher    | Subscribers   | Payload             |
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
- Users and authentication records
- Bet history and state
- Sports events and market definitions
- Sessions (or delegate to Redis)

### TigerBeetle
Owned exclusively by Core's wallet module. Stores:
- All account balances
- Every debit and credit as an immutable double-entry transfer
- Provides strong consistency and crash-safety guarantees for financial data

### Redis
Shared infrastructure, used for three distinct purposes:
1. **Pub/sub broker** — inter-service event bus (see above)
2. **Odds cache** — current odds written by the Odds Service, read directly by
   the Core API and served to the frontend
3. **Session store** — short-lived user session tokens

---

## External Dependencies

| Dependency              | Used by      | Purpose                                            |
|-------------------------|--------------|----------------------------------------------------|
| The Odds API / SportsDB | Odds Service | Source of truth for all sports odds and event data |

---

## Deployment

Each service is intended to run as an independent Docker container. A
`docker-compose.yml` at the repo root should wire up all services, Redis,
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
