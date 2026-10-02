-- The version selector is product-scoped: historical metadata is returned only
-- for versions applicable to the selected active product.
revoke all on function public.list_evidence_document_versions(uuid,uuid,uuid) from public, anon, authenticated, service_role;
drop function public.list_evidence_document_versions(uuid,uuid,uuid);

create function public.list_evidence_document_versions(
  p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid, p_document_id uuid
) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select case when not public.m8_evidence_actor_active(p_organization_id, p_actor_user_id)
    or not exists (
      select 1 from public.products p
      where p.organization_id = p_organization_id and p.id = p_product_id and p.archived_at is null
    )
    or not exists (
      select 1 from public.evidence_documents d
      where d.organization_id = p_organization_id and d.id = p_document_id
    )
    then null
    else jsonb_build_object('documentId', p_document_id, 'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'documentId', v.document_id, 'organizationId', v.organization_id,
        'versionNumber', v.version_number, 'title', v.title, 'documentClass', v.document_class,
        'ownerUserId', v.owner_user_id, 'productIds', coalesce((
          select jsonb_agg(vp.product_id order by vp.product_id)
          from public.evidence_document_version_products vp
          where vp.organization_id = v.organization_id and vp.version_id = v.id
        ), '[]'::jsonb),
        'validFrom', case when v.validity_starts_on is null then null else to_char(v.validity_starts_on::timestamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
        'validUntil', case when v.validity_ends_on is null then null else to_char(v.validity_ends_on::timestamp at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
        'fileName', v.original_filename, 'mediaType', v.detected_media_type,
        'byteSize', v.actual_size_bytes, 'sha256', v.original_sha256,
        'status', v.processing_state,
        'scan', case when v.scan_engine_name is null then null else jsonb_build_object(
          'outcome', case when v.processing_state = 'clean' then 'clean'
            when v.processing_state = 'quarantined' then 'detected' else 'failed' end,
          'engineName', v.scan_engine_name, 'engineVersion', v.scan_engine_version,
          'signatureVersion', v.scan_signature_version,
          'scannedAt', to_char(v.scanned_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'detectionName', v.scan_detection
        ) end,
        'uploadExpiresAt', case when v.processing_state = 'uploading' then to_char(v.upload_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
        'uploadedByUserId', v.uploader_user_id,
        'completedAt', case when v.finalized_at is null then null else to_char(v.finalized_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
        'createdAt', to_char(v.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ) order by v.version_number desc, v.id desc)
      from public.evidence_document_versions v
      where v.organization_id = p_organization_id and v.document_id = p_document_id
        and exists (
          select 1 from public.evidence_document_version_products vp
          where vp.organization_id = v.organization_id and vp.version_id = v.id and vp.product_id = p_product_id
        )
    ), '[]'::jsonb))
  end
$$;

revoke all on function public.list_evidence_document_versions(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.list_evidence_document_versions(uuid,uuid,uuid,uuid) to service_role;
notify pgrst, 'reload schema';
