# notification-service — build context: backend root
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache wget openssl
COPY services/notification-service/package.json ./package.json
RUN npm install
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN ./node_modules/.bin/prisma generate --schema ./prisma/schema.prisma
COPY services/notification-service/tsconfig.build.json ./tsconfig.json
COPY services/notification-service/src ./src
RUN npx tsc

FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache wget openssl
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist         ./dist
USER appuser
EXPOSE 3005
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 CMD wget -qO- http://localhost:3005/health || exit 1
CMD ["node", "dist/server.js"]