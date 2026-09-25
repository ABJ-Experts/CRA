-- Align databases that received the first development form of M8-05 with the
-- stable review contract. This changes no evidence, protection, or intent.
create or replace function public.m8_05_retention_review_json(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_document_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with doc as (
    select d.*
      from public.evidence_documents d
     where d.organization_id = p_organization_id
       and d.id = p_document_id
  ),
  protections as (
    select pr.*
      from public.evidence_document_version_retention_protections pr
      join public.evidence_document_versions v
        on v.organization_id = pr.organization_id
       and v.id = pr.version_id
     where pr.organization_id = p_organization_id
       and v.document_id = p_document_id
  ),
  holds as (
    select h.*
      from public.evidence_document_legal_holds h
     where h.organization_id = p_organization_id
       and h.document_id = p_document_id
       and h.released_at is null
  ),
  refs as (
    select exists(
      select 1
        from public.technical_file_section_sources x
       where x.organization_id = p_organization_id
         and x.source_kind = 'evidence_document'
         and x.record_id = p_document_id
    ) or exists(
      select 1
        from public.technical_file_snapshots s
       where s.organization_id = p_organization_id
         and s.payload::text like '%' || p_document_id::text || '%'
    ) as value
  ),
  product_ids as (
    select coalesce(array_agg(distinct product_id), '{}'::uuid[]) as ids
      from protections p
      cross join lateral unnest(p.linked_product_ids) as product_id
  ),
  product_blocks as (
    select p.id,
           p.name,
           p.retention_until,
           p.retention_protection_until,
           p.retention_status
      from public.products p
      join product_ids i on p.id = any(i.ids)
     where p.organization_id = p_organization_id
       and (
         p.retention_status <> 'current'
         or p.retention_protection_until is null
         or p.retention_protection_until > clock_timestamp()
       )
  )
  select jsonb_build_object(
    'documentId', d.id,
    'currentVersionId', d.current_version_id,
    'lifecycleState', d.lifecycle_state,
    'reviewedAt', to_char(
      d.updated_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    ),
    'retentionIncomplete', coalesce((
      select bool_or(p.source_incomplete or p.linked_product_count = 0)
        from protections p
    ), true),
    'productLegalHoldActive', coalesce((
      select bool_or(p.product_legal_hold_active)
        from protections p
    ), false),
    'retentionUntil', (select max(p.strongest_retention_until) from protections p),
    'retentionProtectionUntil', (
      select max(p.strongest_protection_until) from protections p
    ),
    'linkedProductIds', coalesce((select to_jsonb(ids) from product_ids), '[]'::jsonb),
    'activeHolds', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', h.id,
          'reason', h.reason,
          'placedAt', to_char(
            h.placed_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS"Z"'
          ),
          'placedByUserId', h.placed_by_user_id
        )
        order by h.placed_at, h.id
      )
      from holds h
    ), '[]'::jsonb),
    'blockingReasons', coalesce((
      select jsonb_agg(x order by x ->> 'code')
        from (
          select jsonb_build_object(
            'code', 'document_legal_hold',
            'kind', 'legal_hold',
            'legalHoldId', h.id,
            'message', 'An active legal hold prevents deletion.'
          ) as x
          from holds h
          union all
          select jsonb_build_object(
            'code', 'retention_incomplete',
            'kind', 'retention',
            'message', 'Retention information is incomplete; deletion cannot be approved.'
          )
          from protections p
          where p.source_incomplete or p.linked_product_count = 0
          union all
          select jsonb_build_object(
            'code', 'product_legal_hold',
            'kind', 'legal_hold',
            'message', 'A linked product has an active legal hold.'
          )
          from protections p
          where p.product_legal_hold_active
          union all
          select jsonb_build_object(
            'code', 'retention_protection',
            'kind', 'retention',
            'productId', b.id,
            'productName', case
              when public.m5_triage_actor_has_permission(
                p_organization_id,
                p_actor_user_id,
                'can_view_products'
              ) then b.name
              else null
            end,
            'retentionUntil', b.retention_until,
            'retentionProtectionUntil', b.retention_protection_until,
            'message', case
              when public.m5_triage_actor_has_permission(
                p_organization_id,
                p_actor_user_id,
                'can_view_products'
              ) then 'A linked product retention obligation prevents deletion.'
              else 'A protected linked reference prevents deletion.'
            end
          )
          from product_blocks b
          union all
          select jsonb_build_object(
            'code', 'retained_reference',
            'kind', 'reference',
            'message', 'A retained technical-file or snapshot reference prevents deletion.'
          )
          from refs
          where value
          union all
          select jsonb_build_object(
            'code', 'lifecycle',
            'kind', 'lifecycle',
            'message', 'This evidence is already pending or has completed deletion.'
          )
          from doc
          where lifecycle_state <> 'active'
        ) blockers
    ), '[]'::jsonb),
    'deletionIntent', (
      select jsonb_build_object(
        'id', i.id,
        'state', i.state,
        'requestedAt', to_char(
          i.requested_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        ),
        'lastError', i.last_error
      )
      from public.evidence_document_deletion_intents i
      where i.organization_id = p_organization_id
        and i.document_id = p_document_id
        and i.state in ('queued', 'claimed', 'failed')
      order by i.requested_at desc
      limit 1
    )
  )
  from doc d
$$;

revoke all on function public.m8_05_retention_review_json(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.m8_05_retention_review_json(uuid, uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
