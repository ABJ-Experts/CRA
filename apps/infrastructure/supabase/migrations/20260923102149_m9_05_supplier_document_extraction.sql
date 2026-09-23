-- M9-05: local-only, source-grounded supplier document field suggestions.
-- The source bytes/version and M9-03 review remain immutable. These tables hold
-- derived recommendations and reviewer decisions only.

alter table public.evidence_document_version_texts
  add column page_map jsonb check (
    page_map is null or (jsonb_typeof(page_map)='array' and jsonb_array_length(page_map) between 1 and 500
      and octet_length(page_map::text) <= 8388608)
  );

alter table public.organization_settings
  add column supplier_document_ai_provider text not null default 'disabled'
    check (supplier_document_ai_provider in ('disabled','ollama_local')),
  add column supplier_document_ai_residency text not null default 'local_only'
    check (supplier_document_ai_residency='local_only'),
  add column supplier_document_ai_daily_run_limit integer not null default 20
    check (supplier_document_ai_daily_run_limit between 1 and 100);

create table public.ai_inference_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submission_id uuid not null,
  evidence_version_id uuid not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  requested_by_user_id uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  status text not null default 'queued' check (status in ('queued','leased','completed','failed')),
  provider text not null default 'ollama_local' check (provider='ollama_local'),
  model text not null default 'local-ollama' check (char_length(model) between 1 and 120 and model !~ '[[:cntrl:]]'),
  prompt_version text not null default 'm9-05-v1' check (char_length(prompt_version) between 1 and 120 and prompt_version !~ '[[:cntrl:]]'),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  lease_owner uuid,
  lease_expires_at timestamptz,
  error_code text check (error_code is null or error_code in ('provider_unavailable','timeout','refused','malformed_output','budget_exhausted','stale_source','no_evidence','policy_disabled','failed')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (organization_id,id),
  unique (organization_id,requested_by_user_id,idempotency_key),
  foreign key (organization_id,submission_id) references public.supplier_evidence_submissions(organization_id,id) on delete restrict,
  foreign key (organization_id,evidence_version_id) references public.evidence_document_versions(organization_id,id) on delete restrict,
  check ((status='leased' and lease_owner is not null and lease_expires_at is not null)
    or (status<>'leased' and lease_owner is null and lease_expires_at is null))
);

create table public.supplier_document_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submission_id uuid not null,
  run_id uuid,
  evidence_version_id uuid not null,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  field_key text not null check (field_key in ('certification_held','valid_from','valid_until','scope','contact','component_version')),
  candidate_group text check (candidate_group is null or (char_length(candidate_group) between 1 and 120 and candidate_group !~ '[[:cntrl:]]')),
  original_value text,
  corrected_value text,
  confidence numeric(5,4) check (confidence between 0 and 1),
  source_span jsonb,
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  version integer not null default 0 check (version >= 0),
  reviewed_by_user_id uuid references public.users(id) on delete restrict,
  reviewed_at timestamptz,
  idempotency_key uuid,
  request_digest text check (request_digest is null or request_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,reviewed_by_user_id,idempotency_key),
  foreign key (organization_id,submission_id) references public.supplier_evidence_submissions(organization_id,id) on delete restrict,
  foreign key (organization_id,run_id) references public.ai_inference_runs(organization_id,id) on delete restrict,
  foreign key (organization_id,evidence_version_id) references public.evidence_document_versions(organization_id,id) on delete restrict,
  check ((run_id is null and candidate_group is null and original_value is null and confidence is null and source_span is null and status='confirmed')
    or (run_id is not null and candidate_group is not null and original_value is not null and char_length(original_value) between 1 and 2000
      and confidence is not null and source_span is not null)),
  check (corrected_value is null or char_length(corrected_value) between 1 and 2000),
  check ((status='pending' and reviewed_by_user_id is null and reviewed_at is null)
    or (status<>'pending' and reviewed_by_user_id is not null and reviewed_at is not null))
);

create index ai_inference_runs_claim_idx on public.ai_inference_runs(status,created_at,id) where status='queued';
create index ai_inference_runs_submission_idx on public.ai_inference_runs(organization_id,submission_id,created_at desc,id);
create index supplier_document_fields_submission_idx on public.supplier_document_fields(organization_id,submission_id,created_at,id);
create unique index supplier_document_fields_run_candidate_idx on public.supplier_document_fields(organization_id,run_id,field_key,candidate_group,original_value) where run_id is not null;

alter table public.ai_inference_runs enable row level security;
alter table public.supplier_document_fields enable row level security;
revoke all on table public.ai_inference_runs,public.supplier_document_fields from public,anon,authenticated;
grant select,insert,update on table public.ai_inference_runs,public.supplier_document_fields to service_role;

