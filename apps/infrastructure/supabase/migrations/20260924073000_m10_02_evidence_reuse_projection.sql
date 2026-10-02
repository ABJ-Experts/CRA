-- Extend M8's permission-filtered reverse projection with exact M10 control links.
-- Historical evidence and framework mappings remain untouched.

create or replace function public.get_evidence_document_reuse_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_document_id uuid,p_version_id uuid
) returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id)
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence') then
    return query select 'forbidden',null::jsonb; return;
  end if;
  if not exists(select 1 from public.products p join public.evidence_document_version_products vp on vp.organization_id=p.organization_id and vp.product_id=p.id join public.evidence_document_versions v on v.organization_id=vp.organization_id and v.id=vp.version_id where p.organization_id=p_organization_id and p.id=p_product_id and p.archived_at is null and v.id=p_version_id and v.document_id=p_document_id) then
    return query select 'not_found',null::jsonb; return;
  end if;
  return query select 'found',jsonb_build_object(
    'technicalFileLinks',case when public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_view_technical_files') then coalesce((select jsonb_agg(jsonb_build_object('technicalFileId',f.id,'productId',f.product_id,'productName',p.name,'sectionId',s.id,'sectionKey',s.section_key,'sectionHeading',s.heading,'linkedVersionId',v.id,'linkedVersionNumber',v.version_number,'status',public.m7_evidence_section_source_state(p_organization_id,f.product_id,x.id),'reviewedAt',case when x.reviewed_at is null then null else to_char(x.reviewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,'navigationPath','/products/'||f.product_id::text||'/technical-file') order by f.product_id,s.sort_order,x.id)
      from public.technical_file_section_sources x join public.technical_file_sections s on s.organization_id=x.organization_id and s.id=x.section_id join public.technical_files f on f.organization_id=s.organization_id and f.id=s.technical_file_id and f.status='active' join public.products p on p.organization_id=f.organization_id and p.id=f.product_id and p.archived_at is null join public.evidence_document_versions v on v.organization_id=x.organization_id and v.document_id=x.record_id and v.version_number::text=x.observed_revision
      where x.organization_id=p_organization_id and x.source_kind='evidence_document' and x.record_id=p_document_id and v.id=p_version_id),'[]'::jsonb) else '[]'::jsonb end,
    'frameworkControls',case when public.m10_actor_has_framework_permission(p_organization_id,p_actor_user_id,'can_view_frameworks') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'evidenceLinkId',l.id,'controlId',c.id,'controlTitle',c.title,
        'controlStatus',c.implementation_status,'evidenceVersionId',l.evidence_version_id,
        'requirements',coalesce((
          select jsonb_agg(jsonb_build_object(
            'packKey',r.pack_key,'versionKey',r.version_key,
            'requirementKey',r.requirement_key,'identifier',r.identifier,
            'heading',r.heading) order by r.pack_key,r.version_key,r.tree_order)
          from (
            select requirement.*
            from public.framework_control_requirement_mappings mapping
            join public.framework_control_mapping_products mapped_product
              on mapped_product.organization_id=mapping.organization_id
              and mapped_product.mapping_id=mapping.id
              and mapped_product.product_id=p_product_id
            join public.framework_requirements requirement
              on requirement.pack_key=mapping.pack_key
              and requirement.version_key=mapping.version_key
              and requirement.requirement_key=mapping.requirement_key
            where mapping.organization_id=p_organization_id
              and mapping.control_id=c.id and mapping.ended_at is null
            order by requirement.pack_key,requirement.version_key,requirement.tree_order
            limit 100
          ) r
        ),'[]'::jsonb),
        'requirementsHasMore',exists(
          select 1 from public.framework_control_requirement_mappings mapping
          join public.framework_control_mapping_products mapped_product
            on mapped_product.organization_id=mapping.organization_id
            and mapped_product.mapping_id=mapping.id
            and mapped_product.product_id=p_product_id
          where mapping.organization_id=p_organization_id
            and mapping.control_id=c.id and mapping.ended_at is null
          offset 100 limit 1
        ),
        'navigationPath','/frameworks?controlId='||c.id::text
      ) order by c.title,l.id)
      from (
        select link.id,link.organization_id,link.control_id,
          link.evidence_version_id,link.product_id
        from public.framework_control_evidence_links link
        join public.framework_controls head
          on head.organization_id=link.organization_id and head.id=link.control_id
          and head.archived_at is null
        join public.evidence_document_versions version
          on version.organization_id=link.organization_id
          and version.id=link.evidence_version_id
          and version.document_id=p_document_id
        where link.organization_id=p_organization_id
          and link.evidence_version_id=p_version_id and link.product_id=p_product_id
          and link.ended_at is null
        order by head.title,link.id limit 100
      ) l
      join public.framework_controls c
        on c.organization_id=l.organization_id and c.id=l.control_id
    ),'[]'::jsonb) else '[]'::jsonb end,
    'frameworkControlsHasMore',case when public.m10_actor_has_framework_permission(
      p_organization_id,p_actor_user_id,'can_view_frameworks') then exists(
      select 1 from public.framework_control_evidence_links link
      join public.framework_controls head
        on head.organization_id=link.organization_id and head.id=link.control_id
        and head.archived_at is null
      join public.evidence_document_versions version
        on version.organization_id=link.organization_id
        and version.id=link.evidence_version_id
        and version.document_id=p_document_id
      where link.organization_id=p_organization_id
        and link.evidence_version_id=p_version_id and link.product_id=p_product_id
        and link.ended_at is null
      offset 100 limit 1
    ) else false end);
end $$;

revoke all on function public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid)
  to service_role;
notify pgrst, 'reload schema';
