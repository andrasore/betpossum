# Combined Dockerfile for all services - this makes sense because we need
# the Docker context to be the root folder. The build steps need to access
# /schemas and /node_modules

# Stage 1: Build all JS workspaces (frontend + core).
FROM node:25-alpine AS builder-node
RUN npm install corepack -g --force && corepack enable && corepack prepare pnpm@11.1.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/
COPY services/core/package.json ./services/core/
RUN pnpm install --frozen-lockfile --filter '@betting/frontend...' --filter '@betting/core...'
COPY schemas/ ./schemas/
COPY services/core/ ./services/core/
COPY frontend/ ./frontend/
RUN pnpm --filter '@betting/core' --filter '@betting/frontend' run build
# pnpm deploy is used to generate a copiable directory for core
RUN pnpm --filter '@betting/core' deploy --prod services/core/pruned

# Stage 2: Next.js static export packaged into nginx. Same image is served on
# dev (8080 / 8090) and e2e (18080 / 18090); runtime Keycloak URL is injected
# via /config.js generated at container start by docker-entrypoint.d.
FROM nginx:1.27-alpine AS frontend
COPY --from=builder-node /app/frontend/out/ /usr/share/nginx/html/
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/config.js.template /etc/nginx/templates/config.js.template
COPY nginx/docker-entrypoint.d/30-render-config.sh /docker-entrypoint.d/30-render-config.sh
RUN chmod +x /docker-entrypoint.d/30-render-config.sh

# Stage 3: Core Node.js service.
FROM node:25-alpine AS core
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
ENV NODE_ENV=development
COPY --chown=appuser:appgroup --from=builder-node /app/services/core/pruned/ ./
USER appuser
CMD ["node", "./dist/main.js"]

# Stage 4: Odds service.
FROM python:3.13-alpine AS odds
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY services/odds/pyproject.toml .
RUN python -m venv .venv && mkdir -p ./src &&  .venv/bin/pip install -e .
COPY services/odds/src/ ./src/
USER appuser
CMD ["/app/.venv/bin/uvicorn", "app:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8000"]

# Stage 5: Notifications service runtime — FastAPI + python-socketio (ASGI).
FROM python:3.13-alpine AS notifications
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY services/notifications/pyproject.toml .
RUN python -m venv .venv && mkdir -p ./src && .venv/bin/pip install -e .
COPY services/notifications/src/ ./src/
USER appuser
CMD ["/app/.venv/bin/uvicorn", "app:app", "--app-dir", "src", "--host", "0.0.0.0", "--port", "8000"]
