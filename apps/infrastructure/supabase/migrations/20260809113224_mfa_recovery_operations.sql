-- Persist MFA recovery across provider failures so a consumed code resumes the
-- same operation instead of stranding the user after partial factor cleanup.
create table public.mfa_recovery_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  recovery_code_id uuid not null,
  auth_user_id uuid not null,
  status text not null default 'claimed',
  attempts integer not null default 0,
  last_error text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  constraint mfa_recovery_operation_status_check
    check (status in ('claimed', 'factors_removed', 'completed', 'failed')),
  constraint mfa_recovery_operation_attempts_check check (attempts >= 0),
  constraint mfa_recovery_operation_error_length_check
    check (last_error is null or length(last_error) <= 100),
  constraint mfa_recovery_operation_lease_check check (
    (status = 'claimed' and lease_expires_at is not null)
    or (status <> 'claimed' and lease_expires_at is null)
  ),
  constraint mfa_recovery_operation_completion_check check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  ),
  constraint mfa_recovery_operation_code_key unique (recovery_code_id)
);

create index idx_mfa_recovery_operations_pending
  on public.mfa_recovery_operations (updated_at)
  where status <> 'completed';

-- Different valid codes for one user must not create parallel provider sagas.
-- The claim function serializes on the user row; this partial unique index is
-- the final database guard if a future caller forgets that protocol.
create unique index mfa_recovery_operations_user_active_key
  on public.mfa_recovery_operations (user_id)
  where status <> 'completed';

drop trigger if exists set_mfa_recovery_operations_updated_at
  on public.mfa_recovery_operations;
create trigger set_mfa_recovery_operations_updated_at
  before update on public.mfa_recovery_operations
  for each row execute function public.set_updated_at();

alter table public.mfa_recovery_operations enable row level security;
grant all on table public.mfa_recovery_operations to service_role;
revoke all on table public.mfa_recovery_operations
  from public, anon, authenticated;

