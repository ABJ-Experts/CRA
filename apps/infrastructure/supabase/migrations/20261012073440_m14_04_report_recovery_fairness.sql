-- Recovery operates on the failed recipient, never on successful siblings.
create or replace function public.m14_04_replay(p_organization_id uuid,p_actor_user_id uuid,p_run_id uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.report_runs;d public.report_definitions;q public.report_run_recipients;j public.export_jobs;k text:=p_input->>'idempotencyKey';dig text:=public.m14_04_digest(p_input||jsonb_build_object('operation','replay','runId',p_run_id));response jsonb;n int:=0;begin
 select * into r from public.report_runs where organization_id=p_organization_id and id=p_run_id for update;
 if not found then raise exception 'report_access_denied' using errcode='42501';end if;
 d:=public.m14_04_owned(p_organization_id,p_actor_user_id,r.definition_id);
 if k is null then raise exception 'invalid_idempotency_key' using errcode='22023';end if;perform k::uuid;
 if d.commands ? k then if d.commands->k->>'digest'<>dig then raise exception 'report_idempotency_conflict' using errcode='40001';end if;return d.commands->k->'response';end if;
 if (select count(*) from jsonb_object_keys(d.commands))>=1000 then raise exception 'report_command_limit' using errcode='22023';end if;
 if (d.version is distinct from (p_input->>'expectedVersion')::int) or d.definition_version<>r.definition_version or r.state not in ('failed','succeeded') or d.state='archived' then raise exception 'report_replay_conflict' using errcode='40001';end if;
 if exists(select 1 from public.report_runs where organization_id=p_organization_id and definition_id=r.definition_id and id<>r.id and state in ('scheduled','running')) then raise exception 'report_run_in_progress' using errcode='40001';end if;
 perform 1 from public.organizations where id=p_organization_id for update;
 for q in select * from public.report_run_recipients where organization_id=p_organization_id and run_id=r.id and generation_state='failed' and email_state not in ('accepted','uncertain','queued') and expires_at>clock_timestamp() and safe_error_code in ('worker_failure','storage_failure','render_failure','capture_timeout','attempts_exhausted','provider_unavailable','storage_unavailable','generation_failed') for update loop
 if not public.m14_04_authorize_recipient(p_organization_id,q.id) then continue;end if;
 if q.export_job_id is not null then
 select * into j from public.export_jobs where organization_id=p_organization_id and id=q.export_job_id for update;
 if j.expires_at<=clock_timestamp() or j.state not in ('failed','ready') or not public.m14_03_snapshot_access(j) then continue;end if;
 if j.state='ready' then
 if j.manifest is null then continue;end if;
 -- Publication-only recovery preserves completed artifacts and never queues
 -- a renderer or retries a delivery accepted for another recipient.
 else
 if j.manifest is not null or j.failure_code not in ('worker_failure','storage_failure','render_failure','capture_timeout','attempts_exhausted','provider_unavailable','storage_unavailable','generation_failed') then continue;end if;
 if (select count(*) from public.export_jobs where organization_id=p_organization_id and subject_kind='scheduled' and state in ('queued','capturing','audit_pending','rendering'))>=2 then continue;end if;
 update public.export_jobs set state='queued',failure_code=null,attempts=0,worker_id=null,lease_expires_at=null,version=version+1 where organization_id=p_organization_id and id=j.id;
 end if;
 end if;
 update public.report_run_recipients set generation_state='waiting',safe_error_code=null,worker_id=null,lease_expires_at=null,version=version+1 where organization_id=p_organization_id and id=q.id;n:=n+1;
 end loop;
 if n=0 then raise exception 'report_replay_unsafe' using errcode='40001';end if;
 update public.report_runs set state='scheduled',finished_at=null,safe_error_code=null where organization_id=p_organization_id and id=r.id;
 perform public.m14_04_audit(p_organization_id,p_actor_user_id,r.id,'replayed',k::uuid);
 response:=public.m14_04_get_run(p_organization_id,p_actor_user_id,r.id);
 update public.report_definitions set commands=commands||jsonb_build_object(k,jsonb_build_object('digest',dig,'response',response)) where organization_id=p_organization_id and id=d.id;
 return response;end $$;


-- A bounded scheduling timestamp provides tenant round-robin without another table.
alter table public.report_run_recipients add column last_claimed_at timestamptz;
create index report_recipient_tenant_last_claim on public.report_run_recipients(organization_id,last_claimed_at desc) where last_claimed_at is not null;
create or replace function public.m14_04_claim_recipient(p_worker_id text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.report_run_recipients;r public.report_runs;begin
 if p_worker_id is null or length(p_worker_id) not between 1 and 200 then raise exception 'invalid_worker' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('m14-04-recipient-scheduler',0));
 select x.* into q from public.report_run_recipients x join public.report_runs parent_run on parent_run.organization_id=x.organization_id and parent_run.id=x.run_id where parent_run.state in ('scheduled','running') and (x.generation_state='waiting' or (x.generation_state='running' and x.lease_expires_at<=clock_timestamp())) order by (select max(previous.last_claimed_at) from public.report_run_recipients previous where previous.organization_id=x.organization_id and previous.last_claimed_at is not null) nulls first,x.created_at,x.id for update of x skip locked limit 1;
 if not found then return null;end if;
 update public.report_run_recipients set last_claimed_at=clock_timestamp() where organization_id=q.organization_id and id=q.id;
 select * into r from public.report_runs where organization_id=q.organization_id and id=q.run_id;
 if not public.m14_04_source_access(q.organization_id,r.owner_user_id,r.config) then
 update public.report_definitions set state='paused',pause_reason='owner_access_lost',next_due_at=null,version=version+1 where organization_id=q.organization_id and id=r.definition_id and state<>'archived';
 perform public.m14_04_audit(q.organization_id,r.owner_user_id,r.definition_id,'owner_paused',gen_random_uuid());end if;
 if not public.m14_04_authorize_recipient(q.organization_id,q.id) then
 update public.report_run_recipients set generation_state='revoked',safe_error_code='access_changed',email_state='skipped',worker_id=null,lease_expires_at=null,version=version+1 where organization_id=q.organization_id and id=q.id;
 perform public.m14_04_finish_run(q.organization_id,q.run_id);perform public.m14_04_audit(q.organization_id,r.owner_user_id,q.id,'revoked',gen_random_uuid());return null;end if;
 update public.report_run_recipients set generation_state='running',worker_id=p_worker_id,lease_expires_at=clock_timestamp()+interval '120 seconds',version=version+1 where organization_id=q.organization_id and id=q.id returning * into q;
 update public.report_runs set state='running' where organization_id=q.organization_id and id=q.run_id;
 return jsonb_build_object('organizationId',q.organization_id,'recipientId',q.id,'runId',q.run_id,'definitionId',r.definition_id,'definitionVersion',r.definition_version,'ownerUserId',r.owner_user_id,'userId',q.user_id,'ownerBaseRole',(select role from public.organization_members where organization_id=q.organization_id and user_id=r.owner_user_id),'recipientBaseRole',(select role from public.organization_members where organization_id=q.organization_id and user_id=q.user_id),'config',r.config,'sourceSchemaDigest',r.source_schema_digest,'scheduledFor',r.scheduled_for,'workerId',p_worker_id,'version',q.version,'exportJobId',q.export_job_id);
end $$;

revoke all on function public.m14_04_replay(uuid,uuid,uuid,jsonb),public.m14_04_claim_recipient(text) from public,anon,authenticated;
grant execute on function public.m14_04_replay(uuid,uuid,uuid,jsonb),public.m14_04_claim_recipient(text) to service_role;
notify pgrst,'reload schema';
-- PostgREST retries 40001 as a database serialization failure. An explicit
-- version/lease/policy decision is a terminal application conflict; P0001 is
-- mapped by ReportsRepository to HTTP 409. Genuine PostgreSQL serialization
-- failures retain their native 40001 code and remain retryable by the database.
do $$ declare routine record;definition text;begin
 for routine in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'm14_04_%' loop
 definition:=pg_get_functiondef(routine.signature);
 if definition ~* $pattern$errcode\s*=\s*'40001'$pattern$ then
 definition:=regexp_replace(definition,$pattern$errcode\s*=\s*'40001'$pattern$,$replacement$errcode='P0001'$replacement$,'gi');
 execute definition;
 end if;
 end loop;
end$$;
notify pgrst,'reload schema';
