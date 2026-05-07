# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Development server on port 3000
npm run build        # Production build (standalone output)
npm run start        # Serve production build on port 3000
npm run typecheck    # TypeScript type check (no emit)
```

There is no test or lint script configured.

## Environment

Copy `.env.example` to `.env.local` and set:
- `NEXT_PUBLIC_API_URL` — REST backend (default `http://localhost:4000`)
- `NEXT_PUBLIC_WS_URL` — WebSocket backend (default `ws://localhost:4000`)

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
- **Polling** (`src/hooks/useBets.ts`): SWR with a 10-second refresh interval for the user's bet list.

### Component hierarchy (dashboard)

```
DashboardPage
├── Navbar               — logout clears token, redirects to /login
├── OddsBoard            — reads from useOdds; emits selection up via callback
├── My Bets section      — reads from useBets; Badge colored by status
└── BetSlip (sidebar)    — controlled stake input; calls placeBet on submit
```

All interactive components are `'use client'`. shadcn/ui components live in `src/components/ui/`; domain components are directly in `src/components/`.

### Key types (`src/types/index.ts`)

- `OddsEvent` — live event with `homeOdds`, `awayOdds`, `drawOdds`
- `Bet` — placed bet with `status: 'pending' | 'won' | 'lost'`
- `PlaceBetPayload` — `{ eventId, selection, odds, stake }`

### Styling

Tailwind CSS v4 with a custom brand primary (`#1a56db`). Use the `cn()` helper from `src/lib/utils.ts` for conditional class merging. shadcn components use CSS variables defined in `src/app/globals.css`.
