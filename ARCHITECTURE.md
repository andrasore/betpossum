# Architecture

## Overview

This is a distributed sports betting application built for demonstration
purposes. It uses a polyglot service architecture — NestJS for the real-time
core, Flask/FastAPI for Python services, and Next.js for the frontend. Services
communicate asynchronously via Redis pub/sub using protobuf-serialised messages.

---

## Stack
    
| Layer            | Technology                                      |
|------------------|-------------------------------------------------|
| Frontend         | Next.js (React, TailwindCSS, SWR / React Query) |
| Edge proxy       | Nginx (path-based routing only)                 |
| Core API         | NestJS (Node.js)                                |
| Odds Service     | FastAPI (Python, asyncio)                       |
| Wallet Service   | Flask (Python)                                  |
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
- Path-based routing to the appropriate service (`/wallet/*` → Wallet,
  everything else → Core)
- WebSocket connection upgrade (for live odds and bet settlement feeds)

Explicitly **not** responsibilities of the proxy:
- **Authentication / authorisation** — each service verifies its own JWTs.
  (TODO: wallet currently decodes the JWT payload without verifying the
  signature; this needs to be replaced with proper verification using the
  shared `JWT_SECRET`.)
- **Rate limiting** — handled per-service if at all.

### NestJS — Core API
The primary application service. Responsibilities:
- User registration, authentication (JWT / OAuth)
- Bet placement and settlement logic
- WebSocket server for pushing live updates to the frontend
- Publishes and subscribes to Redis channels for inter-service communication

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

### Flask — Wallet Service
Isolated financial service. All money movement goes through here — no other
service writes to TigerBeetle directly. Responsibilities:
- Deposit and withdrawal flows
- Bet hold and payout operations (called by Core API via Redis)
- Maintains a double-entry ledger backed by TigerBeetle
- Subscribes to `bet.placed` and `bet.settled` events to trigger holds and
  releases
- Exposes `GET /wallet/balance` directly to the frontend (via the Nginx
  proxy). Inter-service write flows still go through Redis pub/sub.

---

## Inter-service Communication

Services do not call each other directly over HTTP. All **inter-service**
communication goes through Redis pub/sub. Messages are serialised with
**Protocol Buffers** — `.proto` schema files serve as the contract between
services.

The frontend, however, *does* talk to services over HTTP (through the Nginx
proxy). Read-only endpoints the frontend needs — e.g. `GET /wallet/balance` —
are served directly by the owning service.

### Channels and event types

| Channel        | Publisher      | Subscribers    | Payload                     |
|----------------|----------------|----------------|-----------------------------|
| `odds.updated` | Odds Service   | Core API       | `OddsUpdatedEvent`          |
| `bet.placed`   | Core API       | Wallet Service | `BetPlacedEvent`            |
| `bet.settled`  | Core API       | Wallet Service | `BetSettledEvent`           |
| `tx.confirmed` | Wallet Service | Core API       | `TransactionConfirmedEvent` |

### Why protobuf over JSON?
- Smaller payload size — important for high-frequency odds updates
- Schema is a first-class contract; breaking changes are caught at compile time
- Faster serialisation / deserialisation

> **When to graduate to Kafka:** Redis pub/sub has no message persistence or
> replay. If you need an audit trail of all financial events, fan-out to many
> consumers, or guaranteed delivery, migrate the financial channels
> (`bet.placed`, `bet.settled`, `tx.confirmed`) to Kafka.

---

## Data Storage

### PostgreSQL
Owned exclusively by the Core API service. Stores:
- Users and authentication records
- Bet history and state
- Sports events and market definitions
- Sessions (or delegate to Redis)

### TigerBeetle
Owned exclusively by the Wallet service. Stores:
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
│   ├── core/          # NestJS
│   ├── odds/          # FastAPI
│   └── wallet/        # Flask + TigerBeetle sidecar
├── proto/             # Shared .proto schema definitions
├── docker-compose.yml
└── ARCHITECTURE.md
```

> Proto definitions live in a shared top-level `/proto` directory so all
> services can reference the same schemas without duplication.
