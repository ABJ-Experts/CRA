-- M2 V1 product/release CSV import.
-- The job row is also the durable queue; paged row plans are the only child
-- state. Product and release writes remain owned by their atomic procedures.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-imports', 'product-imports', false, 10485760,
  array['text/csv', 'text/plain', 'application/octet-stream']::text[])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.product_import_jobs (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  commit_actor_user_id uuid references public.users(id) on delete restrict,
  schema_version text not null check (schema_version = 'm2-product-release-import-v1'),
  status text not null check (status in (
    'queued', 'parsing', 'validating', 'dry_run_completed', 'dry_run_failed',
    'committing', 'retrying', 'dead_letter', 'stale_conflict', 'canceled',
    'expired', 'completed'
  )),
  work_kind text not null default 'dry_run' check (work_kind in ('dry_run', 'commit')),
  upload_idempotency_key uuid not null,
  upload_request_digest text not null check (upload_request_digest ~ '^[a-f0-9]{64}$'),
  commit_idempotency_key uuid,
  commit_request_digest text check (
    commit_request_digest is null or commit_request_digest ~ '^[a-f0-9]{64}$'
  ),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  original_filename text not null check (char_length(btrim(original_filename)) between 1 and 255),
  source_object_path text not null,
  report_object_path text,
  byte_size integer not null check (byte_size between 0 and 10485760),
  row_count integer not null default 0 check (row_count between 0 and 10000),
  processed_row_count integer not null default 0 check (processed_row_count between 0 and 10000),
  committed_row_count integer not null default 0 check (committed_row_count between 0 and 10000),
  create_count integer not null default 0 check (create_count >= 0),
  update_count integer not null default 0 check (update_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  warning_count integer not null default 0 check (warning_count >= 0),
  checkpoint_row_number integer not null default 0 check (checkpoint_row_number between 0 and 10001),
  retry_count integer not null default 0 check (retry_count between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  lease_owner text check (lease_owner is null or char_length(btrim(lease_owner)) between 1 and 100),
  lease_expires_at timestamptz,
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,120}$'),
  cancellation_reason text check (
    cancellation_reason is null or char_length(btrim(cancellation_reason)) between 1 and 500
  ),
  correlation_id uuid not null,
  expires_at timestamptz not null,
  retention_until timestamptz not null,
  committed_at timestamptz,
  canceled_at timestamptz,
  source_deleted_at timestamptz,
  report_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint product_import_paths_check check (
    source_object_path = organization_id::text || '/' || id::text || '/source.csv'
    and (report_object_path is null or
      report_object_path = organization_id::text || '/' || id::text || '/report.csv')
  ),
  constraint product_import_commit_identity_check check (
    (commit_idempotency_key is null) = (commit_request_digest is null)
    and (commit_actor_user_id is null) = (commit_idempotency_key is null)
  ),
  constraint product_import_lease_check check ((lease_owner is null) = (lease_expires_at is null)),
  constraint product_import_terminal_time_check check (
    (status = 'completed') = (committed_at is not null)
    and (status = 'canceled') = (canceled_at is not null)
  ),
  constraint product_import_count_bounds_check check (
    create_count + update_count + unchanged_count + skipped_count + failed_count <= row_count
    and processed_row_count <= row_count and committed_row_count <= row_count
  ),
  constraint product_import_dry_run_count_check check (
    status not in ('dry_run_completed', 'dry_run_failed', 'committing', 'stale_conflict', 'completed')
    or (processed_row_count = row_count and
      create_count + update_count + unchanged_count + skipped_count + failed_count = row_count)
  ),
  constraint product_import_ready_check check (status <> 'dry_run_completed' or failed_count = 0),
  constraint product_import_retention_check check (expires_at > created_at and retention_until >= expires_at)
);

create unique index product_import_upload_idempotency_idx
  on public.product_import_jobs (organization_id, actor_user_id, upload_idempotency_key);
create unique index product_import_commit_idempotency_idx
  on public.product_import_jobs (organization_id, commit_actor_user_id, commit_idempotency_key)
  where commit_idempotency_key is not null;
create index product_import_list_idx
  on public.product_import_jobs (organization_id, created_at desc, id desc);
create index product_import_claim_idx
  on public.product_import_jobs (organization_id, next_attempt_at, created_at, id)
  where status in ('queued', 'retrying');
create index product_import_expiry_idx
  on public.product_import_jobs (organization_id, expires_at, id)
  where status in ('queued', 'parsing', 'validating', 'dry_run_completed', 'dry_run_failed', 'retrying');
create index product_import_cleanup_idx
  on public.product_import_jobs (organization_id, retention_until, id)
  where source_deleted_at is null or report_deleted_at is null;

create table public.product_import_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  import_id uuid not null,
  source_row_number integer not null check (source_row_number between 2 and 10001),
  row_hash text not null check (row_hash ~ '^[a-f0-9]{64}$'),
  row_type text check (row_type is null or row_type in ('product', 'release')),
  proposed_action text not null check (
    proposed_action in ('create', 'update', 'unchanged', 'skipped', 'failed')
  ),
  result text not null check (result in ('planned', 'committed', 'failed', 'skipped')),
  product_internal_code text check (
    product_internal_code is null or char_length(product_internal_code) between 1 and 128
  ),
  release_version text check (
    release_version is null or char_length(release_version) between 1 and 200
  ),
  product_internal_code_normalized text check (
    product_internal_code_normalized is null or
    char_length(product_internal_code_normalized) between 1 and 128
  ),
  release_version_normalized text check (
    release_version_normalized is null or char_length(release_version_normalized) between 1 and 200
  ),
  product_id uuid,
  release_id uuid,
  expected_product_version integer check (expected_product_version is null or expected_product_version >= 0),
  expected_release_version integer check (expected_release_version is null or expected_release_version >= 0),
  proposed jsonb not null default '{}'::jsonb check (
    jsonb_typeof(proposed) = 'object' and pg_column_size(proposed) <= 32768
  ),
  issues jsonb not null default '[]'::jsonb check (
    jsonb_typeof(issues) = 'array' and pg_column_size(issues) <= 32768
  ),
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, import_id, source_row_number),
  foreign key (organization_id, import_id)
    references public.product_import_jobs(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id) on delete restrict,
  foreign key (organization_id, release_id)
    references public.product_releases(organization_id, id) on delete restrict,
  constraint product_import_row_result_check check (
    (result = 'committed') = (committed_at is not null)
    and (proposed_action = 'failed') = (result = 'failed')
    and (proposed_action = 'skipped') = (result = 'skipped')
  )
);

