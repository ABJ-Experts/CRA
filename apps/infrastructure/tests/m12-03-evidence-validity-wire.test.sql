begin;

create or replace function pg_temp.check(p_name text,p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_product uuid;
  v_worker uuid := gen_random_uuid();
  v_document uuid := gen_random_uuid();
  v_version uuid := gen_random_uuid();
  v_outbox uuid;
  v_claim jsonb;
  v_completion text;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  select id into v_product from public.products
  where organization_id=v_org and archived_at is null order by id limit 1;
  perform pg_temp.check('local owner and product fixture',v_owner is not null and v_product is not null);
  insert into public.evidence_documents(id,organization_id,created_by)
  values(v_document,v_org,v_owner);
  insert into public.evidence_document_versions(
    id,organization_id,document_id,version_number,title,document_class,retention_evidence_class,
    owner_user_id,uploader_user_id,validity_starts_on,validity_ends_on,object_key,
    original_filename,declared_size_bytes,upload_expires_at,initialize_idempotency_key,
    initialize_request_digest
  ) values(
    v_version,v_org,v_document,1,'M12-03 validity wire fixture','certificate','evidence_document',
    v_owner,v_owner,current_date-1,current_date+7,'m12-03-validity/'||v_version,
    'fixture.pdf',10,clock_timestamp()+interval '10 minutes',gen_random_uuid(),repeat('a',64)
  );
  insert into public.evidence_document_version_products(organization_id,version_id,product_id)
  values(v_org,v_version,v_product);
  update public.evidence_document_versions set processing_state='clean',actual_size_bytes=10,
    detected_media_type='application/pdf',original_sha256=repeat('b',64),finalized_at=clock_timestamp()
  where organization_id=v_org and id=v_version;
  update public.evidence_documents set current_version_id=v_version
  where organization_id=v_org and id=v_document;
  insert into public.evidence_document_notification_outbox(
    organization_id,version_id,owner_user_id,event_type,threshold_days,next_attempt_at
  ) values(v_org,v_version,v_owner,'evidence_validity_expiring',30,clock_timestamp())
  returning id into v_outbox;

  update public.organization_settings set notification_delivery_mode='unified'
  where organization_id=v_org;
  perform pg_temp.check('unified mode still fences legacy M8 claim',
    public.claim_evidence_validity_notification_atomic(v_org,v_worker,60) is null
    and exists(select 1 from public.evidence_document_notification_outbox
      where organization_id=v_org and id=v_outbox and status='queued'));
  update public.organization_settings set notification_delivery_mode='legacy'
  where organization_id=v_org;
  v_claim:=public.claim_evidence_validity_notification_atomic(v_org,v_worker,60);
  perform pg_temp.check('M8 claim retains UTC timestamp wire format',
    v_claim->>'outboxId'=v_outbox::text
    and v_claim->>'validUntil'=to_char((current_date+7)::timestamp at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    and v_claim->>'eventType'='evidence_validity_expiring'
    and exists(select 1 from public.evidence_document_notification_outbox
      where organization_id=v_org and id=v_outbox and status='leased' and lease_owner=v_worker));
  v_completion:=public.complete_evidence_validity_notification_atomic(v_org,v_worker,v_outbox,'sent',null);
  perform pg_temp.check('legacy completion still consumes claimed source',
    v_completion='sent' and exists(select 1 from public.evidence_document_notification_outbox
      where organization_id=v_org and id=v_outbox and status='sent'));
end $$;

rollback;
