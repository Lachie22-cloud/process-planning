#!/bin/bash
set -e

# Step 1: Generate secrets
/app/generate-secrets.sh
source /app/secrets.env

# Step 2: Generate nginx config
echo "=== Generating nginx config ==="
envsubst '${PREVIEW_BASE_PATH}' < /etc/nginx/app.conf.template > /etc/nginx/conf.d/app.conf

# Step 3: Start supervisor (postgres + nginx start immediately)
/usr/bin/supervisord -c /etc/supervisor/conf.d/app.conf &
SUP_PID=$!

# Wait for supervisor socket to be ready
echo "=== Waiting for supervisor socket ==="
for i in $(seq 1 30); do
  test -S /var/run/supervisor.sock && break
  sleep 1
done

# Step 4: Wait for Postgres, then init DB
echo "=== Waiting for PostgreSQL ==="
for i in $(seq 1 60); do pg_isready -h 127.0.0.1 -q 2>/dev/null && break; sleep 1; done

/app/init-db.sh

# Step 5: Start backend services
echo "=== Starting GoTrue ==="
supervisorctl start gotrue
echo "=== Waiting for GoTrue ==="
for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:9999/health > /dev/null 2>&1 && break
  sleep 1
done

echo "=== Starting PostgREST ==="
supervisorctl start postgrest
sleep 2

# Step 6: Seed dev user (needs GoTrue running)
/app/seed-dev-user.sh

# Step 7: Build frontend (needs ANON_KEY from secrets.env)
echo "=== Starting frontend build ==="
supervisorctl start frontend-build

# Keep container running
wait $SUP_PID
