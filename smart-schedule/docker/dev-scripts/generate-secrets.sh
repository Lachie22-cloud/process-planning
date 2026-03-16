#!/bin/bash
set -e

export JWT_SECRET=${JWT_SECRET:-$(openssl rand -hex 32)}
export POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-$(openssl rand -hex 16)}
export DEV_USER_EMAIL=${DEV_USER_EMAIL:-admin@dev.local}
export DEV_USER_PASSWORD=${DEV_USER_PASSWORD:-dev-password}

export ANON_KEY=$(node -e "
const crypto = require('crypto');
const h = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const now = Math.floor(Date.now()/1000);
const p = Buffer.from(JSON.stringify({role:'anon',iss:'supabase',iat:now,exp:now+315360000})).toString('base64url');
const s = crypto.createHmac('sha256',process.env.JWT_SECRET).update(h+'.'+p).digest('base64url');
console.log(h+'.'+p+'.'+s);
")

export SERVICE_ROLE_KEY=$(node -e "
const crypto = require('crypto');
const h = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const now = Math.floor(Date.now()/1000);
const p = Buffer.from(JSON.stringify({role:'service_role',iss:'supabase',iat:now,exp:now+315360000})).toString('base64url');
const s = crypto.createHmac('sha256',process.env.JWT_SECRET).update(h+'.'+p).digest('base64url');
console.log(h+'.'+p+'.'+s);
")

cat > /app/secrets.env <<ENVEOF
export JWT_SECRET="$JWT_SECRET"
export POSTGRES_PASSWORD="$POSTGRES_PASSWORD"
export ANON_KEY="$ANON_KEY"
export SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY"
export DEV_USER_EMAIL="$DEV_USER_EMAIL"
export DEV_USER_PASSWORD="$DEV_USER_PASSWORD"
ENVEOF

echo ""
echo "========================================"
echo "  Smart Schedule Dev Container"
echo "========================================"
echo "  Email:    $DEV_USER_EMAIL"
echo "  Password: $DEV_USER_PASSWORD"
echo "========================================"
echo ""
