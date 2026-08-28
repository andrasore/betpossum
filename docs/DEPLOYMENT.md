# Deployment — Coolify

BetPossum deploys as a single [Coolify](https://coolify.io) Docker Compose
resource on a server you own. Coolify clones this repo, runs
[`docker-compose.coolify.yml`](../docker-compose.coolify.yml), and fronts it with
its own Traefik proxy, which terminates TLS and issues Let's Encrypt
certificates. The images come from GHCR, published by CI — the server never
builds the monorepo.

```
Internet ──► Coolify Traefik (TLS) ──► nginx:80 ──┬─► core:4000           (/api/)
                                                   ├─► odds:8000          (/odds)
                                                   ├─► stats:8000         (/stats)
                                                   ├─► notifications:8000 (/socket.io/)
                                                   ├─► keycloak:8080      (/kc/)
                                                   └─► static SPA         (/)
```

The SPA is origin-agnostic — `frontend/src/lib/auth.ts` derives the OIDC issuer
from `window.location.origin` — so moving to a real hostname needs **no image
rebuild**. Only Keycloak's hostname and the realm's redirect URIs change, and
both are driven by a single `PUBLIC_ORIGIN` variable.

## Server prerequisites

- Docker, and a kernel new enough for **io_uring** — the TigerBeetle ledger and
  the TigerBeetle client inside `core` both need it. Both containers run with
  `security_opt: seccomp=unconfined`; a host that refuses that will boot the
  stack but every wallet operation will fail.
- ~4 GB RAM. The stack is ten containers, of which Keycloak and Postgres are the
  memory-hungry ones.
- Ports **22**, **80**, **443** open. Coolify's own dashboard also uses **8000**,
  **6001** and **6002**; once you put the dashboard behind its own domain you can
  close those.

## GHCR access

CI publishes to `ghcr.io/andrasore/betpossum/{core,odds,notifications,stats,frontend,keycloak,bots}`.
**GHCR packages are private by default.** Either make those seven packages
public, or add a registry credential in Coolify (*Keys & Tokens → Docker
Registries*) or run `docker login ghcr.io` on the server. Symptom if this is
missed: `pull access denied` on the first deploy.

## Creating the resource

1. *New Resource → Docker Compose*, pointed at this repository.
2. **Base Directory** `/`, **Docker Compose Location** `/docker-compose.coolify.yml`.
3. Assign your domain to the **`nginx`** service. It is the only service that
   should be reachable from the internet.
4. Set the environment variables below.
5. Deploy.

### Environment variables you set by hand

| Variable | Value |
|---|---|
| `PUBLIC_ORIGIN` | `https://<your-domain>` — **must match** the domain assigned to `nginx`, no trailing slash |
| `IMAGE_TAG` | `latest` to track the promoted build, or `0.1.<run_number>` to pin an immutable release |
| `IMAGE_REPO` | only if you forked — defaults to `ghcr.io/andrasore/betpossum` |
| `ODDS_PROVIDERS` | `mock` (default) or e.g. `theoddsapi`, `apifootball` |
| `THE_ODDS_API_KEY`, `APIFOOTBALL_API_KEY`, `APIFOOTBALL_LEAGUES`, `APIFOOTBALL_SEASON` | only when a real provider is enabled |
| `BOT_COUNT` | how many synthetic players to run (default 10) |

`PUBLIC_ORIGIN` is referenced as `${PUBLIC_ORIGIN:?}`, so a missing value fails
the deploy instead of quietly booting an IdP that hands out `http://localhost`
URLs.

### Environment variables Coolify generates

These are [magic variables](https://coolify.io/docs/knowledge-base/docker/compose):
Coolify creates them on first deploy and keeps the same value on every later
one. Nothing is typed by hand and nothing is committed.

| Variable | Used for |
|---|---|
| `SERVICE_PASSWORD_POSTGRES` | the `betting` Postgres role, and inline in every `DATABASE_URL` |
| `SERVICE_PASSWORD_RABBITMQ` | the `betting` RabbitMQ user, and inline in every `RABBITMQ_URL` |
| `SERVICE_PASSWORD_KCDB` | Keycloak's own `keycloak` Postgres role |
| `SERVICE_PASSWORD_KCADMIN` | Keycloak's bootstrap admin, and the bots' admin login |
| `SERVICE_PASSWORD_CORECLIENT` | the `betting-core` confidential client secret |

They are the alphanumeric `SERVICE_PASSWORD_*` variant on purpose — the values
are embedded inside connection URLs, where symbols would need percent-encoding.

## The realm is imported exactly once

`keycloak/render-realm.sh` renders `keycloak/realm.template.json` at container
start, substituting `__PUBLIC_ORIGIN__`, `__CORE_CLIENT_SECRET__` and
`__SSL_REQUIRED__`, and then Keycloak imports it with `--import-realm`. This is
the same realm file and the same render step the dev and e2e stacks use — only
those three values differ — so a realm change is exercised by the e2e suite
before it ever reaches production.

**`--import-realm` only imports a realm that does not already exist.** Once
`betting` is persisted in the `keycloak` database, the rendered file is ignored
on every subsequent boot. So changing `PUBLIC_ORIGIN`, the redirect URIs, or the
client secret after the first successful deploy has *no effect* until you drop
the realm's database:

```bash
# From a terminal on the postgres container (Coolify → Terminal).
# This destroys every Keycloak user, including anyone who self-registered.
psql -U betting -d betting -c 'DROP DATABASE keycloak;'
psql -U betting -d betting -c 'CREATE DATABASE keycloak OWNER keycloak;'
# Then restart the keycloak service from the Coolify UI.
```

The app's own data (bets, wallets, stats) lives in the `betting` database and in
TigerBeetle, and is untouched by this.

If you only need to change a redirect URI, editing it in the Keycloak admin
console is less destructive — but the console is deliberately unreachable from
the internet (nginx returns 404 for `/kc/admin/`), so reach it through Coolify's
container terminal or an SSH port-forward to `keycloak:8080`.

## Deploying an update

CI already does the work: merging to `main` runs `test → build → e2e`, pushes
`:<sha>` images to GHCR, and on success promotes them by digest to `:latest` and
`:0.1.<run_number>`. To ship that build, click **Redeploy** in Coolify. Every
service sets `pull_policy: always`, so a redeploy with `IMAGE_TAG=latest` pulls
the freshly promoted images.

To roll back, set `IMAGE_TAG` to an earlier `0.1.<run_number>` and redeploy.

## Persistence and backups

Three named volumes:

| Volume | Holds |
|---|---|
| `tigerbeetle_data` | **the ledger.** The single most important volume in the system |
| `postgres_data` | users, bets, odds, stats, and the whole Keycloak realm |
| `rabbitmq_data` | the durable queues `core.events.resolved` and `stats.bets.settled` |

Add a Coolify **Scheduled Task** on the `postgres` service to take dumps:

```bash
pg_dumpall -U betting
```

TigerBeetle's data file has no dump equivalent — back the volume up at the
filesystem level, with the container stopped.

## Verifying a deployment

1. Every container healthy in the Coolify UI. `bots` reports no health status by
   design: it is a best-effort daemon that restarts on failure, and it must not
   mark the whole deployment unhealthy.
2. `curl -sI https://<domain>/` → `200`, valid certificate.
3. `curl -s https://<domain>/kc/realms/betting/.well-known/openid-configuration | jq .issuer`
   → `https://<domain>/kc/realms/betting`. The scheme here comes from
   `KC_HOSTNAME`, i.e. from `PUBLIC_ORIGIN` — **if it comes back `http://` or
   the wrong host, `PUBLIC_ORIGIN` is wrong**, and every redirect URI in the
   rendered realm is wrong with it (see the import-once note above).
4. `curl -sI https://<domain>/kc/admin/` → `404`. The admin console stays closed.
5. Log in as `alice` / `password`, place a bet. This is the real test: it proves
   the rendered realm's redirect URIs match the origin, and that the wallet
   debit reached TigerBeetle.
6. `GET /odds` returns events. `GET /stats/leaderboard` fills in once bots have
   settled at least three bets each (`LEADERBOARD_MIN_SETTLED`).
7. Devtools → Network → WS: the `/socket.io/` connection upgrades and stays open.
8. Restart the stack and repeat 5–7 — this is what proves the volumes survived.

## This is a public demo

Stated plainly, because it is intentional and not an oversight:

- The seeded users `alice` and `bob` both have the password `password`.
- Self-registration is open (`registrationAllowed: true`).
- The `bots` service continuously creates users and places bets so the odds board
  and leaderboard have live activity.
- Every account starts with a fixed play balance. No real money is involved
  anywhere in the system.

Turning this into a non-demo deployment means removing `bots`, removing the
seeded users from `keycloak/realm.template.json`, and reconsidering open
registration — plus the gaps listed under *Production gaps & trade-offs* in
[ARCHITECTURE.md](../ARCHITECTURE.md).

## Scaling notes

`odds` and `notifications` **must stay single-instance**. The odds poller has no
partitioning or leader election, so a second replica double-publishes every
update; the notifications relay holds socket.io rooms in process memory, so a
second replica silently drops messages for clients attached to the other one.
Postgres, RabbitMQ and TigerBeetle each run as a single node.
