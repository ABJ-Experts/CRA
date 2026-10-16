-- Correct the initial M8-04 projection without mutating evidence, M7 links,
-- or notification history. The worker contract consumes UTC timestamps and
-- reuse must match the active-target predicate used by evidence list counts.

create or replace function public.claim_evidence_validity_notification_atomic(
  p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare n public.evidence_document_notification_outbox%rowtype; v_email text; v_version_info record;
begin
  if p_organization_id is null or p_worker_id is null or p_lease_seconds not between 30 and 900 then return null; end if;
  select * into n from public.evidence_document_notification_outbox x where x.organization_id=p_organization_id
    and x.event_type='evidence_validity_expiring' and x.status in ('queued','leased') and x.next_attempt_at<=clock_timestamp()
    and (x.status='queued' or x.lease_expires_at<=clock_timestamp()) order by x.next_attempt_at,x.created_at,x.id for update skip locked limit 1;
  if not found then return null; end if;
  select u.email into v_email from public.users u where u.id=n.owner_user_id
    and public.m8_evidence_actor_active(p_organization_id,u.id)
    and public.m5_triage_actor_has_permission(p_organization_id,u.id,'can_view_evidence') limit 1;
  if v_email is null then
    update public.evidence_document_notification_outbox set status='recipient_unavailable',sent_at=clock_timestamp(),last_error='recipient unavailable',lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=n.id;
    return jsonb_build_object('outboxId',n.id,'outcome','recipient_unavailable');
  end if;
  select version_record.id,version_record.document_id,version_record.title,version_record.validity_ends_on,coalesce((select jsonb_agg(vp.product_id order by vp.product_id) from public.evidence_document_version_products vp join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id and p.archived_at is null where vp.organization_id=version_record.organization_id and vp.version_id=version_record.id),'[]'::jsonb) product_ids into v_version_info from public.evidence_document_versions version_record where version_record.organization_id=p_organization_id and version_record.id=n.version_id and version_record.processing_state='clean';
  if not found or jsonb_array_length(v_version_info.product_ids)=0 then
    update public.evidence_document_notification_outbox set status='obsolete',last_error='evidence unavailable',lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=n.id;
    return null;
  end if;
  update public.evidence_document_notification_outbox set status='leased',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempt_count=attempt_count+1,last_error=null where organization_id=p_organization_id and id=n.id;
  return jsonb_build_object('outboxId',n.id,'email',v_email,'eventType',n.event_type,'thresholdDays',n.threshold_days,'versionId',v_version_info.id,'documentId',v_version_info.document_id,'title',v_version_info.title,'validUntil',to_char(v_version_info.validity_ends_on::timestamp at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'productIds',v_version_info.product_ids);
end $$;

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
      where x.organization_id=p_organization_id and x.source_kind='evidence_document' and x.record_id=p_document_id and v.id=p_version_id),'[]'::jsonb) else '[]'::jsonb end,'frameworkControls','[]'::jsonb);
end $$;

revoke all on function public.claim_evidence_validity_notification_atomic(uuid,uuid,integer),public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_evidence_validity_notification_atomic(uuid,uuid,integer),public.get_evidence_document_reuse_atomic(uuid,uuid,uuid,uuid,uuid) to service_role;
notify pgrst, 'reload schema';
