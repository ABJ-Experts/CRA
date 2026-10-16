-- A queued upload must never be committable before a complete dry run, even if
-- a service caller invokes the commit coordinator out of order.
alter table public.product_import_jobs add column dry_run_completed_at timestamptz;

create or replace function public.product_import_issue_code_is_valid(p_code text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select p_code is null or p_code in (
    'empty_file','no_data_rows','file_too_large','too_many_rows','compressed_input',
    'invalid_utf8','null_byte','malformed_csv','row_too_large','cell_too_large',
    'missing_header','duplicate_header','ambiguous_header','unknown_column',
    'invalid_column_count','unsupported_schema_version','invalid_record_type',
    'invalid_operation','required','invalid_format','invalid_value','unexpected_value',
    'duplicate_in_file','conflicting_row','already_exists','not_found','inactive',
    'stale_version','no_changes','content_hash_mismatch','source_missing',
    'authorization_changed','permission_denied','validation_failed','stale_conflict',
    'canceled','expired','retry_exhausted','unavailable'
  );
$$;

alter table public.product_import_jobs
  add constraint product_import_error_code_check
  check (public.product_import_issue_code_is_valid(error_code));

create or replace function public.enforce_product_import_commit_precondition()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status='committing' and old.dry_run_completed_at is null then
    raise exception using errcode='23514',message='product import requires a completed dry run';
  end if;
  return new;
end;
$$;
create trigger enforce_product_import_commit_precondition
  before update of status on public.product_import_jobs for each row
  execute function public.enforce_product_import_commit_precondition();

create or replace function public.complete_product_import_dry_run(
  p_organization_id uuid,p_import_id uuid,p_worker_id text,p_content_hash text,
  p_row_count integer,p_create_count integer,p_update_count integer,
  p_unchanged_count integer,p_skipped_count integer,p_failed_count integer,
  p_warning_count integer,p_report_object_path text,p_error_code text
) returns table(outcome text,job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.product_import_jobs%rowtype; v_stored_rows integer; v_status text; v_error text;
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
     or not public.product_import_issue_code_is_valid(p_error_code) then
    return query select 'invalid_request'::text,null::jsonb; return; end if;
  select count(*) into v_stored_rows from public.product_import_rows rows
   where rows.organization_id=p_organization_id and rows.import_id=p_import_id;
  if v_stored_rows<>p_row_count then return query select 'checkpoint_mismatch'::text,null::jsonb; return; end if;
  v_error:=case when p_row_count=0 then coalesce(p_error_code,'no_data_rows') else p_error_code end;
  v_status:=case when p_failed_count>0 or v_error is not null
    then 'dry_run_failed' else 'dry_run_completed' end;
  update public.product_import_jobs set status=v_status,row_count=p_row_count,
    create_count=p_create_count,update_count=p_update_count,unchanged_count=p_unchanged_count,
    skipped_count=p_skipped_count,failed_count=p_failed_count,warning_count=p_warning_count,
    processed_row_count=p_row_count,report_object_path=p_report_object_path,error_code=v_error,
    dry_run_completed_at=now(),lease_owner=null,lease_expires_at=null
  where organization_id=p_organization_id and id=p_import_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,v_job.actor_user_id,
    case when v_status='dry_run_completed' then 'product_import.dry_run_completed'
      else 'product_import.dry_run_failed' end,
    'product_import',p_import_id::text,jsonb_build_object(
      'status',v_status,'contentHash',p_content_hash,'rowCount',p_row_count,
      'createCount',p_create_count,'updateCount',p_update_count,'unchangedCount',p_unchanged_count,
      'skippedCount',p_skipped_count,'failedCount',p_failed_count,'warningCount',p_warning_count,
      'errorCode',v_error,'correlationId',v_job.correlation_id));
  return query select v_status,public.product_import_job_json(p_organization_id,p_import_id);
end;
$$;

create or replace function public.fail_product_import_job(
  p_organization_id uuid,p_import_id uuid,p_worker_id text,p_error_code text,p_retryable boolean
) returns table(outcome text,job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.product_import_jobs%rowtype; v_status text; v_retries integer;
begin
  if p_error_code is null or not public.product_import_issue_code_is_valid(p_error_code) then
    return query select 'invalid_request'::text,null::jsonb; return; end if;
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
     and jobs.report_object_path is not null and jobs.report_deleted_at is null
     and jobs.retention_until>now() for share;
  if not found then return query select 'not_found'::text,null::text; return; end if;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'product_import.report_downloaded','product_import',p_import_id::text,
    jsonb_build_object('correlationId',p_correlation_id));
  return query select 'found'::text,v_job.report_object_path;
end;
$$;

create or replace function public.mark_product_import_objects_deleted(
  p_organization_id uuid,p_import_id uuid,p_source_deleted boolean,p_report_deleted boolean
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.product_import_jobs%rowtype;
begin
  select * into v_job from public.product_import_jobs jobs
   where jobs.organization_id=p_organization_id and jobs.id=p_import_id
     and jobs.retention_until<=now() and jobs.status in (
       'dead_letter','stale_conflict','canceled','expired','completed') for update;
  if not found then return query select 'not_found'::text; return; end if;
  update public.product_import_jobs set
    source_deleted_at=case when p_source_deleted then coalesce(source_deleted_at,now()) else source_deleted_at end,
    report_deleted_at=case when p_report_deleted or report_object_path is null
      then coalesce(report_deleted_at,now()) else report_deleted_at end
  where organization_id=p_organization_id and id=p_import_id;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
  values(p_organization_id,'product_import.objects_deleted','product_import',p_import_id::text,
    jsonb_build_object('sourceDeleted',p_source_deleted,'reportDeleted',p_report_deleted,
      'correlationId',v_job.correlation_id));
  return query select 'updated'::text;
end;
$$;

alter function public.product_import_issue_code_is_valid(text) owner to postgres;
alter function public.enforce_product_import_commit_precondition() owner to postgres;
alter function public.complete_product_import_dry_run(uuid,uuid,text,text,integer,integer,integer,integer,integer,integer,integer,text,text) owner to postgres;
alter function public.fail_product_import_job(uuid,uuid,text,text,boolean) owner to postgres;
alter function public.record_product_import_report_download(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.mark_product_import_objects_deleted(uuid,uuid,boolean,boolean) owner to postgres;

revoke all on function
  public.product_import_issue_code_is_valid(text),
  public.enforce_product_import_commit_precondition()
from public,anon,authenticated;
