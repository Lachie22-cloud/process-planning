#!/bin/bash
# Run all migration files in order from the mounted migrations directory.
# This script is placed in docker-entrypoint-initdb.d and runs after
# 00-extensions.sql (which creates the required extensions).
# It also records each migration in _migrations so the CI deploy script
# knows which have already been applied.

set -e

MIGRATIONS_DIR="/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "No migrations directory found at $MIGRATIONS_DIR — skipping."
  exit 0
fi

PSQL="psql -v ON_ERROR_STOP=1 --username $POSTGRES_USER --dbname $POSTGRES_DB"

$PSQL -c "CREATE TABLE IF NOT EXISTS _migrations (
  name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now()
);"

for f in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort); do
  BASENAME=$(basename "$f")
  echo "Running migration: $BASENAME"
  $PSQL -f "$f"
  $PSQL -c "INSERT INTO _migrations(name) VALUES('$BASENAME') ON CONFLICT DO NOTHING;"
done

echo "All migrations complete."
