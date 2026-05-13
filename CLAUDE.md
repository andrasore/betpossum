# CLAUDE.md

## Build and typecheck

Always run typechecks and builds from the **repo root**, never from a single
workspace:

```bash
npm run build      # builds all services (regenerates proto bindings)
npm run typecheck  # typechecks all services
```

Do not run module-scoped checks (e.g. `cd services/core && npx tsc --noEmit`).
Generated proto bindings, cross-workspace imports, and Turbo's caching all
assume the root-level run; module-only checks can pass while the integrated
build fails. Run the full set every time, even if the change appears to touch
one module only.
