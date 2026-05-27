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

Auth uses the **OIDC Authorization Code + PKCE** flow against Keycloak
(public client `betting-frontend`). The access + ID tokens live in JS memory
only; there is no refresh token — when the access token expires (or a fetch
returns 401), `refresh()` does a top-level navigation to Keycloak with
`prompt=none`, which bounces back instantly via Keycloak's own session
cookie if the user is still signed in there. Auth logic is in
`src/lib/auth.ts`; the React layer is in `src/lib/auth-context.tsx`.

Runtime config (`KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`) is rendered into
`/config.js` by the nginx container's entrypoint and loaded via a blocking
`<script>` in `src/app/layout.tsx`. One image runs dev (8080 / 8090) and
e2e (18080 / 18090).

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
  401, triggers `refresh()` (top-level navigation to Keycloak with
  `prompt=none`).
- **WebSocket** (`src/lib/websocket.ts`): browser opens Socket.io
  same-origin to the gateway; the `auth()` callback returns the in-memory
  access token. On `connect_error`, triggers `refresh()`.
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
