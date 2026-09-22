# ── Stage 1: Build all TypeScript services & packages ──
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ openssl

# Copy root workspace manifests
COPY package*.json ./
COPY tsconfig.base.json ./
COPY prisma ./prisma/

# Copy packages and services
COPY packages/ ./packages/
COPY services/ ./services/

# Install dependencies and build all packages & services
RUN npm ci --prefer-offline --no-audit
RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build --workspaces --if-present

# ── Stage 2: Runtime image with Node 20, Nginx, Redis & PostgreSQL ──
FROM node:20-alpine AS runner

WORKDIR /app

# Install runtime dependencies (nginx, redis, postgresql, su-exec, openssl, curl, wget, bash)
RUN apk add --no-cache nginx redis postgresql postgresql-contrib su-exec openssl curl wget bash

# Copy built node_modules, generated prisma client, and compiled code
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services ./services

# Setup Nginx configuration
COPY services/api-gateway/nginx.conf /etc/nginx/nginx.conf
COPY services/api-gateway/conf.d/ /etc/nginx/conf.d/
RUN rm -f /etc/nginx/conf.d/default.conf

# Setup startup script
COPY scripts/start-all.sh /app/scripts/start-all.sh
RUN chmod +x /app/scripts/start-all.sh

EXPOSE 80 10000

ENV NODE_ENV=production
ENV PORT=10000

CMD ["/bin/bash", "/app/scripts/start-all.sh"]
