create function public.m14_04_owned(p_organization_id uuid,p_actor_user_id uuid,p_definition_id uuid) returns public.report_definitions language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.report_definitions;begin
 select * into d from public.report_definitions where organization_id=p_organization_id and id=p_definition_id and owner_user_id=p_actor_user_id for update;
 if not found or not public.m14_04_member(p_organization_id,p_actor_user_id) then raise exception 'report_access_denied' using errcode='42501';end if;return d;end $$;
create function public.m14_04_create_definition(p_organization_id uuid,p_actor_user_id uuid,p_input jsonb,p_schema_digest text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.report_definitions;c jsonb:=p_input->'config';k uuid:=(p_input->>'idempotencyKey')::uuid;begin
 perform public.m14_04_validate_config(p_organization_id,p_actor_user_id,c);
 if k is null then raise exception 'invalid_idempotency_key' using errcode='22023';end if;
 perform 1 from public.organizations where id=p_organization_id for update;
 select * into d from public.report_definitions where organization_id=p_organization_id and owner_user_id=p_actor_user_id and create_key=k;
 if found then if d.commands->k::text->>'digest' is distinct from public.m14_04_digest(p_input) then raise exception 'report_idempotency_conflict' using errcode='40001';end if;return d.commands->k::text->'response';end if;
 if (select count(*) from public.report_definitions where organization_id=p_organization_id and state<>'archived')>=100 then raise exception 'report_definition_limit' using errcode='22023';end if;
 insert into public.report_definitions(organization_id,owner_user_id,config,config_digest,source_schema_digest,create_key) values(p_organization_id,p_actor_user_id,c,public.m14_04_digest(c),coalesce(p_schema_digest,public.m14_04_digest(public.m14_03_source_policy(case when c->'report'->>'kind'='readiness' then 'technical_files.readiness_report' else c->'report'->>'source' end))),k) returning * into d;
 update public.report_definitions set commands=jsonb_build_object(k::text,jsonb_build_object('digest',public.m14_04_digest(p_input),'response',jsonb_build_object('data',public.m14_04_definition_json(d)))) where organization_id=p_organization_id and id=d.id;
 perform public.m14_04_audit(p_organization_id,p_actor_user_id,d.id,'created',k,jsonb_build_object('version',d.version));
 return jsonb_build_object('data',public.m14_04_definition_json(d));end $$;
create function public.m14_04_get_definition(p_organization_id uuid,p_actor_user_id uuid,p_definition_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin return jsonb_build_object('data',public.m14_04_definition_json(public.m14_04_owned(p_organization_id,p_actor_user_id,p_definition_id)));end $$;
create function public.m14_04_update_definition(p_organization_id uuid,p_actor_user_id uuid,p_definition_id uuid,p_input jsonb,p_schema_digest text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.report_definitions;c jsonb:=p_input->'config';k text:=p_input->>'idempotencyKey';response jsonb;begin
 d:=public.m14_04_owned(p_organization_id,p_actor_user_id,p_definition_id);
 if k is null then raise exception 'invalid_idempotency_key' using errcode='22023';end if;perform k::uuid;
 if (select count(*) from jsonb_object_keys(d.commands))>=1000 and not(d.commands ? k) then raise exception 'report_command_limit' using errcode='22023';end if;
 if d.commands ? k then if d.commands->k->>'digest'<>public.m14_04_digest(p_input) then raise exception 'report_idempotency_conflict' using errcode='40001';end if;return d.commands->k->'response';end if;
 if (d.version is distinct from (p_input->>'expectedVersion')::integer) or d.state='archived' then raise exception 'report_version_conflict' using errcode='40001';end if;
 perform public.m14_04_validate_config(p_organization_id,p_actor_user_id,c);
 update public.report_definitions set config=c,config_digest=public.m14_04_digest(c),source_schema_digest=coalesce(p_schema_digest,public.m14_04_digest(public.m14_03_source_policy(case when c->'report'->>'kind'='readiness' then 'technical_files.readiness_report' else c->'report'->>'source' end))),definition_version=definition_version+1,version=version+1,state='draft',next_due_at=null,preview_run_id=null,pause_reason=null,updated_at=clock_timestamp() where organization_id=p_organization_id and id=p_definition_id returning * into d;
 -- Removing a recipient invalidates all existing artifacts, permanently.
 update public.report_run_recipients q set generation_state='revoked',email_state=case when q.email_state in ('accepted','uncertain') then q.email_state else 'skipped' end,worker_id=null,lease_expires_at=null,version=q.version+1,safe_error_code='recipient_removed'
 from public.report_runs r where r.organization_id=p_organization_id and r.definition_id=p_definition_id and q.organization_id=r.organization_id and q.run_id=r.id and q.generation_state<>'revoked' and not(c->'recipientUserIds' ? q.user_id::text) and r.kind='scheduled';
 response:=jsonb_build_object('data',public.m14_04_definition_json(d));
 update public.report_definitions set commands=commands||jsonb_build_object(k,jsonb_build_object('digest',public.m14_04_digest(p_input),'response',response)) where organization_id=p_organization_id and id=p_definition_id;
 perform public.m14_04_audit(p_organization_id,p_actor_user_id,d.id,'updated',k::uuid,jsonb_build_object('version',d.version));return response;end $$;
create function public.m14_04_list_definitions(p_organization_id uuid,p_actor_user_id uuid,p_query jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare items jsonb;lim int:=coalesce((p_query->>'limit')::int,25);begin
 if not public.m14_04_member(p_organization_id,p_actor_user_id) then raise exception 'report_access_denied' using errcode='42501';end if;
 if lim not between 1 and 50 then raise exception 'invalid_report_limit' using errcode='22023';end if;
 select coalesce(jsonb_agg(public.m14_04_definition_json(d) order by d.id),'[]') into items from (select * from public.report_definitions where organization_id=p_organization_id and owner_user_id=p_actor_user_id and (p_query->>'cursor' is null or id>(p_query->>'cursor')::uuid) order by id limit lim) d;
 return jsonb_build_object('items',items,'nextCursor',case when jsonb_array_length(items)=lim then items->-1->>'id' else null end);end $$;
create function public.m14_04_recipients(p_organization_id uuid,p_actor_user_id uuid,p_query jsonb default '{}') returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare items jsonb;lim int:=coalesce((p_query->>'limit')::int,25);begin
 if not public.m14_04_member(p_organization_id,p_actor_user_id) then raise exception 'report_access_denied' using errcode='42501';end if;
 if lim not between 1 and 50 then raise exception 'invalid_report_limit' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',member_row.id,'displayName',coalesce(nullif(btrim(concat_ws(' ',member_row.first_name,member_row.last_name)),''),member_row.username,'Member')) order by member_row.id),'[]') into items
 from (select u.id,u.first_name,u.last_name,u.username from public.organization_members m join public.users u on u.id=m.user_id where m.organization_id=p_organization_id and public.m14_04_member(p_organization_id,u.id) and (p_query->>'cursor' is null or u.id>(p_query->>'cursor')::uuid) order by u.id limit lim) member_row;
 return jsonb_build_object('items',items,'nextCursor',case when jsonb_array_length(items)=lim then items->-1->>'id' else null end);end $$;
create function public.m14_04_get_run(p_organization_id uuid,p_actor_user_id uuid,p_run_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.report_runs;items jsonb;begin
 select * into r from public.report_runs where organization_id=p_organization_id and id=p_run_id;
 if not found or not public.m14_04_member(p_organization_id,p_actor_user_id) or (r.owner_user_id<>p_actor_user_id and not exists(select 1 from public.report_run_recipients where organization_id=p_organization_id and run_id=p_run_id and user_id=p_actor_user_id)) then raise exception 'report_access_denied' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'userId',q.user_id,'generationState',q.generation_state,'emailState',q.email_state,'safeErrorCode',q.safe_error_code,'expiresAt',q.expires_at,
 'artifacts',case when q.user_id=p_actor_user_id and q.generation_state='ready' and public.m14_04_authorize_recipient(p_organization_id,p_actor_user_id,p_run_id,q.id) then coalesce(public.m14_03_job_json(j)->'artifacts','[]') else '[]'::jsonb end) order by q.id),'[]') into items
 from public.report_run_recipients q left join public.export_jobs j on j.organization_id=q.organization_id and j.id=q.export_job_id where q.organization_id=p_organization_id and q.run_id=p_run_id and (r.owner_user_id=p_actor_user_id or q.user_id=p_actor_user_id);
 return jsonb_build_object('run',public.m14_04_run_json(r),'recipients',items);end $$;
create function public.m14_04_list_runs(p_organization_id uuid,p_actor_user_id uuid,p_query jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare items jsonb;lim int:=coalesce((p_query->>'limit')::int,25);begin
 if not public.m14_04_member(p_organization_id,p_actor_user_id) then raise exception 'report_access_denied' using errcode='42501';end if;
 if lim not between 1 and 50 then raise exception 'invalid_report_limit' using errcode='22023';end if;
 select coalesce(jsonb_agg(public.m14_04_run_json(r) order by r.id),'[]') into items from (select r.* from public.report_runs r where r.organization_id=p_organization_id and (r.owner_user_id=p_actor_user_id or exists(select 1 from public.report_run_recipients q where q.organization_id=r.organization_id and q.run_id=r.id and q.user_id=p_actor_user_id)) and (p_query->>'definitionId' is null or r.definition_id=(p_query->>'definitionId')::uuid) and (p_query->>'cursor' is null or r.id>(p_query->>'cursor')::uuid) order by r.id limit lim) r;
 return jsonb_build_object('items',items,'nextCursor',case when jsonb_array_length(items)=lim then items->-1->>'id' else null end);end $$;
create function public.m14_04_preview(p_organization_id uuid,p_actor_user_id uuid,p_definition_id uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.report_definitions;r public.report_runs;k uuid:=(p_input->>'idempotencyKey')::uuid;dig text:=public.m14_04_digest(p_input||jsonb_build_object('operation','preview'));response jsonb;begin
 d:=public.m14_04_owned(p_organization_id,p_actor_user_id,p_definition_id);
 if d.commands ? k::text then if d.commands->k::text->>'digest'<>dig then raise exception 'report_idempotency_conflict' using errcode='40001';end if;return d.commands->k::text->'response';end if;
 if (select count(*) from jsonb_object_keys(d.commands))>=1000 then raise exception 'report_command_limit' using errcode='22023';end if;
 if (d.version is distinct from (p_input->>'expectedVersion')::integer) or d.state='archived' or k is null then raise exception 'report_version_conflict' using errcode='40001';end if;
 perform public.m14_04_validate_config(p_organization_id,p_actor_user_id,d.config);
 if exists(select 1 from public.report_runs where organization_id=p_organization_id and definition_id=p_definition_id and state in ('scheduled','running')) then raise exception 'report_run_in_progress' using errcode='40001';end if;
 insert into public.report_runs(organization_id,definition_id,definition_version,owner_user_id,kind,config,config_digest,schema_version,source_schema_digest,scheduled_for,occurrence_key) values(p_organization_id,d.id,d.definition_version,d.owner_user_id,'preview',d.config,d.config_digest,d.schema_version,d.source_schema_digest,clock_timestamp(),'preview:'||k) returning * into r;
 insert into public.report_run_recipients(organization_id,run_id,user_id,email_state) values(p_organization_id,r.id,p_actor_user_id,'off');
 update public.report_definitions set preview_run_id=r.id,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=d.id;
 perform public.m14_04_audit(p_organization_id,p_actor_user_id,r.id,'preview_requested',k);
 response:=public.m14_04_get_run(p_organization_id,p_actor_user_id,r.id);
 update public.report_definitions set commands=commands||jsonb_build_object(k::text,jsonb_build_object('digest',dig,'response',response)) where organization_id=p_organization_id and id=d.id;return response;end $$;
create function public.m14_04_mutate_definition(p_organization_id uuid,p_actor_user_id uuid,p_definition_id uuid,p_operation text,p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.report_definitions;k text:=p_input->>'idempotencyKey';u text;response jsonb;dig text:=public.m14_04_digest(p_input||jsonb_build_object('operation',p_operation));begin
 d:=public.m14_04_owned(p_organization_id,p_actor_user_id,p_definition_id);
 if k is null then raise exception 'invalid_idempotency_key' using errcode='22023';end if;perform k::uuid;
 if (select count(*) from jsonb_object_keys(d.commands))>=1000 and not(d.commands ? k) then raise exception 'report_command_limit' using errcode='22023';end if;
 if d.commands ? k then if d.commands->k->>'digest'<>dig then raise exception 'report_idempotency_conflict' using errcode='40001';end if;return d.commands->k->'response';end if;
 if (d.version is distinct from (p_input->>'expectedVersion')::int) or d.state='archived' then raise exception 'report_version_conflict' using errcode='40001';end if;
 if p_operation in ('activate','resume') then
 perform public.m14_04_validate_config(p_organization_id,p_actor_user_id,d.config);
 if not exists(select 1 from public.report_runs r where r.organization_id=p_organization_id and r.id=d.preview_run_id and r.id=coalesce((p_input->>'previewRunId')::uuid,d.preview_run_id) and r.definition_id=d.id and r.definition_version=d.definition_version and r.config_digest=d.config_digest and r.kind='preview' and r.state='succeeded' and r.finished_at>clock_timestamp()-interval '24 hours') then raise exception 'report_fresh_preview_required' using errcode='40001';end if;
 for u in select jsonb_array_elements_text(d.config->'recipientUserIds') loop if not public.m14_04_source_access(p_organization_id,u::uuid,d.config) then raise exception 'report_recipient_ineligible' using errcode='42501';end if;end loop;
 update public.report_definitions set state='active',next_due_at=public.m14_04_next_occurrence(config->'schedule',clock_timestamp()),pause_reason=null,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=d.id returning * into d;
 elsif p_operation in ('pause','archive') then
 update public.report_definitions set state=case when p_operation='archive' then 'archived' else 'paused' end,next_due_at=null,pause_reason=case when p_operation='pause' then 'user_paused' else null end,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=d.id returning * into d;
 else raise exception 'invalid_report_operation' using errcode='22023';end if;
 if p_operation in ('pause','archive') then perform public.m14_04_stop_notices(p_organization_id,d.id);end if;
 response:=jsonb_build_object('data',public.m14_04_definition_json(d));
 update public.report_definitions set commands=commands||jsonb_build_object(k,jsonb_build_object('digest',dig,'response',response)) where organization_id=p_organization_id and id=d.id;
 perform public.m14_04_audit(p_organization_id,p_actor_user_id,d.id,p_operation,k::uuid,jsonb_build_object('version',d.version));return response;end $$;
create function public.m14_04_replay(p_organization_id uuid,p_actor_user_id uuid,p_run_id uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.report_runs;d public.report_definitions;q public.report_run_recipients;j public.export_jobs;k text:=p_input->>'idempotencyKey';dig text:=public.m14_04_digest(p_input||jsonb_build_object('operation','replay','runId',p_run_id));response jsonb;n int:=0;begin
 select * into r from public.report_runs where organization_id=p_organization_id and id=p_run_id for update;
 if not found then raise exception 'report_access_denied' using errcode='42501';end if;
 d:=public.m14_04_owned(p_organization_id,p_actor_user_id,r.definition_id);
 if k is null then raise exception 'invalid_idempotency_key' using errcode='22023';end if;perform k::uuid;
 if d.commands ? k then if d.commands->k->>'digest'<>dig then raise exception 'report_idempotency_conflict' using errcode='40001';end if;return d.commands->k->'response';end if;
 if (select count(*) from jsonb_object_keys(d.commands))>=1000 then raise exception 'report_command_limit' using errcode='22023';end if;
 if (d.version is distinct from (p_input->>'expectedVersion')::int) or d.definition_version<>r.definition_version or r.state<>'failed' or d.state='archived' then raise exception 'report_replay_conflict' using errcode='40001';end if;
 if exists(select 1 from public.report_runs where organization_id=p_organization_id and definition_id=r.definition_id and id<>r.id and state in ('scheduled','running')) then raise exception 'report_run_in_progress' using errcode='40001';end if;
 if exists(select 1 from public.report_run_recipients where organization_id=p_organization_id and run_id=r.id and (email_state in ('accepted','uncertain','queued') or expires_at<=clock_timestamp())) then raise exception 'report_replay_unsafe' using errcode='40001';end if;
 perform 1 from public.organizations where id=p_organization_id for update;
 for q in select * from public.report_run_recipients where organization_id=p_organization_id and run_id=r.id and generation_state='failed' and safe_error_code in ('worker_failure','storage_failure','render_failure','capture_timeout','attempts_exhausted','provider_unavailable','storage_unavailable','generation_failed') for update loop
 if not public.m14_04_authorize_recipient(p_organization_id,q.id) then continue;end if;
 if q.export_job_id is not null then
 select * into j from public.export_jobs where organization_id=p_organization_id and id=q.export_job_id for update;
 if j.state<>'failed' or j.expires_at<=clock_timestamp() or j.manifest is not null or not public.m14_03_snapshot_access(j) then continue;end if;
 if (select count(*) from public.export_jobs where organization_id=p_organization_id and subject_kind='scheduled' and state in ('queued','capturing','audit_pending','rendering'))>=2 then continue;end if;
 update public.export_jobs set state='queued',failure_code=null,attempts=0,worker_id=null,lease_expires_at=null,version=version+1 where organization_id=p_organization_id and id=j.id;
 end if;
 update public.report_run_recipients set generation_state='waiting',safe_error_code=null,worker_id=null,lease_expires_at=null,version=version+1 where organization_id=p_organization_id and id=q.id;n:=n+1;
 end loop;
 if n=0 then raise exception 'report_replay_unsafe' using errcode='40001';end if;
 update public.report_runs set state='scheduled',finished_at=null,safe_error_code=null where organization_id=p_organization_id and id=r.id;
 perform public.m14_04_audit(p_organization_id,p_actor_user_id,r.id,'replayed',k::uuid);
 response:=public.m14_04_get_run(p_organization_id,p_actor_user_id,r.id);
 update public.report_definitions set commands=commands||jsonb_build_object(k,jsonb_build_object('digest',dig,'response',response)) where organization_id=p_organization_id and id=d.id;
 return response;end $$;

create function public.m14_04_stop_notices(p_organization_id uuid,p_definition_id uuid) returns void language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 update public.notification_dispatches d set status='cancelled',lease_owner=null,lease_expires_at=null,safe_error_code='source_unavailable',version=d.version+1
 where d.organization_id=p_organization_id and d.source_type='report_run_recipient' and d.status in ('queued','retrying')
 and exists(select 1 from public.report_run_recipients q join public.report_runs r on r.organization_id=q.organization_id and r.id=q.run_id where q.organization_id=d.organization_id and q.id=d.source_id and r.definition_id=p_definition_id);
 update public.report_run_recipients q set email_state='skipped',version=q.version+1 from public.report_runs r where r.organization_id=p_organization_id and r.definition_id=p_definition_id and q.organization_id=r.organization_id and q.run_id=r.id and q.email_state in ('pending','queued') and not exists(select 1 from public.notification_dispatches d where d.organization_id=q.organization_id and d.source_type='report_run_recipient' and d.source_id=q.id and d.status='leased');
end $$;
create function public.m14_04_list_administration(p_organization_id uuid,p_actor_user_id uuid,p_query jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare items jsonb;lim int:=coalesce((p_query->>'limit')::int,25);begin
 if not public.m14_04_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_actor_user_id and role in ('owner','admin')) then raise exception 'report_access_denied' using errcode='42501';end if;
 if lim not between 1 and 50 then raise exception 'invalid_report_limit' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'ownerUserId',d.owner_user_id,'state',d.state,'version',d.version) order by d.id),'[]') into items from (select * from public.report_definitions where organization_id=p_organization_id and (p_query->>'cursor' is null or id>(p_query->>'cursor')::uuid) order by id limit lim) d;
 return jsonb_build_object('items',items,'nextCursor',case when jsonb_array_length(items)=lim then items->-1->>'id' else null end);end $$;
create function public.m14_04_admin_pause(p_organization_id uuid,p_actor_user_id uuid,p_definition_id uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.report_definitions;k text:=p_input->>'idempotencyKey';digest text:=public.m14_04_digest(p_input||jsonb_build_object('operation','admin_pause','actor',p_actor_user_id));response jsonb;begin
 if not public.m14_04_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_actor_user_id and role in ('owner','admin')) then raise exception 'report_access_denied' using errcode='42501';end if;
 select * into d from public.report_definitions where organization_id=p_organization_id and id=p_definition_id for update;
 if not found then raise exception 'report_access_denied' using errcode='42501';end if;
 if k is null then raise exception 'invalid_idempotency_key' using errcode='22023';end if;perform k::uuid;
 if d.commands ? k then if d.commands->k->>'digest'<>digest then raise exception 'report_idempotency_conflict' using errcode='40001';end if;return d.commands->k->'response';end if;
 if (select count(*) from jsonb_object_keys(d.commands))>=1000 then raise exception 'report_command_limit' using errcode='22023';end if;
 if (d.version is distinct from (p_input->>'expectedVersion')::int) or d.state='archived' then raise exception 'report_version_conflict' using errcode='40001';end if;
 update public.report_definitions set state='paused',pause_reason='administrator_paused',next_due_at=null,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=d.id returning * into d;
 perform public.m14_04_stop_notices(p_organization_id,d.id);
 response:=jsonb_build_object('data',jsonb_build_object('id',d.id,'ownerUserId',d.owner_user_id,'state',d.state,'version',d.version));
 update public.report_definitions set commands=commands||jsonb_build_object(k,jsonb_build_object('digest',digest,'response',response)) where organization_id=p_organization_id and id=d.id;
 perform public.m14_04_audit(p_organization_id,p_actor_user_id,d.id,'administrator_paused',k::uuid);return response;end $$;

do $$ declare f record;begin for f in select oid::regprocedure as sig from pg_proc where pronamespace='public'::regnamespace and proname like 'm14_04_%' loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);end loop;end $$;
