-- Keep completion idempotency explicit at the public RPC boundary.  The
-- original M3 migration was already applied locally with eight-argument
-- functions, so this additive overload preserves both existing databases and
-- clean installs while routing all service-role calls through the keyed form.

do $$
begin
  if to_regprocedure('public.finalize_sbom_source_atomic(uuid,uuid,uuid,uuid,text,bigint,text,uuid)') is not null then
    revoke all on function public.finalize_sbom_source_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid) from service_role;
  end if;
  if to_regprocedure('public.reject_sbom_source_integrity_atomic(uuid,uuid,uuid,uuid,text,bigint,text,uuid)') is not null then
    revoke all on function public.reject_sbom_source_integrity_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid) from service_role;
  end if;
end;
$$;

-- Early M3 local environments already have the keyed implementation.  Fresh
-- installs have the original eight-argument implementation, so install the
-- keyed overload only when that legacy implementation is present.
do $migration$
begin
  if to_regprocedure('public.finalize_sbom_source_atomic(uuid,uuid,uuid,uuid,text,bigint,text,uuid)') is null then
    return;
  end if;

  execute $function_sql$
create or replace function public.finalize_sbom_source_atomic(
  p_organization_id uuid, p_source_id uuid, p_actor_user_id uuid, p_actor_credential_id uuid,
  p_actual_sha256 text, p_actual_byte_size bigint, p_actual_media_type text,
  p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, source jsonb, job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $function$
declare v_source public.sbom_sources%rowtype;
begin
  if p_idempotency_key is null
    or ((p_actor_user_id is null) = (p_actor_credential_id is null)) then
    return query select 'invalid_request'::text, null::jsonb, null::jsonb;
    return;
  end if;

  select * into v_source
  from public.sbom_sources sources
  where sources.organization_id = p_organization_id and sources.id = p_source_id;

  if not found
    or (p_actor_user_id is not null and (v_source.actor_user_id is distinct from p_actor_user_id
      or not public.m2_active_member(p_organization_id, p_actor_user_id)))
    or (p_actor_credential_id is not null and (v_source.actor_credential_id is distinct from p_actor_credential_id
      or not exists (
        select 1 from public.sbom_ci_credentials credentials
        where credentials.organization_id = p_organization_id
          and credentials.id = p_actor_credential_id
          and credentials.status = 'active'
      ))) then
    return query select 'not_found'::text, null::jsonb, null::jsonb;
    return;
  end if;

  if v_source.idempotency_key <> p_idempotency_key then
    return query select 'idempotency_mismatch'::text, null::jsonb, null::jsonb;
    return;
  end if;

  return query
  select * from public.finalize_sbom_source_atomic(
    p_organization_id, p_source_id, p_actor_user_id, p_actor_credential_id,
    p_actual_sha256, p_actual_byte_size, p_actual_media_type, p_correlation_id
  );
end;
$function$;

create or replace function public.reject_sbom_source_integrity_atomic(
  p_organization_id uuid, p_source_id uuid, p_actor_user_id uuid, p_actor_credential_id uuid,
  p_actual_sha256 text, p_actual_byte_size bigint, p_actual_media_type text,
  p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, source jsonb)
language plpgsql security definer set search_path = public, pg_temp as $function$
declare v_source public.sbom_sources%rowtype;
begin
  if p_idempotency_key is null
    or ((p_actor_user_id is null) = (p_actor_credential_id is null)) then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;

  select * into v_source
  from public.sbom_sources sources
  where sources.organization_id = p_organization_id and sources.id = p_source_id;

  if not found
    or (p_actor_user_id is not null and (v_source.actor_user_id is distinct from p_actor_user_id
      or not public.m2_active_member(p_organization_id, p_actor_user_id)))
    or (p_actor_credential_id is not null and (v_source.actor_credential_id is distinct from p_actor_credential_id
      or not exists (
        select 1 from public.sbom_ci_credentials credentials
        where credentials.organization_id = p_organization_id
          and credentials.id = p_actor_credential_id
          and credentials.status = 'active'
      ))) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  if v_source.idempotency_key <> p_idempotency_key then
    return query select 'idempotency_mismatch'::text, null::jsonb;
    return;
  end if;

  return query
  select * from public.reject_sbom_source_integrity_atomic(
    p_organization_id, p_source_id, p_actor_user_id, p_actor_credential_id,
    p_actual_sha256, p_actual_byte_size, p_actual_media_type, p_correlation_id
  );
end;
$function$;
$function_sql$;
end;
$migration$;

alter function public.finalize_sbom_source_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid, uuid) owner to postgres;
alter function public.reject_sbom_source_integrity_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid, uuid) owner to postgres;

revoke all on function public.finalize_sbom_source_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.reject_sbom_source_integrity_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.finalize_sbom_source_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid, uuid) to service_role;
grant execute on function public.reject_sbom_source_integrity_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid, uuid) to service_role;
