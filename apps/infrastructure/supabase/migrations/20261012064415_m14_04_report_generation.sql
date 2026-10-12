alter table public.export_jobs add column report_recipient_id uuid;
alter table public.export_jobs add constraint export_report_recipient_tenant_fk foreign key(organization_id,report_recipient_id) references public.report_run_recipients(organization_id,id);
create unique index export_report_recipient_unique on public.export_jobs(organization_id,report_recipient_id) where report_recipient_id is not null;
-- Preserve each old subject constraint byte-for-byte and add one narrow branch.
do $$ declare c record;begin
 for c in select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.export_jobs'::regclass and contype='c' and pg_get_constraintdef(oid) like '%subject_kind%' loop
 execute format('alter table public.export_jobs drop constraint %I',c.conname);
 execute format('alter table public.export_jobs add constraint %I CHECK ((%s) OR (subject_kind=''scheduled'' AND requester_id IS NOT NULL AND session_id IS NULL AND supplier_invitation_id IS NULL AND supplier_session_digest IS NULL AND auditor_session_id IS NULL AND report_recipient_id IS NOT NULL))',c.conname,substring(c.definition from 8 for length(c.definition)-8));
 end loop;
end $$;
alter table public.export_jobs add constraint export_report_subject_reference check((subject_kind='scheduled')=(report_recipient_id is not null));
create function public.m14_04_authorize_recipient(p_organization_id uuid,p_recipient_id uuid) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare q public.report_run_recipients;r public.report_runs;d public.report_definitions;begin
 select * into q from public.report_run_recipients where organization_id=p_organization_id and id=p_recipient_id;
 if not found or q.generation_state in ('revoked','skipped') or q.expires_at<=clock_timestamp() then return false;end if;
 select * into r from public.report_runs where organization_id=p_organization_id and id=q.run_id;
 select * into d from public.report_definitions where organization_id=p_organization_id and id=r.definition_id;
 if d.state='archived' or (r.kind='scheduled' and d.state<>'active') or d.schema_version<>'m14_04_v1' then return false;end if;
 if r.kind='scheduled' and not(d.config->'recipientUserIds' ? q.user_id::text) then return false;end if;
 return public.m14_04_source_access(p_organization_id,r.owner_user_id,r.config) and public.m14_04_source_access(p_organization_id,q.user_id,r.config);
end $$;
create function public.m14_04_authorize_history(p_organization_id uuid,p_recipient_id uuid) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare q public.report_run_recipients;r public.report_runs;begin
 select * into q from public.report_run_recipients where organization_id=p_organization_id and id=p_recipient_id;
 if not found or q.generation_state in ('revoked','skipped') then return false;end if;
 select * into r from public.report_runs where organization_id=p_organization_id and id=q.run_id;
 return public.m14_04_source_access(p_organization_id,r.owner_user_id,r.config) and public.m14_04_source_access(p_organization_id,q.user_id,r.config);
