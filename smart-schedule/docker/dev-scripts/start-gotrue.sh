#!/bin/bash
source /app/secrets.env

export GOTRUE_API_HOST=0.0.0.0
export GOTRUE_API_PORT=9999
export API_EXTERNAL_URL=http://localhost:5173
export GOTRUE_DB_DRIVER=postgres
export GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin@127.0.0.1:5432/smart_schedule?search_path=auth"
export GOTRUE_DB_MIGRATIONS_PATH="/usr/local/share/gotrue/migrations"
export GOTRUE_SITE_URL=http://localhost:5173
export GOTRUE_DISABLE_SIGNUP=false
export GOTRUE_JWT_SECRET="$JWT_SECRET"
export GOTRUE_JWT_EXP=3600
export GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated
export GOTRUE_EXTERNAL_EMAIL_ENABLED=true
export GOTRUE_MAILER_AUTOCONFIRM=true
export GOTRUE_EXTERNAL_AZURE_ENABLED=false
export GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true
export GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI="pg-functions://postgres/public/custom_access_token_hook"

exec /usr/local/bin/gotrue
