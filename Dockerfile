# Combined Dockerfile for all services - this makes sense because we need
# the Docker context to be the root folder. The build steps need to access
# /proto and /node_modules

# Stage 1: Build all Node.js services (frontend + core).
FROM node:25-alpine AS builder-node
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/core/package.json ./services/core/
COPY frontend/package.json ./frontend/
RUN npm ci
COPY proto/ ./proto/
COPY services/core/ ./services/core/
COPY frontend/ ./frontend/
COPY turbo.json ./turbo.json
RUN npm run build

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

# Stage 3: Core Node.js service (bundled single file).
FROM node:25-alpine AS core
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
ENV NODE_ENV=development
COPY --chown=appuser:appgroup --from=builder-node /app/services/core/dist/bundle.js ./dist/
USER appuser
CMD ["node", "./dist/bundle.js"]

# Stage 4: Build Python services into self-contained PEX executables.
# PEX bundles the virtualenv so runtime images need no pip install.
FROM python:3.13-slim AS builder-python
# We install node and npm so we can access our build scripts
RUN apt-get update && apt-get install -y nodejs npm
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/odds/package.json ./services/odds/
RUN npm ci
COPY proto/ ./proto
COPY services/odds/pyproject.toml ./services/odds/
COPY turbo.json ./turbo.json
RUN  npm run init
COPY services/odds/src ./services/odds/src
RUN npm run build

# Stage 5: Odds service runtime — just the PEX, nothing else.
FROM python:3.13-slim AS odds
RUN groupadd appgroup && useradd -g appgroup -m appuser
WORKDIR /app
COPY --chown=appuser:appgroup --from=builder-python /app/services/odds/dist/gunicorn_app.pex ./dist/
USER appuser
CMD ["/app/dist/gunicorn_app.pex", "app:app", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "2"]