create or replace function public.m9_05_context(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_submission_id uuid
) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select case when public.m9_03_internal_can_review(p_organization_id,p_actor_user_id)
      and q.product_id=p_product_id and p.archived_at is null
    then jsonb_build_object('submissionId',s.id,'productId',q.product_id,
      'requestId',q.id,'requestVersion',q.version,'submissionUpdatedAt',s.updated_at,
      'evidenceVersionId',s.evidence_version_id,
      'evidenceSha256',s.declared_sha256,'documentId',s.evidence_document_id,
      'accepted',s.state='accepted' and exists(select 1 from public.supplier_evidence_submission_reviews r
        where r.organization_id=s.organization_id and r.submission_id=s.id and r.decision='accepted'),
      'current',d.current_version_id=s.evidence_version_id and d.lifecycle_state='active'
        and v.processing_state='clean' and v.original_sha256=s.declared_sha256)
    else null end
  from public.supplier_evidence_submissions s
  join public.supplier_evidence_requests q on q.organization_id=s.organization_id and q.id=s.request_id
  join public.products p on p.organization_id=q.organization_id and p.id=q.product_id
  join public.evidence_documents d on d.organization_id=s.organization_id and d.id=s.evidence_document_id
  join public.evidence_document_versions v on v.organization_id=s.organization_id and v.id=s.evidence_version_id
  where s.organization_id=p_organization_id and s.id=p_submission_id
$$;

