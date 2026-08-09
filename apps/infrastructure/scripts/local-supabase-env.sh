#!/usr/bin/env bash

# Parse only the local values CRA consumes. Do not `eval` or source CLI output:
# informational lines and future fields must never become executable shell code.
parse_local_supabase_env() {
  local status_output=${1-}
  local name
  local raw_value
  local value

  while IFS='=' read -r name raw_value; do
    case "$name" in
      ANON_KEY | API_URL | DB_URL | JWT_SECRET | SERVICE_ROLE_KEY)
        value=$raw_value
        if [[ $value == \"*\" && $value == *\" ]]; then
          value=${value#\"}
          value=${value%\"}
        fi
        printf -v "$name" '%s' "$value"
        export "$name"
        ;;
    esac
  done <<<"$status_output"
}

load_local_supabase_env() {
  local script_directory
  local package_directory
  local status_output
  local required_name

  script_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
  package_directory=$(cd -- "$script_directory/.." && pwd)
  unset ANON_KEY API_URL DB_URL JWT_SECRET SERVICE_ROLE_KEY
  if ! status_output=$(
    pnpm --dir "$package_directory" exec supabase status -o env
  ); then
    echo "Unable to read the local Supabase environment" >&2
    return 1
  fi
  parse_local_supabase_env "$status_output"

  for required_name in \
    ANON_KEY API_URL DB_URL JWT_SECRET SERVICE_ROLE_KEY; do
    if [[ -z ${!required_name:-} ]]; then
      echo "Supabase status did not return $required_name" >&2
      return 1
    fi
  done
}
