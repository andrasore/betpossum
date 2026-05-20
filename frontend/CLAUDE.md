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

The REST and WebSocket URLs are resolved at runtime in the browser from
`window.location.hostname`, pointing at the nginx gateway on port 8080. They
are not configurable via env vars — nginx routes `/` to core and `/socket.io/`
to the notifications service.

Keycloak's URL (a separate origin the browser is redirected to for OAuth) is
*also* resolved at runtime — via the `/runtime-config.js` route handler
(`src/app/runtime-config.js/route.ts`), which reads `process.env.KEYCLOAK_URL`
on every request and returns a tiny JS payload that sets `window.__APP_CONFIG__`.
The root layout includes it as a blocking `<script src="/runtime-config.js">`
in `<head>`, so by the time any client bundle runs, the config is set.
`src/lib/keycloak.ts` reads from `window.__APP_CONFIG__` via `getConfig()` —
never `process.env.NEXT_PUBLIC_*`. This lets one image serve dev (port 8090)
and e2e (port 18090) without rebuilding.

Copy `.env.example` to `.env.local` for Keycloak settings only.

## Architecture

**BetPossum** is a Next.js 16 (App Router) sports betting frontend. It is part of a Turbo monorepo (`@betting/frontend`).

### Routes

| Route        | Description                                                    |
|--------------|----------------------------------------------------------------|
| `/`          | Redirects to `/dashboard`                                      |
| `/login`     | Login / register form; stores JWT in `localStorage` as `token` |
| `/dashboard` | Protected main page; redirects to `/login` if no token         |

### Data flow

- **REST** (`src/lib/api.ts`): `login`, `register`, `placeBet`, `fetchBets` — all protected calls attach `Authorization: Bearer <token>`.
- **WebSocket** (`src/lib/websocket.ts`): Singleton Socket.io instance authenticated via the token. The `useOdds` hook subscribes to `odds.updated` events and maintains a `Map<eventId, OddsEvent>`. Incoming events are validated with the Zod schema in `src/lib/schemas.ts`.
- **Bets** (`src/hooks/useBets.ts`): SWR-backed. No interval polling — invalidation is socket-driven via `bet.held` / `bet.settled` events (per-user filtered server-side via socket.io rooms keyed on the JWT `sub`), plus a `connect` listener that revalidates after any disconnect.

### Component hierarchy (dashboard)

```
DashboardPage
├── Navbar               — logout clears token, redirects to /login
├── OddsBoard            — reads from useOdds; emits selection up via callback
├── My Bets section      — reads from useBets; Badge colored by status
└── BetSlip (sidebar)    — controlled stake input; calls placeBet on submit
```

All interactive components are `'use client'`. Domain components live in `src/components/`; there is no `ui/` primitives folder — Chakra UI v3 supplies the primitives directly.

### Key types (`src/types/index.ts`)

- `OddsEvent` — live event with `homeOdds`, `awayOdds`, `drawOdds`
- `Bet` — placed bet with `status: 'pending' | 'won' | 'lost'`
- `PlaceBetPayload` — `{ eventId, selection, odds, stake }`

### Styling

Chakra UI v3 with `defaultSystem`. `next-themes` forces dark mode via `forcedTheme="dark"` in `src/app/providers.tsx`. There is no Tailwind, no global CSS file, and no `cn()` helper — styling is via Chakra props (`bg`, `color`, `p`, etc.) and tokens (`bg.muted`, `fg.muted`, `border`, color palettes like `green`/`red`).