create index product_import_rows_page_idx
  on public.product_import_rows (organization_id, import_id, source_row_number);
create index product_import_rows_result_idx
  on public.product_import_rows (organization_id, import_id, result, source_row_number);
create index product_import_rows_product_identity_idx
  on public.product_import_rows (
    organization_id, import_id, product_internal_code_normalized, source_row_number
  ) where product_internal_code_normalized is not null;
create index product_import_rows_release_identity_idx
  on public.product_import_rows (
    organization_id, import_id, product_internal_code_normalized,
    release_version_normalized, source_row_number
  ) where row_type = 'release';

create or replace function public.product_import_issues_are_safe(p_issues jsonb)
returns boolean language plpgsql immutable
set search_path = public, pg_temp
as $$
declare v_issue jsonb;
begin
  if p_issues is null or jsonb_typeof(p_issues) <> 'array'
     or jsonb_array_length(p_issues) > 50 or pg_column_size(p_issues) > 32768 then return false; end if;
  for v_issue in select value from jsonb_array_elements(p_issues) loop
    if jsonb_typeof(v_issue) <> 'object'
       or v_issue - array['field','code','message','severity']::text[] <> '{}'::jsonb
       or jsonb_typeof(v_issue->'field') <> 'string'
       or jsonb_typeof(v_issue->'code') <> 'string'
       or jsonb_typeof(v_issue->'message') <> 'string'
       or jsonb_typeof(v_issue->'severity') <> 'string'
       or char_length(v_issue->>'field') not between 1 and 80
       or (v_issue->>'code') !~ '^[a-z0-9_]{1,80}$'
       or char_length(v_issue->>'message') not between 1 and 500
       or v_issue->>'severity' not in ('warning','error') then return false; end if;
  end loop;
  return true;
end;
$$;
alter table public.product_import_rows add constraint product_import_row_issues_check
  check (public.product_import_issues_are_safe(issues));

create or replace function public.enforce_product_import_status_transition()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'queued' and new.status in ('parsing','committing','retrying','dead_letter','canceled','expired'))
    or (old.status = 'parsing' and new.status in ('validating','retrying','dead_letter','canceled','expired'))
    or (old.status = 'validating' and new.status in ('dry_run_completed','dry_run_failed','retrying','dead_letter','canceled','expired'))
    or (old.status = 'dry_run_completed' and new.status in ('queued','committing','stale_conflict','canceled','expired'))
    or (old.status = 'dry_run_failed' and new.status in ('canceled','expired'))
    or (old.status = 'committing' and new.status in ('completed','retrying','dead_letter','stale_conflict'))
    or (old.status = 'retrying' and new.status in ('parsing','committing','dead_letter','canceled','expired'))
  ) then raise exception using errcode = '23514', message = 'invalid product import status transition'; end if;
  return new;
end;
$$;
create trigger enforce_product_import_status_transition before update of status
  on public.product_import_jobs for each row execute function public.enforce_product_import_status_transition();
create trigger set_product_import_jobs_updated_at before update on public.product_import_jobs
  for each row execute function public.set_updated_at();
create trigger set_product_import_rows_updated_at before update on public.product_import_rows
  for each row execute function public.set_updated_at();

alter table public.product_import_jobs enable row level security;
alter table public.product_import_rows enable row level security;
revoke all on public.product_import_jobs, public.product_import_rows from public, anon, authenticated;
grant select, insert, update, delete on public.product_import_jobs, public.product_import_rows to service_role;

create or replace function public.product_import_job_json(p_organization_id uuid, p_import_id uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', jobs.id, 'schemaVersion', jobs.schema_version, 'status', jobs.status,
    'contentHash', jobs.content_hash, 'byteSize', jobs.byte_size,
    'rowCount', jobs.row_count, 'processedRowCount', jobs.processed_row_count,
    'counts', jsonb_build_object(
      'create', jobs.create_count, 'update', jobs.update_count,
      'unchanged', jobs.unchanged_count, 'skipped', jobs.skipped_count,
      'failed', jobs.failed_count, 'warnings', jobs.warning_count
    ),
    'errorCode', jobs.error_code, 'expiresAt', jobs.expires_at,
    'createdAt', jobs.created_at, 'updatedAt', jobs.updated_at,
    'committedAt', jobs.committed_at
  ) from public.product_import_jobs jobs
  where jobs.organization_id = p_organization_id and jobs.id = p_import_id;
$$;

create or replace function public.product_import_row_json(p_row public.product_import_rows)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'sourceRowNumber', p_row.source_row_number, 'rowType', p_row.row_type,
    'proposedAction', p_row.proposed_action, 'result', p_row.result,
    'productInternalCode', p_row.product_internal_code,
    'releaseVersion', p_row.release_version, 'issues', p_row.issues
  );
$$;

