FROM node:25-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/core/package.json ./services/core/
COPY frontend/package.json ./frontend/
RUN npm ci
COPY . .
RUN npm run build

FROM node:25-alpine AS frontend
WORKDIR /app
ENV NODE_ENV=development
COPY --from=builder /app/frontend/.next/standalone ./
COPY --from=builder /app/frontend/.next/static ./.next/static
COPY --from=builder /app/frontend/public ./public
EXPOSE 3001
CMD ["node", "server.js"]

FROM node:25-alpine AS core
WORKDIR /app
ENV NODE_ENV=development
COPY --from=builder /app/services/core/dist ./dist
