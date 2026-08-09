#!/usr/bin/env bash
set -euo pipefail

source scripts/local-supabase-env.sh
load_local_supabase_env
database_url=${DB_URL:?Supabase status did not return DB_URL}
container_name="supabase_db_cra"
temporary_directory=$(mktemp -d)
result_one="$temporary_directory/result-one"
result_two="$temporary_directory/result-two"
result_three="$temporary_directory/result-three"
result_four="$temporary_directory/result-four"
user_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
multi_code_user_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
code_hash=$(openssl rand -hex 32)
code_hash_one=$(openssl rand -hex 32)
code_hash_two=$(openssl rand -hex 32)
email="mfa-recovery-race-$user_id@cra.test"
multi_code_email="mfa-recovery-multi-code-$multi_code_user_id@cra.test"

cleanup() {
  local original_status=$?
  local cleanup_status=0
  run_psql -X -q -v ON_ERROR_STOP=1 \
    -v user_id="$user_id" -v multi_code_user_id="$multi_code_user_id" <<'SQL' \
    >/dev/null || cleanup_status=$?
delete from public.mfa_recovery_operations
 where user_id in (:'user_id'::uuid, :'multi_code_user_id'::uuid);
delete from public.auth_mfa_recovery_codes
 where user_id in (:'user_id'::uuid, :'multi_code_user_id'::uuid);
delete from public.users
 where id in (:'user_id'::uuid, :'multi_code_user_id'::uuid);
SQL
  rm -rf "$temporary_directory"
  if [[ $cleanup_status -ne 0 ]]; then
    echo "MFA recovery fixture cleanup failed" >&2
    if [[ $original_status -eq 0 ]]; then
      exit "$cleanup_status"
    fi
  fi
  exit "$original_status"
}
trap cleanup EXIT

run_psql() {
  if command -v psql >/dev/null 2>&1; then
    psql "$database_url" "$@"
  else
    docker exec -i "$container_name" psql -U postgres -d postgres "$@"
  fi
}

run_psql -X -q -v ON_ERROR_STOP=1 \
  -v user_id="$user_id" -v email="$email" -v code_hash="$code_hash" <<'SQL'
insert into public.users (id, auth_user_id, email)
select :'user_id'::uuid, users.auth_user_id, :'email'
  from public.users users
 where users.email = 'member@cra.test';

insert into public.auth_mfa_recovery_codes (user_id, code_hash)
values (:'user_id'::uuid, :'code_hash');
SQL

claim_hash() {
  local selected_hash=$1
  run_psql -X -qAt -v ON_ERROR_STOP=1 \
    -v user_id="$user_id" -v code_hash="$selected_hash" <<'SQL'
select outcome || '|' || operation_id::text || '|' || status
  from public.claim_mfa_recovery(:'user_id'::uuid, :'code_hash');
SQL
}

claim_hash "$code_hash" >"$result_one" &
pid_one=$!
claim_hash "$code_hash" >"$result_two" &
pid_two=$!

wait_status=0
wait "$pid_one" || wait_status=$?
wait "$pid_two" || wait_status=$?
if [[ $wait_status -ne 0 ]]; then
  echo "A concurrent MFA recovery claim failed" >&2
  exit "$wait_status"
fi

first=$(tr -d '\r\n' <"$result_one")
second=$(tr -d '\r\n' <"$result_two")
outcomes=$(printf '%s\n%s\n' "${first%%|*}" "${second%%|*}" | sort)
first_operation=${first#*|}
first_operation=${first_operation%%|*}
second_operation=${second#*|}
second_operation=${second_operation%%|*}

if [[ $outcomes != $'claimed\nin_progress' ]]; then
  printf 'Unexpected MFA recovery outcomes:\n%s\n' "$outcomes" >&2
  exit 1
fi
if [[ $first_operation != "$second_operation" ]]; then
  echo "Concurrent claims returned different operation IDs" >&2
  exit 1
fi

effects=$(
  run_psql -X -qAt -v ON_ERROR_STOP=1 -v user_id="$user_id" <<'SQL'
select
  (count(*) = 1)::integer::text || ':' ||
  bool_and(codes.consumed_at is not null)::integer::text
from public.mfa_recovery_operations operations
join public.auth_mfa_recovery_codes codes
  on codes.id = operations.recovery_code_id
where operations.user_id = :'user_id'::uuid;
SQL
)
if [[ $effects != "1:1" ]]; then
  echo "MFA recovery race left invalid effects: $effects" >&2
  exit 1
fi

run_psql -X -q -v ON_ERROR_STOP=1 \
  -v user_id="$multi_code_user_id" \
  -v email="$multi_code_email" \
  -v code_hash_one="$code_hash_one" \
  -v code_hash_two="$code_hash_two" <<'SQL'
insert into public.users (id, auth_user_id, email)
select :'user_id'::uuid, users.auth_user_id, :'email'
  from public.users users
 where users.email = 'member@cra.test';

insert into public.auth_mfa_recovery_codes (user_id, code_hash)
values
  (:'user_id'::uuid, :'code_hash_one'),
  (:'user_id'::uuid, :'code_hash_two');
SQL

claim_multi_code() {
  local selected_hash=$1
  run_psql -X -qAt -v ON_ERROR_STOP=1 \
    -v user_id="$multi_code_user_id" -v code_hash="$selected_hash" <<'SQL'
select outcome || '|' || operation_id::text || '|' || status
  from public.claim_mfa_recovery(:'user_id'::uuid, :'code_hash');
SQL
}

claim_multi_code "$code_hash_one" >"$result_three" &
pid_three=$!
claim_multi_code "$code_hash_two" >"$result_four" &
pid_four=$!

wait_status=0
wait "$pid_three" || wait_status=$?
wait "$pid_four" || wait_status=$?
if [[ $wait_status -ne 0 ]]; then
  echo "A concurrent multi-code MFA recovery claim failed" >&2
  exit "$wait_status"
fi

third=$(tr -d '\r\n' <"$result_three")
fourth=$(tr -d '\r\n' <"$result_four")
multi_outcomes=$(
  printf '%s\n%s\n' "${third%%|*}" "${fourth%%|*}" | sort
)
third_operation=${third#*|}
third_operation=${third_operation%%|*}
fourth_operation=${fourth#*|}
fourth_operation=${fourth_operation%%|*}

if [[ $multi_outcomes != $'claimed\nin_progress' ]]; then
  printf 'Unexpected multi-code MFA recovery outcomes:\n%s\n' \
    "$multi_outcomes" >&2
  exit 1
fi
if [[ $third_operation != "$fourth_operation" ]]; then
  echo "Different-code claims returned different operation IDs" >&2
  exit 1
fi

multi_effects=$(
  run_psql -X -qAt -v ON_ERROR_STOP=1 \
    -v user_id="$multi_code_user_id" <<'SQL'
select
  ((select count(*) from public.mfa_recovery_operations
     where user_id = :'user_id'::uuid and status <> 'completed') = 1
  )::integer::text || ':' ||
  ((select count(*) from public.auth_mfa_recovery_codes
     where user_id = :'user_id'::uuid and consumed_at is not null) = 1
  )::integer::text || ':' ||
  ((select count(*) from public.auth_mfa_recovery_codes
     where user_id = :'user_id'::uuid) = 2)::integer::text;
SQL
)
if [[ $multi_effects != "1:1:1" ]]; then
  echo "Multi-code race left invalid effects: $multi_effects" >&2
  exit 1
fi

echo "MFA recovery concurrency: same and different codes share one operation"