create or replace function public.claim_mfa_recovery(
  p_user_id uuid,
  p_code_hash text
)
returns table (
  outcome text,
  operation_id uuid,
  auth_user_id uuid,
  status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_code public.auth_mfa_recovery_codes%rowtype;
  v_operation public.mfa_recovery_operations%rowtype;
  v_user public.users%rowtype;
begin
  if p_user_id is null
     or p_code_hash is null
     or p_code_hash !~ '^[0-9a-f]{64}$' then
    return query
      select 'invalid'::text, null::uuid, null::uuid, null::text;
    return;
  end if;

  select codes.*
    into v_code
    from public.auth_mfa_recovery_codes codes
   where codes.user_id = p_user_id
     and codes.code_hash = p_code_hash
   for update;

  if not found then
    return query
      select 'invalid'::text, null::uuid, null::uuid, null::text;
    return;
  end if;

  select operations.*
    into v_operation
    from public.mfa_recovery_operations operations
   where operations.recovery_code_id = v_code.id
   for update;

  if found then
    if v_operation.user_id <> p_user_id then
      return query
        select 'invalid'::text, null::uuid, null::uuid, null::text;
      return;
    end if;

    if v_operation.status in ('claimed', 'failed')
       and v_operation.lease_expires_at > now() then
      return query select
        'in_progress'::text,
        v_operation.id,
        v_operation.auth_user_id,
        v_operation.status;
      return;
    end if;

    if v_operation.status in ('claimed', 'failed') then
      update public.mfa_recovery_operations operations
         set status = 'claimed',
             lease_expires_at = now() + interval '5 minutes'
       where operations.id = v_operation.id
       returning * into v_operation;
    end if;

    return query select
      'resumed'::text,
      v_operation.id,
      v_operation.auth_user_id,
      v_operation.status;
    return;
  end if;

  if v_code.consumed_at is not null then
    return query
      select 'invalid'::text, null::uuid, null::uuid, null::text;
    return;
  end if;

  select users.*
    into v_user
    from public.users users
   where users.id = p_user_id
   for update;

  if not found or v_user.auth_user_id is null then
    return query
      select 'invalid'::text, null::uuid, null::uuid, null::text;
    return;
  end if;

  select operations.*
    into v_operation
    from public.mfa_recovery_operations operations
   where operations.user_id = v_user.id
     and operations.status <> 'completed'
   for update;

  if found then
    if v_operation.status in ('claimed', 'failed')
       and v_operation.lease_expires_at > now() then
      return query select
        'in_progress'::text,
        v_operation.id,
        v_operation.auth_user_id,
        v_operation.status;
      return;
    end if;

    if v_operation.status in ('claimed', 'failed') then
      update public.mfa_recovery_operations operations
         set status = 'claimed',
             lease_expires_at = now() + interval '5 minutes'
       where operations.id = v_operation.id
       returning * into v_operation;
    end if;

    return query select
      'resumed'::text,
      v_operation.id,
      v_operation.auth_user_id,
      v_operation.status;
    return;
  end if;

  update public.auth_mfa_recovery_codes codes
     set consumed_at = now()
   where codes.id = v_code.id;

  insert into public.mfa_recovery_operations (
    user_id,
    recovery_code_id,
    auth_user_id,
    lease_expires_at
  ) values (
    v_user.id,
    v_code.id,
    v_user.auth_user_id,
    now() + interval '5 minutes'
  )
  returning * into v_operation;

  return query select
    'claimed'::text,
    v_operation.id,
    v_operation.auth_user_id,
    v_operation.status;
end;
$$;

create or replace function public.mark_mfa_factors_removed(
  p_operation_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_operation public.mfa_recovery_operations%rowtype;
begin
  select operations.*
    into v_operation
    from public.mfa_recovery_operations operations
   where operations.id = p_operation_id
     and operations.user_id = p_user_id
   for update;

  if not found then
    return 'not_found';
  end if;
  if v_operation.status not in ('claimed', 'failed') then
    return 'invalid_state';
  end if;

  update public.mfa_recovery_operations operations
     set status = 'factors_removed',
         last_error = null,
         lease_expires_at = null
   where operations.id = v_operation.id;

  return 'factors_removed';
end;
$$;

create or replace function public.complete_mfa_recovery(
  p_operation_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_operation public.mfa_recovery_operations%rowtype;
  v_actor_email text;
begin
  select operations.*
    into v_operation
    from public.mfa_recovery_operations operations
   where operations.id = p_operation_id
     and operations.user_id = p_user_id
   for update;

  if not found then
    return 'not_found';
  end if;
  if v_operation.status <> 'factors_removed' then
    return 'invalid_state';
  end if;

  select users.email into v_actor_email
    from public.users users
   where users.id = v_operation.user_id;

  delete from public.auth_mfa_recovery_codes codes
   where codes.user_id = v_operation.user_id;

  insert into public.audit_logs (
    user_id,
    actor_email,
    action,
    entity_type,
    entity_id,
    changes
  ) values (
    v_operation.user_id,
    v_actor_email,
    'mfa.recovery_code_used',
    'user',
    v_operation.user_id::text,
    jsonb_build_object('factorsRemoved', true)
  );

  update public.mfa_recovery_operations operations
     set status = 'completed',
         completed_at = now(),
         last_error = null,
         lease_expires_at = null
   where operations.id = v_operation.id;

  return 'completed';
end;
$$;

create or replace function public.fail_mfa_recovery(
  p_operation_id uuid,
  p_user_id uuid,
  p_error_code text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_operation public.mfa_recovery_operations%rowtype;
  v_error_code text;
begin
  select operations.*
    into v_operation
    from public.mfa_recovery_operations operations
   where operations.id = p_operation_id
     and operations.user_id = p_user_id
   for update;

  if not found then
    return 'not_found';
  end if;
  if v_operation.status not in ('claimed', 'failed') then
    return 'invalid_state';
  end if;

  v_error_code := regexp_replace(
    lower(left(coalesce(nullif(btrim(p_error_code), ''), 'unknown'), 100)),
    '[^a-z0-9_.:-]',
    '_',
    'g'
  );

  update public.mfa_recovery_operations operations
     set status = 'failed',
         attempts = least(
           2147483647::bigint,
           operations.attempts::bigint + 1
         )::integer,
         last_error = v_error_code,
         lease_expires_at = null
   where operations.id = v_operation.id;

  return 'failed';
end;
$$;

create or replace function public.get_mfa_recovery_status(
  p_operation_id uuid,
  p_user_id uuid
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select operations.status
    from public.mfa_recovery_operations operations
   where operations.id = p_operation_id
     and operations.user_id = p_user_id;
$$;

alter function public.claim_mfa_recovery(uuid, text) owner to postgres;
alter function public.mark_mfa_factors_removed(uuid, uuid) owner to postgres;
alter function public.complete_mfa_recovery(uuid, uuid) owner to postgres;
alter function public.fail_mfa_recovery(uuid, uuid, text) owner to postgres;
alter function public.get_mfa_recovery_status(uuid, uuid) owner to postgres;

revoke all on function public.claim_mfa_recovery(uuid, text)
  from public, anon, authenticated;
revoke all on function public.mark_mfa_factors_removed(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_mfa_recovery(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.fail_mfa_recovery(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_mfa_recovery_status(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.claim_mfa_recovery(uuid, text)
  to service_role;
grant execute on function public.mark_mfa_factors_removed(uuid, uuid)
  to service_role;
grant execute on function public.complete_mfa_recovery(uuid, uuid)
  to service_role;
grant execute on function public.fail_mfa_recovery(uuid, uuid, text)
  to service_role;
grant execute on function public.get_mfa_recovery_status(uuid, uuid)
  to service_role;
