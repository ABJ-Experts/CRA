-- M12-03 restored the unified-mode claim fence but accidentally reverted
-- M8-04's UTC timestamp wire format to a date-only string. Keep both.
create or replace function public.claim_evidence_validity_notification_atomic(
  p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare n public.evidence_document_notification_outbox%rowtype;
  v_email text; v_version_info record; v_delivery_mode text;
begin
  if p_organization_id is null or p_worker_id is null or p_lease_seconds not between 30 and 900 then return null; end if;
  select notification_delivery_mode into v_delivery_mode from public.organization_settings
  where organization_id=p_organization_id for share;
  if v_delivery_mode='unified' then return null; end if;
  select * into n from public.evidence_document_notification_outbox x
  where x.organization_id=p_organization_id and x.event_type='evidence_validity_expiring'
    and x.status in ('queued','leased') and x.next_attempt_at<=clock_timestamp()
    and (x.status='queued' or x.lease_expires_at<=clock_timestamp())
  order by x.next_attempt_at,x.created_at,x.id for update skip locked limit 1;
  if not found then return null; end if;
  select u.email into v_email from public.users u where u.id=n.owner_user_id
    and public.m8_evidence_actor_active(p_organization_id,u.id)
    and public.m5_triage_actor_has_permission(p_organization_id,u.id,'can_view_evidence') limit 1;
  if v_email is null then
    update public.evidence_document_notification_outbox
    set status='recipient_unavailable',sent_at=clock_timestamp(),last_error='recipient unavailable',
      lease_owner=null,lease_expires_at=null
    where organization_id=p_organization_id and id=n.id;
    return jsonb_build_object('outboxId',n.id,'outcome','recipient_unavailable');
  end if;
  select version_record.id,version_record.document_id,version_record.title,version_record.validity_ends_on,
    coalesce((select jsonb_agg(vp.product_id order by vp.product_id)
      from public.evidence_document_version_products vp
      join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id and p.archived_at is null
      where vp.organization_id=version_record.organization_id and vp.version_id=version_record.id),'[]'::jsonb) product_ids
  into v_version_info
  from public.evidence_document_versions version_record
  where version_record.organization_id=p_organization_id and version_record.id=n.version_id
    and version_record.processing_state='clean';
  if not found or jsonb_array_length(v_version_info.product_ids)=0 then
    update public.evidence_document_notification_outbox
    set status='obsolete',last_error='evidence unavailable',lease_owner=null,lease_expires_at=null
    where organization_id=p_organization_id and id=n.id;
    return null;
  end if;
  update public.evidence_document_notification_outbox
  set status='leased',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
    attempt_count=attempt_count+1,last_error=null
  where organization_id=p_organization_id and id=n.id;
  return jsonb_build_object(
    'outboxId',n.id,'email',v_email,'eventType',n.event_type,'thresholdDays',n.threshold_days,
    'versionId',v_version_info.id,'documentId',v_version_info.document_id,'title',v_version_info.title,
    'validUntil',to_char(v_version_info.validity_ends_on::timestamp at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'),'productIds',v_version_info.product_ids);
end $$;

alter function public.claim_evidence_validity_notification_atomic(uuid,uuid,integer) owner to postgres;
revoke all on function public.claim_evidence_validity_notification_atomic(uuid,uuid,integer)
  from public,anon,authenticated;
grant execute on function public.claim_evidence_validity_notification_atomic(uuid,uuid,integer)
  to service_role;

notify pgrst,'reload schema';