end $$;
create function public.m14_04_finish_run(p_organization_id uuid,p_run_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 if exists(select 1 from public.report_run_recipients where organization_id=p_organization_id and run_id=p_run_id and generation_state in ('waiting','running')) then return;end if;
 update public.report_runs set state=case when exists(select 1 from public.report_run_recipients where organization_id=p_organization_id and run_id=p_run_id and generation_state='ready') then 'succeeded' else 'failed' end,finished_at=clock_timestamp() where organization_id=p_organization_id and id=p_run_id and state in ('scheduled','running');end $$;
create function public.m14_04_schedule_due(p_worker_id text,p_limit integer) returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.report_definitions;r public.report_runs;slot timestamptz;next_slot timestamptz;u text;n int:=0;coalesced int;recipient_row public.report_run_recipients;cutoff timestamptz:=clock_timestamp()-interval '24 hours';begin
 if length(p_worker_id) not between 1 and 200 or p_limit not between 1 and 100 then raise exception 'invalid_scheduler_input' using errcode='22023';end if;
 for d in select * from public.report_definitions where state='active' and next_due_at<=clock_timestamp() order by next_due_at,id for update skip locked limit p_limit loop
 if not public.m14_04_source_access(d.organization_id,d.owner_user_id,d.config) or d.schema_version<>'m14_04_v1' then
 update public.report_definitions set state='paused',pause_reason='owner_access_lost',next_due_at=null,version=version+1 where organization_id=d.organization_id and id=d.id;
 update public.report_run_recipients q set generation_state='revoked',safe_error_code='owner_access_lost',worker_id=null,lease_expires_at=null,version=q.version+1 from public.report_runs parent_run where parent_run.organization_id=d.organization_id and parent_run.definition_id=d.id and q.organization_id=parent_run.organization_id and q.run_id=parent_run.id and q.generation_state<>'revoked';
 perform public.m14_04_audit(d.organization_id,d.owner_user_id,d.id,'owner_paused',gen_random_uuid());continue;end if;
 coalesced:=0;slot:=public.m14_04_next_occurrence(d.config->'schedule',greatest(d.next_due_at-interval '1 microsecond',cutoff));
 if slot>clock_timestamp() then update public.report_definitions set next_due_at=slot where organization_id=d.organization_id and id=d.id;perform public.m14_04_audit(d.organization_id,d.owner_user_id,d.id,'window_skipped',gen_random_uuid(),jsonb_build_object('previousNextDueAt',d.next_due_at,'catchUpCutoff',cutoff,'nextDueAt',slot));continue;end if;
 loop next_slot:=public.m14_04_next_occurrence(d.config->'schedule',slot);exit when next_slot>clock_timestamp();slot:=next_slot;coalesced:=coalesced+1;end loop;
 update public.report_definitions set next_due_at=next_slot where organization_id=d.organization_id and id=d.id;
 if exists(select 1 from public.report_runs where organization_id=d.organization_id and definition_id=d.id and state in ('scheduled','running')) then perform public.m14_04_audit(d.organization_id,d.owner_user_id,d.id,'busy_occurrence_skipped',gen_random_uuid(),jsonb_build_object('scheduledFor',slot,'coalescedWithinWindow',coalesced,'catchUpCutoff',cutoff));continue;end if;
 insert into public.report_runs(organization_id,definition_id,definition_version,owner_user_id,kind,config,config_digest,schema_version,source_schema_digest,scheduled_for,occurrence_key)
 values(d.organization_id,d.id,d.definition_version,d.owner_user_id,'scheduled',d.config,d.config_digest,d.schema_version,d.source_schema_digest,slot,'scheduled:'||d.definition_version||':'||to_char(slot at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US')) on conflict(organization_id,definition_id,occurrence_key) do nothing returning * into r;
 if not found then continue;end if;
 for u in select jsonb_array_elements_text(d.config->'recipientUserIds') loop
 insert into public.report_run_recipients(organization_id,run_id,user_id,generation_state,email_state,safe_error_code)
 values(d.organization_id,r.id,u::uuid,case when public.m14_04_source_access(d.organization_id,u::uuid,d.config) then 'waiting' else 'skipped' end,case when (d.config->>'emailEnabled')::boolean then 'pending' else 'off' end,case when public.m14_04_source_access(d.organization_id,u::uuid,d.config) then null else 'recipient_access_lost' end) returning * into recipient_row;
 if recipient_row.generation_state='skipped' then perform public.m14_04_audit(d.organization_id,d.owner_user_id,recipient_row.id,'recipient_skipped',recipient_row.id,jsonb_build_object('code','recipient_access_lost'));end if;
 end loop;
 perform public.m14_04_finish_run(d.organization_id,r.id);
 perform public.m14_04_audit(d.organization_id,d.owner_user_id,r.id,'scheduled',r.id,jsonb_build_object('definitionVersion',d.definition_version,'previousNextDueAt',d.next_due_at,'catchUpCutoff',cutoff,'coalescedWithinWindow',coalesced,'skippedBeforeCutoff',d.next_due_at<cutoff,'scheduledFor',slot));n:=n+1;
 end loop;return n;end $$;
create function public.m14_04_claim_recipient(p_worker_id text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.report_run_recipients;r public.report_runs;begin
 if p_worker_id is null or length(p_worker_id) not between 1 and 200 then raise exception 'invalid_worker' using errcode='22023';end if;
 select x.* into q from public.report_run_recipients x join public.report_runs parent_run on parent_run.organization_id=x.organization_id and parent_run.id=x.run_id where parent_run.state in ('scheduled','running') and (x.generation_state='waiting' or (x.generation_state='running' and x.lease_expires_at<=clock_timestamp())) order by x.created_at,x.id for update of x skip locked limit 1;
 if not found then return null;end if;
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
create function public.m14_04_worker_recipient(p_organization_id uuid,p_recipient_id uuid,p_worker_id text,p_expected_version integer) returns public.report_run_recipients language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.report_run_recipients;begin
 select * into q from public.report_run_recipients where organization_id=p_organization_id and id=p_recipient_id for update;
 if not found or q.worker_id is distinct from p_worker_id or q.version is distinct from p_expected_version or q.lease_expires_at<=clock_timestamp() or q.generation_state<>'running' then raise exception 'report_worker_conflict' using errcode='40001';end if;
 return q;end $$;
create function public.m14_04_heartbeat_recipient(p_organization_id uuid,p_recipient_id uuid,p_worker_id text,p_expected_version integer) returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 perform public.m14_04_worker_recipient(p_organization_id,p_recipient_id,p_worker_id,p_expected_version);
 if not public.m14_04_authorize_recipient(p_organization_id,p_recipient_id) then raise exception 'report_access_changed' using errcode='42501';end if;
 update public.report_run_recipients set lease_expires_at=clock_timestamp()+interval '120 seconds' where organization_id=p_organization_id and id=p_recipient_id;return true;end $$;
create function public.m14_04_admit_export(p_organization_id uuid,p_recipient_id uuid,p_worker_id text,p_expected_version integer,p_context jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.report_run_recipients;r public.report_runs;j public.export_jobs;rep jsonb;src text;ctx jsonb;filters jsonb;begin
 q:=public.m14_04_worker_recipient(p_organization_id,p_recipient_id,p_worker_id,p_expected_version);
 if not public.m14_04_authorize_recipient(p_organization_id,p_recipient_id) then raise exception 'report_access_changed' using errcode='42501';end if;
 select * into r from public.report_runs where organization_id=p_organization_id and id=q.run_id;rep:=r.config->'report';
 if p_context->>'_sourceSchemaDigest' is distinct from r.source_schema_digest then
 update public.report_definitions set state='paused',pause_reason='schema_changed',next_due_at=null,version=version+1 where organization_id=p_organization_id and id=r.definition_id;
 update public.report_run_recipients set generation_state='failed',safe_error_code='schema_changed',worker_id=null,lease_expires_at=null,version=version+1 where organization_id=p_organization_id and id=q.id;
 perform public.m14_04_audit(p_organization_id,r.owner_user_id,r.definition_id,'schema_paused',gen_random_uuid());perform public.m14_04_finish_run(p_organization_id,r.id);return null;end if;
 if q.export_job_id is not null then select * into j from public.export_jobs where organization_id=p_organization_id and id=q.export_job_id;return public.m14_03_private_job_json(j);end if;
 perform 1 from public.organizations where id=p_organization_id for update;
 if (select count(*) from public.export_jobs where organization_id=p_organization_id and subject_kind='scheduled' and state in ('queued','capturing','audit_pending','rendering'))>=2 then return null;end if;
 src:=case when rep->>'kind'='readiness' then 'technical_files.readiness_report' else rep->>'source' end;
 ctx:=(case when rep->>'kind'='readiness' then jsonb_build_object('productId',rep->>'productId') else rep->'context' end)||(coalesce(p_context,'{}')-array['_sourceSchemaDigest','_resolvedFilters']);filters:=coalesce(p_context->'_resolvedFilters',rep->'filters','{}');
 if jsonb_typeof(filters)<>'object' or octet_length(filters::text)>32768 then raise exception 'invalid_report_filters' using errcode='22023';end if;
 insert into public.export_jobs(organization_id,subject_kind,requester_id,report_recipient_id,source,format,scope,filters,context,columns,idempotency_key,request_digest,permission_version)
 values(p_organization_id,'scheduled',q.user_id,q.id,src,case when rep->>'kind'='readiness' then 'report' else rep->>'format' end,'all_filtered',filters,ctx,coalesce(rep->'columns',public.m14_03_source_policy(src)->'columns'),q.id,public.m14_04_digest(jsonb_build_object('config',r.config,'context',ctx,'recipientId',q.id)),coalesce((select version from public.organization_permissions_version where organization_id=p_organization_id),0)) returning * into j;
 update public.report_run_recipients set export_job_id=j.id where organization_id=p_organization_id and id=q.id;
 perform public.m14_04_audit(p_organization_id,r.owner_user_id,q.id,'export_admitted',j.id);return public.m14_03_private_job_json(j);end $$;
-- Dispatch inside the existing engine preserves interactive implementations.
do $$ declare def text;begin
 def:=pg_get_functiondef('public.m14_03_audit(public.export_jobs,text,uuid)'::regprocedure);
 def:=replace(def,E'begin\n',E'begin\n if p_job.subject_kind=''scheduled'' then perform public.m14_04_audit(p_job.organization_id,p_job.requester_id,p_job.report_recipient_id,''export_''||p_action,p_request_id,jsonb_build_object(''jobId'',p_job.id,''state'',p_job.state,''version'',p_job.version));return;end if;\n');execute def;
 def:=pg_get_functiondef('public.m14_03_job_access(public.export_jobs)'::regprocedure);
 def:=replace(def,E'begin\n',E'begin\n if p_job.subject_kind=''scheduled'' then if p_job.state=''ready'' then return public.m14_04_authorize_history(p_job.organization_id,p_job.report_recipient_id);end if;return public.m14_04_authorize_recipient(p_job.organization_id,p_job.report_recipient_id);end if;\n');execute def;
 def:=pg_get_functiondef('public.m14_03_snapshot_access(public.export_jobs)'::regprocedure);
 def:=replace(def,E'begin\n',E'begin\n if p_job.subject_kind=''scheduled'' then return public.m14_04_scheduled_snapshot_access(p_job);end if;\n');execute def;
 def:=pg_get_functiondef('public.m14_03_capture_export(uuid,uuid,text,integer)'::regprocedure);
 if position('public.m14_03_source_rows(p_organization_id,v_job.requester_id,v_job.source,v_job.filters,v_job.context||jsonb_build_object(' in def)=0 then raise exception 'report_capture_baseline_changed';end if;
 def:=replace(def,'state=''audit_pending'',row_count=v_count','state=''audit_pending'',permission_version=case when subject_kind=''scheduled'' then coalesce((select version from public.organization_permissions_version where organization_id=p_organization_id),0) else permission_version end,row_count=v_count');
 def:=replace(def,'public.m14_03_source_rows(p_organization_id,v_job.requester_id,v_job.source,v_job.filters,v_job.context||jsonb_build_object(''','public.m14_04_dispatch_source_rows(v_job,p_organization_id,v_job.requester_id,v_job.source,v_job.filters,v_job.context||jsonb_build_object(''');execute def;
 -- Both manual claimant branches and per-tenant running quota exclude scheduled.
 def:=pg_get_functiondef('public.m14_03_claim_export(text)'::regprocedure);
 if position('where j.attempts<3' in def)=0 or position('where j.state in' in def)=0 then raise exception 'report_claim_baseline_changed';end if;
 def:=replace(def,'where j.state in','where j.subject_kind<>''scheduled'' and j.state in');
 def:=replace(def,'where j.attempts<3','where j.subject_kind<>''scheduled'' and j.attempts<3');
 execute def;
 def:=pg_get_functiondef('public.m14_03_create_export(uuid,uuid,uuid,jsonb)'::regprocedure);
 def:=replace(def,'where organization_id=p_organization_id and requester_id=p_actor_user_id and state in','where organization_id=p_organization_id and subject_kind<>''scheduled'' and requester_id=p_actor_user_id and state in');
 def:=replace(def,'where organization_id=p_organization_id and state in','where organization_id=p_organization_id and subject_kind<>''scheduled'' and state in');execute def;
 def:=pg_get_functiondef('public.m14_03_retry_export(uuid,uuid,uuid,uuid,integer,uuid)'::regprocedure);
 def:=replace(def,'where organization_id=p_organization_id and requester_id=p_actor_user_id and state in','where organization_id=p_organization_id and subject_kind<>''scheduled'' and requester_id=p_actor_user_id and state in');
 def:=replace(def,'where organization_id=p_organization_id and state in','where organization_id=p_organization_id and subject_kind<>''scheduled'' and state in');execute def;
end $$;
create function public.m14_04_scheduled_snapshot_access(p_job public.export_jobs) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r public.report_runs;q public.report_run_recipients;begin
 if p_job.state='ready' then
 if not public.m14_04_authorize_history(p_job.organization_id,p_job.report_recipient_id) then return false;end if;
 elsif not public.m14_04_authorize_recipient(p_job.organization_id,p_job.report_recipient_id) then return false;end if;
 select * into q from public.report_run_recipients where organization_id=p_job.organization_id and id=p_job.report_recipient_id;
 select * into r from public.report_runs where organization_id=p_job.organization_id and id=q.run_id;
 if p_job.row_count is null then return true;end if;
 return public.m14_04_source_snapshot_access(p_job,r.owner_user_id,q.user_id);end $$;
create function public.m14_04_authorize_recipient(p_organization_id uuid,p_actor_user_id uuid,p_run_id uuid,p_recipient_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.report_run_recipients where organization_id=p_organization_id and id=p_recipient_id and run_id=p_run_id and user_id=p_actor_user_id and generation_state='ready' and manifest is not null) and public.m14_04_authorize_history(p_organization_id,p_recipient_id) and exists(select 1 from public.export_jobs j join public.report_run_recipients q on q.organization_id=j.organization_id and q.export_job_id=j.id where q.organization_id=p_organization_id and q.id=p_recipient_id and j.state='ready' and j.expires_at>clock_timestamp() and public.m14_04_scheduled_snapshot_access(j)) $$;
create function public.m14_04_dispatch_source_rows(p_job public.export_jobs,p_organization_id uuid,p_actor_user_id uuid,p_source text,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare owner_id uuid;begin
 if p_job.subject_kind<>'scheduled' then return query select * from public.m14_03_source_rows(p_organization_id,p_actor_user_id,p_source,p_filters,p_context);return;end if;
 select r.owner_user_id into owner_id from public.report_run_recipients q join public.report_runs r on r.organization_id=q.organization_id and r.id=q.run_id where q.organization_id=p_organization_id and q.id=p_job.report_recipient_id;
 return query select * from public.m14_04_source_rows(p_organization_id,owner_id,p_actor_user_id,p_source,p_filters,p_context);end $$;
create function public.m14_04_claim_export(p_worker_id text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.export_jobs;begin
 if p_worker_id is null or length(p_worker_id) not between 1 and 200 then raise exception 'invalid_worker' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('m14-03-export-scheduler',0));
 select * into j from public.export_jobs where subject_kind='scheduled' and state in ('queued','capturing','audit_pending','rendering') and (expires_at<=clock_timestamp() or (attempts>=3 and lease_expires_at<=clock_timestamp())) order by updated_at,id for update skip locked limit 1;
 if found then update public.export_jobs set state='failed',failure_code=case when expires_at<=clock_timestamp() then 'expired' else 'attempts_exhausted' end,worker_id=null,lease_expires_at=null,version=version+1 where organization_id=j.organization_id and id=j.id returning * into j;perform public.m14_03_audit(j,'failed',gen_random_uuid());end if;
 -- Manual work has priority within its tenant; other organizations remain
 -- independently runnable. The shared short claim lock prevents slot races.
 select x.* into j from public.export_jobs x where x.subject_kind='scheduled' and x.attempts<3 and x.expires_at>clock_timestamp() and (x.state='queued' or (x.state in ('capturing','audit_pending','rendering') and x.lease_expires_at<=clock_timestamp()))
 and not exists(select 1 from public.export_jobs m where m.organization_id=x.organization_id and m.subject_kind<>'scheduled' and m.state='queued' and m.attempts<3 and m.expires_at>clock_timestamp())
 and not exists(select 1 from public.export_jobs a where a.organization_id=x.organization_id and a.id<>x.id and a.state in ('capturing','audit_pending','rendering') and a.lease_expires_at>clock_timestamp()) order by (select max(a.updated_at) from public.export_jobs a where a.organization_id=x.organization_id and a.attempts>0) nulls first,x.requested_at,x.id for update of x skip locked limit 1;
 if not found then return null;end if;
 if not public.m14_03_snapshot_access(j) then update public.export_jobs set state='failed',failure_code='access_changed',worker_id=null,lease_expires_at=null,version=version+1 where organization_id=j.organization_id and id=j.id;return null;end if;
 update public.export_jobs set state=case when row_count is null then 'capturing' when pending_audit_id is not null then 'audit_pending' else 'rendering' end,worker_id=p_worker_id,lease_expires_at=clock_timestamp()+interval '120 seconds',attempts=attempts+1,version=version+1 where organization_id=j.organization_id and id=j.id returning * into j;
 return public.m14_03_private_job_json(j);end $$;
create function public.m14_04_publish_recipient(p_organization_id uuid,p_recipient_id uuid,p_worker_id text,p_expected_version integer,p_manifest jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.report_run_recipients;r public.report_runs;j public.export_jobs;m jsonb;pv text;begin
 q:=public.m14_04_worker_recipient(p_organization_id,p_recipient_id,p_worker_id,p_expected_version);
 if not public.m14_04_authorize_recipient(p_organization_id,p_recipient_id) then raise exception 'report_access_changed' using errcode='42501';end if;
 select * into r from public.report_runs where organization_id=p_organization_id and id=q.run_id;
 select * into j from public.export_jobs where organization_id=p_organization_id and id=q.export_job_id;
 if j.id is null or j.state in ('queued','capturing','audit_pending','rendering') then return null;end if;
 if j.state<>'ready' or j.manifest is null then return public.m14_04_fail_recipient(p_organization_id,p_recipient_id,p_worker_id,p_expected_version,coalesce(j.failure_code,'export_unavailable'));end if;
 if not public.m14_03_snapshot_access(j) then raise exception 'report_access_changed' using errcode='42501';end if;
 select coalesce(version,0)::text into pv from public.organization_permissions_version where organization_id=p_organization_id;
 m:=jsonb_build_object('schemaVersion','m14_04_v1','definitionId',r.definition_id,'definitionVersion',r.definition_version,'configDigest',r.config_digest,'runId',r.id,'recipientId',q.id,'occurrenceKey',r.occurrence_key,'scheduledFor',r.scheduled_for,'asOf',j.snapshot_as_of,'sourceContextDigest',public.m14_04_digest(j.context),'ownerPermissionVersion',coalesce(pv,'0'),'recipientPermissionVersion',coalesce(pv,'0'),'scopeDigest',public.m14_04_digest(jsonb_build_object('owner',r.owner_user_id,'recipient',q.user_id,'source',j.source,'permissionVersion',coalesce(pv,'0'))),'exportManifest',j.manifest);
 if p_manifest is null or (p_manifest<>'{}'::jsonb and p_manifest<>m) then raise exception 'report_manifest_mismatch' using errcode='22023';end if;
 update public.report_run_recipients set manifest=m,generation_state='ready',expires_at=j.expires_at,worker_id=null,lease_expires_at=null,version=version+1 where organization_id=p_organization_id and id=q.id;
 perform public.m14_04_audit(p_organization_id,r.owner_user_id,q.id,'published',q.id,jsonb_build_object('manifestDigest',public.m14_04_digest(m)));
 if r.kind='scheduled' then perform public.m14_04_enqueue_notice(p_organization_id,p_recipient_id);end if;
 perform public.m14_04_finish_run(p_organization_id,r.id);return jsonb_build_object('outcome','ready');end $$;
create function public.m14_04_fail_recipient(p_organization_id uuid,p_recipient_id uuid,p_worker_id text,p_expected_version integer,p_code text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.report_run_recipients;r public.report_runs;begin
 q:=public.m14_04_worker_recipient(p_organization_id,p_recipient_id,p_worker_id,p_expected_version);
 if p_code is null or p_code!~'^[a-z][a-z0-9_]{0,79}$' then raise exception 'invalid_report_failure' using errcode='22023';end if;
 select * into r from public.report_runs where organization_id=p_organization_id and id=q.run_id;
 update public.report_run_recipients set generation_state=case when p_code in ('access_changed','owner_access_lost','recipient_access_lost') then 'revoked' else 'failed' end,safe_error_code=p_code,worker_id=null,lease_expires_at=null,version=version+1 where organization_id=p_organization_id and id=q.id;
 perform public.m14_04_audit(p_organization_id,r.owner_user_id,q.id,'failed',gen_random_uuid(),jsonb_build_object('code',p_code));perform public.m14_04_finish_run(p_organization_id,r.id);return jsonb_build_object('outcome','failed');end $$;
do $$ declare f record;begin for f in select oid::regprocedure as sig from pg_proc where pronamespace='public'::regnamespace and proname like 'm14_04_%' loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);end loop;end $$;
notify pgrst,'reload schema';