create or replace function public.m9_05_run_json(p_organization_id uuid,p_run_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('id',r.id,'submissionId',r.submission_id,'evidenceVersionId',r.evidence_version_id,
    'evidenceSha256',r.evidence_sha256,'status',case when r.status='leased' then 'processing'
      when r.status='queued' then 'pending' when r.status='failed' and r.error_code='refused' then 'refused'
      else r.status end,
    'model',r.model,'promptVersion',r.prompt_version,'createdAt',r.created_at,
    'completedAt',r.completed_at,'errorCode',r.error_code)
  from public.ai_inference_runs r where r.organization_id=p_organization_id and r.id=p_run_id
$$;

create or replace function public.m9_05_field_json(p_organization_id uuid,p_field_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('id',f.id,'origin',case when f.run_id is null then 'manual' else 'ai' end,
    'runId',f.run_id,'fieldKey',f.field_key,
    'candidateGroup',f.candidate_group,'originalValue',f.original_value,'correctedValue',f.corrected_value,
    'confidence',f.confidence,'sourceSpan',f.source_span,'status',f.status,'version',f.version,
    'evidenceVersionId',f.evidence_version_id,'evidenceSha256',f.evidence_sha256,
    'model',r.model,'promptVersion',r.prompt_version,
    'reviewedByUserId',f.reviewed_by_user_id,'reviewedAt',f.reviewed_at,'createdAt',f.created_at)
  from public.supplier_document_fields f
  left join public.ai_inference_runs r on r.organization_id=f.organization_id and r.id=f.run_id
  where f.organization_id=p_organization_id and f.id=p_field_id
$$;

create or replace function public.start_supplier_document_extraction_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_request_id uuid,p_submission_id uuid,
  p_expected_request_version integer,p_expected_submission_updated_at timestamptz,
  p_expected_evidence_version_id uuid,p_expected_sha256 text,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare c jsonb; r public.ai_inference_runs%rowtype; t public.evidence_document_version_texts%rowtype;
  request_row public.supplier_evidence_requests%rowtype; submission_row public.supplier_evidence_submissions%rowtype;
  ai_settings public.organization_settings%rowtype;
begin
  c:=public.m9_05_context(p_organization_id,p_actor_user_id,p_product_id,p_submission_id);
  if c is null then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_request_id is null or p_expected_request_version is null
    or p_expected_submission_updated_at is null or p_expected_evidence_version_id is null
    or p_expected_sha256 !~ '^[a-f0-9]{64}$' then
    return query select 'invalid_request',null::jsonb; return;
  end if;
  select * into r from public.ai_inference_runs where organization_id=p_organization_id
    and requested_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    return query select case when r.submission_id=p_submission_id and r.evidence_version_id=p_expected_evidence_version_id
      and r.evidence_sha256=p_expected_sha256 then 'replayed' else 'idempotency_conflict' end,
      public.m9_05_run_json(p_organization_id,r.id); return;
  end if;
  select * into request_row from public.supplier_evidence_requests where organization_id=p_organization_id
    and id=p_request_id and product_id=p_product_id for update;
  select * into submission_row from public.supplier_evidence_submissions where organization_id=p_organization_id
    and id=p_submission_id and request_id=p_request_id for update;
  select * into r from public.ai_inference_runs where organization_id=p_organization_id
    and requested_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    return query select case when r.submission_id=p_submission_id and r.evidence_version_id=p_expected_evidence_version_id
      and r.evidence_sha256=p_expected_sha256 then 'replayed' else 'idempotency_conflict' end,
      public.m9_05_run_json(p_organization_id,r.id); return;
  end if;
  c:=public.m9_05_context(p_organization_id,p_actor_user_id,p_product_id,p_submission_id);
  if request_row.id is null or submission_row.id is null or c is null
    or not (c->>'accepted')::boolean or not (c->>'current')::boolean
    or c->>'requestId'<>p_request_id::text or request_row.version<>p_expected_request_version
    or submission_row.updated_at<>p_expected_submission_updated_at
    or c->>'evidenceVersionId' <> p_expected_evidence_version_id::text
    or c->>'evidenceSha256' <> p_expected_sha256 then
    return query select 'conflict',c; return;
  end if;
  select * into t from public.evidence_document_version_texts where organization_id=p_organization_id
    and version_id=p_expected_evidence_version_id;
  if not found or t.extraction_status<>'complete' or t.source_sha256<>p_expected_sha256
    then return query select 'unavailable',null::jsonb; return; end if;
  select * into ai_settings from public.organization_settings where organization_id=p_organization_id for update;
  if not found or ai_settings.supplier_document_ai_provider<>'ollama_local'
    or ai_settings.supplier_document_ai_residency<>'local_only' then
    return query select 'unavailable',null::jsonb; return;
  end if;
  if (select count(*) from public.ai_inference_runs where organization_id=p_organization_id
    and created_at >= date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC')
    >= ai_settings.supplier_document_ai_daily_run_limit then
    return query select 'budget_exhausted',null::jsonb; return;
  end if;
  insert into public.ai_inference_runs(organization_id,submission_id,evidence_version_id,evidence_sha256,
    requested_by_user_id,idempotency_key) values(p_organization_id,p_submission_id,
    p_expected_evidence_version_id,p_expected_sha256,p_actor_user_id,p_idempotency_key) returning * into r;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'supplier.document_extraction_requested','ai_inference_run',r.id::text,
      jsonb_build_object('submissionId',p_submission_id,'evidenceVersionId',r.evidence_version_id,'evidenceSha256',r.evidence_sha256));
  return query select 'queued',public.m9_05_run_json(p_organization_id,r.id);
end $$;

create or replace function public.claim_supplier_document_extraction_atomic(p_worker_id uuid,p_limit integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare rows jsonb;
begin
  if p_worker_id is null or p_limit not between 1 and 10 then return '[]'::jsonb; end if;
  update public.ai_inference_runs set status='queued',lease_owner=null,lease_expires_at=null,
    updated_at=clock_timestamp() where status='leased' and lease_expires_at<clock_timestamp() and attempt_count<3;
  update public.ai_inference_runs set status='failed',lease_owner=null,lease_expires_at=null,error_code='timeout',
    completed_at=clock_timestamp(),updated_at=clock_timestamp()
    where status='leased' and lease_expires_at<clock_timestamp() and attempt_count>=3;
  with picked as (select id from public.ai_inference_runs where status='queued' order by created_at,id
    limit p_limit for update skip locked), claimed as (
    update public.ai_inference_runs r set status='leased',lease_owner=p_worker_id,
      lease_expires_at=clock_timestamp()+interval '900 seconds',attempt_count=r.attempt_count+1,
      updated_at=clock_timestamp() from picked where r.id=picked.id
    returning r.*)
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'organizationId',x.organization_id,
    'submissionId',x.submission_id,'evidenceVersionId',x.evidence_version_id,
    'evidenceSha256',x.evidence_sha256,'attemptCount',x.attempt_count,'model',x.model,
    'promptVersion',x.prompt_version)),'[]'::jsonb) into rows from claimed x;
  return rows;
end $$;

