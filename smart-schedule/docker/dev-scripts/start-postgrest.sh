#!/bin/bash
source /app/secrets.env

export PGRST_DB_URI="postgres://authenticator@127.0.0.1:5432/smart_schedule"
export PGRST_DB_SCHEMAS="public,storage"
export PGRST_DB_ANON_ROLE="anon"
export PGRST_JWT_SECRET="$JWT_SECRET"
export PGRST_DB_USE_LEGACY_GUCS="false"

exec /usr/local/bin/postgrest