create or replace function public.create_product_import_job(
  p_organization_id uuid, p_actor_user_id uuid, p_import_id uuid,
  p_upload_idempotency_key uuid, p_content_hash text, p_original_filename text,
  p_byte_size integer, p_source_object_path text, p_correlation_id uuid
) returns table(outcome text, job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_existing public.product_import_jobs%rowtype; v_digest text;
begin
  if p_import_id is null or p_upload_idempotency_key is null or p_correlation_id is null
     or p_content_hash !~ '^[a-f0-9]{64}$' or p_byte_size not between 0 and 10485760
     or char_length(btrim(p_original_filename)) not between 1 and 255
     or p_source_object_path <> p_organization_id::text||'/'||p_import_id::text||'/source.csv'
     or not public.m2_active_member(p_organization_id,p_actor_user_id) then
    return query select 'invalid_request'::text,null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object(
    'schemaVersion','m2-product-release-import-v1','contentHash',p_content_hash,
    'filename',btrim(p_original_filename),'byteSize',p_byte_size)::text,'sha256'),'hex');
  select * into v_existing from public.product_import_jobs jobs
   where jobs.organization_id=p_organization_id and jobs.actor_user_id=p_actor_user_id
     and jobs.upload_idempotency_key=p_upload_idempotency_key for update;
  if found then
    if v_existing.upload_request_digest<>v_digest then
      return query select 'idempotency_mismatch'::text,null::jsonb;
    else return query select 'replayed'::text,
      public.product_import_job_json(p_organization_id,v_existing.id); end if; return;
  end if;
  insert into public.product_import_jobs(
    id,organization_id,actor_user_id,schema_version,status,upload_idempotency_key,
    upload_request_digest,content_hash,original_filename,source_object_path,
    byte_size,correlation_id,expires_at,retention_until
  ) values (
    p_import_id,p_organization_id,p_actor_user_id,'m2-product-release-import-v1','queued',
    p_upload_idempotency_key,v_digest,p_content_hash,btrim(p_original_filename),
    p_source_object_path,p_byte_size,p_correlation_id,
    now()+interval '24 hours',now()+interval '7 days'
  );
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'product_import.uploaded','product_import',p_import_id::text,
    jsonb_build_object('schemaVersion','m2-product-release-import-v1','contentHash',p_content_hash,
      'byteSize',p_byte_size,'correlationId',p_correlation_id));
  return query select 'created'::text,public.product_import_job_json(p_organization_id,p_import_id);
exception when unique_violation then return query select 'conflict'::text,null::jsonb;
end;
$$;

