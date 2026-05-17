# Combined Dockerfile for all services - this makes sense because we need
# the Docker context to be the root folder. The build steps need to access
# /proto and /node_modules

# Stage 1: Build all JS workspaces (frontend + core).
FROM node:25-alpine AS builder-node
RUN npm install corepack -g --force && corepack enable && corepack prepare pnpm@11.1.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/
COPY services/core/package.json ./services/core/
RUN pnpm install --frozen-lockfile --filter '@betting/frontend...' --filter '@betting/core...'
COPY proto/ ./proto/
COPY services/core/ ./services/core/
COPY frontend/ ./frontend/
COPY turbo.json ./turbo.json
RUN pnpm --filter '@betting/core' --filter '@betting/frontend' run build
# pnpm deploy is used to generate copiable files for core
# --legacy is required because 
RUN pnpm --filter '@betting/core' deploy  --prod services/core/pruned

# Stage 2: Next.js frontend served via its standalone output.
FROM node:25-alpine AS frontend
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
ENV NODE_ENV=development
COPY --chown=appuser:appgroup --from=builder-node /app/frontend/.next/standalone/ ./
COPY --chown=appuser:appgroup --from=builder-node /app/frontend/.next/static ./frontend/.next/static
# TODO also copy public folder if we have one
USER appuser
EXPOSE 3001
CMD ["node", "frontend/server.js"]

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
CMD ["/app/.venv/bin/gunicorn", "app:app", "--bind", "0.0.0.0:8000"]

# Stage 5: Notifications service runtime — Flask-SocketIO with eventlet.
FROM python:3.13-alpine AS notifications
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY services/notifications/pyproject.toml .
RUN python -m venv .venv && mkdir -p ./src && .venv/bin/pip install -e .
COPY services/notifications/src/ ./src/
USER appuser
CMD ["/app/.venv/bin/gunicorn", "app:app", "--bind", "0.0.0.0:8000", "--worker-class", "eventlet"]
