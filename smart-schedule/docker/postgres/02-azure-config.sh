#!/bin/bash
# Set Azure AD credentials as PostgreSQL config params from environment variables.
# These are used by the search_directory_users() function.
set -e

DB="${POSTGRES_DB:-smart_schedule}"
USER="${POSTGRES_USER:-supabase}"

if [ -n "$AZURE_TENANT_ID" ]; then
  psql -v ON_ERROR_STOP=1 --username "$USER" --dbname "$DB" <<-EOSQL
    ALTER DATABASE ${DB} SET app.azure_tenant_id = '${AZURE_TENANT_ID}';
    ALTER DATABASE ${DB} SET app.azure_client_id = '${AZURE_CLIENT_ID}';
    ALTER DATABASE ${DB} SET app.azure_client_secret = '${AZURE_CLIENT_SECRET}';
EOSQL
  echo "Azure AD config params set."
else
  echo "AZURE_TENANT_ID not set — skipping Azure config."
fi
