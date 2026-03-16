#!/bin/bash
set -e
source /app/secrets.env

PSQL="psql -h 127.0.0.1 -U postgres"

echo "=== Waiting for PostgreSQL ==="
until pg_isready -h 127.0.0.1 -q 2>/dev/null; do sleep 1; done
echo "=== PostgreSQL ready ==="

$PSQL -tc "SELECT 1 FROM pg_database WHERE datname='smart_schedule'" | grep -q 1 || $PSQL -c "CREATE DATABASE smart_schedule"

$PSQL -d smart_schedule <<'EOSQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin LOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOINHERIT LOGIN; END IF;
  GRANT anon TO authenticator;
  GRANT authenticated TO authenticator;
  GRANT service_role TO authenticator;
  GRANT ALL ON SCHEMA public TO supabase_auth_admin;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO supabase_auth_admin;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO supabase_auth_admin;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO supabase_auth_admin;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO supabase_auth_admin;
END
$$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;

DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_publication WHERE pubname='supabase_realtime') THEN CREATE PUBLICATION supabase_realtime; END IF; END $$;

CREATE SCHEMA IF NOT EXISTS auth AUTHORIZATION supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, supabase_auth_admin;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO supabase_auth_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO supabase_auth_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON SEQUENCES TO supabase_auth_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON ROUTINES TO supabase_auth_admin;
EOSQL

$PSQL -d smart_schedule -c "CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA public CASCADE;"
$PSQL -d smart_schedule -c "CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\" SCHEMA public;"
$PSQL -d smart_schedule -c "CREATE EXTENSION IF NOT EXISTS pgjwt SCHEMA public CASCADE;"
$PSQL -d smart_schedule -c "CREATE EXTENSION IF NOT EXISTS pg_cron SCHEMA pg_catalog;"

echo "=== Running migrations ==="
for f in $(ls /migrations/*.sql 2>/dev/null | sort); do
  echo "  $(basename $f)"
  $PSQL -v ON_ERROR_STOP=0 -d smart_schedule -f "$f" > /dev/null 2>&1 || echo "  Warning: $(basename $f) had errors"
done
echo "=== Migrations complete ==="

$PSQL -d smart_schedule <<'EOSQL'
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, supabase_auth_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, supabase_auth_admin;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role, supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, supabase_auth_admin;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO supabase_auth_admin;
GRANT ALL ON ALL ROUTINES IN SCHEMA auth TO supabase_auth_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO supabase_auth_admin;
EOSQL

# Grant supabase_auth_admin access to the custom_access_token_hook specifically
$PSQL -d smart_schedule -c "GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;" 2>/dev/null || echo "  (hook function grant will be retried after GoTrue starts)"

echo "=== Database ready ==="
