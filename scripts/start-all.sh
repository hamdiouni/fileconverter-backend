#!/bin/bash
set -e

echo "=================================================="
echo " Starting FileConverter Pro All-in-One Cloud Stack"
echo "=================================================="

# 1. Embedded Redis: start if REDIS_URL not provided or localhost
if [ -z "$REDIS_URL" ] || [[ "$REDIS_URL" == *"localhost"* ]] || [[ "$REDIS_URL" == *"127.0.0.1"* ]]; then
  echo "[+] Starting embedded Redis server..."
  redis-server --daemonize yes --bind 127.0.0.1 --port 6379 || echo "[!] Redis already running"
  export REDIS_URL="redis://127.0.0.1:6379"
fi

# 2. Embedded PostgreSQL: start if DATABASE_URL not provided or localhost
if [ -z "$DATABASE_URL" ] || [[ "$DATABASE_URL" == *"localhost"* ]] || [[ "$DATABASE_URL" == *"127.0.0.1"* ]]; then
  echo "[+] Initializing embedded PostgreSQL..."
  mkdir -p /run/postgresql /var/lib/postgresql/data
  chown -R postgres:postgres /run/postgresql /var/lib/postgresql/data
  if [ ! -f /var/lib/postgresql/data/PG_VERSION ]; then
    su-exec postgres initdb -D /var/lib/postgresql/data --auth=trust > /dev/null 2>&1 || true
  fi
  su-exec postgres pg_ctl -D /var/lib/postgresql/data -w -l /tmp/postgres.log start || true
  
  # Ensure database and user exist
  su-exec postgres psql -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'fileconverter'" | grep -q 1 || \
    (su-exec postgres psql -U postgres -c "CREATE USER fileconverter WITH SUPERUSER PASSWORD 'fileconverter_dev';" && \
     su-exec postgres psql -U postgres -c "CREATE DATABASE fileconverter OWNER fileconverter;") || true
     
  export DATABASE_URL="postgresql://fileconverter:fileconverter_dev@127.0.0.1:5432/fileconverter"
  echo "[+] Embedded PostgreSQL ready on 127.0.0.1:5432"
fi

# 3. Apply Prisma database schema migrations
echo "[+] Syncing database schema with Prisma..."
npx prisma db push --schema=./prisma/schema.prisma --accept-data-loss || echo "[!] Prisma push warning (continuing)"

# 4. Configure Nginx
echo "[+] Configuring Nginx reverse proxy..."
sed -i 's/auth-service:3000/127.0.0.1:3000/g' /etc/nginx/nginx.conf
sed -i 's/user-service:3001/127.0.0.1:3001/g' /etc/nginx/nginx.conf
sed -i 's/upload-service:3002/127.0.0.1:3002/g' /etc/nginx/nginx.conf
sed -i 's/orchestrator-service:3003/127.0.0.1:3003/g' /etc/nginx/nginx.conf
sed -i 's/billing-service:3004/127.0.0.1:3004/g' /etc/nginx/nginx.conf
sed -i 's/notification-service:3005/127.0.0.1:3005/g' /etc/nginx/nginx.conf
sed -i 's/admin-service:3006/127.0.0.1:3006/g' /etc/nginx/nginx.conf

# Port resolution: Koyeb uses 8000/8080, Render uses 10000, Hugging Face uses 7860
TARGET_PORT=${PORT:-8080}
echo "[+] Nginx binding to port ${TARGET_PORT}"
sed -i "s/listen 80;/listen ${TARGET_PORT};/g" /etc/nginx/conf.d/fileconverter.conf

# 5. Launch all microservices
echo "[+] Launching backend microservices..."
PORT=3000 node services/auth-service/dist/server.js &
PORT=3001 node services/user-service/dist/server.js &
PORT=3002 node services/upload-service/dist/server.js &
PORT=3003 node services/conversion-orchestrator/dist/server.js &
PORT=3004 node services/billing-service/dist/server.js &
PORT=3005 node services/notification-service/dist/server.js &
PORT=3006 node services/admin-service/dist/server.js &

# 6. Start Nginx
echo "[+] Starting Nginx in foreground..."
exec nginx -g "daemon off;"
