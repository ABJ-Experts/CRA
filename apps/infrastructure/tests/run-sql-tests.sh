#!/usr/bin/env bash
set -euo pipefail

container_name="${CRA_SQL_TEST_CONTAINER:-supabase_db_cra}"
if [[ ! "$container_name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$ ]]; then
  echo "CRA_SQL_TEST_CONTAINER must be a Docker container name" >&2
  exit 1
fi

node --test tests/prepare-legacy-sql.test.mjs
test_files=(tests/*.test.sql)
tap_output=$(mktemp)
suite_input=$(mktemp)
trap 'rm -f "$tap_output" "$suite_input"' EXIT

if [[ ${#test_files[@]} -eq 0 ]]; then
  echo "No SQL test files found" >&2
  exit 1
fi

for test_file in "${test_files[@]}"; do
  echo "Running $test_file"
  # M15 authority tests intentionally exercise unlicensed tenants unchanged.
  if [[ $(basename "$test_file") == m15-* ]]; then
    cp "$test_file" "$suite_input"
  else
    node tests/prepare-legacy-sql.mjs "$test_file" >"$suite_input"
  fi
  docker exec -i "$container_name" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - <"$suite_input" 2>&1 | tee "$tap_output"
  if grep -Eq '^[[:space:]]*not ok[[:space:]]+[0-9]+[[:space:]]*-|^[[:space:]]*# Looks like you (failed|planned)' "$tap_output"; then
    echo "TAP assertion failure in $test_file" >&2
    exit 1
  fi
done
