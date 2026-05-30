# CLAUDE.md — Shared protobuf schemas

`/proto` holds the single source of truth for all inter-service message
contracts. Every service generates its own bindings from these files; nothing
here is service-specific.

## The golden rule

`events.proto` **is** the contract. After editing it, regenerate every
service's bindings from the **repo root**:

```bash
pnpm proto:gen     # regenerates core, odds, notifications (and frontend) bindings
```

Generated output (`services/*/src/generated`, `frontend/src/generated`) is
committed and **must stay in sync** — the pre-push hook (`tools/protobuf_guard.sh`)
regenerates and fails the push if anything differs from what's staged. Never
hand-edit generated files; re-run `proto:gen` and stage the result.

> Turbo's `proto:gen` input glob is depth-sensitive: `../../proto/**` resolves
> for `services/*`, but `frontend/` is only one level deep and needs its own
> input override, or its cache silently goes stale. Keep that in mind if a
> proto change doesn't show up in the frontend bindings.

## Conventions

- All inter-service messages are protobuf — no ad-hoc JSON on the broker. (JSON
  only appears as an opaque string field the frontend consumes verbatim.)
- Add a notification type by adding a oneof variant to `NotificationEvent`,
  then wiring it in the publisher (Core) and the `SOCKET_EVENT` map
  (Notifications).
- Document field-level gotchas inline as comments — e.g. `draw_odds = 0.0` for
  no-draw markets, `payout` being profit-only, amounts in dollars vs cents.
  These comments are the spec.
- Treat changes as a wire contract: prefer adding fields/variants over
  renumbering or repurposing existing tags.
