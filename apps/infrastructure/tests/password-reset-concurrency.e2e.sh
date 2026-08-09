#!/usr/bin/env bash
set -euo pipefail

source scripts/local-supabase-env.sh
load_local_supabase_env
database_url=${DB_URL:?Supabase status did not return DB_URL}
container_name="supabase_db_cra"
temporary_directory=$(mktemp -d)
result_one="$temporary_directory/result-one"
result_two="$temporary_directory/result-two"
user_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
token_hash=$(openssl rand -hex 32)
email="password-reset-race-$user_id@cra.test"

uuid_pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
hash_pattern='^[0-9a-f]{64}$'
[[ $user_id =~ $uuid_pattern ]] || {
  echo "Generated user ID is not a UUID" >&2
  exit 1
}
[[ $token_hash =~ $hash_pattern ]] || {
  echo "Generated reset-token hash is not lowercase sha256 hex" >&2
  exit 1
}

run_psql() {
  if command -v psql >/dev/null 2>&1; then
    psql "$database_url" "$@"
  else
    docker exec -i "$container_name" psql -U postgres -d postgres "$@"
  fi
}

cleanup() {
  local original_status=$?
  local cleanup_status=0
  run_psql -X -q -v ON_ERROR_STOP=1 -v user_id="$user_id" <<'SQL' \
    >/dev/null || cleanup_status=$?
delete from public.auth_recovery_tokens where user_id = :'user_id'::uuid;
delete from public.users where id = :'user_id'::uuid;
SQL
  rm -rf "$temporary_directory"
  if [[ $cleanup_status -ne 0 ]]; then
    echo "Password-reset fixture cleanup failed" >&2
    if [[ $original_status -eq 0 ]]; then
      exit "$cleanup_status"
    fi
  fi
  exit "$original_status"
}
trap cleanup EXIT

run_psql -X -q -v ON_ERROR_STOP=1 \
  -v user_id="$user_id" -v email="$email" -v token_hash="$token_hash" <<'SQL'
insert into public.users (id, auth_user_id, email, session_epoch_at)
select
  :'user_id'::uuid,
  users.auth_user_id,
  :'email',
  now() - interval '1 day'
from public.users users
where users.email = 'member@cra.test';

insert into public.auth_recovery_tokens (user_id, token_hash, expires_at)
values (:'user_id'::uuid, :'token_hash', now() + interval '10 minutes');
SQL

consume_once() {
  run_psql -X -qAt -v ON_ERROR_STOP=1 -v token_hash="$token_hash" <<'SQL'
select outcome from public.consume_password_reset(:'token_hash');
SQL
}

consume_once >"$result_one" &
pid_one=$!
consume_once >"$result_two" &
pid_two=$!

wait_status=0
wait "$pid_one" || wait_status=$?
wait "$pid_two" || wait_status=$?
if [[ $wait_status -ne 0 ]]; then
  echo "A concurrent password-reset consume call failed" >&2
  exit "$wait_status"
fi

outcomes=$(
  printf '%s\n%s\n' \
    "$(tr -d '\r\n' <"$result_one")" \
    "$(tr -d '\r\n' <"$result_two")" |
    sort
)
if [[ $outcomes != $'consumed\ninvalid' ]]; then
  printf 'Unexpected password-reset outcomes:\n%s\n' "$outcomes" >&2
  exit 1
fi

effects=$(
  run_psql -X -qAt -v ON_ERROR_STOP=1 -v user_id="$user_id" <<'SQL'
select
  (tokens.consumed_at is not null)::integer::text || ':' ||
  (users.session_epoch_at > users.created_at - interval '1 hour')::integer::text
from public.auth_recovery_tokens tokens
join public.users users on users.id = tokens.user_id
where users.id = :'user_id'::uuid;
SQL
)
if [[ $effects != "1:1" ]]; then
  echo "Password-reset race left invalid effects: $effects" >&2
  exit 1
fi

echo "Password-reset concurrency: exactly one token consume succeeded"
