# CLAUDE.md — Shared JSON Schemas

`/schemas` holds the single source of truth for cross-service contracts. The
schema documents live in `schemas/json/`:

- `events.json` — inter-service **message** contracts (the RabbitMQ / socket.io
  pubsub payloads).
- `rest.json` — the HTTP **REST resource** shapes the Odds service serves and
  the frontend consumes (`OddsEvent`, `Sport`, `League`, `Outcome`).

Every service generates its own bindings from these; nothing here is
service-specific. The codegen reads the whole `schemas/json/` directory, so a
new `schemas/json/<name>.json` is picked up with **no script change**.

## The golden rule

Each `$def` in `schemas/json/*.json` **is** a contract. After editing one,
regenerate every service's bindings from the **repo root**:

```bash
pnpm schema:gen   # regenerates every service's bindings (and the frontend's)
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

One generator, consuming the whole `schemas/json/` directory:
`tools/gen-zod.mjs` (wraps `json-schema-to-zod`) merges every `$def` across all
files into a single `src/generated/events.ts` per workspace, with a
`<Name>Schema` + `type <Name>` per `$def` — runtime validation **and** types in
one. `additionalProperties: false` becomes `.strict()`.

## Conventions

- All inter-service messages are JSON, **camelCase keys** on the wire — no
  protobuf, no snake_case.
- Add a notification type by adding a `$def` for the message, a `NotificationKind`
  enum value, then wiring it in the publisher (Core) and the `SOCKET_EVENT` map
  (Notifications).
- The `NotificationEvent` envelope is flat: `{ userId, kind, payload }`. `kind`
  is the discriminator the relay maps to a socket.io event name; `payload` is
  the inner message object, relayed verbatim.
- Document field-level gotchas inline as `description`s — e.g. `drawOdds = 0` for
  no-draw markets, `payoutCents` being profit-only, amounts being integer cents.
  These descriptions are the spec.
- Treat changes as a wire contract: prefer adding fields/variants over
  renaming or repurposing existing ones.
