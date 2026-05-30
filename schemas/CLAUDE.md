# CLAUDE.md — Shared JSON Schemas

`/schemas` holds the single source of truth for all inter-service message
contracts. Every service generates its own bindings from `events.schema.json`;
nothing here is service-specific.

## The golden rule

`events.schema.json` **is** the contract. After editing it, regenerate every
service's bindings from the **repo root**:

```bash
pnpm schema:gen   # regenerates core, odds, notifications (and frontend) bindings
```

Generated output (`services/*/src/generated`, `frontend/src/generated`) is
committed and **must stay in sync** — the pre-push hook (`tools/schema_guard.sh`)
regenerates and fails the push if anything differs from what's staged. Never
hand-edit generated files; re-run `schema:gen` and stage the result.

> Turbo's `schema:gen` input glob is depth-sensitive: `../../schemas/**`
> resolves for `services/*`, but `frontend/` is only one level deep and needs
> its own input override, or its cache silently goes stale. Keep that in mind if
> a schema change doesn't show up in the frontend bindings.

## Codegen

- **TS (core, frontend):** `tools/gen-zod.mjs` (wraps `json-schema-to-zod`)
  emits `src/generated/events.ts` with a `<Name>Schema` + `type <Name>` per
  `$def`.
- **Python (odds, notifications):** `datamodel-codegen` emits Pydantic v2 models
  to `src/generated/events.py` — runtime validation **and** type stubs in one.

## Conventions

- All inter-service messages are JSON, **camelCase keys** on the wire — no
  protobuf, no snake_case. (Python generated fields keep the camelCase property
  names.)
- Add a notification type by adding a `$def` for the message, a `NotificationKind`
  enum value, then wiring it in the publisher (Core) and the `SOCKET_EVENT` map
  (Notifications).
- The `NotificationEvent` envelope is flat: `{ userId, kind, payload }`. `kind`
  is the discriminator the relay maps to a socket.io event name; `payload` is
  the inner message object, relayed verbatim.
- Document field-level gotchas inline as `description`s — e.g. `drawOdds = 0` for
  no-draw markets, `payout` being profit-only, amounts in dollars vs cents.
  These descriptions are the spec.
- Treat changes as a wire contract: prefer adding fields/variants over
  renaming or repurposing existing ones.
