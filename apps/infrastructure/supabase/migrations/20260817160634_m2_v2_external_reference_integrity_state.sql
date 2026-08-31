alter table public.product_security_update_artifacts
  drop constraint if exists product_security_update_artifact_distribution_check,
  add constraint product_security_update_artifact_distribution_check check (
    (distribution_kind = 'authenticated_download' and object_key is not null
      and distribution_reference is null
      and jsonb_array_length(published_external_references) = 0)
    or (distribution_kind = 'external_reference'
      and object_key is null
      and distribution_reference is not null
      and distribution_reference ~ '^https://[^/@?#]+(?:/[^?#]*)?(?:\?[^#]*)?(?:#.*)?$'
      and distribution_reference !~* '(signature|token|x-amz-)'
      and jsonb_array_length(published_external_references) > 0
      and public.m2_v2_valid_published_external_references(published_external_references))
  );

alter function public.reserve_product_security_update_artifact_atomic(
  uuid, uuid, uuid, uuid, text, text, text, text, jsonb, text, jsonb, text,
  text, bigint, text, timestamptz, uuid, uuid
) rename to reserve_product_security_update_artifact_atomic_base;

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
  v_result record;
  v_artifact public.product_security_update_artifacts%rowtype;
  v_reference text;
begin
  if p_distribution_kind = 'external_reference' then
    if jsonb_typeof(p_validated_external_references) <> 'array'
       or jsonb_array_length(p_validated_external_references) = 0
       or not public.m2_v2_valid_published_external_references(p_validated_external_references) then
      return query select 'invalid_request'::text, null::jsonb;
      return;
    end if;
  end if;

  select * into v_result
  from public.reserve_product_security_update_artifact_atomic_base(
    p_organization_id, p_product_id, p_release_id, p_actor_user_id,
    p_update_version, p_title, p_artifact_type, p_supported_platform,
    p_signature_metadata, p_distribution_kind, p_validated_external_references,
    p_file_name, p_content_type, p_byte_size, p_sha256, p_issued_at,
    p_idempotency_key, p_correlation_id
  );
  if v_result.outcome <> 'reserved' or p_distribution_kind <> 'external_reference' then
    return query select v_result.outcome, v_result.artifact;
    return;
  end if;

  select coalesce(reference->>'uri', reference->>'url', reference->>'href')
  into v_reference
  from jsonb_array_elements(p_validated_external_references) reference
  limit 1;
  update public.product_security_update_artifacts set
    distribution_reference = v_reference,
    published_external_references = p_validated_external_references,
    version = version + 1,
    updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = (v_result.artifact->>'id')::uuid
  returning * into v_artifact;

  insert into public.product_regulatory_outbox_events(
    organization_id, product_id, release_id, event_type, event_key, payload,
    correlation_id, occurred_at, delivery_state
  ) values (
    p_organization_id, p_product_id, p_release_id, 'security_update_artifact.inspect',
    concat('security-update-artifact:inspect:', v_artifact.id::text),
    jsonb_build_object('artifactId', v_artifact.id, 'distributionKind', p_distribution_kind),
    p_correlation_id, now(), 'scheduled'
  ) on conflict(organization_id, event_key) do nothing;

  return query select 'reserved'::text, public.m2_v2_security_update_artifact_json(v_artifact, true);
end;
$$;

alter function public.review_product_security_update_artifact_atomic(
  uuid, uuid, uuid, uuid, integer, text, text, uuid
) rename to review_product_security_update_artifact_atomic_base;

create or replace function public.review_product_security_update_artifact_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_review_decision text, p_review_reason text,
  p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_artifact public.product_security_update_artifacts%rowtype;
begin
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id;
  if found and p_review_decision = 'cleared' and v_artifact.distribution_kind = 'external_reference'
     and (v_artifact.upload_status <> 'finalized' or v_artifact.integrity_status <> 'verified') then
    return query select 'invalid_state'::text, null::jsonb;
    return;
  end if;
  return query select * from public.review_product_security_update_artifact_atomic_base(
    p_organization_id, p_product_id, p_artifact_id, p_actor_user_id,
    p_expected_version, p_review_decision, p_review_reason, p_correlation_id
  );
