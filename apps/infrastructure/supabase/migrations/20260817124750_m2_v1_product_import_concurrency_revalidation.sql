-- Close concurrent upload replay and commit-reference races without adding
-- storage tables or bypassing the authoritative row mutation procedures.

create or replace function public.create_product_import_job(
  p_organization_id uuid,p_actor_user_id uuid,p_import_id uuid,
  p_upload_idempotency_key uuid,p_content_hash text,p_original_filename text,
  p_byte_size integer,p_source_object_path text,p_correlation_id uuid
) returns table(outcome text,job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_existing public.product_import_jobs%rowtype; v_digest text;
begin
  if p_import_id is null or p_upload_idempotency_key is null or p_correlation_id is null
     or p_content_hash!~'^[a-f0-9]{64}$' or p_byte_size not between 0 and 10485760
     or char_length(btrim(p_original_filename)) not between 1 and 255
     or p_source_object_path<>p_organization_id::text||'/'||p_import_id::text||'/source.csv'
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
  begin
    insert into public.product_import_jobs(
      id,organization_id,actor_user_id,schema_version,status,upload_idempotency_key,
      upload_request_digest,content_hash,original_filename,source_object_path,
      byte_size,correlation_id,expires_at,retention_until
    ) values(
      p_import_id,p_organization_id,p_actor_user_id,'m2-product-release-import-v1','queued',
      p_upload_idempotency_key,v_digest,p_content_hash,btrim(p_original_filename),
      p_source_object_path,p_byte_size,p_correlation_id,
      now()+interval '24 hours',now()+interval '7 days');
    insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'product_import.uploaded','product_import',p_import_id::text,
      jsonb_build_object('schemaVersion','m2-product-release-import-v1','contentHash',p_content_hash,
        'byteSize',p_byte_size,'correlationId',p_correlation_id));
    return query select 'created'::text,public.product_import_job_json(p_organization_id,p_import_id);
    return;
  exception when unique_violation then
    select * into v_existing from public.product_import_jobs jobs
     where jobs.organization_id=p_organization_id and jobs.actor_user_id=p_actor_user_id
       and jobs.upload_idempotency_key=p_upload_idempotency_key;
    if found and v_existing.upload_request_digest=v_digest then
      return query select 'replayed'::text,public.product_import_job_json(p_organization_id,v_existing.id);
    elsif found then return query select 'idempotency_mismatch'::text,null::jsonb;
    else return query select 'conflict'::text,null::jsonb; end if;
  end;
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
      'commitActorId',v_job.commit_actor_user_id,'commitIdempotencyKey',v_job.commit_idempotency_key,
      'retryCount',v_job.retry_count);
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
      'commitActorId',v_job.commit_actor_user_id,'commitIdempotencyKey',v_job.commit_idempotency_key,
      'retryCount',v_job.retry_count);
end;
$$;