create or replace function public.get_product_import_job(
  p_organization_id uuid,p_actor_user_id uuid,p_import_id uuid
) returns table(outcome text,job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(
    select 1 from public.product_import_jobs jobs where jobs.organization_id=p_organization_id and jobs.id=p_import_id
  ) then return query select 'not_found'::text,null::jsonb; return; end if;
  return query select 'found'::text,public.product_import_job_json(p_organization_id,p_import_id);
end;
$$;

create or replace function public.list_product_import_jobs(
  p_organization_id uuid,p_actor_user_id uuid,p_status text,p_page integer,p_page_size integer
) returns table(outcome text,imports jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total integer; v_rows jsonb;
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) then
    return query select 'not_found'::text,null::jsonb; return; end if;
  if p_page not between 1 and 100000 or p_page_size not between 1 and 100 or
     (p_status is not null and p_status not in (
       'queued','parsing','validating','dry_run_completed','dry_run_failed','committing',
       'retrying','dead_letter','stale_conflict','canceled','expired','completed'
     )) then return query select 'invalid_request'::text,null::jsonb; return; end if;
  select count(*) into v_total from public.product_import_jobs jobs
   where jobs.organization_id=p_organization_id and (p_status is null or jobs.status=p_status);
  select coalesce(jsonb_agg(public.product_import_job_json(p_organization_id,page.id)
    order by page.created_at desc,page.id desc),'[]'::jsonb) into v_rows from (
    select jobs.id,jobs.created_at from public.product_import_jobs jobs
    where jobs.organization_id=p_organization_id and (p_status is null or jobs.status=p_status)
    order by jobs.created_at desc,jobs.id desc limit p_page_size offset ((p_page-1)*p_page_size)
  ) page;
  return query select 'found'::text,jsonb_build_object(
    'rows',v_rows,'total',v_total,'page',p_page,'pageSize',p_page_size,
    'pageCount',case when v_total=0 then 0 else ceil(v_total::numeric/p_page_size)::integer end);
end;
$$;

create or replace function public.list_product_import_rows(
  p_organization_id uuid,p_actor_user_id uuid,p_import_id uuid,p_result text,
  p_page integer,p_page_size integer
) returns table(outcome text,rows jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total integer; v_rows jsonb;
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(
    select 1 from public.product_import_jobs jobs where jobs.organization_id=p_organization_id and jobs.id=p_import_id
  ) then return query select 'not_found'::text,null::jsonb; return; end if;
  if p_page not between 1 and 100000 or p_page_size not between 1 and 100 or
     (p_result is not null and p_result not in ('planned','committed','failed','skipped')) then
    return query select 'invalid_request'::text,null::jsonb; return; end if;
  select count(*) into v_total from public.product_import_rows import_rows
   where import_rows.organization_id=p_organization_id and import_rows.import_id=p_import_id
     and (p_result is null or import_rows.result=p_result);
  select coalesce(jsonb_agg(public.product_import_row_json(page)
    order by page.source_row_number),'[]'::jsonb) into v_rows from (
    select import_rows.* from public.product_import_rows import_rows
    where import_rows.organization_id=p_organization_id and import_rows.import_id=p_import_id
      and (p_result is null or import_rows.result=p_result)
    order by import_rows.source_row_number limit p_page_size offset ((p_page-1)*p_page_size)
  ) page;
  return query select 'found'::text,jsonb_build_object(
    'rows',v_rows,'total',v_total,'page',p_page,'pageSize',p_page_size,
    'pageCount',case when v_total=0 then 0 else ceil(v_total::numeric/p_page_size)::integer end);
end;
$$;

create or replace function public.claim_product_import_job(
  p_organization_id uuid,p_worker_id text,p_lease_seconds integer
) returns table(outcome text,job jsonb,work jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.product_import_jobs%rowtype;
begin
  if char_length(btrim(p_worker_id)) not between 1 and 100 or p_lease_seconds not between 10 and 300 then
    return query select 'invalid_request'::text,null::jsonb,null::jsonb; return; end if;
  select * into v_job from public.product_import_jobs jobs
   where jobs.organization_id=p_organization_id and jobs.status in ('queued','retrying')
     and jobs.next_attempt_at<=now() and jobs.expires_at>now()
     and (jobs.lease_expires_at is null or jobs.lease_expires_at<=now())
   order by jobs.next_attempt_at,jobs.created_at,jobs.id for update skip locked limit 1;
  if not found then return query select 'empty'::text,null::jsonb,null::jsonb; return; end if;
  update public.product_import_jobs set
    status=case when v_job.work_kind='dry_run' then 'parsing' else 'committing' end,
    lease_owner=btrim(p_worker_id),lease_expires_at=now()+make_interval(secs=>p_lease_seconds),
    error_code=null where organization_id=p_organization_id and id=v_job.id;
  return query select 'claimed'::text,public.product_import_job_json(p_organization_id,v_job.id),
    jsonb_build_object('kind',v_job.work_kind,'sourceObjectPath',v_job.source_object_path,
      'reportObjectPath',v_job.report_object_path,'checkpointRowNumber',v_job.checkpoint_row_number,
      'commitActorId',v_job.commit_actor_user_id,'commitIdempotencyKey',v_job.commit_idempotency_key);
end;
$$;

create or replace function public.checkpoint_product_import_job(
  p_organization_id uuid,p_import_id uuid,p_worker_id text,p_status text,
  p_processed_row_count integer,p_checkpoint_row_number integer,p_lease_seconds integer
) returns table(outcome text,job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('parsing','validating') or p_processed_row_count not between 0 and 10000
     or p_checkpoint_row_number not between 0 and 10001 or p_lease_seconds not between 10 and 300 then
    return query select 'invalid_request'::text,null::jsonb; return; end if;
  update public.product_import_jobs set status=p_status,
    processed_row_count=greatest(processed_row_count,p_processed_row_count),
    checkpoint_row_number=greatest(checkpoint_row_number,p_checkpoint_row_number),
    lease_expires_at=now()+make_interval(secs=>p_lease_seconds)
  where organization_id=p_organization_id and id=p_import_id and lease_owner=btrim(p_worker_id)
    and lease_expires_at>now() and status in ('parsing','validating');
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  return query select 'checkpointed'::text,public.product_import_job_json(p_organization_id,p_import_id);
end;
$$;

create or replace function public.save_product_import_rows_page(
  p_organization_id uuid,p_import_id uuid,p_worker_id text,p_content_hash text,p_rows jsonb
) returns table(outcome text,saved_count integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item jsonb; v_existing_hash text; v_count integer; v_source_row integer;
begin
  v_count:=case when jsonb_typeof(p_rows)='array' then jsonb_array_length(p_rows) else 0 end;
  if v_count not between 1 and 500 then return query select 'invalid_request'::text,0; return; end if;
  if not exists(select 1 from public.product_import_jobs jobs
    where jobs.organization_id=p_organization_id and jobs.id=p_import_id
      and jobs.content_hash=p_content_hash and jobs.lease_owner=btrim(p_worker_id)
      and jobs.lease_expires_at>now() and jobs.status in ('parsing','validating')) then
    return query select 'not_found'::text,0; return; end if;
  for v_item in select value from jsonb_array_elements(p_rows) loop
    v_source_row:=(v_item->>'sourceRowNumber')::integer;
    if jsonb_typeof(v_item)<>'object' or v_source_row not between 2 and 10001
       or (v_item->>'rowHash')!~'^[a-f0-9]{64}$'
       or coalesce(v_item->>'proposedAction','') not in ('create','update','unchanged','skipped','failed')
       or coalesce(v_item->>'result','') not in ('planned','failed','skipped')
       or not public.product_import_issues_are_safe(coalesce(v_item->'issues','[]'::jsonb)) then
      raise exception using errcode='22023',message='invalid product import row page'; end if;
    select rows.row_hash into v_existing_hash from public.product_import_rows rows
     where rows.organization_id=p_organization_id and rows.import_id=p_import_id
       and rows.source_row_number=v_source_row;
    if found and v_existing_hash<>v_item->>'rowHash' then
      return query select 'content_mismatch'::text,0; return; end if;
    insert into public.product_import_rows(
      id,organization_id,import_id,source_row_number,row_hash,row_type,proposed_action,result,
      product_internal_code,release_version,product_internal_code_normalized,
      release_version_normalized,product_id,release_id,expected_product_version,
      expected_release_version,proposed,issues
    ) values(
      coalesce(nullif(v_item->>'id','')::uuid,gen_random_uuid()),p_organization_id,p_import_id,
      v_source_row,v_item->>'rowHash',nullif(v_item->>'rowType',''),v_item->>'proposedAction',
      v_item->>'result',nullif(v_item->>'productInternalCode',''),nullif(v_item->>'releaseVersion',''),
      nullif(v_item->>'productInternalCodeNormalized',''),nullif(v_item->>'releaseVersionNormalized',''),
      nullif(v_item->>'productId','')::uuid,nullif(v_item->>'releaseId','')::uuid,
      nullif(v_item->>'expectedProductVersion','')::integer,
      nullif(v_item->>'expectedReleaseVersion','')::integer,
      coalesce(v_item->'proposed','{}'::jsonb),coalesce(v_item->'issues','[]'::jsonb)
    ) on conflict(organization_id,import_id,source_row_number) do nothing;
  end loop;
  update public.product_import_jobs set status='validating',
    processed_row_count=(select count(*) from public.product_import_rows rows
      where rows.organization_id=p_organization_id and rows.import_id=p_import_id),
    checkpoint_row_number=(select coalesce(max(rows.source_row_number),0)
      from public.product_import_rows rows where rows.organization_id=p_organization_id and rows.import_id=p_import_id)
  where organization_id=p_organization_id and id=p_import_id;
  return query select 'saved'::text,v_count;
exception when invalid_text_representation or numeric_value_out_of_range then
  return query select 'invalid_request'::text,0;
end;
$$;

create or replace function public.complete_product_import_dry_run(
  p_organization_id uuid,p_import_id uuid,p_worker_id text,p_content_hash text,
  p_row_count integer,p_create_count integer,p_update_count integer,
  p_unchanged_count integer,p_skipped_count integer,p_failed_count integer,
  p_warning_count integer,p_report_object_path text,p_error_code text
) returns table(outcome text,job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.product_import_jobs%rowtype; v_stored_rows integer; v_status text;
begin
  select * into v_job from public.product_import_jobs jobs
   where jobs.organization_id=p_organization_id and jobs.id=p_import_id
     and jobs.content_hash=p_content_hash and jobs.lease_owner=btrim(p_worker_id)
     and jobs.lease_expires_at>now() and jobs.status in ('parsing','validating') for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if p_row_count not between 0 and 10000 or
     least(p_create_count,p_update_count,p_unchanged_count,p_skipped_count,p_failed_count,p_warning_count)<0
     or p_create_count+p_update_count+p_unchanged_count+p_skipped_count+p_failed_count<>p_row_count
     or p_report_object_path<>p_organization_id::text||'/'||p_import_id::text||'/report.csv'
     or (p_error_code is not null and p_error_code!~'^[a-z0-9_]{1,120}$') then
    return query select 'invalid_request'::text,null::jsonb; return; end if;
  select count(*) into v_stored_rows from public.product_import_rows rows
   where rows.organization_id=p_organization_id and rows.import_id=p_import_id;
  if v_stored_rows<>p_row_count then return query select 'checkpoint_mismatch'::text,null::jsonb; return; end if;
  v_status:=case when p_failed_count>0 or p_error_code is not null
    then 'dry_run_failed' else 'dry_run_completed' end;
  update public.product_import_jobs set status=v_status,row_count=p_row_count,
    create_count=p_create_count,update_count=p_update_count,unchanged_count=p_unchanged_count,
    skipped_count=p_skipped_count,failed_count=p_failed_count,warning_count=p_warning_count,
    processed_row_count=p_row_count,report_object_path=p_report_object_path,error_code=p_error_code,
    lease_owner=null,lease_expires_at=null
  where organization_id=p_organization_id and id=p_import_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,v_job.actor_user_id,'product_import.dry_run_completed','product_import',p_import_id::text,
    jsonb_build_object('status',v_status,'contentHash',p_content_hash,'rowCount',p_row_count,
      'createCount',p_create_count,'updateCount',p_update_count,'unchangedCount',p_unchanged_count,
      'skippedCount',p_skipped_count,'failedCount',p_failed_count,'warningCount',p_warning_count,
      'correlationId',v_job.correlation_id));
  return query select v_status,public.product_import_job_json(p_organization_id,p_import_id);
end;
$$;

create or replace function public.fail_product_import_job(
  p_organization_id uuid,p_import_id uuid,p_worker_id text,p_error_code text,p_retryable boolean
) returns table(outcome text,job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.product_import_jobs%rowtype; v_status text; v_retries integer;
begin
  if p_error_code!~'^[a-z0-9_]{1,120}$' then return query select 'invalid_request'::text,null::jsonb; return; end if;
  select * into v_job from public.product_import_jobs jobs
   where jobs.organization_id=p_organization_id and jobs.id=p_import_id
     and jobs.lease_owner=btrim(p_worker_id) and jobs.lease_expires_at>now()
     and jobs.status in ('parsing','validating','committing') for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  v_retries:=least(5,v_job.retry_count+1);
  v_status:=case when p_retryable and v_retries<5 then 'retrying' else 'dead_letter' end;
  update public.product_import_jobs set status=v_status,retry_count=v_retries,
    next_attempt_at=case when v_status='retrying'
      then now()+make_interval(secs=>least(300,(2^v_retries)::integer*5)) else next_attempt_at end,
    lease_owner=null,lease_expires_at=null,
    error_code=case when v_status='dead_letter' then 'retry_exhausted' else p_error_code end
  where organization_id=p_organization_id and id=p_import_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,v_job.actor_user_id,
    case when v_status='retrying' then 'product_import.retry_scheduled' else 'product_import.dead_lettered' end,
    'product_import',p_import_id::text,jsonb_build_object(
      'errorCode',p_error_code,'retryCount',v_retries,'correlationId',v_job.correlation_id));
  return query select v_status,public.product_import_job_json(p_organization_id,p_import_id);
end;
$$;

create or replace function public.cancel_product_import_job(
  p_organization_id uuid,p_actor_user_id uuid,p_import_id uuid,p_reason text
) returns table(outcome text,job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.product_import_jobs%rowtype;
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) or
     (p_reason is not null and char_length(btrim(p_reason)) not between 1 and 500) then
    return query select 'not_found'::text,null::jsonb; return; end if;
  select * into v_job from public.product_import_jobs jobs
   where jobs.organization_id=p_organization_id and jobs.id=p_import_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_job.status='canceled' then return query select 'replayed'::text,
    public.product_import_job_json(p_organization_id,p_import_id); return; end if;
  if v_job.status in ('committing','completed','stale_conflict','expired','dead_letter') then
    return query select 'conflict'::text,public.product_import_job_json(p_organization_id,p_import_id); return; end if;
  update public.product_import_jobs set status='canceled',canceled_at=now(),
    cancellation_reason=nullif(btrim(p_reason),''),lease_owner=null,lease_expires_at=null
  where organization_id=p_organization_id and id=p_import_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'product_import.canceled','product_import',p_import_id::text,
    jsonb_build_object('reason',nullif(btrim(p_reason),''),'correlationId',v_job.correlation_id));
  return query select 'canceled'::text,public.product_import_job_json(p_organization_id,p_import_id);
end;
$$;

create or replace function public.request_product_import_commit(
  p_organization_id uuid,p_actor_user_id uuid,p_import_id uuid,p_content_hash text,p_idempotency_key uuid
) returns table(outcome text,job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.product_import_jobs%rowtype; v_digest text;
begin
  if p_idempotency_key is null or p_content_hash!~'^[a-f0-9]{64}$'
     or not public.m2_active_member(p_organization_id,p_actor_user_id) then
    return query select 'invalid_request'::text,null::jsonb; return; end if;
  select * into v_job from public.product_import_jobs jobs
   where jobs.organization_id=p_organization_id and jobs.id=p_import_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object(
    'importId',p_import_id,'contentHash',p_content_hash)::text,'sha256'),'hex');
  if v_job.commit_idempotency_key is not null then
    if v_job.commit_actor_user_id<>p_actor_user_id or v_job.commit_idempotency_key<>p_idempotency_key
       or v_job.commit_request_digest<>v_digest then
      return query select 'idempotency_mismatch'::text,null::jsonb;
    else return query select 'replayed'::text,
      public.product_import_job_json(p_organization_id,p_import_id); end if; return;
  end if;
  if v_job.status<>'dry_run_completed' or v_job.failed_count>0 or v_job.expires_at<=now()
     or v_job.content_hash<>p_content_hash then
    return query select 'conflict'::text,public.product_import_job_json(p_organization_id,p_import_id); return; end if;
  update public.product_import_jobs set status='queued',work_kind='commit',
    commit_actor_user_id=p_actor_user_id,commit_idempotency_key=p_idempotency_key,
    commit_request_digest=v_digest,next_attempt_at=now(),retry_count=0,error_code=null
  where organization_id=p_organization_id and id=p_import_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'product_import.commit_requested','product_import',p_import_id::text,
    jsonb_build_object('contentHash',p_content_hash,'rowCount',v_job.row_count,
      'correlationId',v_job.correlation_id));
  return query select 'queued'::text,public.product_import_job_json(p_organization_id,p_import_id);
end;
$$;

create or replace function public.commit_product_import_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_import_id uuid,p_content_hash text,p_idempotency_key uuid
) returns table(outcome text,job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job public.product_import_jobs%rowtype; v_row public.product_import_rows%rowtype;
  v_digest text; v_mutation_outcome text; v_payload jsonb; v_product_id uuid;
  v_failure_code text; v_retry_count integer;
begin
  if p_idempotency_key is null or p_content_hash!~'^[a-f0-9]{64}$'
     or not public.m2_active_member(p_organization_id,p_actor_user_id) then
    return query select 'invalid_request'::text,null::jsonb; return; end if;
  select * into v_job from public.product_import_jobs jobs
   where jobs.organization_id=p_organization_id and jobs.id=p_import_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object(
    'importId',p_import_id,'contentHash',p_content_hash)::text,'sha256'),'hex');
  if v_job.commit_idempotency_key is not null and (
    v_job.commit_actor_user_id<>p_actor_user_id or v_job.commit_idempotency_key<>p_idempotency_key
    or v_job.commit_request_digest<>v_digest) then
    return query select 'idempotency_mismatch'::text,null::jsonb; return; end if;
  if v_job.status='completed' then return query select 'replayed'::text,
    public.product_import_job_json(p_organization_id,p_import_id); return;
  elsif v_job.status='stale_conflict' then return query select 'stale_conflict'::text,
    public.product_import_job_json(p_organization_id,p_import_id); return; end if;
  if v_job.status not in ('dry_run_completed','committing','retrying','queued')
     or v_job.failed_count>0 or v_job.expires_at<=now() or v_job.content_hash<>p_content_hash
     or exists(select 1 from public.product_import_rows rows
       where rows.organization_id=p_organization_id and rows.import_id=p_import_id and rows.result='failed')
     or (select count(*) from public.product_import_rows rows
       where rows.organization_id=p_organization_id and rows.import_id=p_import_id)<>v_job.row_count then
    return query select 'conflict'::text,public.product_import_job_json(p_organization_id,p_import_id); return; end if;
  if v_job.commit_idempotency_key is null then
    update public.product_import_jobs set commit_actor_user_id=p_actor_user_id,
      commit_idempotency_key=p_idempotency_key,commit_request_digest=v_digest,work_kind='commit'
    where organization_id=p_organization_id and id=p_import_id;
  end if;
  if v_job.status<>'committing' then update public.product_import_jobs set status='committing'
    where organization_id=p_organization_id and id=p_import_id; end if;

  -- The exception block is a PostgreSQL subtransaction. Any non-success from an
  -- authoritative row mutation raises, rolling back every earlier row mutation
  -- before the outer block records the safe job failure state.
  begin
    for v_row in select * from public.product_import_rows rows
      where rows.organization_id=p_organization_id and rows.import_id=p_import_id
        and rows.row_type='product' and rows.proposed_action not in ('skipped','failed')
      order by rows.source_row_number loop
      if v_row.proposed_action='unchanged' then
        if v_row.product_id is null or v_row.expected_product_version is null or not exists(
          select 1 from public.products products where products.organization_id=p_organization_id
            and products.id=v_row.product_id and products.version=v_row.expected_product_version
            and products.archived_at is null) then
          v_failure_code:='stale_version'; raise exception 'expected import conflict'; end if;
      elsif v_row.proposed_action='create' then
        select created.outcome,created.product into v_mutation_outcome,v_payload
        from public.create_product_atomic(p_organization_id,p_actor_user_id,v_row.id,
          v_row.proposed->>'name',v_row.proposed->>'internalCode',v_row.proposed->>'productType',
          nullif(v_row.proposed->>'description',''),nullif(v_row.proposed->>'responsibleOwnerId','')::uuid,
          nullif(v_row.proposed->>'legalEntityId','')::uuid) created;
        if v_mutation_outcome not in ('created','replayed') then
          v_failure_code:=case when v_mutation_outcome='not_found' then 'authorization_changed' else 'stale_conflict' end;
          raise exception 'expected import conflict'; end if;
        update public.product_import_rows set product_id=(v_payload->>'id')::uuid
         where organization_id=p_organization_id and id=v_row.id;
      elsif v_row.proposed_action='update' then
        select updated.outcome,updated.product into v_mutation_outcome,v_payload
        from public.update_product_atomic(p_organization_id,v_row.product_id,p_actor_user_id,
          v_row.expected_product_version,nullif(v_row.proposed->>'name',''),null,
          nullif(v_row.proposed->>'productType',''),v_row.proposed->>'description',
          v_row.proposed?'description',nullif(v_row.proposed->>'responsibleOwnerId','')::uuid) updated;
        if v_mutation_outcome<>'updated' then
          v_failure_code:=case when v_mutation_outcome='not_found' then 'authorization_changed' else 'stale_version' end;
          raise exception 'expected import conflict'; end if;
      end if;
      update public.product_import_rows set result='committed',committed_at=now()
       where organization_id=p_organization_id and id=v_row.id;
    end loop;

    for v_row in select * from public.product_import_rows rows
      where rows.organization_id=p_organization_id and rows.import_id=p_import_id
        and rows.row_type='release' and rows.proposed_action not in ('skipped','failed')
      order by rows.source_row_number loop
      v_product_id:=v_row.product_id;
      if v_product_id is null then select products.id into v_product_id from public.products products
        where products.organization_id=p_organization_id
          and products.internal_code_normalized=v_row.product_internal_code_normalized
          and products.archived_at is null limit 1; end if;
      if v_product_id is null then v_failure_code:='not_found'; raise exception 'expected import conflict'; end if;
      if v_row.proposed_action='unchanged' then
        if v_row.release_id is null or v_row.expected_release_version is null or not exists(
          select 1 from public.product_releases releases where releases.organization_id=p_organization_id
            and releases.product_id=v_product_id and releases.id=v_row.release_id
            and releases.version=v_row.expected_release_version and releases.archived_at is null) then
          v_failure_code:='stale_version'; raise exception 'expected import conflict'; end if;
      elsif v_row.proposed_action='create' then
        select created.outcome,created.release into v_mutation_outcome,v_payload
        from public.create_product_release_atomic(p_organization_id,v_product_id,p_actor_user_id,v_row.id,
          v_row.proposed->>'label',v_row.proposed->>'version',nullif(v_row.proposed->>'description','')) created;
        if v_mutation_outcome not in ('created','replayed') then
          v_failure_code:=case when v_mutation_outcome='not_found' then 'not_found' else 'stale_conflict' end;
          raise exception 'expected import conflict'; end if;
        update public.product_import_rows set release_id=(v_payload->>'id')::uuid
         where organization_id=p_organization_id and id=v_row.id;
      elsif v_row.proposed_action='update' then
        select updated.outcome,updated.release into v_mutation_outcome,v_payload
        from public.update_product_release_atomic(p_organization_id,v_product_id,v_row.release_id,p_actor_user_id,
          v_row.expected_release_version,nullif(v_row.proposed->>'label',''),null,
          v_row.proposed->>'description',v_row.proposed?'description') updated;
        if v_mutation_outcome<>'updated' then
          v_failure_code:=case when v_mutation_outcome='not_found' then 'not_found' else 'stale_version' end;
          raise exception 'expected import conflict'; end if;
      end if;
      update public.product_import_rows set product_id=v_product_id,result='committed',committed_at=now()
       where organization_id=p_organization_id and id=v_row.id;
    end loop;
  exception when others then
    if v_failure_code is null then v_failure_code:='unavailable'; end if;
  end;

  if v_failure_code is not null then
    if v_failure_code<>'unavailable' then
      update public.product_import_jobs set status='stale_conflict',error_code=v_failure_code,
        lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=p_import_id;
      insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
      values(p_organization_id,p_actor_user_id,'product_import.commit_stale','product_import',p_import_id::text,
        jsonb_build_object('errorCode',v_failure_code,'correlationId',v_job.correlation_id));
      return query select 'stale_conflict'::text,public.product_import_job_json(p_organization_id,p_import_id); return;
    end if;
    v_retry_count:=least(5,v_job.retry_count+1);
    update public.product_import_jobs set
      status=case when v_retry_count<5 then 'retrying' else 'dead_letter' end,
      retry_count=v_retry_count,error_code=case when v_retry_count<5 then 'unavailable' else 'retry_exhausted' end,
      next_attempt_at=now()+make_interval(secs=>least(300,(2^v_retry_count)::integer*5)),
      lease_owner=null,lease_expires_at=null where organization_id=p_organization_id and id=p_import_id;
    return query select case when v_retry_count<5 then 'retrying' else 'dead_letter' end,
      public.product_import_job_json(p_organization_id,p_import_id); return;
  end if;
  update public.product_import_jobs set status='completed',committed_at=now(),
    committed_row_count=(select count(*) from public.product_import_rows rows
      where rows.organization_id=p_organization_id and rows.import_id=p_import_id and rows.result='committed'),
    lease_owner=null,lease_expires_at=null,error_code=null
  where organization_id=p_organization_id and id=p_import_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'product_import.committed','product_import',p_import_id::text,
    jsonb_build_object('schemaVersion',v_job.schema_version,'contentHash',p_content_hash,
      'rowCount',v_job.row_count,'createCount',v_job.create_count,'updateCount',v_job.update_count,
      'unchangedCount',v_job.unchanged_count,'skippedCount',v_job.skipped_count,
      'correlationId',v_job.correlation_id));
  return query select 'completed'::text,public.product_import_job_json(p_organization_id,p_import_id);