end;
$$;

alter function public.finalize_product_security_update_artifact_atomic(
  uuid, uuid, uuid, uuid, integer, text, bigint, text, text, uuid
) rename to finalize_product_security_update_artifact_atomic_base;

create or replace function public.finalize_product_security_update_artifact_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_verified_sha256 text, p_verified_byte_size bigint,
  p_verified_content_type text, p_integrity_status text, p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_artifact public.product_security_update_artifacts%rowtype;
begin
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id
  for update;
  if not found or v_artifact.distribution_kind <> 'external_reference' then
    return query select * from public.finalize_product_security_update_artifact_atomic_base(
      p_organization_id, p_product_id, p_artifact_id, p_actor_user_id,
      p_expected_version, p_verified_sha256, p_verified_byte_size,
      p_verified_content_type, p_integrity_status, p_correlation_id
    );
    return;
  end if;
  if v_artifact.version <> p_expected_version then
    return query select 'conflict'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
    return;
  end if;
  if p_integrity_status <> 'verified'
     or p_verified_sha256 <> v_artifact.sha256
     or p_verified_byte_size <> v_artifact.byte_size
     or btrim(p_verified_content_type) <> v_artifact.content_type then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  update public.product_security_update_artifacts set
    upload_status = 'finalized',
    integrity_status = 'verified',
    version = version + 1,
    updated_by = p_actor_user_id
  where organization_id = p_organization_id and id = p_artifact_id
  returning * into v_artifact;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'product.security_update_artifact_finalized',
    'product_security_update_artifact', p_artifact_id::text,
    jsonb_build_object('integrityStatus', p_integrity_status, 'correlationId', p_correlation_id)
  );
  return query select 'finalized'::text, public.m2_v2_security_update_artifact_json(v_artifact, false);
end;
$$;

alter function public.publish_product_security_update_artifact_atomic(
  uuid, uuid, uuid, uuid, integer, jsonb, uuid
) rename to publish_product_security_update_artifact_atomic_base;

create or replace function public.publish_product_security_update_artifact_atomic(
  p_organization_id uuid, p_product_id uuid, p_artifact_id uuid, p_actor_user_id uuid,
  p_expected_version integer, p_published_external_references jsonb,
  p_correlation_id uuid
) returns table(outcome text, artifact jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_artifact public.product_security_update_artifacts%rowtype;
begin
  select * into v_artifact from public.product_security_update_artifacts
  where organization_id = p_organization_id and product_id = p_product_id and id = p_artifact_id;
  if found and v_artifact.distribution_kind = 'external_reference'
     and p_published_external_references <> v_artifact.published_external_references then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  return query select * from public.publish_product_security_update_artifact_atomic_base(
    p_organization_id, p_product_id, p_artifact_id, p_actor_user_id,
    p_expected_version, p_published_external_references, p_correlation_id
  );
end;
$$;

alter function public.reserve_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, text, text, text, text, jsonb, text, jsonb, text, text, bigint, text, timestamptz, uuid, uuid) owner to postgres;
alter function public.review_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid) owner to postgres;
alter function public.finalize_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, bigint, text, text, uuid) owner to postgres;
alter function public.publish_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, jsonb, uuid) owner to postgres;

revoke all on function
  public.reserve_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, text, text, text, text, jsonb, text, jsonb, text, text, bigint, text, timestamptz, uuid, uuid),
  public.review_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid),
  public.finalize_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, bigint, text, text, uuid),
  public.publish_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, jsonb, uuid)
from public, anon, authenticated;

grant execute on function
  public.reserve_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, text, text, text, text, jsonb, text, jsonb, text, text, bigint, text, timestamptz, uuid, uuid),
  public.review_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, text, uuid),
  public.finalize_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, text, bigint, text, text, uuid),
  public.publish_product_security_update_artifact_atomic(uuid, uuid, uuid, uuid, integer, jsonb, uuid)
to service_role;