create or replace function public.complete_supplier_document_extraction_atomic(
  p_organization_id uuid,p_worker_id uuid,p_run_id uuid,p_model text,p_prompt_version text,
  p_suggestions jsonb,p_failure_code text default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.ai_inference_runs%rowtype; t public.evidence_document_version_texts%rowtype;
  s jsonb; page_text text; page_number integer; start_offset integer; end_offset integer;
  field_key text; original_value text; quote_text text; candidate_group text; confidence numeric;
  ai_settings public.organization_settings%rowtype;
begin
  select * into r from public.ai_inference_runs where organization_id=p_organization_id and id=p_run_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if r.status='completed' then return query select 'replayed',public.m9_05_run_json(p_organization_id,r.id); return; end if;
  if r.status<>'leased' or r.lease_owner<>p_worker_id or r.lease_expires_at<clock_timestamp() then
    return query select 'lease_lost',null::jsonb; return;
  end if;
  if p_model is null or char_length(p_model) not between 1 and 120 or p_model~'[[:cntrl:]]'
    or p_prompt_version is null or char_length(p_prompt_version) not between 1 and 120 or p_prompt_version~'[[:cntrl:]]'
    or p_failure_code is not null and p_failure_code not in ('provider_unavailable','timeout','refused','malformed_output','budget_exhausted','stale_source','no_evidence','policy_disabled','failed') then
    return query select 'invalid_request',null::jsonb; return;
  end if;
  if not exists(select 1 from public.supplier_evidence_submissions sub
    join public.evidence_documents d on d.organization_id=sub.organization_id and d.id=sub.evidence_document_id
    join public.evidence_document_versions v on v.organization_id=sub.organization_id and v.id=sub.evidence_version_id
    join public.supplier_evidence_submission_reviews review on review.organization_id=sub.organization_id
      and review.submission_id=sub.id and review.decision='accepted'
    where sub.organization_id=p_organization_id and sub.id=r.submission_id and sub.state='accepted'
      and sub.evidence_version_id=r.evidence_version_id and sub.declared_sha256=r.evidence_sha256
      and d.current_version_id=r.evidence_version_id and d.lifecycle_state='active'
      and v.processing_state='clean' and v.original_sha256=r.evidence_sha256) then
    update public.ai_inference_runs set status='failed',lease_owner=null,lease_expires_at=null,
      error_code='stale_source',model=p_model,prompt_version=p_prompt_version,
      completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
    return query select 'stale_source',public.m9_05_run_json(p_organization_id,r.id); return;
  end if;
  select * into ai_settings from public.organization_settings where organization_id=p_organization_id for share;
  if not found or ai_settings.supplier_document_ai_provider<>'ollama_local'
    or ai_settings.supplier_document_ai_residency<>'local_only' then
    update public.ai_inference_runs set status='failed',lease_owner=null,lease_expires_at=null,
      error_code='policy_disabled',model=p_model,prompt_version=p_prompt_version,
      completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=r.id;
    return query select 'policy_disabled',public.m9_05_run_json(p_organization_id,r.id); return;
  end if;
  if p_failure_code is not null then
    update public.ai_inference_runs set status=case when attempt_count<3 and p_failure_code in ('provider_unavailable','timeout') then 'queued' else 'failed' end,
      lease_owner=null,lease_expires_at=null,error_code=p_failure_code,model=p_model,prompt_version=p_prompt_version,
      completed_at=case when attempt_count<3 and p_failure_code in ('provider_unavailable','timeout') then null else clock_timestamp() end,
      updated_at=clock_timestamp() where id=r.id;
    return query select 'failed',public.m9_05_run_json(p_organization_id,r.id); return;
  end if;
  select * into t from public.evidence_document_version_texts where organization_id=p_organization_id
    and version_id=r.evidence_version_id and source_sha256=r.evidence_sha256 and extraction_status='complete';
  if not found or t.page_map is null or jsonb_typeof(p_suggestions)<>'array'
    or jsonb_array_length(p_suggestions)>100 then return query select 'invalid_request',null::jsonb; return; end if;
  for s in select value from jsonb_array_elements(p_suggestions) loop
    if jsonb_typeof(s)<>'object' or (select count(*) from jsonb_object_keys(s))<>5
      or not (s ?& array['fieldKey','candidateGroup','originalValue','confidence','sourceSpan'])
      or jsonb_typeof(s->'sourceSpan')<>'object'
      or (select count(*) from jsonb_object_keys(s->'sourceSpan'))<>4
      or not (s->'sourceSpan' ?& array['page','startOffset','endOffset','quote']) then
      return query select 'invalid_request',null::jsonb; return;
    end if;
    field_key:=s->>'fieldKey'; candidate_group:=s->>'candidateGroup'; original_value:=s->>'originalValue';
    quote_text:=s->'sourceSpan'->>'quote';
    begin
      confidence:=(s->>'confidence')::numeric;
      page_number:=(s->'sourceSpan'->>'page')::integer;
      start_offset:=(s->'sourceSpan'->>'startOffset')::integer;
      end_offset:=(s->'sourceSpan'->>'endOffset')::integer;
    exception when others then return query select 'invalid_request',null::jsonb; return; end;
    select x->>'text' into page_text from jsonb_array_elements(t.page_map) x
      where (x->>'page')::integer=page_number limit 1;
    if field_key not in ('certification_held','valid_from','valid_until','scope','contact','component_version')
      or candidate_group is null or char_length(candidate_group) not between 1 and 120
      or candidate_group~'[[:cntrl:]]'
    or original_value is null or char_length(original_value) not between 1 and 2000
      or quote_text is null or char_length(quote_text) not between 1 and 4000
      or confidence is null or confidence<0 or confidence>1
      or page_number is null or page_number<1 or start_offset is null or start_offset<0
      or end_offset is null or end_offset<=start_offset or page_text is null
      or end_offset>char_length(page_text)
      or substring(page_text from start_offset+1 for end_offset-start_offset)<>quote_text then
      return query select 'invalid_request',null::jsonb; return;
    end if;
  end loop;
  insert into public.supplier_document_fields(organization_id,submission_id,run_id,evidence_version_id,evidence_sha256,
    field_key,candidate_group,original_value,confidence,source_span)
  select p_organization_id,r.submission_id,r.id,r.evidence_version_id,r.evidence_sha256,
    x->>'fieldKey',x->>'candidateGroup',x->>'originalValue',(x->>'confidence')::numeric,x->'sourceSpan'
  from jsonb_array_elements(p_suggestions) x
  on conflict do nothing;
  update public.ai_inference_runs set status='completed',lease_owner=null,lease_expires_at=null,
    error_code=null,model=p_model,prompt_version=p_prompt_version,completed_at=clock_timestamp(),
    updated_at=clock_timestamp() where id=r.id;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
    values(p_organization_id,'supplier.document_extraction_completed','ai_inference_run',r.id::text,
      jsonb_build_object('submissionId',r.submission_id,'evidenceVersionId',r.evidence_version_id,
        'suggestionCount',jsonb_array_length(p_suggestions),'model',p_model,'promptVersion',p_prompt_version));
  return query select 'completed',public.m9_05_run_json(p_organization_id,r.id);
end $$;

create or replace function public.get_supplier_document_extraction_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_submission_id uuid
) returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c jsonb; r public.ai_inference_runs%rowtype;
begin
  c:=public.m9_05_context(p_organization_id,p_actor_user_id,p_product_id,p_submission_id);
  if c is null then return query select 'forbidden',null::jsonb; return; end if;
  select * into r from public.ai_inference_runs where organization_id=p_organization_id
    and submission_id=p_submission_id order by created_at desc,id desc limit 1;
  return query select 'found',jsonb_build_object(
    'run',case when r.id is null then null else public.m9_05_run_json(p_organization_id,r.id) end,
    'suggestions',coalesce((select jsonb_agg(public.m9_05_field_json(p_organization_id,f.id) order by f.created_at,f.id)
      from public.supplier_document_fields f where f.organization_id=p_organization_id and f.submission_id=p_submission_id
        and f.evidence_version_id=(c->>'evidenceVersionId')::uuid
        and f.evidence_sha256=c->>'evidenceSha256'),'[]'::jsonb),
    'pages',coalesce((select t.page_map from public.evidence_document_version_texts t
      where t.organization_id=p_organization_id and t.version_id=(c->>'evidenceVersionId')::uuid
        and t.source_sha256=c->>'evidenceSha256' and t.extraction_status='complete'),'[]'::jsonb));
