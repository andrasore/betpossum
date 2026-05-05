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
WORKDIR /app
ENV NODE_ENV=development
COPY --from=builder-node /app/frontend/.next/standalone ./
EXPOSE 3001
CMD ["node", "frontend/server.js"]

# Stage 3: Core Node.js service (bundled single file).
FROM node:25-alpine AS core
WORKDIR /app
ENV NODE_ENV=development
COPY --from=builder-node /app/services/core/dist/bundle.js ./dist/
CMD ["node", "./dist/bundle.js"]

# Stage 4: Build Python services into self-contained PEX executables.
# PEX bundles the virtualenv so runtime images need no pip install.
FROM python:3.13-alpine AS builder-python
WORKDIR /app
# We do an npm install so we can access our tooling
RUN apk add --update nodejs npm
COPY package.json package-lock.json ./
COPY services/wallet/package.json ./services/wallet/
COPY services/odds/package.json ./services/odds/
RUN npm ci
COPY proto/ ./proto
COPY services/wallet/pyproject.toml ./services/wallet/
COPY services/odds/pyproject.toml ./services/odds/
COPY turbo.json ./turbo.json
RUN  npm run init
COPY services/wallet/src ./services/wallet/
COPY services/odds/src ./services/odds/
RUN npm run build

# Stage 5: Odds service runtime — just the PEX, nothing else.
FROM python:3.13-alpine AS odds
WORKDIR /app
COPY --from=builder-python /app/services/odds/gunicorn_app.pex ./
CMD ["/app/gunicorn_app.pex", "app", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "2"]

# Stage 6: Wallet service runtime — just the PEX, nothing else.
FROM python:3.13-alpine AS wallet
WORKDIR /app
COPY --from=builder-python /app/services/wallet/gunicorn_app.pex ./
CMD ["/app/gunicorn_app.pex", "app", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "2"]