create or replace function public.product_import_commit_references_valid(
  p_organization_id uuid,p_import_id uuid
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.product_import_rows%rowtype; v_product public.products%rowtype;
  v_owner uuid; v_entity uuid;
begin
  for v_row in select * from public.product_import_rows rows
    where rows.organization_id=p_organization_id and rows.import_id=p_import_id
      and rows.proposed_action not in ('failed','skipped') order by rows.source_row_number
  loop
    if v_row.row_type='product' and v_row.proposed_action='create' then
      begin
        v_owner:=(v_row.proposed->>'responsibleOwnerId')::uuid;
        v_entity:=(v_row.proposed->>'legalEntityId')::uuid;
      exception when invalid_text_representation then return false; end;
      perform 1 from public.organization_members members join public.users users on users.id=members.user_id
       where members.organization_id=p_organization_id and members.user_id=v_owner and users.is_active
       for key share of members,users;
      if not found then return false; end if;
      perform 1 from public.organization_legal_entities entities
       where entities.organization_id=p_organization_id and entities.id=v_entity
         and entities.status='active' and entities.completion_status='complete' for key share;
      if not found then return false; end if;
    else
      v_product:=null;
      if v_row.product_id is not null then
        select * into v_product from public.products products
         where products.organization_id=p_organization_id and products.id=v_row.product_id
           and products.archived_at is null for key share;
      elsif v_row.product_internal_code_normalized is not null then
        select * into v_product from public.products products
         where products.organization_id=p_organization_id
           and products.internal_code_normalized=v_row.product_internal_code_normalized
           and products.archived_at is null for key share;
      end if;
      if v_product.id is null then return false; end if;
      v_owner:=case when v_row.row_type='product' and v_row.proposed?'responsibleOwnerId'
        then (v_row.proposed->>'responsibleOwnerId')::uuid else v_product.responsible_owner_id end;
      perform 1 from public.organization_members members join public.users users on users.id=members.user_id
       where members.organization_id=p_organization_id and members.user_id=v_owner and users.is_active
       for key share of members,users;
      if not found then return false; end if;
      perform 1 from public.organization_legal_entities entities
       where entities.organization_id=p_organization_id and entities.id=v_product.legal_entity_id
         and entities.status='active' and entities.completion_status='complete' for key share;
      if not found then return false; end if;
    end if;
  end loop;
  return true;
exception when invalid_text_representation then return false;
end;
$$;

alter function public.commit_product_import_atomic(uuid,uuid,uuid,text,uuid)
  rename to commit_product_import_rows_atomic;

create function public.commit_product_import_atomic(
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
  if v_job.commit_idempotency_key is not null and (
    v_job.commit_actor_user_id<>p_actor_user_id or v_job.commit_idempotency_key<>p_idempotency_key
    or v_job.commit_request_digest<>v_digest) then
    return query select 'idempotency_mismatch'::text,null::jsonb; return; end if;
  if v_job.status in ('completed','stale_conflict') or v_job.content_hash<>p_content_hash
     or v_job.status not in ('dry_run_completed','queued','committing','retrying') then
    return query select delegated.outcome,delegated.job from public.commit_product_import_rows_atomic(
      p_organization_id,p_actor_user_id,p_import_id,p_content_hash,p_idempotency_key) delegated;
    return;
  end if;
  if not public.product_import_commit_references_valid(p_organization_id,p_import_id) then
    update public.product_import_jobs set status='stale_conflict',error_code='authorization_changed',
      lease_owner=null,lease_expires_at=null
    where organization_id=p_organization_id and id=p_import_id;
    insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'product_import.commit_stale','product_import',p_import_id::text,
      jsonb_build_object('errorCode','authorization_changed','correlationId',v_job.correlation_id));
    return query select 'stale_conflict'::text,public.product_import_job_json(p_organization_id,p_import_id);
    return;
  end if;
  return query select delegated.outcome,delegated.job from public.commit_product_import_rows_atomic(
    p_organization_id,p_actor_user_id,p_import_id,p_content_hash,p_idempotency_key) delegated;
end;
$$;

create or replace function public.enforce_product_import_status_transition()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.status=old.status then return new; end if;
  if not (
    (old.status='queued' and new.status in ('parsing','committing','retrying','dead_letter','stale_conflict','canceled','expired'))
    or (old.status='parsing' and new.status in ('validating','dry_run_failed','retrying','dead_letter','canceled','expired'))
    or (old.status='validating' and new.status in ('dry_run_completed','dry_run_failed','retrying','dead_letter','canceled','expired'))
    or (old.status='dry_run_completed' and new.status in ('queued','committing','stale_conflict','canceled','expired'))
    or (old.status='dry_run_failed' and new.status in ('canceled','expired'))
    or (old.status='committing' and new.status in ('completed','retrying','dead_letter','stale_conflict'))
    or (old.status='retrying' and new.status in ('parsing','committing','dead_letter','stale_conflict','canceled','expired'))
  ) then raise exception using errcode='23514',message='invalid product import status transition'; end if;
  return new;
end;
$$;

alter function public.create_product_import_job(uuid,uuid,uuid,uuid,text,text,integer,text,uuid) owner to postgres;
alter function public.claim_product_import_job(uuid,text,integer) owner to postgres;
alter function public.claim_product_import_job_by_id(uuid,uuid,text,integer) owner to postgres;
alter function public.product_import_commit_references_valid(uuid,uuid) owner to postgres;
alter function public.commit_product_import_rows_atomic(uuid,uuid,uuid,text,uuid) owner to postgres;
alter function public.commit_product_import_atomic(uuid,uuid,uuid,text,uuid) owner to postgres;
alter function public.enforce_product_import_status_transition() owner to postgres;

revoke all on function
  public.product_import_commit_references_valid(uuid,uuid),
  public.commit_product_import_rows_atomic(uuid,uuid,uuid,text,uuid),
  public.commit_product_import_atomic(uuid,uuid,uuid,text,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.commit_product_import_atomic(uuid,uuid,uuid,text,uuid) to service_role;
