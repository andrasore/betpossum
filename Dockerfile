# Combined Dockerfile for all services - this makes sense because we need
# the Docker context to be the root folder. The build steps need to access
# /schemas and /node_modules

# Stage 1: Build all JS workspaces (frontend + node services).
FROM node:25-alpine AS builder-node
RUN npm install corepack -g --force && corepack enable && corepack prepare pnpm@11.1.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/
COPY services/core/package.json ./services/core/
COPY services/notifications/package.json ./services/notifications/
COPY services/stats/package.json ./services/stats/
COPY services/odds/package.json ./services/odds/
RUN pnpm install --frozen-lockfile --filter '@betting/frontend...' --filter '@betting/core...' \
      --filter '@betting/notifications...' --filter '@betting/stats...' \
      --filter '@betting/odds...'
COPY schemas/ ./schemas/
COPY services/core/ ./services/core/
COPY services/notifications/ ./services/notifications/
COPY services/stats/ ./services/stats/
COPY services/odds/ ./services/odds/
COPY frontend/ ./frontend/
RUN pnpm --filter '@betting/core' --filter '@betting/notifications' \
      --filter '@betting/stats' --filter '@betting/odds' \
      --filter '@betting/frontend' run build
# pnpm deploy is used to generate a copiable directory per node service
RUN pnpm --filter '@betting/core' deploy --prod services/core/pruned
RUN pnpm --filter '@betting/notifications' deploy --prod services/notifications/pruned
RUN pnpm --filter '@betting/stats' deploy --prod services/stats/pruned
RUN pnpm --filter '@betting/odds' deploy --prod services/odds/pruned

# Stage 2: Next.js static export packaged into nginx. The same image is served
# on dev (8080) and e2e (18080) with no per-environment config: Keycloak is
# fronted by nginx under /kc, so the SPA derives its issuer from the current
# origin at runtime — no /config.js injection step.
FROM nginx:1.27-alpine AS frontend
COPY --from=builder-node /app/frontend/out/ /usr/share/nginx/html/
COPY nginx/nginx.conf /etc/nginx/nginx.conf

# Stage 3: Core Node.js service.
FROM node:25-alpine AS core
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=appuser:appgroup --from=builder-node /app/services/core/pruned/ ./
USER appuser
CMD ["node", "./dist/main.js"]

# Stage 4: Odds service runtime — NestJS ingestion + poll loops.
FROM node:25-alpine AS odds
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=appuser:appgroup --from=builder-node /app/services/odds/pruned/ ./
USER appuser
CMD ["node", "./dist/main.js"]

# Stage 5: Notifications service runtime — NestJS socket.io relay.
FROM node:25-alpine AS notifications
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=appuser:appgroup --from=builder-node /app/services/notifications/pruned/ ./
USER appuser
CMD ["node", "./dist/main.js"]

# Stage 6: Stats service runtime — NestJS read model + durable consumer.
FROM node:25-alpine AS stats
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=appuser:appgroup --from=builder-node /app/services/stats/pruned/ ./
USER appuser
CMD ["node", "./dist/main.js"]

# Stage 7: Bots — dev-only play-data daemon, run straight from TS via tsx. Not
# part of the e2e stack (excluded there via a compose profile).
FROM node:25-alpine AS bots
RUN npm install corepack -g --force && corepack enable && corepack prepare pnpm@11.1.2 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY bots/package.json ./bots/
RUN pnpm install --frozen-lockfile --filter '@betting/bots...'
COPY bots/ ./bots/
WORKDIR /app/bots
CMD ["pnpm", "start"]
