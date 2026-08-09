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
invitation_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
token_hash=$(openssl rand -hex 32)
email="concurrent-$user_id@cra.test"
race_user_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
race_invitation_id=$(uuidgen | tr '[:upper:]' '[:lower:]')
race_token_hash=$(openssl rand -hex 32)
race_email="accept-revoke-$race_user_id@cra.test"

uuid_pattern='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
token_pattern='^[0-9a-f]{64}$'
[[ $user_id =~ $uuid_pattern ]] || {
  echo "Generated user ID is not a UUID" >&2
  exit 1
}
[[ $invitation_id =~ $uuid_pattern ]] || {
  echo "Generated invitation ID is not a UUID" >&2
  exit 1
}
[[ $race_user_id =~ $uuid_pattern ]] || {
  echo "Generated race user ID is not a UUID" >&2
  exit 1
}
[[ $race_invitation_id =~ $uuid_pattern ]] || {
  echo "Generated race invitation ID is not a UUID" >&2
  exit 1
}
[[ $token_hash =~ $token_pattern ]] || {
  echo "Generated token hash is not lowercase sha256 hex" >&2
  exit 1
}
[[ $race_token_hash =~ $token_pattern ]] || {
  echo "Generated race token hash is not lowercase sha256 hex" >&2
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
  run_psql -X -q -v ON_ERROR_STOP=1 \
    -v user_id="$user_id" -v invitation_id="$invitation_id" \
    -v race_user_id="$race_user_id" \
    -v race_invitation_id="$race_invitation_id" <<'SQL' \
    >/dev/null || cleanup_status=$?
delete from public.audit_logs
 where entity_type = 'invitation'
   and entity_id in (:'invitation_id', :'race_invitation_id');
delete from public.organization_members
 where user_id in (:'user_id'::uuid, :'race_user_id'::uuid);
delete from public.invitations
 where id in (:'invitation_id'::uuid, :'race_invitation_id'::uuid);
delete from public.users
 where id in (:'user_id'::uuid, :'race_user_id'::uuid);
SQL
  rm -rf "$temporary_directory"
  if [[ $cleanup_status -ne 0 ]]; then
    echo "Fixture cleanup failed" >&2
    if [[ $original_status -eq 0 ]]; then
      exit "$cleanup_status"
    fi
  fi
  exit "$original_status"
}
trap cleanup EXIT

run_psql -X -q -v ON_ERROR_STOP=1 \
  -v user_id="$user_id" -v invitation_id="$invitation_id" \
  -v token_hash="$token_hash" -v email="$email" \
  -v race_user_id="$race_user_id" \
  -v race_invitation_id="$race_invitation_id" \
  -v race_token_hash="$race_token_hash" -v race_email="$race_email" <<'SQL'
insert into public.users (id, email)
values
  (:'user_id'::uuid, :'email'),
  (:'race_user_id'::uuid, :'race_email');

insert into public.invitations (
  id, organization_id, email, role, token_hash, expires_at
)
select
  fixtures.invitation_id,
  organizations.id,
  fixtures.email,
  'member',
  fixtures.token_hash,
  now() + interval '1 day'
from public.organizations organizations
cross join (
  values
    (:'invitation_id'::uuid, :'email'::text, :'token_hash'::text),
    (:'race_invitation_id'::uuid, :'race_email'::text, :'race_token_hash'::text)
) fixtures (invitation_id, email, token_hash)
where organizations.slug = 'cra';
SQL

accept_once() {
  local accept_token_hash=$1
  local accept_user_id=$2
  local accept_email=$3
  run_psql -X -qAt -v ON_ERROR_STOP=1 \
    -v token_hash="$accept_token_hash" \
    -v user_id="$accept_user_id" -v email="$accept_email" <<'SQL'
select outcome
from public.accept_invitation_atomic(
  :'token_hash', :'user_id'::uuid, :'email'
);
SQL
}

revoke_once() {
  local revoke_invitation_id=$1
  run_psql -X -qAt -v ON_ERROR_STOP=1 \
    -v invitation_id="$revoke_invitation_id" <<'SQL'
select public.revoke_invitation_atomic(
  (select id from public.organizations where slug = 'cra'),
  :'invitation_id'::uuid,
  (select id from public.users where email = 'owner@cra.test'),
  'owner@cra.test'
);
SQL
}

accept_once "$token_hash" "$user_id" "$email" >"$result_one" &
pid_one=$!
accept_once "$token_hash" "$user_id" "$email" >"$result_two" &
pid_two=$!

wait_status=0
wait "$pid_one" || wait_status=$?
wait "$pid_two" || wait_status=$?
if [[ $wait_status -ne 0 ]]; then
  echo "A concurrent acceptance call failed" >&2
  exit "$wait_status"
fi

outcomes=$(
  printf '%s\n%s\n' \
    "$(tr -d '\r\n' <"$result_one")" \
    "$(tr -d '\r\n' <"$result_two")" |
    sort
)
expected_outcomes=$'accepted\nalready_accepted'
if [[ $outcomes != "$expected_outcomes" ]]; then
  printf 'Unexpected outcomes:\n%s\n' "$outcomes" >&2
  exit 1
fi

effect_counts=$(
  run_psql -X -qAt -v ON_ERROR_STOP=1 \
    -v user_id="$user_id" -v invitation_id="$invitation_id" <<'SQL'
select
  (select count(*) from public.organization_members
    where user_id = :'user_id'::uuid)::text
  || ':' ||
  (select count(*) from public.audit_logs
    where action = 'invitation.accepted'
      and entity_id = :'invitation_id')::text;
SQL
)

if [[ $effect_counts != "1:1" ]]; then
  echo "Expected one membership and one audit row, got $effect_counts" >&2
  exit 1
fi

accept_once \
  "$race_token_hash" "$race_user_id" "$race_email" >"$result_three" &
pid_three=$!
revoke_once "$race_invitation_id" >"$result_four" &
pid_four=$!

wait_status=0
wait "$pid_three" || wait_status=$?
wait "$pid_four" || wait_status=$?
if [[ $wait_status -ne 0 ]]; then
  echo "An accept-versus-revoke call failed" >&2
  exit "$wait_status"
fi

accept_outcome=$(tr -d '\r\n' <"$result_three")
revoke_outcome=$(tr -d '\r\n' <"$result_four")
race_effects=$(
  run_psql -X -qAt -v ON_ERROR_STOP=1 \
    -v user_id="$race_user_id" \
    -v invitation_id="$race_invitation_id" <<'SQL'
select
  invitations.status::text || ':' ||
  (select count(*) from public.organization_members
    where user_id = :'user_id'::uuid)::text || ':' ||
  (select count(*) from public.audit_logs
    where action = 'invitation.accepted'
      and entity_id = :'invitation_id')::text || ':' ||
  (select count(*) from public.audit_logs
    where action = 'invitation.revoked'
      and entity_id = :'invitation_id')::text
from public.invitations invitations
where invitations.id = :'invitation_id'::uuid;
SQL
)

case "$accept_outcome:$revoke_outcome:$race_effects" in
  "accepted:already_accepted:accepted:1:1:0" | \
    "not_pending:revoked:revoked:0:0:1") ;;
  *)
    echo "Accept/revoke race produced mixed state: $accept_outcome:$revoke_outcome:$race_effects" >&2
    exit 1
    ;;
esac

echo "Invitation concurrency: accept/accept and accept/revoke serialized"