end $$;

create or replace function public.decide_supplier_document_field_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_request_id uuid,p_submission_id uuid,
  p_expected_request_version integer,p_expected_submission_updated_at timestamptz,
  p_expected_evidence_version_id uuid,p_expected_sha256 text,
  p_field_id uuid,p_expected_version integer,p_decision text,p_corrected_value text,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare c jsonb; f public.supplier_document_fields%rowtype; digest text;
  request_row public.supplier_evidence_requests%rowtype; submission_row public.supplier_evidence_submissions%rowtype;
begin
  c:=public.m9_05_context(p_organization_id,p_actor_user_id,p_product_id,p_submission_id);
  if c is null then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_request_id is null or p_expected_request_version is null
    or p_expected_submission_updated_at is null or p_expected_evidence_version_id is null
    or p_expected_sha256 !~ '^[a-f0-9]{64}$' or p_expected_version is null or p_expected_version<0
    or p_decision is null or p_decision not in ('confirmed','rejected')
    or (p_decision='rejected' and p_corrected_value is not null)
    or (p_corrected_value is not null and (char_length(p_corrected_value) not between 1 and 2000
      or p_corrected_value~'[[:cntrl:]]')) then
    return query select 'invalid_request',null::jsonb; return;
  end if;
  digest:=encode(extensions.digest(jsonb_build_object('productId',p_product_id,'requestId',p_request_id,
    'submissionId',p_submission_id,'expectedRequestVersion',p_expected_request_version,
    'expectedSubmissionUpdatedAt',p_expected_submission_updated_at,
    'expectedEvidenceVersionId',p_expected_evidence_version_id,'expectedSha256',p_expected_sha256,
    'fieldId',p_field_id,'expectedVersion',p_expected_version,
    'decision',p_decision,'correctedValue',p_corrected_value)::text,'sha256'),'hex');
  select * into f from public.supplier_document_fields where organization_id=p_organization_id
    and reviewed_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    return query select case when f.id=p_field_id and f.request_digest=digest then 'replayed' else 'idempotency_conflict' end,
      jsonb_build_object('field',public.m9_05_field_json(p_organization_id,f.id)); return;
  end if;
  select * into f from public.supplier_document_fields where organization_id=p_organization_id
    and id=p_field_id and submission_id=p_submission_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  select * into request_row from public.supplier_evidence_requests where organization_id=p_organization_id
    and id=p_request_id and product_id=p_product_id for update;
  select * into submission_row from public.supplier_evidence_submissions where organization_id=p_organization_id
    and id=p_submission_id and request_id=p_request_id for update;
  select * into f from public.supplier_document_fields where organization_id=p_organization_id
    and reviewed_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    return query select case when f.id=p_field_id and f.request_digest=digest then 'replayed' else 'idempotency_conflict' end,
      jsonb_build_object('field',public.m9_05_field_json(p_organization_id,f.id)); return;
  end if;
  c:=public.m9_05_context(p_organization_id,p_actor_user_id,p_product_id,p_submission_id);
  if request_row.id is null or submission_row.id is null or c is null
    or not (c->>'accepted')::boolean or not (c->>'current')::boolean
    or c->>'requestId'<>p_request_id::text or request_row.version<>p_expected_request_version
    or submission_row.updated_at<>p_expected_submission_updated_at
    or c->>'evidenceVersionId'<>p_expected_evidence_version_id::text
    or c->>'evidenceSha256'<>p_expected_sha256
    or f.evidence_version_id::text<>c->>'evidenceVersionId' or f.evidence_sha256<>c->>'evidenceSha256'
    or f.status<>'pending' or f.version<>p_expected_version then
    return query select 'conflict',jsonb_build_object('field',public.m9_05_field_json(p_organization_id,f.id)); return;
  end if;
  if not public.m9_03_internal_can_review(p_organization_id,p_actor_user_id) then
    return query select 'forbidden',null::jsonb; return;
  end if;
  update public.supplier_document_fields set status=p_decision,corrected_value=p_corrected_value,
    version=version+1,reviewed_by_user_id=p_actor_user_id,reviewed_at=clock_timestamp(),
    idempotency_key=p_idempotency_key,request_digest=digest where id=f.id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'supplier.document_field_'||p_decision,'supplier_document_field',f.id::text,
      jsonb_build_object('submissionId',p_submission_id,'evidenceVersionId',f.evidence_version_id,
        'evidenceSha256',f.evidence_sha256,'fieldKey',f.field_key,'originalValue',f.original_value,
        'correctedValue',p_corrected_value,'sourceSpan',f.source_span,'idempotencyKey',p_idempotency_key));
  return query select p_decision,jsonb_build_object('field',public.m9_05_field_json(p_organization_id,f.id));
