-- Authenticated artifact bytes are content-addressed at the organization
-- boundary. A release record remains immutable and release-scoped, while two
-- records that attest to identical verified bytes may safely share one private
-- storage object. Existing three-segment keys remain readable so applying this
-- migration never invalidates a previously reserved upload.

alter table public.product_security_update_artifacts
  drop constraint if exists product_security_update_artifact_organization_id_object_key_key,
  drop constraint if exists product_security_update_artif_organization_id_sha256_object_key,
  drop constraint if exists product_security_update_artifacts_object_key_check,
  add constraint product_security_update_artifacts_object_key_check check (
    object_key is null
    or object_key ~ '^[0-9a-f-]{36}/([0-9a-f-]{36}/)?[a-f0-9]{64}$'
  );

create index if not exists product_security_update_artifacts_org_object_key_idx
  on public.product_security_update_artifacts(organization_id, object_key)
  where object_key is not null;

create or replace function public.reserve_product_security_update_artifact_atomic(
  p_organization_id uuid, p_product_id uuid, p_release_id uuid, p_actor_user_id uuid,
  p_update_version text, p_title text, p_artifact_type text, p_supported_platform text,
  p_signature_metadata jsonb, p_distribution_kind text,
  p_validated_external_references jsonb, p_file_name text,
  p_content_type text, p_byte_size bigint, p_sha256 text, p_issued_at timestamptz,
  p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_artifact public.product_security_update_artifacts%rowtype;
  v_replay public.product_security_update_artifacts%rowtype;
  v_support public.product_support_periods%rowtype;
  v_artifact_id uuid := gen_random_uuid();
  v_object_key text;
  v_distribution_reference text;
  v_request_digest text;
  v_support_eligible boolean := false;
begin
  if p_idempotency_key is null
     or char_length(btrim(p_update_version)) not between 1 and 200
     or char_length(btrim(p_title)) not between 1 and 200
     or p_artifact_type not in ('software_update', 'firmware_update', 'security_advisory')
     or char_length(btrim(p_supported_platform)) not between 1 and 500
     or jsonb_typeof(p_signature_metadata) <> 'object'
     or p_distribution_kind not in ('authenticated_download', 'external_reference')
     or jsonb_typeof(p_validated_external_references) <> 'array'
     or char_length(btrim(p_file_name)) not between 1 and 255
     or char_length(btrim(p_content_type)) not between 1 and 255
     or p_byte_size not between 1 and 2147483647
     or p_sha256 !~ '^[a-f0-9]{64}$' or p_issued_at is null then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  perform 1 from public.products
  where organization_id = p_organization_id and id = p_product_id for update;
  if not found or not exists (
    select 1 from public.product_releases
    where organization_id = p_organization_id and product_id = p_product_id and id = p_release_id
  ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  select * into v_support from public.m2_active_support_period(
    p_organization_id, p_product_id, p_release_id
  );
  v_support_eligible := found and p_issued_at >= v_support.support_starts_at
    and p_issued_at <= v_support.support_ends_at;
  if p_distribution_kind = 'authenticated_download'
     and jsonb_array_length(p_validated_external_references) <> 0 then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  if p_distribution_kind = 'external_reference' then
    if jsonb_array_length(p_validated_external_references) = 0
       or not public.m2_v2_valid_published_external_references(p_validated_external_references) then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end if;
    select reference->>'uri' into v_distribution_reference
    from jsonb_array_elements(p_validated_external_references) reference
    limit 1;
    if v_distribution_reference is null then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end if;
  end if;
  v_request_digest := public.m2_v2_command_digest(jsonb_build_object(
    'action', 'reserve_artifact', 'productId', p_product_id, 'releaseId', p_release_id,
    'updateVersion', btrim(p_update_version), 'title', btrim(p_title),
    'artifactType', p_artifact_type, 'supportedPlatform', btrim(p_supported_platform),
    'signatureMetadata', p_signature_metadata, 'distributionKind', p_distribution_kind,
    'validatedExternalReferences', p_validated_external_references,
    'fileName', btrim(p_file_name), 'contentType', btrim(p_content_type),
    'byteSize', p_byte_size, 'sha256', p_sha256, 'issuedAt', public.m2_utc_z(p_issued_at)
  ));
  select * into v_replay from public.product_security_update_artifacts
  where organization_id = p_organization_id and created_by = p_actor_user_id
    and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_replay.idempotency_request_digest = v_request_digest then
      return query select 'reserved'::text, public.m2_v2_security_update_artifact_json(v_replay, true);
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb;
    return;
  end if;
  v_object_key := case when p_distribution_kind = 'authenticated_download'
    then concat(p_organization_id::text, '/', p_sha256)
    else null end;
  insert into public.product_security_update_artifacts(
    id, organization_id, product_id, release_id, support_period_id, support_period_revision,
    update_version, title, artifact_type, supported_platform, signature_metadata,
    distribution_kind, distribution_reference, published_external_references,
    file_name, content_type, byte_size, sha256, object_key, issued_at,
    upload_status, integrity_status,
    availability_status, availability_explanation,
    created_by, updated_by, idempotency_key, idempotency_request_digest
  ) values (
    v_artifact_id, p_organization_id, p_product_id, p_release_id,
    case when v_support_eligible then v_support.id else null end,
    case when v_support_eligible then v_support.scope_revision else null end,
    btrim(p_update_version), btrim(p_title), p_artifact_type,
    btrim(p_supported_platform), p_signature_metadata, p_distribution_kind,
    v_distribution_reference, p_validated_external_references,
    btrim(p_file_name), btrim(p_content_type), p_byte_size, p_sha256, v_object_key,
    p_issued_at, 'reserved', 'pending',
    case when v_support_eligible then 'pending' else 'blocked' end,
    jsonb_build_object(
      'ruleVersion', 'm2.v2.security-update-availability.v1',
      'status', case when v_support_eligible then 'pending' else 'blocked' end,
      'code', case when v_support_eligible then 'awaiting_publication'
        when v_support.id is null then 'missing_support_period'
        else 'issued_at_outside_current_support_period' end
    ), p_actor_user_id, p_actor_user_id, p_idempotency_key, v_request_digest
  ) returning * into v_artifact;
  insert into public.product_regulatory_outbox_events(
    organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, delivery_state
  ) values (
    p_organization_id, p_product_id, p_release_id, 'security_update_artifact.inspect',
    concat('security-update-artifact:inspect:', v_artifact.id::text),
    jsonb_build_object('artifactId', v_artifact.id, 'distributionKind', p_distribution_kind),
    p_correlation_id, now(), 'scheduled'
  );
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'product.security_update_artifact_reserved',
    'product_security_update_artifact', v_artifact.id::text,
    jsonb_build_object(
      'releaseId', p_release_id, 'distributionKind', p_distribution_kind,
      'externalReferenceCount', jsonb_array_length(p_validated_external_references),
      'correlationId', p_correlation_id, 'requestDigest', v_request_digest
    )
  );
  return query select 'reserved'::text, public.m2_v2_security_update_artifact_json(v_artifact, true);
end;
$$;

alter function public.reserve_product_security_update_artifact_atomic(
  uuid, uuid, uuid, uuid, text, text, text, text, jsonb, text, jsonb, text,
  text, bigint, text, timestamptz, uuid, uuid
) owner to postgres;
revoke all on function public.reserve_product_security_update_artifact_atomic(
  uuid, uuid, uuid, uuid, text, text, text, text, jsonb, text, jsonb, text,
  text, bigint, text, timestamptz, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.reserve_product_security_update_artifact_atomic(
  uuid, uuid, uuid, uuid, text, text, text, text, jsonb, text, jsonb, text,
  text, bigint, text, timestamptz, uuid, uuid
) to service_role;
