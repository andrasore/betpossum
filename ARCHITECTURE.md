# Architecture

## Overview

This is a distributed sports betting application built for demonstration
purposes. It uses a polyglot service architecture — NestJS for the real-time
core, FastAPI for the odds ingestion service, Flask + Flask-SocketIO for the
notifications service, and Next.js for the frontend. Services communicate
asynchronously via RabbitMQ fanout exchanges using JSON messages validated
against a shared JSON Schema.

---

## Stack
    
| Layer            | Technology                                      |
|------------------|-------------------------------------------------|
| Frontend         | Next.js (React, Chakra UI v3, SWR) — static export |
| Edge proxy       | Nginx (path-based routing only)                 |
| Core API         | NestJS (Node.js) — includes the wallet module   |
| Odds Service     | FastAPI (Python, asyncio)                       |
| Notifications    | Flask + Flask-SocketIO (Python, eventlet)       |
| Identity         | Keycloak (OIDC, realm `betting`)                |
| Messaging        | RabbitMQ (fanout exchanges)                     |
| Message format   | JSON (validated against shared JSON Schema)     |
| Primary DB       | PostgreSQL                                      |
| Financial ledger | TigerBeetle                                     |
| External data    | The Odds API + API-Football (pluggable providers)|

---

## Services

### Next.js — Frontend (SPA)
A **pure static single-page app** (Next.js App Router, `output: "export"`).
`next build` emits `./out/`, which is copied straight into the nginx image —
there is **no Node.js frontend runtime and no server-side auth**; the browser
runs the bundle and talks to the backend itself.

- **Authentication** uses the OIDC **Authorization Code + PKCE** flow
  (`oidc-client-ts`) against Keycloak's public `betting-frontend` client. The
  access + ID tokens are held **in JS memory only** (never persisted), so a
  reload starts anonymous and re-bootstraps a session in the background.
- **Origin-agnostic, zero runtime config.** The realm (`betting`) and client id
  are the same in every environment and Keycloak is fronted same-origin under
  `/kc`, so the entire OIDC configuration is derived from
  `window.location.origin`. There is no `/config.js` / `window.__ENV` injection
  step — one static export runs unchanged on dev (8080) and e2e (18080).
- **Silent renew via a hidden same-origin iframe** (`prompt=none`,
  `automaticSilentRenew` ~60s before expiry). Keycloak's session cookie makes the
  round-trip invisible, so an expiring token never forces a top-level navigation
  and in-flight UI state survives. A 401 from the API or a socket `connect_error`
  triggers the same silent refresh; if it fails, the app drops to anonymous.
- **Roles** are read client-side from the access token's `realm_access` claim
  and drive **UI gating only** (e.g. the admin page) — they are never trusted for
  authorization, which each service enforces by verifying the JWT itself.
- **Single-origin data access.** Authenticated REST calls hit `/api/*` with the
  access token attached as `Authorization: Bearer …` from the in-memory snapshot;
  public reads (`/odds`, the leaderboard) go unauthenticated. REST responses
  hydrate an SWR cache that live socket.io events merge into (see Inter-service
  Communication).

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
| `/stats`       | Stats Service                     | `/me/*` authed, leaderboard public |
| `/api/*`       | Core API                          | Bearer token forwarded    |
| `/kc/*`        | Keycloak                          | OIDC login + token/JWKS   |
| `/` (default)  | Frontend (Next.js)                | Includes HMR WebSocket    |

Responsibilities:
- Path-based routing as above
- WebSocket connection upgrade for the live event feed (`/socket.io/`)
- Serves the SPA's static export at `/` (origin-agnostic: the SPA derives its
  Keycloak issuer from the current origin, so the same image runs on dev/8080
  and e2e/18080 with no per-environment config)
- Reverse-proxies Keycloak under `/kc` so the IdP is same-origin too

Explicitly **not** responsibilities of the proxy:
- **Authentication / authorisation** — each service verifies its own JWTs.
- **Rate limiting** — handled per-service if at all.

Keycloak sits behind nginx too, under the `/kc` path prefix
(`KC_HTTP_RELATIVE_PATH=/kc`), so the browser only ever sees the single nginx
origin. The login/refresh/logout hops are top-level redirects that need no CORS
regardless, but the SPA's PKCE code→token exchange is a `fetch` — routing
Keycloak through the same origin removes its dependence on the client's
Keycloak `webOrigins` CORS allow-list. Service-to-Keycloak backchannel traffic
(JWKS, admin API) stays
in-cluster via `KEYCLOAK_INTERNAL_URL` (`http://keycloak:8080/kc`) and does not
traverse nginx.