end $$;

create or replace function public.add_supplier_document_field_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_request_id uuid,p_submission_id uuid,
  p_expected_request_version integer,p_expected_submission_updated_at timestamptz,
  p_expected_evidence_version_id uuid,p_expected_sha256 text,
  p_field_key text,p_value text,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare c jsonb; f public.supplier_document_fields%rowtype; digest text;
  request_row public.supplier_evidence_requests%rowtype; submission_row public.supplier_evidence_submissions%rowtype;
begin
  c:=public.m9_05_context(p_organization_id,p_actor_user_id,p_product_id,p_submission_id);
  if c is null then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_request_id is null or p_expected_request_version is null
    or p_expected_submission_updated_at is null or p_expected_evidence_version_id is null
    or p_expected_sha256 !~ '^[a-f0-9]{64}$'
    or p_field_key is null or p_field_key not in ('certification_held','valid_from','valid_until','scope','contact','component_version')
    or p_value is null or char_length(p_value) not between 1 and 2000 or p_value~'[[:cntrl:]]' then
    return query select 'invalid_request',null::jsonb; return;
  end if;
  digest:=encode(extensions.digest(jsonb_build_object('productId',p_product_id,'requestId',p_request_id,
    'submissionId',p_submission_id,'expectedRequestVersion',p_expected_request_version,
    'expectedSubmissionUpdatedAt',p_expected_submission_updated_at,
    'expectedEvidenceVersionId',p_expected_evidence_version_id,'expectedSha256',p_expected_sha256,
    'fieldKey',p_field_key,'value',p_value)::text,'sha256'),'hex');
  select * into f from public.supplier_document_fields where organization_id=p_organization_id
    and reviewed_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    return query select case when f.submission_id=p_submission_id and f.request_digest=digest then 'replayed' else 'idempotency_conflict' end,
      jsonb_build_object('field',public.m9_05_field_json(p_organization_id,f.id)); return;
  end if;
  select * into request_row from public.supplier_evidence_requests where organization_id=p_organization_id
    and id=p_request_id and product_id=p_product_id for update;
  select * into submission_row from public.supplier_evidence_submissions where organization_id=p_organization_id
    and id=p_submission_id and request_id=p_request_id for update;
  select * into f from public.supplier_document_fields where organization_id=p_organization_id
    and reviewed_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then
    return query select case when f.submission_id=p_submission_id and f.request_digest=digest then 'replayed' else 'idempotency_conflict' end,
      jsonb_build_object('field',public.m9_05_field_json(p_organization_id,f.id)); return;
  end if;
  c:=public.m9_05_context(p_organization_id,p_actor_user_id,p_product_id,p_submission_id);
  if request_row.id is null or submission_row.id is null or c is null
    or not (c->>'accepted')::boolean or not (c->>'current')::boolean
    or c->>'requestId'<>p_request_id::text or request_row.version<>p_expected_request_version
    or submission_row.updated_at<>p_expected_submission_updated_at
    or c->>'evidenceVersionId'<>p_expected_evidence_version_id::text
    or c->>'evidenceSha256'<>p_expected_sha256 then
    return query select 'conflict',c; return;
  end if;
  insert into public.supplier_document_fields(organization_id,submission_id,evidence_version_id,evidence_sha256,
    field_key,candidate_group,corrected_value,status,version,reviewed_by_user_id,reviewed_at,
    idempotency_key,request_digest)
    values(p_organization_id,p_submission_id,(c->>'evidenceVersionId')::uuid,c->>'evidenceSha256',
      p_field_key,null,p_value,'confirmed',1,p_actor_user_id,clock_timestamp(),p_idempotency_key,digest) returning * into f;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'supplier.document_field_manual','supplier_document_field',f.id::text,
      jsonb_build_object('submissionId',p_submission_id,'evidenceVersionId',f.evidence_version_id,
        'evidenceSha256',f.evidence_sha256,'fieldKey',p_field_key,'correctedValue',p_value,
        'idempotencyKey',p_idempotency_key));
  return query select 'confirmed',jsonb_build_object('field',public.m9_05_field_json(p_organization_id,f.id));