end;
$$;

create or replace function public.expire_product_import_jobs(p_organization_id uuid,p_batch_size integer)
returns table(expired_count integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  if p_batch_size not between 1 and 500 then return query select 0; return; end if;
  with due as (
    select jobs.id from public.product_import_jobs jobs where jobs.organization_id=p_organization_id
      and jobs.expires_at<=now() and jobs.status in (
        'queued','parsing','validating','dry_run_completed','dry_run_failed','retrying')
    order by jobs.expires_at,jobs.id for update skip locked limit p_batch_size
  ),changed as (
    update public.product_import_jobs jobs set status='expired',lease_owner=null,lease_expires_at=null
    from due where jobs.organization_id=p_organization_id and jobs.id=due.id
    returning jobs.id,jobs.actor_user_id,jobs.correlation_id
  ),audited as (
    insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    select p_organization_id,changed.actor_user_id,'product_import.expired','product_import',changed.id::text,
      jsonb_build_object('correlationId',changed.correlation_id) from changed returning 1
  ) select count(*) into v_count from audited;
  return query select v_count;
end;
$$;

create or replace function public.get_product_import_cleanup_candidates(
  p_organization_id uuid,p_batch_size integer
) returns table(import_id uuid,source_object_path text,report_object_path text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_batch_size not between 1 and 500 then return; end if;
  return query select jobs.id,
    case when jobs.source_deleted_at is null then jobs.source_object_path else null end,
    case when jobs.report_deleted_at is null then jobs.report_object_path else null end
  from public.product_import_jobs jobs where jobs.organization_id=p_organization_id
    and jobs.retention_until<=now() and jobs.status in (
      'dead_letter','stale_conflict','canceled','expired','completed')
    and (jobs.source_deleted_at is null or jobs.report_deleted_at is null)
  order by jobs.retention_until,jobs.id limit p_batch_size;
end;
$$;

create or replace function public.mark_product_import_objects_deleted(
  p_organization_id uuid,p_import_id uuid,p_source_deleted boolean,p_report_deleted boolean
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.product_import_jobs set
    source_deleted_at=case when p_source_deleted then coalesce(source_deleted_at,now()) else source_deleted_at end,
    report_deleted_at=case when p_report_deleted or report_object_path is null
      then coalesce(report_deleted_at,now()) else report_deleted_at end
  where organization_id=p_organization_id and id=p_import_id and retention_until<=now()
    and status in ('dead_letter','stale_conflict','canceled','expired','completed');
  if not found then return query select 'not_found'::text; else return query select 'updated'::text; end if;
end;
$$;

alter function public.product_import_issues_are_safe(jsonb) owner to postgres;
alter function public.enforce_product_import_status_transition() owner to postgres;
alter function public.product_import_job_json(uuid,uuid) owner to postgres;
alter function public.product_import_row_json(public.product_import_rows) owner to postgres;
alter function public.create_product_import_job(uuid,uuid,uuid,uuid,text,text,integer,text,uuid) owner to postgres;
alter function public.get_product_import_job(uuid,uuid,uuid) owner to postgres;
alter function public.list_product_import_jobs(uuid,uuid,text,integer,integer) owner to postgres;
alter function public.list_product_import_rows(uuid,uuid,uuid,text,integer,integer) owner to postgres;
alter function public.claim_product_import_job(uuid,text,integer) owner to postgres;
alter function public.checkpoint_product_import_job(uuid,uuid,text,text,integer,integer,integer) owner to postgres;
alter function public.save_product_import_rows_page(uuid,uuid,text,text,jsonb) owner to postgres;
alter function public.complete_product_import_dry_run(uuid,uuid,text,text,integer,integer,integer,integer,integer,integer,integer,text,text) owner to postgres;
alter function public.fail_product_import_job(uuid,uuid,text,text,boolean) owner to postgres;
alter function public.cancel_product_import_job(uuid,uuid,uuid,text) owner to postgres;
alter function public.request_product_import_commit(uuid,uuid,uuid,text,uuid) owner to postgres;
alter function public.commit_product_import_atomic(uuid,uuid,uuid,text,uuid) owner to postgres;
alter function public.expire_product_import_jobs(uuid,integer) owner to postgres;
alter function public.get_product_import_cleanup_candidates(uuid,integer) owner to postgres;
alter function public.mark_product_import_objects_deleted(uuid,uuid,boolean,boolean) owner to postgres;

revoke all on function
  public.product_import_issues_are_safe(jsonb),
  public.enforce_product_import_status_transition(),
  public.product_import_job_json(uuid,uuid),
  public.product_import_row_json(public.product_import_rows),
  public.create_product_import_job(uuid,uuid,uuid,uuid,text,text,integer,text,uuid),
  public.get_product_import_job(uuid,uuid,uuid),
  public.list_product_import_jobs(uuid,uuid,text,integer,integer),
  public.list_product_import_rows(uuid,uuid,uuid,text,integer,integer),
  public.claim_product_import_job(uuid,text,integer),
  public.checkpoint_product_import_job(uuid,uuid,text,text,integer,integer,integer),
  public.save_product_import_rows_page(uuid,uuid,text,text,jsonb),
  public.complete_product_import_dry_run(uuid,uuid,text,text,integer,integer,integer,integer,integer,integer,integer,text,text),
  public.fail_product_import_job(uuid,uuid,text,text,boolean),
  public.cancel_product_import_job(uuid,uuid,uuid,text),
  public.request_product_import_commit(uuid,uuid,uuid,text,uuid),
  public.commit_product_import_atomic(uuid,uuid,uuid,text,uuid),
  public.expire_product_import_jobs(uuid,integer),
  public.get_product_import_cleanup_candidates(uuid,integer),
  public.mark_product_import_objects_deleted(uuid,uuid,boolean,boolean)
from public,anon,authenticated;

grant execute on function
  public.create_product_import_job(uuid,uuid,uuid,uuid,text,text,integer,text,uuid),
  public.get_product_import_job(uuid,uuid,uuid),
  public.list_product_import_jobs(uuid,uuid,text,integer,integer),
  public.list_product_import_rows(uuid,uuid,uuid,text,integer,integer),
  public.claim_product_import_job(uuid,text,integer),
  public.checkpoint_product_import_job(uuid,uuid,text,text,integer,integer,integer),
  public.save_product_import_rows_page(uuid,uuid,text,text,jsonb),
  public.complete_product_import_dry_run(uuid,uuid,text,text,integer,integer,integer,integer,integer,integer,integer,text,text),
  public.fail_product_import_job(uuid,uuid,text,text,boolean),
  public.cancel_product_import_job(uuid,uuid,uuid,text),
  public.request_product_import_commit(uuid,uuid,uuid,text,uuid),
  public.commit_product_import_atomic(uuid,uuid,uuid,text,uuid),
  public.expire_product_import_jobs(uuid,integer),
  public.get_product_import_cleanup_candidates(uuid,integer),
  public.mark_product_import_objects_deleted(uuid,uuid,boolean,boolean)
to service_role;

insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
select null,'migration.product_import_installed','database_migration','20260817120521',
  jsonb_build_object('schemaVersion','m2-product-release-import-v1')
where not exists(select 1 from public.audit_logs
  where action='migration.product_import_installed' and entity_id='20260817120521');
