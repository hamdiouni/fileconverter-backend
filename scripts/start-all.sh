#!/bin/bash
set -e

echo "=================================================="
echo " Starting FileConverter Pro All-in-One Backend"
echo "=================================================="

# 1. Start embedded Redis cache if REDIS_URL is not set or points to localhost
if [ -z "$REDIS_URL" ] || [[ "$REDIS_URL" == *"localhost"* ]] || [[ "$REDIS_URL" == *"127.0.0.1"* ]]; then
  echo "[+] Starting embedded Redis cache on 127.0.0.1:6379..."
  redis-server --daemonize yes --bind 127.0.0.1 --port 6379 || echo "[!] Redis already running or failed to daemonize"
  export REDIS_URL="redis://127.0.0.1:6379"
fi

# 2. Apply database migrations if DATABASE_URL is configured
if [ -n "$DATABASE_URL" ] && [[ "$DATABASE_URL" != *"localhost"* ]]; then
  echo "[+] Running Prisma schema sync on remote database..."
  npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss || echo "[!] Prisma push failed (continuing startup)"
fi

# 3. Configure Nginx for single-container loopback routing
echo "[+] Configuring Nginx upstreams and listening port..."
sed -i 's/auth-service:3000/127.0.0.1:3000/g' /etc/nginx/nginx.conf
sed -i 's/user-service:3001/127.0.0.1:3001/g' /etc/nginx/nginx.conf
sed -i 's/upload-service:3002/127.0.0.1:3002/g' /etc/nginx/nginx.conf
sed -i 's/orchestrator-service:3003/127.0.0.1:3003/g' /etc/nginx/nginx.conf
sed -i 's/billing-service:3004/127.0.0.1:3004/g' /etc/nginx/nginx.conf
sed -i 's/notification-service:3005/127.0.0.1:3005/g' /etc/nginx/nginx.conf
sed -i 's/admin-service:3006/127.0.0.1:3006/g' /etc/nginx/nginx.conf

# Render / Railway dynamic listening port
TARGET_PORT=${PORT:-10000}
echo "[+] Nginx listening on port ${TARGET_PORT}"
sed -i "s/listen 80;/listen ${TARGET_PORT};/g" /etc/nginx/conf.d/fileconverter.conf

# 4. Start all microservices in background
echo "[+] Launching core microservices..."
PORT=3000 node services/auth-service/dist/server.js &
PORT=3001 node services/user-service/dist/server.js &
PORT=3002 node services/upload-service/dist/server.js &
PORT=3003 node services/conversion-orchestrator/dist/server.js &
PORT=3004 node services/billing-service/dist/server.js &
PORT=3005 node services/notification-service/dist/server.js &
PORT=3006 node services/admin-service/dist/server.js &

# 5. Start Nginx in foreground
echo "[+] Starting Nginx API Gateway..."
exec nginx -g "daemon off;"
