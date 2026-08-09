#!/usr/bin/env bash
set -euo pipefail

source scripts/local-supabase-env.sh
load_local_supabase_env
database_url=${DB_URL:?Supabase status did not return DB_URL}
container_name="supabase_db_cra"
temporary_directory=$(mktemp -d)
correct_result="$temporary_directory/correct-result"
wrong_result="$temporary_directory/wrong-result"
user_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
correct_hash=$(openssl rand -hex 32)
wrong_hash=$(openssl rand -hex 32)
email="verification-race-$user_id@cra.test"

uuid_pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
hash_pattern='^[0-9a-f]{64}$'
[[ $user_id =~ $uuid_pattern ]] || {
  echo "Generated user ID is not a UUID" >&2
  exit 1
}
[[ $correct_hash =~ $hash_pattern ]] || {
  echo "Generated correct hash is not lowercase sha256 hex" >&2
  exit 1
}
[[ $wrong_hash =~ $hash_pattern && $wrong_hash != "$correct_hash" ]] || {
  echo "Generated wrong hash is invalid or unexpectedly equal" >&2
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
delete from public.auth_email_verifications where user_id = :'user_id'::uuid;
delete from public.users where id = :'user_id'::uuid;
SQL
  rm -rf "$temporary_directory"
  if [[ $cleanup_status -ne 0 ]]; then
    echo "Email verification fixture cleanup failed" >&2
    if [[ $original_status -eq 0 ]]; then
      exit "$cleanup_status"
    fi
  fi
  exit "$original_status"
}
trap cleanup EXIT

run_psql -X -q -v ON_ERROR_STOP=1 \
  -v user_id="$user_id" -v email="$email" \
  -v correct_hash="$correct_hash" <<'SQL'
insert into public.users (id, email)
values (:'user_id'::uuid, :'email');

insert into public.auth_email_verifications (
  user_id, email, code_hash, purpose, expires_at
) values (
  :'user_id'::uuid, :'email', :'correct_hash', 'signup',
  now() + interval '10 minutes'
);
SQL

verify_once() {
  local submitted_hash=$1
  run_psql -X -qAt -v ON_ERROR_STOP=1 \
    -v user_id="$user_id" -v code_hash="$submitted_hash" <<'SQL'
select public.verify_email_code_atomic(
  :'user_id'::uuid, :'code_hash', 5
);
SQL
}

verify_once "$correct_hash" >"$correct_result" &
correct_pid=$!
verify_once "$wrong_hash" >"$wrong_result" &
wrong_pid=$!

wait_status=0
wait "$correct_pid" || wait_status=$?
wait "$wrong_pid" || wait_status=$?
if [[ $wait_status -ne 0 ]]; then
  echo "A concurrent email verification call failed" >&2
  exit "$wait_status"
fi

correct_outcome=$(tr -d '\r\n' <"$correct_result")
wrong_outcome=$(tr -d '\r\n' <"$wrong_result")
effects=$(
  run_psql -X -qAt -v ON_ERROR_STOP=1 -v user_id="$user_id" <<'SQL'
select
  verifications.attempts::text || ':' ||
  (users.email_verified_at is not null)::integer::text || ':' ||
  (verifications.consumed_at is not null)::integer::text
from public.auth_email_verifications verifications
join public.users users on users.id = verifications.user_id
where verifications.user_id = :'user_id'::uuid
  and verifications.purpose = 'signup';
SQL
)

case "$correct_outcome:$wrong_outcome:$effects" in
  "verified:missing:0:1:1" | "verified:invalid:1:1:1") ;;
  *)
    echo "Email verification race produced mixed state: $correct_outcome:$wrong_outcome:$effects" >&2
    exit 1
    ;;
esac

echo "Email verification concurrency: correct/wrong calls serialized"
