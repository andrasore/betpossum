# Stage 1: Build all Node.js services (frontend + core).
# Dependencies are installed before copying source so this layer is cached
# unless package-lock.json changes.
FROM node:25-alpine AS builder-node
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/core/package.json ./services/core/
COPY frontend/package.json ./frontend/
RUN npm ci
COPY services/wallet/pyproject.toml ./services/wallet/
COPY . .
RUN npm run build

# Stage 2: Next.js frontend served via its standalone output.
FROM node:25-alpine AS frontend
WORKDIR /app
ENV NODE_ENV=development
COPY --from=builder-node /app/frontend/.next/standalone ./
COPY --from=builder-node /app/frontend/.next/static ./.next/static
# Nothing in /public yet
#COPY --from=builder-node /app/frontend/public ./public
EXPOSE 3001
CMD ["node", "server.js"]

# Stage 3: Core Node.js service (bundled single file).
FROM node:25-alpine AS core
WORKDIR /app
ENV NODE_ENV=development
COPY --from=builder-node /app/services/core/dist ./dist
CMD ["node", "./dist/bundle.js"]

# Stage 4: Build Python services into self-contained PEX executables.
# PEX bundles the virtualenv so runtime images need no pip install.
FROM python:3.13-alpine AS builder-python
WORKDIR /app
COPY services/wallet/pyproject.toml ./services/wallet/
COPY services/wallet/src ./services/wallet/src
COPY services/odds/pyproject.toml ./services/odds/
COPY services/odds/src ./services/odds/src
WORKDIR /app/services/wallet
RUN python -m venv .venv && .venv/bin/pip freeze > requirements.txt && .venv/bin/pip install -e .
RUN .venv/bin/pex . -r requirements.txt -e gunicorn -o gunicorn_app.pex
WORKDIR /app/services/odds
RUN python -m venv .venv && .venv/bin/pip freeze > requirements.txt && .venv/bin/pip install -e .
RUN .venv/bin/pex . -r requirements.txt -e gunicorn -o gunicorn_app.pex

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
