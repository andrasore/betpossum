# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

This repo uses **pnpm**, not npm — never run `npm` commands.

```bash
pnpm dev            # Development server on port 3000 (HMR via nginx proxy)
pnpm build          # Static export to ./out/ (consumed by the nginx image)
```

For typechecks and builds, always run `pnpm build` / `pnpm typecheck`
from the **repo root**, not from this workspace. See the root `CLAUDE.md`.

There is no test or lint script configured.

## Environment

This is a **pure static SPA** — no Node.js frontend container, no server-side
auth. nginx serves the Next static export and proxies `/api/*` to Core,
`/odds` to Odds, `/socket.io/` to Notifications.

Auth uses the **OIDC Authorization Code + PKCE** flow (`oidc-client-ts`)
against Keycloak (public client `betting-frontend`). The access + ID tokens
live in JS memory only (`InMemoryWebStorage`) — a reload starts anonymous and
re-bootstraps via the `auth:previously-authed` localStorage flag. There is no
stored refresh token; instead the token is renewed by a **hidden same-origin
iframe** silent renew (`signinSilent`, `prompt=none`), driven by
`automaticSilentRenew` ~60s before expiry. Keycloak's own session cookie makes
the round-trip invisible if the user is still signed in there, so an expiry no
longer forces a top-level navigation and in-flight UI state survives. When the
access token expires (or a fetch returns 401), `refresh()` runs the same silent
renew; on failure it drops to anonymous. Auth logic is in `src/lib/auth.ts`;
the React layer is in `src/lib/auth-context.tsx`.

There is no runtime config injection. Keycloak is fronted by nginx same-origin
under `/kc`, and the realm/client id are identical in every environment, so
`src/lib/auth.ts` derives the issuer as `${window.location.origin}/kc/realms/betting`.
The static export is origin-agnostic — one image runs dev (8080) and e2e (18080)
with no `/config.js` step.

## Architecture

**BetPossum** is a Next.js 16 (App Router, Turbopack) sports betting
frontend, part of a Turbo monorepo (`@betting/frontend`). It is configured
with `output: "export"` — `next build` writes `./out/` which is copied
straight into the nginx image.

### Routes

| Route            | Description                                                |
|------------------|------------------------------------------------------------|
| `/`              | Client-side redirects to `/dashboard`                      |
| `/login`         | Auto-triggers `login("/dashboard")` → Keycloak             |
| `/dashboard`     | Public for odds; logged-in adds bet placement + history    |
| `/admin`         | Logged-in; client-side redirect to `/dashboard` if not admin |
| `/auth/callback` | Exchanges the OIDC `?code=…` for tokens (PKCE) and routes back to `returnTo` |

### Data flow

- **REST** (`src/lib/api.ts`): calls `/api/...` same-origin with
  `Authorization: Bearer <access_token>` read from the in-memory store. On
  401, triggers `refresh()` (iframe silent renew via `signinSilent`).
- **WebSocket** (`src/lib/websocket.ts`): browser opens Socket.io
  same-origin to the gateway; the `auth()` callback returns the in-memory
  access token. On `connect_error`, triggers `refresh()` (iframe silent
  renew).
- **Bets** (`src/hooks/useBets.ts`): SWR-backed, invalidated by
  `bet.held` / `bet.settled` socket events (per-user rooms keyed on JWT
  `sub`).
- **Odds** (`src/hooks/useOdds.ts`): subscribes to `odds.updated`,
  validates with the Zod schema in `src/lib/schemas.ts`.

### Component hierarchy (dashboard)

```
DashboardPage
├── Navbar               — logout() → federated logout via Keycloak end-session
├── OddsBoard            — reads from useOdds; emits selection up via callback
├── My Bets section      — reads from useBets; Badge colored by status
└── BetSlip (sidebar)    — controlled stake input; calls placeBet on submit
```

All interactive components are `'use client'`. Domain components live in
`src/components/`; there is no `ui/` primitives folder — Chakra UI v3
supplies the primitives directly. `useAuth()` from `src/lib/auth-context.tsx`
provides session state under `<AuthProvider>` in `src/app/providers.tsx`.

### Key types (`src/types/index.ts`)

- `OddsEvent` — live event with `homeOdds`, `awayOdds`, `drawOdds`
- `Bet` — placed bet with `status: 'pending' | 'won' | 'lost'`
- `PlaceBetPayload` — `{ eventId, selection, odds, stake }`

### Styling

Chakra UI v3 with `defaultSystem`. `next-themes` forces dark mode via
`forcedTheme="dark"` in `src/app/providers.tsx`. No Tailwind, no global
CSS, no `cn()` — styling is via Chakra props and tokens.

## Conventions

- **No `node:*` imports** — not even in files that are server-only by usage
  (e.g. the NextAuth config in `src/lib/auth.ts`). Next can pull such files into
  the client bundle through transitive imports, and `node:*` modules don't
  bundle for the browser. Narrow types for an invariant with a non-null `!` or a
  plain `if (!x) throw new Error(...)` (Error is browser-safe), not
  `node:assert`; reach for Web/standard APIs over `node:buffer`, `node:crypto`,
  `node:fs`, etc.
