# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This repo uses **pnpm**, not npm — never run `npm` commands.

```bash
pnpm dev            # Development server on port 3000
pnpm start          # Serve production build on port 3000
```

For typechecks and builds, always run `pnpm build` / `pnpm typecheck`
from the **repo root**, not from this workspace. See the root `CLAUDE.md`.

There is no test or lint script configured.

## Environment

Auth uses **NextAuth.js v4** with a Keycloak provider, configured via
`authOptions` in `src/auth.ts`. The Keycloak client is **confidential** —
the frontend container holds `NEXTAUTH_KEYCLOAK_SECRET` and never ships
tokens to the browser. The session cookie is httpOnly; `/api/auth/*` is
the standard NextAuth handler.

Server-side env, set in `docker-compose.yml`:

- `NEXTAUTH_SECRET` — cookie/JWT signing key
- `NEXTAUTH_URL` — public origin of the app (used for callback URLs)
- `NEXTAUTH_KEYCLOAK_ID` / `NEXTAUTH_KEYCLOAK_SECRET` — client credentials
- `NEXTAUTH_KEYCLOAK_ISSUER` — public issuer (matches `iss` in tokens, the URL the browser is redirected to)
- `NEXTAUTH_KEYCLOAK_ISSUER_INTERNAL` — server-only Keycloak URL used for OIDC discovery (e.g. `http://keycloak:8080/...`). Backchannel endpoints in the discovery response (`token_endpoint`, `userinfo_endpoint`, `jwks_uri`) come back under this host because Keycloak runs with `KC_HOSTNAME_BACKCHANNEL_DYNAMIC=true`
- `GATEWAY_URL` — server-side upstream for the BFF (e.g. `http://nginx:80`)

The browser-facing gateway port is exposed at runtime via a blocking
`<script>` in the root layout that sets `window.__GATEWAY_PORT__` from
`GATEWAY_PUBLIC_PORT`. There are no build-time `NEXT_PUBLIC_*` vars —
one image serves dev (8080 / 8090) and e2e (18080 / 18090).

## Architecture

**BetPossum** is a Next.js 16 (App Router, Turbopack) sports betting
frontend, part of a Turbo monorepo (`@betting/frontend`).

### Routes

| Route        | Description                                                |
|--------------|------------------------------------------------------------|
| `/`          | Redirects to `/dashboard`                                  |
| `/login`     | "Sign in with Keycloak" button → `signIn("keycloak")`      |
| `/dashboard` | Protected; `proxy.ts` redirects unauthenticated to `/login`|
| `/admin`     | Protected; `session.roles` must include `admin`            |
| `/api/auth/[...nextauth]` | NextAuth handler                              |
| `/api/proxy/[...path]`    | BFF: attaches `Authorization: Bearer <accessToken>` server-side and forwards to `GATEWAY_URL` |
| `/api/socket-token`       | Returns the current session's access token for the WebSocket handshake |

`src/proxy.ts` is the route-protection middleware (renamed from
`middleware.ts` per Next 16's deprecation). It re-exports
`next-auth/middleware` to gate `/dashboard` and `/admin`; unauthenticated
hits go to `/login` (configured via `pages.signIn` in `authOptions`).

### Data flow

- **REST** (`src/lib/api.ts`): calls `/api/proxy/...` same-origin. The
  BFF route handler reads the session, attaches the Bearer token, and
  forwards to `GATEWAY_URL`. No tokens or refresh logic in the browser.
- **WebSocket** (`src/lib/websocket.ts`): browser opens Socket.io
  directly to the gateway port (`window.__GATEWAY_PORT__`). The auth
  token comes from `GET /api/socket-token` on each (re)connect. On
  persistent `connect_error`, falls back to `signIn("keycloak")`.
- **Bets** (`src/hooks/useBets.ts`): SWR-backed, invalidated by
  `bet.held` / `bet.settled` socket events (per-user rooms keyed on JWT
  `sub`).
- **Odds** (`src/hooks/useOdds.ts`): subscribes to `odds.updated`,
  validates with the Zod schema in `src/lib/schemas.ts`.

### Component hierarchy (dashboard)

```
DashboardPage
├── Navbar               — signOut({ callbackUrl: "/login" }) → federated logout via Keycloak end-session
├── OddsBoard            — reads from useOdds; emits selection up via callback
├── My Bets section      — reads from useBets; Badge colored by status
└── BetSlip (sidebar)    — controlled stake input; calls placeBet on submit
```

All interactive components are `'use client'`. Domain components live in
`src/components/`; there is no `ui/` primitives folder — Chakra UI v3
supplies the primitives directly. `useSession()` from `next-auth/react`
provides session state under `<SessionProvider>` in
`src/app/providers.tsx`.

### Key types (`src/types/index.ts`)

- `OddsEvent` — live event with `homeOdds`, `awayOdds`, `drawOdds`
- `Bet` — placed bet with `status: 'pending' | 'won' | 'lost'`
- `PlaceBetPayload` — `{ eventId, selection, odds, stake }`

### Styling

Chakra UI v3 with `defaultSystem`. `next-themes` forces dark mode via
`forcedTheme="dark"` in `src/app/providers.tsx`. No Tailwind, no global
CSS, no `cn()` — styling is via Chakra props and tokens.
