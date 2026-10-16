-- Forward-only corrections and worker coordination added after the import
-- foundation was applied to the local CRA stack. No product data is rewritten.

create or replace function public.enforce_product_import_status_transition()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'queued' and new.status in ('parsing','committing','retrying','dead_letter','canceled','expired'))
    or (old.status = 'parsing' and new.status in ('validating','dry_run_failed','retrying','dead_letter','canceled','expired'))
    or (old.status = 'validating' and new.status in ('dry_run_completed','dry_run_failed','retrying','dead_letter','canceled','expired'))
    or (old.status = 'dry_run_completed' and new.status in ('queued','committing','stale_conflict','canceled','expired'))
    or (old.status = 'dry_run_failed' and new.status in ('canceled','expired'))
    or (old.status = 'committing' and new.status in ('completed','retrying','dead_letter','stale_conflict'))
    or (old.status = 'retrying' and new.status in ('parsing','committing','dead_letter','canceled','expired'))
  ) then raise exception using errcode = '23514', message = 'invalid product import status transition'; end if;
  return new;
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
    row_count=greatest(row_count,p_processed_row_count),
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
    row_count=(select count(*) from public.product_import_rows rows
      where rows.organization_id=p_organization_id and rows.import_id=p_import_id),
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

create or replace function public.claim_product_import_job_by_id(
  p_organization_id uuid,p_import_id uuid,p_worker_id text,p_lease_seconds integer
) returns table(outcome text,job jsonb,work jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.product_import_jobs%rowtype;
begin
  if char_length(btrim(p_worker_id)) not between 1 and 100 or p_lease_seconds not between 10 and 300 then
    return query select 'invalid_request'::text,null::jsonb,null::jsonb; return; end if;
  select * into v_job from public.product_import_jobs jobs
   where jobs.organization_id=p_organization_id and jobs.id=p_import_id
     and jobs.status in ('queued','retrying') and jobs.next_attempt_at<=now()
     and jobs.expires_at>now() and (jobs.lease_expires_at is null or jobs.lease_expires_at<=now())
   for update skip locked;
  if not found then return query select 'not_found'::text,null::jsonb,null::jsonb; return; end if;
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

-- Scheduler-only exception to org-first: it returns opaque organization IDs
-- and no customer/import content, enabling one org-scoped claim per tenant.
drop function if exists public.list_due_product_import_organizations(integer);
create or replace function public.list_due_product_import_organizations(p_limit integer)
returns table(organization_id uuid,oldest_due_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_limit not between 1 and 500 then return; end if;
  return query select jobs.organization_id,min(jobs.next_attempt_at)
  from public.product_import_jobs jobs where jobs.status in ('queued','retrying')
    and jobs.next_attempt_at<=now() and jobs.expires_at>now()
    and (jobs.lease_expires_at is null or jobs.lease_expires_at<=now())
  group by jobs.organization_id
  order by min(jobs.next_attempt_at),jobs.organization_id limit p_limit;
end;
$$;

create or replace function public.record_product_import_report_download(
  p_organization_id uuid,p_actor_user_id uuid,p_import_id uuid,p_correlation_id uuid
) returns table(outcome text,object_path text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.product_import_jobs%rowtype;
begin
  if p_correlation_id is null or not public.m2_active_member(p_organization_id,p_actor_user_id) then
    return query select 'not_found'::text,null::text; return; end if;
  select * into v_job from public.product_import_jobs jobs
   where jobs.organization_id=p_organization_id and jobs.id=p_import_id
     and jobs.report_object_path is not null for share;
  if not found then return query select 'not_found'::text,null::text; return; end if;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'product_import.report_downloaded','product_import',p_import_id::text,
    jsonb_build_object('correlationId',p_correlation_id));
  return query select 'found'::text,v_job.report_object_path;
end;
$$;

create or replace function public.mark_product_import_stale_conflict(
  p_organization_id uuid,p_import_id uuid,p_worker_id text,p_error_code text
) returns table(outcome text,job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_error_code not in (
    'authorization_changed','permission_denied','content_hash_mismatch',
    'source_missing','stale_version','stale_conflict'
  ) then return query select 'invalid_request'::text,null::jsonb; return; end if;
  update public.product_import_jobs set status='stale_conflict',error_code=p_error_code,
    lease_owner=null,lease_expires_at=null
  where organization_id=p_organization_id and id=p_import_id and status='committing'
    and lease_owner=btrim(p_worker_id) and lease_expires_at>now();
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  return query select 'stale_conflict'::text,public.product_import_job_json(p_organization_id,p_import_id);
end;
$$;

alter function public.enforce_product_import_status_transition() owner to postgres;
alter function public.checkpoint_product_import_job(uuid,uuid,text,text,integer,integer,integer) owner to postgres;
alter function public.save_product_import_rows_page(uuid,uuid,text,text,jsonb) owner to postgres;
alter function public.claim_product_import_job_by_id(uuid,uuid,text,integer) owner to postgres;
alter function public.list_due_product_import_organizations(integer) owner to postgres;
alter function public.record_product_import_report_download(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.mark_product_import_stale_conflict(uuid,uuid,text,text) owner to postgres;

revoke all on function
  public.claim_product_import_job_by_id(uuid,uuid,text,integer),
  public.list_due_product_import_organizations(integer),
  public.record_product_import_report_download(uuid,uuid,uuid,uuid),
  public.mark_product_import_stale_conflict(uuid,uuid,text,text)
from public,anon,authenticated;
grant execute on function
  public.claim_product_import_job_by_id(uuid,uuid,text,integer),
  public.list_due_product_import_organizations(integer),
  public.record_product_import_report_download(uuid,uuid,uuid,uuid),
  public.mark_product_import_stale_conflict(uuid,uuid,text,text)
to service_role;