### Keycloak — Identity provider
Keycloak owns all authentication. The realm `betting` defines two roles —
`admin` (gates admin pages) and `user` (default for everyone) — plus two
clients: a public `betting-frontend` (PKCE, used by the SPA) and a
confidential `betting-core` (service-account access to the admin API for
user-info lookups). Keycloak persists to its own `keycloak` database on the
shared Postgres instance, isolated from the app's `betting` database.

### NestJS — Core API
The primary application service. Responsibilities:
- Bet placement and settlement logic
- Wallet / ledger operations against TigerBeetle (in-process module)
- Subscribes to the `events.resolved` exchange (durable queue
  `core.events.resolved`) and settles any held bets on the resolved event
- Publishes per-user UI events (bet held / settled, balance updated,
  insufficient balance) to the `notifications` exchange for the notifications
  service to deliver

Internally the wallet logic lives as a Nest module within the core service and
is invoked by the bets module via direct method calls — no broker hop for
money movement.

### Flask + Flask-SocketIO — Notifications Service
The only service the browser holds an open socket to. Responsibilities:
- Accepts socket.io connections, verifies the JWT on `connect`, and joins each
  socket into a room named after its `sub` claim
- Binds an exclusive auto-delete queue to the `notifications` fanout exchange;
  for each `NotificationEvent` it emits the carried JSON payload to the target
  user's room (or broadcasts if `userId` is empty)

The service is stateless — no DB, no business logic — and exists purely so the
frontend has a fan-out point that doesn't depend on Core staying up to keep
sockets healthy.

### FastAPI — Odds Service
Lightweight async service responsible for ingesting odds from one or more
external providers. Responsibilities:
- Runs a concurrent `asyncio` polling loop (using `aiohttp`) per enabled
  provider (`ODDS_PROVIDERS`); providers run side by side
- Normalises each provider's payload into a provider-agnostic **common model**
  (`CanonicalEvent` → `Market`s → `Selection`s) that represents many sports and
  bet types; events are kept separate per provider, stamped with an `origin`,
  and linked back to source ids via an `event_source_map` table
- Persists current odds to Postgres (the flexible model as JSONB, plus the
  projected 3-way columns the wire/HTTP contract reads)
- Publishes `OddsUpdatedEvent` messages to the `odds.updated` fanout exchange
- Serves the public `GET /odds` HTTP endpoint used by the frontend to
  hydrate the live markets board on first paint (live updates after that
  arrive via the notifications socket)

> **Note:** This service does not calculate odds. It is purely an ingestion and
> normalisation layer over an external feed.

### FastAPI — Stats Service
Maintains a read model built from settled bets — a logically separate read store
(its own schema) kept in sync off an event, so the dashboard's aggregate reads
don't hit Core.
Responsibilities:
- Subscribes to the durable `bets.settled` exchange (durable queue
  `stats.bets.settled`, manual ack) and upserts one row per settlement into its
  own `stats` schema (`stats_settlements`) of the shared `betting` DB, keyed on
  `betId` so redelivery is idempotent
- Serves the dashboard reads: `GET /stats/me/pnl` (cumulative ROI% per active
  UTC day), `GET /stats/me/summary` (staked / win-rate / ROI / net P&L — both
  authed), and `GET /stats/leaderboard` (top players by ROI, public)

