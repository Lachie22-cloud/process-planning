-- Supabase-compatible Postgres extensions for smart-schedule
-- Loaded automatically on first container start via docker-entrypoint-initdb.d

CREATE EXTENSION IF NOT EXISTS "pg_cron"    SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS "pgjwt"      SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"  SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "pgcrypto"   SCHEMA public;

