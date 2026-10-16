-- Remove unused PL/pgSQL row variables from the M8-05 retention projection
-- refresh function. Behavior is unchanged: the evidence version row is still
-- locked before the protection snapshot is recalculated.
create or replace function public.refresh_evidence_document_retention_protection_atomic(
  p_organization_id uuid,
  p_version_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product_ids uuid[];
  v_product_count integer;
  v_incomplete boolean;
  v_legal_hold boolean;
  v_retention_until timestamptz;
  v_protection_until timestamptz;
begin
  perform 1
    from public.evidence_document_versions
   where organization_id = p_organization_id
     and id = p_version_id
   for update;

  if not found then
    return null;
  end if;

  select coalesce(array_agg(vp.product_id order by vp.product_id), '{}'::uuid[]),
         count(*)::integer,
         coalesce(bool_or(p.retention_status <> 'current' or p.retention_until is null or p.retention_protection_until is null), true),
         coalesce(bool_or(exists(
           select 1
             from public.product_lifecycle_dependency_facts f
            where f.organization_id = p.organization_id
              and f.product_id = p.id
              and f.active
              and f.authority_kind = 'legal_hold'
         )), false),
         max(p.retention_until),
         max(p.retention_protection_until)
    into v_product_ids,
         v_product_count,
         v_incomplete,
         v_legal_hold,
         v_retention_until,
         v_protection_until
    from public.evidence_document_version_products vp
    left join public.products p
      on p.organization_id = vp.organization_id
     and p.id = vp.product_id
   where vp.organization_id = p_organization_id
     and vp.version_id = p_version_id;

  insert into public.evidence_document_version_retention_protections(
    organization_id,
    version_id,
    linked_product_ids,
    linked_product_count,
    source_status,
    source_incomplete,
    product_legal_hold_active,
    observed_retention_until,
    observed_protection_until,
    strongest_retention_until,
    strongest_protection_until,
    refreshed_at
  ) values (
    p_organization_id,
    p_version_id,
    v_product_ids,
    v_product_count,
    case when v_incomplete or v_product_count = 0 then 'incomplete' else 'current' end,
    v_incomplete or v_product_count = 0,
    v_legal_hold,
    v_retention_until,
    v_protection_until,
    v_retention_until,
    v_protection_until,
    clock_timestamp()
  ) on conflict (organization_id, version_id) do update set
    linked_product_ids = excluded.linked_product_ids,
    linked_product_count = excluded.linked_product_count,
    source_status = excluded.source_status,
    source_incomplete = excluded.source_incomplete,
    product_legal_hold_active = excluded.product_legal_hold_active,
    observed_retention_until = excluded.observed_retention_until,
    observed_protection_until = excluded.observed_protection_until,
    strongest_retention_until = case
      when evidence_document_version_retention_protections.strongest_retention_until is null
        then excluded.observed_retention_until
      when excluded.observed_retention_until is null
        then evidence_document_version_retention_protections.strongest_retention_until
      else greatest(evidence_document_version_retention_protections.strongest_retention_until, excluded.observed_retention_until)
    end,
    strongest_protection_until = case
      when evidence_document_version_retention_protections.strongest_protection_until is null
        then excluded.observed_protection_until
      when excluded.observed_protection_until is null
        then evidence_document_version_retention_protections.strongest_protection_until
      else greatest(evidence_document_version_retention_protections.strongest_protection_until, excluded.observed_protection_until)
    end,
    refreshed_at = clock_timestamp();

  return jsonb_build_object(
    'versionId', p_version_id,
    'linkedProductIds', to_jsonb(v_product_ids),
    'status', case when v_incomplete or v_product_count = 0 then 'incomplete' else 'current' end,
    'retentionUntil', v_retention_until,
    'retentionProtectionUntil', v_protection_until,
    'legalHoldActive', v_legal_hold
  );
end;
$$;

revoke all on function public.refresh_evidence_document_retention_protection_atomic(uuid, uuid) from public, anon, authenticated;
grant execute on function public.refresh_evidence_document_retention_protection_atomic(uuid, uuid) to service_role;
notify pgrst, 'reload schema';