The stats service owns its store and **never reads Core's or Odds' tables** —
the `BetSettledEvent` carries everything it needs (denormalized, incl. the
player's display name). It starts empty and accrues forward; there is no
backfill.

---

## Inter-service Communication

Cross-process traffic flows over RabbitMQ fanout exchanges with **JSON**
payloads — the schemas in `schemas/json/` serve as the contract (`events.json`
for the pubsub messages, `rest.json` for the HTTP resource shapes), from which
each service generates its bindings (Zod for TS, Pydantic for Python). The wallet
logic is colocated inside Core as a Nest module; bets call the wallet via
direct in-process method calls.

The frontend talks to Core and Odds over HTTP and to Notifications over a
socket.io connection — all through the Nginx proxy on a single origin.
Authenticated calls go to `/api/*` (proxied to Core) with the Keycloak
access token attached client-side as `Authorization: Bearer …` from the
SPA's in-memory store. The `/odds` hydrate is public and hits the gateway
without auth.

Each exchange is a `fanout` type. Subscribers declare their own anonymous
exclusive auto-delete queue and bind it to the exchange — semantically
equivalent to publish/subscribe: every running subscriber gets a copy, and
messages sent while no subscriber is connected are dropped.

### Exchanges and event types

| Exchange          | Publisher           | Subscribers   | Payload              |
|-------------------|---------------------|---------------|----------------------|
| `odds.updated`    | Odds Service        | —             | `OddsUpdatedEvent`   |
| `events.resolved` | Odds Service        | Core API      | `EventResolvedEvent` |
| `bets.settled`    | Core API            | Stats Service | `BetSettledEvent`    |
| `notifications`   | Core + Odds Service | Notifications | `NotificationEvent`  |

`bets.settled` is durable + persistent (like `events.resolved`): the stats
read model must not drop settlements, so it cannot ride the fire-and-forget
`notifications` exchange.

The browser's live odds updates do **not** flow over `odds.updated`: the Odds
Service separately broadcasts an `oddsUpdated` `NotificationEvent` (empty
`userId`) on the `notifications` exchange, which the Notifications service
relays. `odds.updated` carries the raw `OddsUpdatedEvent` and currently has no
in-process subscriber. Core consumes `events.resolved` to settle held bets.

`NotificationEvent` is a flat envelope: `userId` (empty = broadcast), `kind`
(discriminator mapped to a socket.io event name), and `payload` (the inner
message object the frontend consumes verbatim). It is fire-and-forget — Core
does not wait for a reply.

### Why JSON Schema?
- One schema is the contract for all four services; bindings are generated, so
  drift is caught by the pre-push guard rather than at runtime
- Runtime validation on both ends (Zod / Pydantic) — malformed messages are
  rejected at the boundary instead of corrupting state
- Human-readable on the wire (RabbitMQ management UI, socket frames), and no
  binary toolchain to install

---

## Data Storage

### PostgreSQL
A single Postgres instance backs the whole stack. It hosts two databases:

- **`betting`** — the application database, partitioned into one schema per
  service (`DB_SCHEMA` selects it) so each owns its tables in isolation:
  - `core` — local user records (id only — PK matches the Keycloak `sub`; email
    and name are fetched on demand from Keycloak), bet history and state.
  - `odds` — current odds + history written by the Odds service (read over HTTP
    by the SPA, not via a shared table).
  - `stats` — the Stats read model (`stats_settlements`), kept independent of
    Core's tables.
- **`keycloak`** — Keycloak's own database (own role/credentials), isolated from
  application data.

`postgres/init.sql` provisions the `keycloak` database and the three schemas on
first boot of a fresh data volume.

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

| Dependency                  | Used by      | Purpose                                            |
|-----------------------------|--------------|----------------------------------------------------|
| The Odds API                | Odds Service | Multi-sport odds (h2h, totals) — provider `theoddsapi` |
| API-Football (api-sports.io)| Odds Service | Football fixtures + rich bet types — provider `apifootball` |

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
│   ├── odds/          # FastAPI
│   └── stats/         # FastAPI — read model over settled bets
├── schemas/           # Shared JSON Schema message definitions
├── docker-compose.yml
└── ARCHITECTURE.md
```

> Proto definitions live in a shared top-level `/proto` directory so all
> services can reference the same schemas without duplication.

## Observability

On Kubernetes, an optional Helm-installed platform lives in its own
`observability` namespace (`k8s/observability/`):

- **Metrics** — kube-prometheus-stack: Prometheus scrapes cluster/infra metrics
  (node-exporter, kube-state-metrics, cAdvisor), with Alertmanager for routing.
- **Logs** — Loki (single-binary, filesystem) as the store, fed by **Alloy** (a
  DaemonSet) tailing every pod's logs.
- **Dashboards** — Grafana, wired to both Prometheus and Loki, exposed on its own
  Ingress host.

This is infra-level only today; the app services do not yet export `/metrics`, so
per-service instrumentation (prom-client / prometheus_client + ServiceMonitors) is
a future step. See `k8s/observability/README.md`.
