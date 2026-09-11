#!/usr/bin/env bash
set -euo pipefail

if [[ "${CRA_RUN_M2_PROPAGATION_SCALE:-}" != "1" ]]; then
  echo "Refusing to run the 5,000,000-source local scale suite. Set CRA_RUN_M2_PROPAGATION_SCALE=1 explicitly." >&2
  exit 1
fi

docker exec -i supabase_db_cra \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -f - < tests/m2-v1-propagation-scale.sql

