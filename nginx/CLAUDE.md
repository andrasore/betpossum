# CLAUDE.md — Edge proxy (nginx)

`/nginx` is the single browser-facing origin. It serves the frontend's static
export and path-routes to the backends. See `ARCHITECTURE.md` for the routing
table.

## Files

- `nginx.conf` — production/e2e config (listens on 80 inside the container).
- `nginx.dev.conf` — dev overrides.

## Why it's shaped this way

- **nginx fronts everything** — frontend, the backend endpoints, *and* Keycloak
  (under `/kc`) — so the browser only ever sees one origin → no CORS. One built
  image runs both dev (8080) and e2e (18080) with **no per-environment config**.
- **The SPA needs no runtime config injection.** Because Keycloak is same-origin
  under `/kc` and the realm/client are identical everywhere, the frontend
  derives its issuer from `window.location.origin` (see `frontend/src/lib/auth.ts`).
  There is no `config.js` template or entrypoint render step anymore — the static
  export is fully origin-agnostic.
- **It is not a smart gateway.** Path-based routing and WebSocket upgrade only.
  Auth/authz is each service's own job (every service verifies its own JWT);
  rate limiting is per-service if at all. Don't add auth, header rewriting, or
  business logic here.

## Routing recap

| Prefix         | Upstream            | Notes                       |
|----------------|---------------------|-----------------------------|
| `/socket.io/`  | notifications:8000  | WebSocket upgrade           |
| `/odds`        | odds:8000/odds      | public, unauthenticated     |
| `/api/`        | core:4000/          | Bearer token forwarded as-is|
| `/kc/`         | keycloak:8080/kc/   | OIDC; `X-Forwarded-*` set   |
| `/` (default)  | SPA static export   | `try_files … /index.html`   |

Keycloak is fronted by nginx under the `/kc` prefix
(`KC_HTTP_RELATIVE_PATH=/kc`), so the SPA stays single-origin — important
because the PKCE code→token exchange is a `fetch`, not just a redirect. Don't
confuse `/kc` (the Keycloak IdP) with the SPA's own `/auth/callback` route,
which stays with the frontend. Backchannel JWKS/admin traffic from the services
bypasses nginx via `KEYCLOAK_INTERNAL_URL` (`http://keycloak:8080/kc`).
