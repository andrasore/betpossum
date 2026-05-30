# CLAUDE.md — Edge proxy (nginx)

`/nginx` is the single browser-facing origin. It serves the frontend's static
export and path-routes to the backends. See `ARCHITECTURE.md` for the routing
table.

## Files

- `nginx.conf` — production/e2e config (listens on 80 inside the container).
- `nginx.dev.conf` — dev overrides.
- `config.js.template` — runtime SPA config, rendered at container start.
- `docker-entrypoint.d/30-render-config.sh` — `envsubst`s the template into
  `/usr/share/nginx/html/config.js` before nginx boots. The `nginx:alpine`
  entrypoint sources every executable here on startup.

## Why it's shaped this way

- **nginx fronts everything** so the browser only ever sees one origin → no
  CORS, no runtime URL injection into the JS bundle. One built image runs both
  dev (8080/8090) and e2e (18080/18090); the only thing that differs is the
  rendered `config.js`.
- **No env vars baked into the frontend image.** Keycloak issuer / client id
  arrive at *runtime* via `config.js`, loaded by a blocking `<script>` in the
  SPA. `config.js` is served `Cache-Control: no-store` so it's never stale.
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
| `/` (default)  | SPA static export   | `try_files … /index.html`   |

Keycloak is **not** behind nginx — it has its own port; the browser→Keycloak
hop is just a login redirect.