end $$;

create or replace function public.m9_05_page_map_valid(p_page_map jsonb)
returns boolean language plpgsql immutable set search_path=public,pg_temp as $$
declare p jsonb; last_page integer:=0; page_number integer;
begin
  if p_page_map is null or jsonb_typeof(p_page_map)<>'array'
    or jsonb_array_length(p_page_map) not between 1 and 500
    or octet_length(p_page_map::text)>8388608 then return false; end if;
  for p in select value from jsonb_array_elements(p_page_map) loop
    if jsonb_typeof(p)<>'object' or (select count(*) from jsonb_object_keys(p))<>2
      or not (p ?& array['page','text']) or jsonb_typeof(p->'page')<>'number'
      or jsonb_typeof(p->'text')<>'string' or char_length(p->>'text')>1048576 then return false; end if;
    begin page_number:=(p->>'page')::integer;
    exception when others then return false; end;
    if page_number<>last_page+1 then return false; end if;
    last_page:=page_number;
  end loop;
  return true;
end $$;

-- New M8 jobs can attach page text in the same transaction as completion.
-- The 11-argument form is retained for existing callers and search behavior.
create or replace function public.complete_evidence_text_extraction_job_atomic(
  p_organization_id uuid,p_worker_id uuid,p_version_id uuid,p_source_sha256 text,
  p_extractor_version text,p_outcome text,p_extracted_text text,p_quality text,
  p_is_truncated boolean,p_failure_code text,p_retry_after_seconds integer,p_page_map jsonb
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare result_code text;
begin
  if p_outcome='complete' and not public.m9_05_page_map_valid(p_page_map) then return 'invalid_request'; end if;
  result_code:=public.complete_evidence_text_extraction_job_atomic(p_organization_id,p_worker_id,p_version_id,
    p_source_sha256,p_extractor_version,p_outcome,p_extracted_text,p_quality,p_is_truncated,
    p_failure_code,p_retry_after_seconds);
  if result_code='completed' and p_outcome='complete' then
    update public.evidence_document_version_texts set page_map=p_page_map
    where organization_id=p_organization_id and version_id=p_version_id
      and source_sha256=p_source_sha256 and extractor_version=p_extractor_version
      and extraction_status='complete';
  end if;
  return result_code;
end $$;

create or replace function public.get_supplier_document_extraction_worker_atomic(
  p_organization_id uuid,p_worker_id uuid,p_run_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.ai_inference_runs%rowtype; v public.evidence_document_versions%rowtype;
  t public.evidence_document_version_texts%rowtype;
begin
  select * into r from public.ai_inference_runs where organization_id=p_organization_id and id=p_run_id
    and status='leased' and lease_owner=p_worker_id and lease_expires_at>clock_timestamp();
  if not found then return null; end if;
  select * into v from public.evidence_document_versions where organization_id=p_organization_id
    and id=r.evidence_version_id and original_sha256=r.evidence_sha256 and processing_state='clean';
  if not found then return null; end if;
  select * into t from public.evidence_document_version_texts where organization_id=p_organization_id
    and version_id=r.evidence_version_id and source_sha256=r.evidence_sha256 and extraction_status='complete';
  if not found then return null; end if;
  return jsonb_build_object('organizationId',p_organization_id,'runId',r.id,'submissionId',r.submission_id,
    'evidenceVersionId',r.evidence_version_id,'evidenceSha256',r.evidence_sha256,
    'objectBucket',v.object_bucket,'objectKey',v.object_key,'byteSize',v.actual_size_bytes,
    'mediaType',v.detected_media_type,
    'originalFilename',v.original_filename,'extractedText',t.extracted_text,'pageMap',t.page_map,
    'aiEnabled',(select s.supplier_document_ai_provider='ollama_local' and s.supplier_document_ai_residency='local_only'
      from public.organization_settings s where s.organization_id=p_organization_id),
    'aiResidency','local_only','maxInputTokens',10000,
    'model',r.model,'promptVersion',r.prompt_version);
end $$;

create or replace function public.attach_supplier_document_page_map_atomic(
  p_organization_id uuid,p_worker_id uuid,p_run_id uuid,p_page_map jsonb
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.ai_inference_runs%rowtype; t public.evidence_document_version_texts%rowtype;
begin
  if not public.m9_05_page_map_valid(p_page_map) then return 'invalid_request'; end if;
  select * into r from public.ai_inference_runs where organization_id=p_organization_id and id=p_run_id for update;
  if not found then return 'not_found'; end if;
  if r.status<>'leased' or r.lease_owner<>p_worker_id or r.lease_expires_at<clock_timestamp() then
    return 'lease_lost'; end if;
  if not exists(select 1 from public.supplier_evidence_submissions s
    join public.evidence_documents d on d.organization_id=s.organization_id and d.id=s.evidence_document_id
    join public.evidence_document_versions v on v.organization_id=s.organization_id and v.id=s.evidence_version_id
    where s.organization_id=p_organization_id and s.id=r.submission_id and s.state='accepted'
      and s.evidence_version_id=r.evidence_version_id and s.declared_sha256=r.evidence_sha256
      and d.current_version_id=r.evidence_version_id and d.lifecycle_state='active'
      and v.processing_state='clean' and v.original_sha256=r.evidence_sha256) then return 'stale_source'; end if;
  select * into t from public.evidence_document_version_texts where organization_id=p_organization_id
    and version_id=r.evidence_version_id for update;
  if not found or t.extraction_status<>'complete' or t.source_sha256<>r.evidence_sha256 then
    return 'unavailable'; end if;
  if t.page_map is not null then
    return case when t.page_map=p_page_map then 'replayed' else 'conflict' end; end if;
  update public.evidence_document_version_texts set page_map=p_page_map,updated_at=clock_timestamp()
    where organization_id=p_organization_id and version_id=r.evidence_version_id;
  return 'attached';
end $$;

revoke all on function public.m9_05_context(uuid,uuid,uuid,uuid),public.m9_05_run_json(uuid,uuid),
  public.m9_05_field_json(uuid,uuid),public.m9_05_page_map_valid(jsonb),
  public.complete_evidence_text_extraction_job_atomic(uuid,uuid,uuid,text,text,text,text,text,boolean,text,integer,jsonb),
  public.start_supplier_document_extraction_atomic(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,uuid),
  public.claim_supplier_document_extraction_atomic(uuid,integer),
  public.complete_supplier_document_extraction_atomic(uuid,uuid,uuid,text,text,jsonb,text),
  public.get_supplier_document_extraction_worker_atomic(uuid,uuid,uuid),
  public.attach_supplier_document_page_map_atomic(uuid,uuid,uuid,jsonb),
  public.get_supplier_document_extraction_atomic(uuid,uuid,uuid,uuid),
  public.decide_supplier_document_field_atomic(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,uuid,integer,text,text,uuid),
  public.add_supplier_document_field_atomic(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.complete_evidence_text_extraction_job_atomic(uuid,uuid,uuid,text,text,text,text,text,boolean,text,integer,jsonb),
  public.start_supplier_document_extraction_atomic(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,uuid),
  public.claim_supplier_document_extraction_atomic(uuid,integer),
  public.complete_supplier_document_extraction_atomic(uuid,uuid,uuid,text,text,jsonb,text),
  public.get_supplier_document_extraction_worker_atomic(uuid,uuid,uuid),
  public.attach_supplier_document_page_map_atomic(uuid,uuid,uuid,jsonb),
  public.get_supplier_document_extraction_atomic(uuid,uuid,uuid,uuid),
  public.decide_supplier_document_field_atomic(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,uuid,integer,text,text,uuid),
  public.add_supplier_document_field_atomic(uuid,uuid,uuid,uuid,uuid,integer,timestamptz,uuid,text,text,text,uuid) to service_role;
