#!/bin/bash
source /app/secrets.env

cd /app/frontend
export VITE_BASE_PATH=${PREVIEW_BASE_PATH:-/}
export VITE_SUPABASE_URL=__SELF__
export VITE_SUPABASE_ANON_KEY="$ANON_KEY"
export VITE_DEV_AUTO_LOGIN=true
export VITE_DEV_USER_EMAIL="$DEV_USER_EMAIL"
export VITE_DEV_USER_PASSWORD="$DEV_USER_PASSWORD"

echo "=== Building frontend (base=$VITE_BASE_PATH) ==="
npm run build 2>&1

rm -rf /var/www/html/*
cp -r dist/* /var/www/html/
echo "=== Frontend ready ==="
