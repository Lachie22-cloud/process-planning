#!/bin/bash
set -e
source /app/secrets.env

echo "=== Waiting for GoTrue ==="
for i in $(seq 1 60); do
  curl -sf http://127.0.0.1:9999/health > /dev/null 2>&1 && break
  sleep 1
done
echo "=== GoTrue ready ==="

# Create dev user via GoTrue admin API
RESP=$(curl -s -X POST http://127.0.0.1:9999/admin/users \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$DEV_USER_EMAIL\",\"password\":\"$DEV_USER_PASSWORD\",\"email_confirm\":true}")

AUID=$(echo "$RESP" | node -p "try{JSON.parse(require('fs').readFileSync(0,'utf8')).id}catch(e){''}")

if [ -z "$AUID" ]; then
  echo "User may exist, looking up..."
  AUID=$(curl -s http://127.0.0.1:9999/admin/users \
    -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    | node -p "try{const d=JSON.parse(require('fs').readFileSync(0,'utf8'));const u=(d.users||[]).find(u=>u.email==='$DEV_USER_EMAIL');u?u.id:''}catch(e){''}")
fi

if [ -n "$AUID" ]; then
  echo "Auth UID: $AUID"
  psql -h 127.0.0.1 -U postgres -d smart_schedule -c \
    "UPDATE site_users SET external_id='$AUID', email='$DEV_USER_EMAIL', display_name='Rocklea Dev Admin', role='site_admin', updated_at=NOW() WHERE id='00000000-0000-0000-0000-000000000901';"
  echo "=== Linked to Rocklea site_admin ==="
else
  echo "ERROR: Could not create/find GoTrue user"
fi

echo ""
echo "========================================"
echo "  Login: $DEV_USER_EMAIL / $DEV_USER_PASSWORD"
echo "========================================"
