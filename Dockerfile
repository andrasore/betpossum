FROM node:25-alpine AS builder-node
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/core/package.json ./services/core/
COPY frontend/package.json ./frontend/
RUN npm ci
COPY services/wallet/pyproject.toml ./services/wallet/
COPY . .
RUN npm run build

FROM node:25-alpine AS frontend
WORKDIR /app
ENV NODE_ENV=development
COPY --from=builder-node /app/frontend/.next/standalone ./
COPY --from=builder-node /app/frontend/.next/static ./.next/static
COPY --from=builder-node /app/frontend/public ./public
EXPOSE 3001
CMD ["node", "server.js"]

FROM node:25-alpine AS core
WORKDIR /app
ENV NODE_ENV=development
COPY --from=builder-node /app/services/core/dist ./dist

FROM python:3.13-alpine AS builder-python
WORKDIR /app
COPY services/wallet/pyproject.toml ./services/wallet/
COPY services/odds/pyproject.toml ./services/odds/
WORKDIR /app/services/wallet
RUN python -m venv .venv && .venv/bin/pip freeze > requirements.txt && .venv/bin/pip install -e .
RUN .venv/bin/pex . -r requirements.txt -e gunicorn -o gunicorn_app.pex
WORKDIR /app/services/odds
RUN python -m venv .venv && .venv/bin/pip freeze > requirements.txt && .venv/bin/pip install -e .
RUN .venv/bin/pex . -r requirements.txt -e gunicorn -o gunicorn_app.pex

FROM python:3.13-alpine AS odds
WORKDIR /app
COPY --from=builder-python /app/services/odds/gunicorn_app.pex ./
CMD ["/app/gunicorn_app.pex", "main:app", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "2"]

FROM python:3.13-alpine AS wallet
WORKDIR /app
COPY --from=builder-python /app/services/wallet/gunicorn_app.pex ./
CMD ["/app/gunicorn_app.pex", "main:app", "--bind", "0.0.0.0:8000", "--workers", "1", "--threads", "2"]
