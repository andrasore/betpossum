# Architecture

## Overview

This is a distributed sports betting application built for demonstration
purposes. It uses a polyglot service architecture — NestJS for the real-time
core, FastAPI for the odds ingestion service, and Next.js for the frontend.
The core and odds services communicate asynchronously via Redis pub/sub using
protobuf-serialised messages.

---

## Stack
    
| Layer            | Technology                                      |
|------------------|-------------------------------------------------|
| Frontend         | Next.js (React, TailwindCSS, SWR / React Query) |
| Edge proxy       | Nginx (path-based routing only)                 |
| Core API         | NestJS (Node.js) — includes the wallet module   |
| Odds Service     | FastAPI (Python, asyncio)                       |
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
- Path-based routing to the Core API (the wallet endpoints are served by
  Core's wallet module)
- WebSocket connection upgrade (for live odds and bet settlement feeds)

Explicitly **not** responsibilities of the proxy:
- **Authentication / authorisation** — each service verifies its own JWTs.
- **Rate limiting** — handled per-service if at all.

### NestJS — Core API
The primary application service. Responsibilities:
- User registration, authentication (JWT / OAuth)
- Bet placement and settlement logic
- Wallet / ledger operations against TigerBeetle (in-process module)
- WebSocket server for pushing live updates to the frontend
- Subscribes to the odds Redis channel for inter-service communication

Internally the wallet logic lives as a Nest module within the core service and
is invoked by the bets module via direct method calls — no Redis hop for
money movement.

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

The only cross-process boundary in the system is between the Odds Service and
the Core API. They communicate asynchronously via Redis pub/sub with
**Protocol Buffer** payloads — `.proto` schema files serve as the contract.

The wallet logic is colocated inside Core as a Nest module; bets call the
wallet via direct in-process method calls.

The frontend talks to Core over HTTP (through the Nginx proxy).

### Channels and event types

| Channel        | Publisher    | Subscribers | Payload            |
|----------------|--------------|-------------|--------------------|
| `odds.updated` | Odds Service | Core API    | `OddsUpdatedEvent` |

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
│   └── odds/          # FastAPI
├── proto/             # Shared .proto schema definitions
├── docker-compose.yml
└── ARCHITECTURE.md
```

> Proto definitions live in a shared top-level `/proto` directory so all
> services can reference the same schemas without duplication.
