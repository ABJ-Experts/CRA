-- Run only against a local database with an accepted M9-03 supplier submission.
-- All 101 synthetic fields and assertions are rolled back.
begin;
do $$
declare fixture record; first_page record; second_page record; wrong_tenant record; forged record;
  cursor_text text; stale_run_id uuid; low_run_id uuid; low_field_id uuid; precision_field_id uuid;
  decision record; worker_id uuid:=gen_random_uuid(); completion text; extractor text;
begin
  select review.organization_id,review.request_id,review.submission_id,review.reviewer_user_id actor_id,
    request_row.product_id,request_row.version request_version,submission_row.updated_at submission_updated_at,
    review.evidence_version_id,review.evidence_sha256
    into fixture
  from public.supplier_evidence_submission_reviews review
  join public.supplier_evidence_requests request_row on request_row.organization_id=review.organization_id
    and request_row.id=review.request_id
  join public.supplier_evidence_submissions submission_row on submission_row.organization_id=review.organization_id
    and submission_row.id=review.submission_id and submission_row.state='accepted'
  join public.evidence_documents document_row on document_row.organization_id=review.organization_id
    and document_row.id=review.evidence_document_id and document_row.current_version_id=review.evidence_version_id
  where review.decision='accepted' limit 1;
  if not found then raise exception 'Requires an accepted local M9-03 supplier submission'; end if;

  -- A recent run against an old hash must never be shown for the current submission.
  insert into public.ai_inference_runs(organization_id,submission_id,evidence_version_id,evidence_sha256,
    requested_by_user_id,idempotency_key,status,created_at)
  values(fixture.organization_id,fixture.submission_id,fixture.evidence_version_id,repeat('a',64),
    fixture.actor_id,gen_random_uuid(),'failed',clock_timestamp()+interval '1 day') returning id into stale_run_id;
  select * into first_page from public.get_supplier_document_extraction_atomic(
    fixture.organization_id,fixture.actor_id,fixture.product_id,fixture.submission_id,null,25);
  if first_page.outcome<>'found' or first_page.result->'run'->>'id'=stale_run_id::text then
    raise exception 'Current submission read exposed a run pinned to a stale hash';
  end if;

  -- An AI field below the provisional release threshold must be rejectable but not confirmable.
  insert into public.ai_inference_runs(organization_id,submission_id,evidence_version_id,evidence_sha256,
    requested_by_user_id,idempotency_key,status)
  values(fixture.organization_id,fixture.submission_id,fixture.evidence_version_id,fixture.evidence_sha256,
    fixture.actor_id,gen_random_uuid(),'completed') returning id into low_run_id;
  insert into public.supplier_document_fields(organization_id,submission_id,run_id,evidence_version_id,
    evidence_sha256,field_key,candidate_group,original_value,confidence,source_span)
  values(fixture.organization_id,fixture.submission_id,low_run_id,fixture.evidence_version_id,
    fixture.evidence_sha256,'certification_held','low-confidence-test','ISO 27001',0.79,
    '{"page":1,"startOffset":0,"endOffset":9,"quote":"ISO 27001"}'::jsonb) returning id into low_field_id;
  select * into decision from public.decide_supplier_document_field_atomic(
    fixture.organization_id,fixture.actor_id,fixture.product_id,fixture.request_id,fixture.submission_id,
    fixture.request_version,fixture.submission_updated_at,fixture.evidence_version_id,fixture.evidence_sha256,
    low_field_id,0,'confirmed','ISO 27001',gen_random_uuid());
  if decision.outcome<>'low_confidence' or
    (select status from public.supplier_document_fields where id=low_field_id)<>'pending' then
    raise exception 'Low-confidence AI value was confirmed or returned %',decision.outcome;
  end if;
  select * into decision from public.decide_supplier_document_field_atomic(
    fixture.organization_id,fixture.actor_id,fixture.product_id,fixture.request_id,fixture.submission_id,
    fixture.request_version,fixture.submission_updated_at,fixture.evidence_version_id,fixture.evidence_sha256,
    low_field_id,0,'rejected',null,gen_random_uuid());
  if decision.outcome<>'rejected' then raise exception 'Low-confidence field could not be rejected'; end if;
  insert into public.supplier_document_fields(organization_id,submission_id,run_id,evidence_version_id,
    evidence_sha256,field_key,candidate_group,original_value,confidence,source_span)
  values(fixture.organization_id,fixture.submission_id,low_run_id,fixture.evidence_version_id,
    fixture.evidence_sha256,'scope','precision-boundary-test','Secure components',0.79996,
    '{"page":1,"startOffset":0,"endOffset":17,"quote":"Secure components"}'::jsonb)
  returning id into precision_field_id;
  select * into decision from public.decide_supplier_document_field_atomic(
    fixture.organization_id,fixture.actor_id,fixture.product_id,fixture.request_id,fixture.submission_id,
    fixture.request_version,fixture.submission_updated_at,fixture.evidence_version_id,fixture.evidence_sha256,
    precision_field_id,0,'confirmed','Secure components',gen_random_uuid());
  if decision.outcome<>'low_confidence' or
    (select status from public.supplier_document_fields where id=precision_field_id)<>'pending' then
    raise exception 'Precision rounding allowed a below-threshold value: %',decision.outcome;
  end if;

  -- Truncated M8 text has no faithful page offsets, but the legacy successful OCR record survives.
  select extractor_version into extractor from public.evidence_document_version_texts
    where organization_id=fixture.organization_id and version_id=fixture.evidence_version_id;
  update public.evidence_document_extraction_jobs set status='leased',lease_owner=worker_id,
    lease_expires_at=clock_timestamp()+interval '5 minutes'
    where organization_id=fixture.organization_id and version_id=fixture.evidence_version_id;
  update public.evidence_document_version_texts set extraction_status='running',extracted_text=null,
    page_map=null,completed_at=null
    where organization_id=fixture.organization_id and version_id=fixture.evidence_version_id;
  completion:=public.complete_evidence_text_extraction_job_atomic(
    fixture.organization_id,worker_id,fixture.evidence_version_id,fixture.evidence_sha256,
    extractor,'complete','Truncated legacy OCR text','low',true,null,null,null);
  if completion<>'completed' or not exists(select 1 from public.evidence_document_version_texts
    where organization_id=fixture.organization_id and version_id=fixture.evidence_version_id
      and extraction_status='complete' and extracted_text='Truncated legacy OCR text'
      and is_truncated and page_map is null) then
    raise exception 'Truncated OCR completion was lost: %',completion;
  end if;

  insert into public.supplier_document_fields(organization_id,submission_id,evidence_version_id,evidence_sha256,
    field_key,corrected_value,status,version,reviewed_by_user_id,reviewed_at)
  select fixture.organization_id,fixture.submission_id,fixture.evidence_version_id,fixture.evidence_sha256,
    'scope','pagination-fixture-'||n,'confirmed',1,fixture.actor_id,clock_timestamp()
  from generate_series(1,101) n;

  select * into first_page from public.get_supplier_document_extraction_atomic(
    fixture.organization_id,fixture.actor_id,fixture.product_id,fixture.submission_id,null,100);
  if first_page.outcome<>'found' or jsonb_array_length(first_page.result->'suggestions')<>100
    or first_page.result->>'nextCursor' is null then
    raise exception 'First page must contain 100 fields and a cursor';
  end if;
  cursor_text:=first_page.result->>'nextCursor';
  select * into second_page from public.get_supplier_document_extraction_atomic(
    fixture.organization_id,fixture.actor_id,fixture.product_id,fixture.submission_id,cursor_text,100);
  if second_page.outcome<>'found' or jsonb_array_length(second_page.result->'suggestions')<1
    or exists(select 1 from jsonb_array_elements(first_page.result->'suggestions') first_field
      join jsonb_array_elements(second_page.result->'suggestions') second_field
        on first_field->>'id'=second_field->>'id') then
    raise exception 'Second page must contain distinct remaining fields';
  end if;
  select * into wrong_tenant from public.get_supplier_document_extraction_atomic(
    gen_random_uuid(),fixture.actor_id,fixture.product_id,fixture.submission_id,cursor_text,100);
  if wrong_tenant.outcome<>'forbidden' then raise exception 'Cross-tenant cursor was accepted'; end if;
  select * into forged from public.get_supplier_document_extraction_atomic(
    fixture.organization_id,fixture.actor_id,fixture.product_id,fixture.submission_id,
    left(cursor_text,21)||gen_random_uuid()::text,100);
  if forged.outcome<>'invalid_request' then raise exception 'Forged cursor was accepted'; end if;
end $$;
rollback;
