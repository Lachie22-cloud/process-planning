#!/bin/bash
set -e

PGDATA=/var/lib/postgresql/16/devdata
export PGDATA

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "=== Initializing PostgreSQL ==="
  mkdir -p "$PGDATA"
  chown postgres:postgres "$PGDATA"
  su - postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA --auth=trust"

  cat >> "$PGDATA/postgresql.conf" <<'PGEOF'
wal_level = logical
max_replication_slots = 5
max_wal_senders = 10
shared_preload_libraries = 'pg_cron'
cron.database_name = 'smart_schedule'
listen_addresses = '127.0.0.1'
port = 5432
PGEOF

  cat > "$PGDATA/pg_hba.conf" <<'HBAEOF'
local all all trust
host all all 127.0.0.1/32 trust
HBAEOF
fi

echo "=== Starting PostgreSQL ==="
exec su - postgres -c "/usr/lib/postgresql/16/bin/postgres -D $PGDATA"
