-- Compatibility for the first local M3 draft, which installed the keyed
-- completion overload before its private eight-argument implementation.  The
-- legacy overload remains ungranted and is reachable only from the keyed
-- security-definer function.

create or replace function public.finalize_sbom_source_atomic(
  p_organization_id uuid, p_source_id uuid, p_actor_user_id uuid, p_actor_credential_id uuid,
  p_actual_sha256 text, p_actual_byte_size bigint, p_actual_media_type text, p_correlation_id uuid
) returns table(outcome text, source jsonb, job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $function$
declare v_source public.sbom_sources%rowtype; v_raw_id uuid; v_job_id uuid;
begin
  if p_correlation_id is null or p_actual_sha256 !~ '^[a-f0-9]{64}$'
    or p_actual_byte_size not between 1 and 104857600
    or p_actual_media_type not in ('application/json', 'application/xml', 'text/xml', 'application/octet-stream',
      'application/vnd.cyclonedx+json', 'application/vnd.cyclonedx+xml', 'application/spdx+json', 'application/spdx+xml')
    or ((p_actor_user_id is null) = (p_actor_credential_id is null)) then
    return query select 'invalid_request'::text, null::jsonb, null::jsonb; return;
  end if;
  select * into v_source from public.sbom_sources sources
    where sources.organization_id = p_organization_id and sources.id = p_source_id for update;
  if not found
    or (p_actor_user_id is not null and (v_source.actor_user_id is distinct from p_actor_user_id
      or not public.m2_active_member(p_organization_id, p_actor_user_id)))
    or (p_actor_credential_id is not null and (v_source.actor_credential_id is distinct from p_actor_credential_id
      or not exists (select 1 from public.sbom_ci_credentials credentials
        where credentials.organization_id = p_organization_id and credentials.id = p_actor_credential_id
          and credentials.status = 'active'))) then
    return query select 'not_found'::text, null::jsonb, null::jsonb; return;
  end if;
  if v_source.status = 'verified' then
    select id into v_job_id from public.sbom_ingest_jobs
      where organization_id = p_organization_id and source_id = v_source.id;
    return query select 'replayed'::text, public.sbom_source_json(p_organization_id, v_source.id),
      public.sbom_ingest_job_json(p_organization_id, v_job_id); return;
  end if;
  if v_source.status <> 'upload_pending' then
    return query select 'invalid_state'::text, public.sbom_source_json(p_organization_id, v_source.id), null::jsonb;
    return;
  end if;
  if v_source.upload_expires_at <= now() then
    update public.sbom_sources set status = 'expired', rejected_at = now(), rejection_code = 'upload_expired'
      where organization_id = p_organization_id and id = v_source.id;
    return query select 'expired'::text, public.sbom_source_json(p_organization_id, v_source.id), null::jsonb; return;
  end if;
  if p_actual_sha256 <> v_source.declared_sha256 or p_actual_byte_size <> v_source.declared_byte_size
    or p_actual_media_type <> v_source.declared_media_type then
    update public.sbom_sources set status = 'rejected', rejected_at = now(), rejection_code = case
      when p_actual_sha256 <> v_source.declared_sha256 then 'hash_mismatch'
      when p_actual_byte_size <> v_source.declared_byte_size then 'byte_size_mismatch'
      else 'media_type_mismatch' end
    where organization_id = p_organization_id and id = v_source.id;
    insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
    values (p_organization_id, p_actor_user_id, 'sbom.hash_mismatch', 'sbom_source', v_source.id::text,
      jsonb_build_object('correlationId', p_correlation_id, 'code', case
        when p_actual_sha256 <> v_source.declared_sha256 then 'hash_mismatch'
        when p_actual_byte_size <> v_source.declared_byte_size then 'byte_size_mismatch'
        else 'media_type_mismatch' end));
    return query select 'integrity_mismatch'::text, public.sbom_source_json(p_organization_id, v_source.id), null::jsonb;
    return;
  end if;
  insert into public.sbom_raw_objects(organization_id, sha256, byte_size, media_type, storage_key)
  values (p_organization_id, v_source.declared_sha256, v_source.declared_byte_size,
    v_source.declared_media_type, v_source.staging_storage_key)
  on conflict (organization_id, sha256) do nothing;
  select id into v_raw_id from public.sbom_raw_objects
    where organization_id = p_organization_id and sha256 = v_source.declared_sha256 for share;
  update public.sbom_sources set status = 'verified', verified_at = now(), raw_object_id = v_raw_id
    where organization_id = p_organization_id and id = v_source.id;
  insert into public.sbom_ingest_jobs(
    organization_id, source_id, release_id, actor_user_id, actor_credential_id, correlation_id,
    idempotency_key, input_sha256
  ) values (
    p_organization_id, v_source.id, v_source.release_id, v_source.actor_user_id,
    v_source.actor_credential_id, v_source.correlation_id, v_source.idempotency_key, v_source.declared_sha256
  ) returning id into v_job_id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values
    (p_organization_id, p_actor_user_id, 'sbom.upload_completed', 'sbom_source', v_source.id::text,
      jsonb_build_object('sha256', v_source.declared_sha256, 'byteSize', v_source.declared_byte_size,
        'correlationId', p_correlation_id)),
    (p_organization_id, p_actor_user_id, 'sbom.source_linked', 'sbom_source', v_source.id::text,
      jsonb_build_object('rawObjectId', v_raw_id, 'correlationId', p_correlation_id)),
    (p_organization_id, p_actor_user_id, 'sbom.job_queued', 'sbom_ingest_job', v_job_id::text,
      jsonb_build_object('sourceId', v_source.id, 'correlationId', p_correlation_id));
  return query select 'queued'::text, public.sbom_source_json(p_organization_id, v_source.id),
    public.sbom_ingest_job_json(p_organization_id, v_job_id);
exception when unique_violation then
  select id into v_job_id from public.sbom_ingest_jobs
    where organization_id = p_organization_id and source_id = p_source_id;
  return query select 'replayed'::text, public.sbom_source_json(p_organization_id, p_source_id),
    public.sbom_ingest_job_json(p_organization_id, v_job_id);
end;
$function$;

create or replace function public.reject_sbom_source_integrity_atomic(
  p_organization_id uuid, p_source_id uuid, p_actor_user_id uuid, p_actor_credential_id uuid,
  p_actual_sha256 text, p_actual_byte_size bigint, p_actual_media_type text, p_correlation_id uuid
) returns table(outcome text, source jsonb)
language plpgsql security definer set search_path = public, pg_temp as $function$
declare v_source public.sbom_sources%rowtype; v_code text;
begin
  if p_correlation_id is null
    or ((p_actor_user_id is null) = (p_actor_credential_id is null))
    or (p_actual_sha256 is not null and p_actual_sha256 !~ '^[a-f0-9]{64}$')
    or (p_actual_byte_size is not null and (p_actual_byte_size < 0 or p_actual_byte_size > 104857600))
    or (p_actual_media_type is not null and p_actual_media_type not in (
      'application/json', 'application/xml', 'text/xml', 'application/octet-stream',
      'application/vnd.cyclonedx+json', 'application/vnd.cyclonedx+xml', 'application/spdx+json', 'application/spdx+xml'
    )) then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_source from public.sbom_sources sources
  where sources.organization_id = p_organization_id and sources.id = p_source_id for update;
  if not found
    or (p_actor_user_id is not null and (v_source.actor_user_id is distinct from p_actor_user_id
      or not public.m2_active_member(p_organization_id, p_actor_user_id)))
    or (p_actor_credential_id is not null and (v_source.actor_credential_id is distinct from p_actor_credential_id
      or not exists (select 1 from public.sbom_ci_credentials credentials
        where credentials.organization_id = p_organization_id and credentials.id = p_actor_credential_id
          and credentials.status = 'active'))) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if v_source.status = 'rejected' then
    return query select 'replayed'::text, public.sbom_source_json(p_organization_id, v_source.id); return;
  end if;
  if v_source.status <> 'upload_pending' then
    return query select 'invalid_state'::text, public.sbom_source_json(p_organization_id, v_source.id); return;
  end if;
  v_code := case
    when p_actual_sha256 is null or p_actual_sha256 <> v_source.declared_sha256 then 'hash_mismatch'
    when p_actual_byte_size is null or p_actual_byte_size <> v_source.declared_byte_size then 'byte_size_mismatch'
    when p_actual_media_type is null or p_actual_media_type <> v_source.declared_media_type then 'media_type_mismatch'
    else 'hash_mismatch'
  end;
  update public.sbom_sources set status = 'rejected', rejected_at = now(), rejection_code = v_code
  where organization_id = p_organization_id and id = v_source.id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'sbom.hash_mismatch', 'sbom_source', v_source.id::text,
    jsonb_build_object('correlationId', p_correlation_id, 'code', v_code));
  return query select 'rejected'::text, public.sbom_source_json(p_organization_id, v_source.id);
end;
$function$;

alter function public.finalize_sbom_source_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid) owner to postgres;
alter function public.reject_sbom_source_integrity_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid) owner to postgres;
revoke all on function public.finalize_sbom_source_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.reject_sbom_source_integrity_atomic(uuid, uuid, uuid, uuid, text, bigint, text, uuid) from public, anon, authenticated, service_role;
