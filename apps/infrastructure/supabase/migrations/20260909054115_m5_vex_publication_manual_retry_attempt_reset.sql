-- A manual retry is a new bounded delivery cycle. Prior attempts remain in
-- the append-only attempt table; only the current job's retry budget resets.
create or replace function public.retry_vulnerability_vex_publication_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_job_id uuid, p_expected_version integer,
  p_idempotency_key uuid, p_correlation_id uuid default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_vex_publication_jobs%rowtype; v_existing record; v_digest text;
begin
  if p_organization_id is null or p_actor_user_id is null or p_job_id is null or p_expected_version is null
    or p_expected_version < 1 or p_idempotency_key is null
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_manage_finding_publication') then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0));
  v_digest:=encode(extensions.digest(jsonb_build_object('jobId',p_job_id,'expectedVersion',p_expected_version)::text,'sha256'),'hex');
  select * into v_existing from public.m5_triage_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'retry_vex_publication',v_digest);
  if found then return query select v_existing.outcome,v_existing.result; return; end if;
  select * into v_job from public.vulnerability_vex_publication_jobs jobs where jobs.organization_id=p_organization_id and jobs.id=p_job_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_job.version<>p_expected_version then return query select 'conflict'::text,jsonb_build_object('job',public.m5_vex_publication_job_json(p_organization_id,p_job_id)); return; end if;
  if v_job.delivery_state not in ('retrying','dead_letter') then return query select 'invalid_state'::text,jsonb_build_object('job',public.m5_vex_publication_job_json(p_organization_id,p_job_id)); return; end if;
  update public.vulnerability_vex_publication_jobs set delivery_state='pending',attempt_count=0,next_attempt_at=clock_timestamp(),last_error_code=null,last_error_detail=null,lease_owner=null,lease_expires_at=null,version=version+1,updated_at=clock_timestamp()
    where organization_id=p_organization_id and id=p_job_id returning * into v_job;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'vulnerability.vex_publication_retried','vulnerability_vex_publication_job',p_job_id::text,jsonb_build_object('idempotencyKey',p_idempotency_key,'correlationId',p_correlation_id));
  insert into public.vulnerability_triage_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'retry_vex_publication',v_digest,jsonb_build_object('job',public.m5_vex_publication_job_json(p_organization_id,p_job_id)));
  return query select 'queued'::text,jsonb_build_object('job',public.m5_vex_publication_job_json(p_organization_id,p_job_id));
end;
$$;

alter function public.retry_vulnerability_vex_publication_atomic(uuid,uuid,uuid,integer,uuid,uuid) owner to postgres;
revoke all on function public.retry_vulnerability_vex_publication_atomic(uuid,uuid,uuid,integer,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.retry_vulnerability_vex_publication_atomic(uuid,uuid,uuid,integer,uuid,uuid)
  to service_role;
