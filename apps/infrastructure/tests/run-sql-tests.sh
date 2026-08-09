#!/usr/bin/env bash
set -euo pipefail

container_name="supabase_db_cra"
test_files=(tests/*.test.sql)

if [[ ${#test_files[@]} -eq 0 ]]; then
  echo "No SQL test files found" >&2
  exit 1
fi

for test_file in "${test_files[@]}"; do
  echo "Running $test_file"
  docker exec -i "$container_name" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - <"$test_file"
done
