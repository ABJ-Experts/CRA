-- M15-04: source-owned consent, private artifacts, and explicit retention cleanup.
-- Preview is deliberately absent: static application disclosure never reads sources.
create table public.support_diagnostic_jobs (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 creator_user_id uuid not null references public.users(id),
 session_id uuid not null,
 permission_version bigint not null,
 idempotency_key uuid not null,
 preview_digest text not null check(preview_digest ~ '^[a-f0-9]{64}$'),
 selection jsonb not null,
 selection_digest text not null check(selection_digest ~ '^[a-f0-9]{64}$'),
 disclosure_version text not null default 'm15_04_v1' check(disclosure_version='m15_04_v1'),
 consented_at timestamptz not null default clock_timestamp(),
 created_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz,expires_at timestamptz,
 state text not null default 'queued' check(state in ('queued','running','ready','failed','cancelled','expired','deleted')),
 stage text not null default 'queued' check(stage in ('queued','collecting','redacting','packaging','ready','cleanup')),
 version integer not null default 1 check(version>0),
 attempts integer not null default 0 check(attempts between 0 and 3),
 worker_id text,lease_expires_at timestamptz,attempt_started_at timestamptz,
 progress jsonb not null default '{"completed":0,"total":4}',
 omissions jsonb not null default '[]',
 artifact jsonb,manifest jsonb,object_path text,object_paths text[] not null default '{}',
 failure_code text check(failure_code in ('source_unavailable','invalid_value','authority_lost','generation_timeout','attempt_limit','storage_unavailable')),
 grant_id uuid,grant_digest text,grant_session_id uuid,grant_expires_at timestamptz,
 grant_version integer,grant_used_at timestamptz,
 cleanup_state text not null default 'none' check(cleanup_state in ('none','requested','deleting','deleted','blocked')),
 cleanup_review_fingerprint text,cleanup_request_key uuid,cleanup_attempts integer not null default 0 check(cleanup_attempts between 0 and 3),
 cleanup_worker_id text,cleanup_lease_expires_at timestamptz,
 unique(organization_id,creator_user_id,idempotency_key),
 check(jsonb_typeof(selection)='object'),check(jsonb_typeof(omissions)='array'),
 check(grant_digest is null or grant_digest ~ '^[a-f0-9]{64}$'),
 check(artifact is null or (artifact->>'sha256' ~ '^[a-f0-9]{64}$' and (artifact->>'byteSize')::bigint between 1 and 10485760))
);
create unique index m15_04_one_active_tenant on public.support_diagnostic_jobs(organization_id) where state in ('queued','running');
create index m15_04_claim_order on public.support_diagnostic_jobs(created_at,id) where state in ('queued','running');
create index m15_04_creator_list on public.support_diagnostic_jobs(organization_id,creator_user_id,id);
alter table public.support_diagnostic_jobs enable row level security;
revoke all on public.support_diagnostic_jobs from public,anon,authenticated,service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('support-diagnostics','support-diagnostics',false,10485760,array['application/zip'])
 on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['application/zip'];

create function public.m15_04_guard_job() returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
 if tg_op='DELETE' then raise exception 'diagnostic_receipt_immutable' using errcode='42501';end if;
 if (new.id,new.organization_id,new.creator_user_id,new.session_id,new.permission_version,new.idempotency_key,new.preview_digest,new.selection,new.selection_digest,new.disclosure_version,new.consented_at,new.created_at)
 is distinct from (old.id,old.organization_id,old.creator_user_id,old.session_id,old.permission_version,old.idempotency_key,old.preview_digest,old.selection,old.selection_digest,old.disclosure_version,old.consented_at,old.created_at)
 then raise exception 'diagnostic_consent_immutable' using errcode='42501';end if;
 if old.artifact is not null and (new.artifact,new.manifest) is distinct from (old.artifact,old.manifest) then raise exception 'diagnostic_artifact_immutable' using errcode='42501';end if;
 if not old.object_paths <@ new.object_paths then raise exception 'diagnostic_object_receipt_immutable' using errcode='42501';end if;
 return new;
end $$;
create trigger m15_04_guard_job before update or delete on public.support_diagnostic_jobs for each row execute function public.m15_04_guard_job();

create function public.m15_04_can(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid) returns boolean language sql volatile security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active and u.email_verified_at is not null
 join public.organizations o on o.id=m.organization_id and o.is_active
 where m.organization_id=p_organization_id and m.user_id=p_actor_user_id and m.role in ('owner','admin'))
 and public.m15_01_actor_can(p_organization_id,p_actor_user_id,'can_export_system_health')
 and public.m14_04_current_session(p_organization_id,p_actor_user_id,p_session_id)
$$;
create function public.m15_04_authority(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v bigint;begin
 -- Permission writers take this row first; hold the live authority through audit/publication.
 select version into v from public.organization_permissions_version where organization_id=p_organization_id for share;
 perform 1 from public.organization_members where organization_id=p_organization_id and user_id=p_actor_user_id for share;
 perform 1 from public.users where id=p_actor_user_id for share;
 perform 1 from public.organizations where id=p_organization_id for share;
 perform 1 from auth.sessions where id=p_session_id for share;
 if v is null or not public.m15_04_can(p_organization_id,p_actor_user_id,p_session_id) then return jsonb_build_object('outcome','forbidden');end if;
 return jsonb_build_object('outcome','ok','result',jsonb_build_object('organizationId',p_organization_id,'actorUserId',p_actor_user_id,'sessionId',p_session_id,'permissionVersion',v::text));
end $$;
create function public.m15_04_job_json(p_job public.support_diagnostic_jobs) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('id',p_job.id,'organizationId',p_job.organization_id,
 'state',case when p_job.state='ready' and p_job.expires_at<=clock_timestamp() then 'expired' else p_job.state end,
 'stage',p_job.stage,'version',p_job.version,'consentedAt',public.m7_snapshot_timestamp_utc(p_job.consented_at),'createdAt',public.m7_snapshot_timestamp_utc(p_job.created_at),
 'completedAt',public.m7_snapshot_timestamp_utc(p_job.completed_at),'expiresAt',public.m7_snapshot_timestamp_utc(p_job.expires_at),'selection',p_job.selection,
 'progress',p_job.progress,'omissions',p_job.omissions,'artifact',p_job.artifact,'failureCode',p_job.failure_code,
 'cleanup',jsonb_build_object('state',p_job.cleanup_state,'blockers','[]'::jsonb))
$$;
create function public.m15_04_internal(p_job public.support_diagnostic_jobs) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('job',public.m15_04_job_json(p_job),'creatorUserId',p_job.creator_user_id,'sessionId',p_job.session_id,'permissionVersion',p_job.permission_version::text,'objectPath',p_job.object_path,'objectPaths',to_jsonb(p_job.object_paths),'manifest',p_job.manifest)
$$;
-- Structural diagnostic receipt digests are independently validated; arbitrary
-- strings and the application audit redactor keep their established behavior.
do $$ declare d text;anchor text;begin
 d:=pg_get_functiondef('public.m13_01_project_v2_audit_json(jsonb)'::regprocedure);
 anchor:='elsif v_key in (''attemptCount'',''count'',''newVersion'',''oldVersion'',''version'')';
 if position(anchor in d)=0 then raise exception 'M15-04 receipt projection anchor missing';end if;
 execute replace(d,anchor,E'    elsif v_key in (''selectionDigest'',''previewDigest'',''sha256'') and v_text ~ ''^[a-f0-9]{64}$''\n    then v_result:=v_result||jsonb_build_object(v_key,v_value);\n'||anchor);
 d:=pg_get_functiondef('public.m13_03_event_visible_cached(uuid,uuid,public.audit_logs,jsonb)'::regprocedure);
 anchor:='''audit_chain'',''audit_search'',''audit_export''';
 if position(anchor in d)=0 then raise exception 'M15-04 audit source visibility anchor missing';end if;
 execute replace(d,anchor,anchor||',''support_diagnostic''');
end $$;
create function public.m15_04_audit(p_job public.support_diagnostic_jobs,p_action text,p_request_id uuid,p_actor_user_id uuid default null) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare receipt record;begin
 if p_action not in ('consented','cancelled','ready','failed','accessed','grant_issued','downloaded','cleanup_requested','cleanup_deleted','cleanup_failed') or p_request_id is null then raise exception 'invalid_diagnostic_receipt' using errcode='22023';end if;
 select * into receipt from public.m13_01_append_audit_event(p_job.organization_id,'organization','support.diagnostic.'||p_action||':'||p_request_id::text,
 case when p_actor_user_id is null then 'system' else 'user' end,coalesce(p_actor_user_id::text,'support-diagnostics'),
 'support.diagnostic.'||p_action,'support_diagnostic',p_job.id::text,case when p_action in ('failed','cleanup_failed') then 'failed' when p_action='cancelled' then 'cancelled' else 'completed' end,p_request_id,null,
 jsonb_build_object('requestId',p_request_id,'version',p_job.version,'count',p_job.attempts,'sha256',p_job.artifact->>'sha256','selectionDigest',p_job.selection_digest,'previewDigest',p_job.preview_digest,'reasonCode',p_job.disclosure_version),null,null,null,p_actor_user_id);
 if receipt.outcome is null or receipt.outcome not in ('inserted','replayed') then raise exception 'diagnostic_audit_conflict' using errcode='40001';end if;
end $$;
create function public.m15_04_selection_valid(p_selection jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare f timestamptz;t timestamptz;begin
 if p_selection is null or jsonb_typeof(p_selection)<>'object' or not p_selection ?& array['categories','from','to'] or (select count(*) from jsonb_object_keys(p_selection))<>3
 or jsonb_typeof(p_selection->'categories')<>'array' or jsonb_array_length(p_selection->'categories') not between 1 and 3
 or exists(select 1 from jsonb_array_elements_text(p_selection->'categories') c where c not in ('logs','configuration','metrics'))
 or (select count(distinct c) from jsonb_array_elements_text(p_selection->'categories')c)<>jsonb_array_length(p_selection->'categories') then return false;end if;
 f:=(p_selection->>'from')::timestamptz;t:=(p_selection->>'to')::timestamptz;
 return coalesce(isfinite(f) and isfinite(t) and f<t and t-f<=interval '7 days',false);
 exception when others then return false;
end $$;
create function public.m15_04_create(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_preview_digest text,p_selection jsonb,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a jsonb;j public.support_diagnostic_jobs;d text;begin
 a:=public.m15_04_authority(p_organization_id,p_actor_user_id,p_session_id);if a->>'outcome'<>'ok' then return a;end if;
 if p_idempotency_key is null or p_preview_digest is null or p_preview_digest !~ '^[a-f0-9]{64}$' or not public.m15_04_selection_valid(p_selection) or (p_selection->>'to')::timestamptz>clock_timestamp() then return jsonb_build_object('outcome','invalid');end if;
 d:=encode(extensions.digest(public.m15_03_canonical_json(p_selection),'sha256'),'hex');
 perform public.m15_01_lock(p_organization_id);
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and creator_user_id=p_actor_user_id and idempotency_key=p_idempotency_key for update;
 if found then
  if j.preview_digest<>p_preview_digest or j.selection_digest<>d then return jsonb_build_object('outcome','conflict');end if;
  return jsonb_build_object('outcome','ok','result',public.m15_04_job_json(j));
 end if;
 if exists(select 1 from public.support_diagnostic_jobs where organization_id=p_organization_id and state in ('queued','running')) then return jsonb_build_object('outcome','conflict');end if;
 insert into public.support_diagnostic_jobs(organization_id,creator_user_id,session_id,permission_version,idempotency_key,preview_digest,selection,selection_digest)
 values(p_organization_id,p_actor_user_id,p_session_id,(a->'result'->>'permissionVersion')::bigint,p_idempotency_key,p_preview_digest,p_selection,d) returning * into j;
 perform public.m15_04_audit(j,'consented',p_idempotency_key,p_actor_user_id);
 return jsonb_build_object('outcome','ok','result',public.m15_04_job_json(j));
end $$;
create function public.m15_04_get(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_job_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a jsonb;j public.support_diagnostic_jobs;begin
 a:=public.m15_04_authority(p_organization_id,p_actor_user_id,p_session_id);if a->>'outcome'<>'ok' then return a;end if;
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_job_id and creator_user_id=p_actor_user_id;
 if not found then return jsonb_build_object('outcome','not_found');end if;
 return jsonb_build_object('outcome','ok','result',public.m15_04_job_json(j));
end $$;
create function public.m15_04_list(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_after_id uuid default null,p_limit integer default 25) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a jsonb;items jsonb;last_id uuid;begin
 a:=public.m15_04_authority(p_organization_id,p_actor_user_id,p_session_id);if a->>'outcome'<>'ok' then return a;end if;
 if p_limit is null or p_limit not between 1 and 100 then return jsonb_build_object('outcome','invalid');end if;
 select coalesce(jsonb_agg(public.m15_04_job_json(j) order by j.id),'[]'),max(j.id::text)::uuid into items,last_id from
 (select * from public.support_diagnostic_jobs where organization_id=p_organization_id and creator_user_id=p_actor_user_id and (p_after_id is null or id>p_after_id) order by id limit p_limit)j;
 return jsonb_build_object('outcome','ok','result',jsonb_build_object('organizationId',p_organization_id,'items',items,'nextCursor',case when exists(select 1 from public.support_diagnostic_jobs where organization_id=p_organization_id and creator_user_id=p_actor_user_id and id>last_id) then last_id::text end));
end $$;
create function public.m15_04_cancel(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_job_id uuid,p_expected_version integer,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a jsonb;j public.support_diagnostic_jobs;begin
 a:=public.m15_04_authority(p_organization_id,p_actor_user_id,p_session_id);if a->>'outcome'<>'ok' then return a;end if;
 perform public.m15_01_lock(p_organization_id);
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_job_id and creator_user_id=p_actor_user_id for update;
 if not found then return jsonb_build_object('outcome','not_found');end if;
 if exists(select 1 from public.audit_logs where organization_id=p_organization_id and event_key='support.diagnostic.cancelled:'||p_idempotency_key::text and entity_id=j.id::text and actor_id=p_actor_user_id::text) then return jsonb_build_object('outcome','ok','result',public.m15_04_job_json(j));end if;
 if p_idempotency_key is null or j.version<>p_expected_version or j.state not in ('queued','running','ready') then return jsonb_build_object('outcome','conflict');end if;
 update public.support_diagnostic_jobs set state='cancelled',version=version+1,worker_id=null,lease_expires_at=null,grant_digest=null,completed_at=clock_timestamp() where organization_id=p_organization_id and id=p_job_id returning * into j;
 perform public.m15_04_audit(j,'cancelled',p_idempotency_key,p_actor_user_id);
 return jsonb_build_object('outcome','ok','result',public.m15_04_job_json(j));
end $$;

create function public.m15_04_worker_valid(p_job public.support_diagnostic_jobs,p_worker_id text,p_expected_version integer) returns boolean language sql volatile security definer set search_path=pg_catalog,public as $$
 select coalesce(p_job.state='running' and p_job.worker_id=p_worker_id and p_job.version=p_expected_version
 and p_job.lease_expires_at>clock_timestamp() and p_job.attempt_started_at>clock_timestamp()-interval '60 seconds'
 and public.m15_04_can(p_job.organization_id,p_job.creator_user_id,p_job.session_id)
 and exists(select 1 from public.organization_permissions_version where organization_id=p_job.organization_id and version=p_job.permission_version),false)
$$;
create function public.m15_04_claim(p_worker_id text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c record;j public.support_diagnostic_jobs;a jsonb;begin
 if p_worker_id is null or p_worker_id !~ '^[a-zA-Z0-9_-]{1,80}$' then return jsonb_build_object('outcome','invalid');end if;
 -- A tiny global scheduling fence preserves oldest-first fairness across tenants.
 if not pg_try_advisory_xact_lock(hashtextextended('m15_04_scheduler',0)) then return jsonb_build_object('outcome','empty');end if;
 for c in select organization_id,id,creator_user_id,session_id from public.support_diagnostic_jobs where state='queued' or (state='running' and lease_expires_at<=clock_timestamp()) order by created_at,id limit 100 loop
  a:=public.m15_04_authority(c.organization_id,c.creator_user_id,c.session_id);
  perform public.m15_01_lock(c.organization_id);
  select * into j from public.support_diagnostic_jobs where organization_id=c.organization_id and id=c.id for update skip locked;
  if not found or not(j.state='queued' or (j.state='running' and j.lease_expires_at<=clock_timestamp())) then continue;end if;
  if a->>'outcome'<>'ok' or (a->'result'->>'permissionVersion')::bigint<>j.permission_version or j.attempts>=3 then
   update public.support_diagnostic_jobs set state='failed',failure_code=case when attempts>=3 then 'attempt_limit' else 'authority_lost' end,worker_id=null,lease_expires_at=null,completed_at=clock_timestamp(),version=version+1 where organization_id=j.organization_id and id=j.id returning * into j;
   perform public.m15_04_audit(j,'failed',gen_random_uuid());continue;
  end if;
  update public.support_diagnostic_jobs set state='running',stage='collecting',attempts=attempts+1,worker_id=p_worker_id,
   lease_expires_at=clock_timestamp()+interval '60 seconds',attempt_started_at=clock_timestamp(),version=version+1,
   object_path=organization_id::text||'/'||id::text||'/attempt-'||(attempts+1)::text||'/bundle.zip',
   object_paths=object_paths||array[organization_id::text||'/'||id::text||'/attempt-'||(attempts+1)::text||'/bundle.zip']
   where organization_id=j.organization_id and id=j.id returning * into j;
  return jsonb_build_object('outcome','ok','result',public.m15_04_internal(j));
 end loop;
 return jsonb_build_object('outcome','empty');
end $$;
create function public.m15_04_authorize_worker(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.support_diagnostic_jobs;a jsonb;begin
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_job_id;
 if not found then return jsonb_build_object('outcome','not_found');end if;
 a:=public.m15_04_authority(p_organization_id,j.creator_user_id,j.session_id);if a->>'outcome'<>'ok' then return a;end if;
 if not public.m15_04_worker_valid(j,p_worker_id,p_expected_version) then return jsonb_build_object('outcome','conflict');end if;
 return jsonb_build_object('outcome','ok','result',public.m15_04_internal(j));
end $$;
create function public.m15_04_heartbeat(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a jsonb;j public.support_diagnostic_jobs;begin
 a:=public.m15_04_authorize_worker(p_organization_id,p_job_id,p_worker_id,p_expected_version);if a->>'outcome'<>'ok' then return a;end if;
 perform public.m15_01_lock(p_organization_id);
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_job_id for update;
 if not public.m15_04_worker_valid(j,p_worker_id,p_expected_version) then return jsonb_build_object('outcome','conflict');end if;
 update public.support_diagnostic_jobs set lease_expires_at=least(clock_timestamp()+interval '60 seconds',attempt_started_at+interval '60 seconds') where organization_id=p_organization_id and id=p_job_id returning * into j;
 return jsonb_build_object('outcome','ok','result',public.m15_04_internal(j));
end $$;
create function public.m15_04_omissions_valid(p_value jsonb) returns boolean language sql immutable set search_path=pg_catalog,public as $$
 select coalesce(jsonb_typeof(p_value)='array' and jsonb_array_length(p_value)<=32 and not exists(select 1 from jsonb_array_elements(p_value)x where
 jsonb_typeof(x)<>'object' or (select count(*) from jsonb_object_keys(x))<>2 or x->>'category' is null or x->>'code' is null or x->>'category' not in ('logs','configuration','metrics') or x->>'code' not in ('source_unavailable','source_withheld','row_limit','invalid_value') or not x ?& array['category','code']),false)
$$;
create function public.m15_04_checkpoint(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer,p_stage text,p_progress jsonb,p_omissions jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a jsonb;j public.support_diagnostic_jobs;begin
 a:=public.m15_04_authorize_worker(p_organization_id,p_job_id,p_worker_id,p_expected_version);if a->>'outcome'<>'ok' then return a;end if;
 if p_stage is null or p_stage not in ('collecting','redacting','packaging') or not public.m15_04_omissions_valid(p_omissions)
 or p_progress is null or jsonb_typeof(p_progress)<>'object' or not p_progress ?& array['completed','total'] or p_progress->>'completed' is null or p_progress->>'total' is null or (select count(*) from jsonb_object_keys(p_progress))<>2 or p_progress->>'completed' !~ '^[0-9]{1,4}$' or p_progress->>'total' !~ '^[0-9]{1,4}$'
 or (p_progress->>'completed')::int>(p_progress->>'total')::int then return jsonb_build_object('outcome','invalid');end if;
 perform public.m15_01_lock(p_organization_id);
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_job_id for update;
 if not public.m15_04_worker_valid(j,p_worker_id,p_expected_version) then return jsonb_build_object('outcome','conflict');end if;
 update public.support_diagnostic_jobs set stage=p_stage,progress=jsonb_build_object('completed',(p_progress->>'completed')::int,'total',(p_progress->>'total')::int),omissions=p_omissions,version=version+1 where organization_id=p_organization_id and id=p_job_id returning * into j;
 return jsonb_build_object('outcome','ok','result',public.m15_04_internal(j));
end $$;
create function public.m15_04_complete(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer,p_artifact jsonb,p_manifest jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a jsonb;j public.support_diagnostic_jobs;begin
 a:=public.m15_04_authorize_worker(p_organization_id,p_job_id,p_worker_id,p_expected_version);if a->>'outcome'<>'ok' then return a;end if;
 if p_artifact is null or jsonb_typeof(p_artifact)<>'object' or not p_artifact ?& array['sha256','byteSize','fileName']
 or p_artifact->>'sha256' is null or p_artifact->>'byteSize' is null or p_artifact->>'fileName' is null or (select count(*) from jsonb_object_keys(p_artifact))<>3 or p_artifact->>'sha256' !~ '^[a-f0-9]{64}$' or p_artifact->>'byteSize' !~ '^[0-9]{1,8}$'
 or (p_artifact->>'byteSize')::bigint not between 1 and 10485760 or p_artifact->>'fileName'<>'support-diagnostics-'||p_job_id::text||'.zip'
 or p_manifest is null or jsonb_typeof(p_manifest)<>'object' or not p_manifest ?& array['version','jobId','generatedAt','selection','entries','omissions'] or (select count(*) from jsonb_object_keys(p_manifest))<>6 or p_manifest->>'version' is null or p_manifest->>'jobId' is null or p_manifest->>'version'<>'m15_04_v1' or p_manifest->>'jobId'<>p_job_id::text
 or p_manifest->'entries'='null'::jsonb or jsonb_typeof(p_manifest->'entries')<>'array' or jsonb_array_length(p_manifest->'entries') not between 1 and 4
 or not public.m15_04_omissions_valid(p_manifest->'omissions')
 or exists(select 1 from jsonb_array_elements(p_manifest->'entries')e where not e ?& array['name','sha256','byteSize'] or e->>'name' is null or e->>'sha256' is null or e->>'byteSize' is null or (select count(*) from jsonb_object_keys(e))<>3 or e->>'name' not in ('logs.json','configuration.json','metrics.json','omissions.json') or e->>'sha256' !~ '^[a-f0-9]{64}$' or e->>'byteSize' !~ '^[0-9]{1,8}$' or (e->>'byteSize')::bigint>10485760)
 then return jsonb_build_object('outcome','invalid');end if;
 perform public.m15_01_lock(p_organization_id);
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_job_id for update;
 if not public.m15_04_worker_valid(j,p_worker_id,p_expected_version) or p_manifest->'selection' is distinct from j.selection then return jsonb_build_object('outcome','conflict');end if;
 if not exists(select 1 from storage.objects where bucket_id='support-diagnostics' and name=j.object_path and public.m15_02_object_bytes(metadata)=(p_artifact->>'byteSize')::bigint) then return jsonb_build_object('outcome','conflict');end if;
 update public.support_diagnostic_jobs set state='ready',stage='ready',artifact=p_artifact,manifest=p_manifest,omissions=p_manifest->'omissions',progress='{"completed":4,"total":4}',completed_at=clock_timestamp(),expires_at=clock_timestamp()+interval '24 hours',worker_id=null,lease_expires_at=null,version=version+1 where organization_id=p_organization_id and id=p_job_id returning * into j;
 perform public.m15_04_audit(j,'ready',gen_random_uuid());
 return jsonb_build_object('outcome','ok','result',public.m15_04_job_json(j));
end $$;
create function public.m15_04_fail(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer,p_failure_code text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.support_diagnostic_jobs;begin
 if p_failure_code is null or p_failure_code not in ('source_unavailable','invalid_value','authority_lost','generation_timeout','attempt_limit','storage_unavailable') then return jsonb_build_object('outcome','invalid');end if;
 perform public.m15_01_lock(p_organization_id);
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_job_id for update;
 if not found then return jsonb_build_object('outcome','not_found');end if;
 -- Failure may close lost authority; it can never publish or expose retained bytes.
 if j.state<>'running' or j.worker_id is distinct from p_worker_id or j.version<>p_expected_version or j.lease_expires_at<=clock_timestamp() then return jsonb_build_object('outcome','conflict');end if;
 update public.support_diagnostic_jobs set state=case when p_failure_code in ('storage_unavailable','generation_timeout') and attempts<3 then 'queued' else 'failed' end,stage=case when p_failure_code in ('storage_unavailable','generation_timeout') and attempts<3 then 'queued' else stage end,failure_code=p_failure_code,completed_at=case when p_failure_code in ('storage_unavailable','generation_timeout') and attempts<3 then null else clock_timestamp() end,worker_id=null,lease_expires_at=null,version=version+1 where organization_id=p_organization_id and id=p_job_id returning * into j;
 perform public.m15_04_audit(j,'failed',gen_random_uuid());
 return jsonb_build_object('outcome','ok','result',public.m15_04_job_json(j));
end $$;

-- Project already structured M13 source records; no message, changes, actor, ID,
-- IP, path, arbitrary action string, stack, or free text crosses this boundary.
create function public.m15_04_logs(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='2s' as $$
declare a jsonb;j public.support_diagnostic_jobs;rows jsonb;n integer;omissions jsonb:='[]';begin
 a:=public.m15_04_authorize_worker(p_organization_id,p_job_id,p_worker_id,p_expected_version);if a->>'outcome'<>'ok' then return a;end if;
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_job_id;
 if not j.selection->'categories' ? 'logs' then return jsonb_build_object('outcome','conflict');end if;
 if not public.m13_03_actor_can(p_organization_id,j.creator_user_id,'can_view_audit') then return jsonb_build_object('outcome','ok','result',jsonb_build_object('logs','[]'::jsonb,'omissions','[{"category":"logs","code":"source_withheld"}]'::jsonb));end if;
 with source as materialized(
  select e.created_at,e.outcome,case
   when e.entity_type in ('user','invitation','session','organization_member') then 'authentication'
   when e.entity_type in ('audit_export','audit_search') then 'audit'
   when e.entity_type in ('connector','connector_run') then 'connectors'
   when e.entity_type in ('sbom','sbom_source','sbom_release','sbom_document','sbom_ingest_job','sbom_supplier_request','sbom_supplier_submission') then 'sboms'
   when e.entity_type in ('evidence_document','evidence_document_version') then 'evidence'
   when e.entity_type in ('reporting_obligation','reporting_stage','reporting_package') then 'reporting'
   when e.entity_type='task' then 'tasks'
   when e.entity_type in ('notification','notification_dispatch') then 'notifications'
   when e.entity_type in ('license','organization_license') then 'licensing' end source
  from public.audit_logs e where e.organization_id=p_organization_id and e.created_at>=(j.selection->>'from')::timestamptz and e.created_at<(j.selection->>'to')::timestamptz
   and e.outcome in ('intent','completed','failed','denied') and public.m13_03_event_visible(p_organization_id,j.creator_user_id,e)
  order by e.created_at,e.id limit 5001
 ),visible as(select * from source where source is not null and case source
 when 'connectors' then public.m13_03_actor_can(p_organization_id,j.creator_user_id,'can_view_connectors')
 when 'sboms' then public.m13_03_actor_can(p_organization_id,j.creator_user_id,'can_view_sboms')
 when 'evidence' then public.m13_03_actor_can(p_organization_id,j.creator_user_id,'can_view_evidence')
 when 'reporting' then public.m13_03_actor_can(p_organization_id,j.creator_user_id,'can_view_reporting')
 when 'licensing' then public.m15_01_actor_can(p_organization_id,j.creator_user_id,'can_view_licensing')
 when 'authentication' then public.m13_03_actor_can(p_organization_id,j.creator_user_id,'can_view_users')
 when 'tasks' then false when 'notifications' then false else true end), numbered as(select *,row_number()over(order by created_at,source,outcome)rn from visible)
 select coalesce(jsonb_agg(jsonb_build_object('at',public.m7_snapshot_timestamp_utc(created_at),'source',source,'outcome',outcome,'code',case outcome when 'intent' then 'operation_started' when 'completed' then 'operation_completed' when 'failed' then 'operation_failed' else 'operation_denied' end) order by rn)filter(where rn<=5000),'[]'),count(*) into rows,n from numbered;
 if n>5000 then omissions:='[{"category":"logs","code":"row_limit"}]';end if;
 return jsonb_build_object('outcome','ok','result',jsonb_build_object('logs',rows,'omissions',omissions));
end $$;

create function public.m15_04_access_valid(p_job public.support_diagnostic_jobs,p_actor_user_id uuid,p_session_id uuid) returns boolean language sql volatile security definer set search_path=pg_catalog,public as $$
 select coalesce(p_job.creator_user_id=p_actor_user_id and p_job.state='ready' and p_job.expires_at>clock_timestamp() and p_job.cleanup_state='none'
 and public.m15_04_can(p_job.organization_id,p_actor_user_id,p_session_id)
 and public.m15_04_can(p_job.organization_id,p_actor_user_id,p_job.session_id)
 and exists(select 1 from public.organization_permissions_version where organization_id=p_job.organization_id and version=p_job.permission_version),false)
$$;
create function public.m15_04_access(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_job_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a jsonb;j public.support_diagnostic_jobs;begin
 a:=public.m15_04_authority(p_organization_id,p_actor_user_id,p_session_id);if a->>'outcome'<>'ok' then return a;end if;
 perform public.m15_01_lock(p_organization_id);
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_job_id and creator_user_id=p_actor_user_id for share;
 if not found then return jsonb_build_object('outcome','not_found');end if;
 if p_request_id is null or not public.m15_04_access_valid(j,p_actor_user_id,p_session_id) then return jsonb_build_object('outcome','forbidden');end if;
 perform public.m15_04_audit(j,'accessed',p_request_id,p_actor_user_id);
 return jsonb_build_object('outcome','ok','result',public.m15_04_internal(j));
end $$;
create function public.m15_04_revalidate(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_job_id uuid,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a jsonb;j public.support_diagnostic_jobs;begin
 a:=public.m15_04_authority(p_organization_id,p_actor_user_id,p_session_id);if a->>'outcome'<>'ok' then return a;end if;
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_job_id and creator_user_id=p_actor_user_id;
 if not found then return jsonb_build_object('outcome','not_found');end if;
 if not public.m15_04_access_valid(j,p_actor_user_id,p_session_id) or not exists(select 1 from public.audit_logs where organization_id=p_organization_id and entity_type='support_diagnostic' and entity_id=p_job_id::text and actor_id=p_actor_user_id::text and correlation_id=p_request_id and action in ('support.diagnostic.accessed','support.diagnostic.downloaded')) then return jsonb_build_object('outcome','forbidden');end if;
 return jsonb_build_object('outcome','ok','result',public.m15_04_internal(j));
end $$;
create function public.m15_04_issue_grant(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_job_id uuid,p_expected_version integer,p_grant_id uuid,p_grant_digest text,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a jsonb;j public.support_diagnostic_jobs;replay boolean;begin
 a:=public.m15_04_authority(p_organization_id,p_actor_user_id,p_session_id);if a->>'outcome'<>'ok' then return a;end if;
 if p_grant_id is null or p_idempotency_key is null or p_grant_digest is null or p_grant_digest !~ '^[a-f0-9]{64}$' then return jsonb_build_object('outcome','invalid');end if;
 perform public.m15_01_lock(p_organization_id);
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_job_id and creator_user_id=p_actor_user_id for update;
 if not found then return jsonb_build_object('outcome','not_found');end if;
 if not public.m15_04_access_valid(j,p_actor_user_id,p_session_id) then return jsonb_build_object('outcome','forbidden');end if;
 replay:=exists(select 1 from public.audit_logs where organization_id=p_organization_id and event_key='support.diagnostic.grant_issued:'||p_idempotency_key::text and entity_id=j.id::text and actor_id=p_actor_user_id::text);
 if replay then
  if j.grant_id is distinct from p_grant_id or j.grant_digest is distinct from p_grant_digest or j.grant_session_id is distinct from p_session_id or j.grant_used_at is not null or j.grant_expires_at<=clock_timestamp() then return jsonb_build_object('outcome','conflict');end if;
 else
  if j.version<>p_expected_version then return jsonb_build_object('outcome','conflict');end if;
  update public.support_diagnostic_jobs set grant_id=p_grant_id,grant_digest=p_grant_digest,grant_session_id=p_session_id,grant_expires_at=least(clock_timestamp()+interval '60 seconds',expires_at),grant_version=version,grant_used_at=null where organization_id=p_organization_id and id=p_job_id returning * into j;
  perform public.m15_04_audit(j,'grant_issued',p_idempotency_key,p_actor_user_id);
 end if;
 return jsonb_build_object('outcome','ok','result',jsonb_build_object('organizationId',p_organization_id,'jobId',p_job_id,'grantId',p_grant_id,'downloadPath','/api/v1/system/diagnostics/bundles/'||p_job_id::text||'/download/'||p_grant_id::text,'expiresAt',public.m7_snapshot_timestamp_utc(j.grant_expires_at)));
end $$;
create function public.m15_04_redeem_grant(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_job_id uuid,p_grant_id uuid,p_grant_digest text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a jsonb;j public.support_diagnostic_jobs;begin
 a:=public.m15_04_authority(p_organization_id,p_actor_user_id,p_session_id);if a->>'outcome'<>'ok' then return a;end if;
 perform public.m15_01_lock(p_organization_id);
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_job_id and creator_user_id=p_actor_user_id for update;
 if not found then return jsonb_build_object('outcome','not_found');end if;
 if p_request_id is null or not public.m15_04_access_valid(j,p_actor_user_id,p_session_id) or j.grant_id is distinct from p_grant_id or j.grant_digest is distinct from p_grant_digest or j.grant_session_id is distinct from p_session_id or j.grant_used_at is not null or j.grant_expires_at is null or j.grant_expires_at<=clock_timestamp() or j.grant_version<>j.version then return jsonb_build_object('outcome','forbidden');end if;
 update public.support_diagnostic_jobs set grant_used_at=clock_timestamp(),grant_digest=null where organization_id=p_organization_id and id=p_job_id returning * into j;
 perform public.m15_04_audit(j,'downloaded',p_request_id,p_actor_user_id);
 return jsonb_build_object('outcome','ok','result',public.m15_04_internal(j));
end $$;

-- Retention is a separate source policy. Unknown authority always blocks deletion.
-- Export uses metadata only, but an in-progress export still protects its snapshot.
create function public.m15_04_cleanup_policy(p_job public.support_diagnostic_jobs) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare blockers jsonb:='[]';policy public.organization_retention_policies;authority text;facts jsonb;fp text;begin
 if p_job.state in ('queued','running') then blockers:=blockers||'["work_in_progress"]';end if;
 if p_job.expires_at>clock_timestamp() or (p_job.completed_at is null) then blockers:=blockers||'["availability_active"]';end if;
 if p_job.grant_expires_at>clock_timestamp() and p_job.grant_used_at is null then blockers:=blockers||'["grant_active"]';end if;
 select * into policy from public.organization_retention_policies where organization_id=p_job.organization_id and evidence_class='export_artifact';
 if not found or not exists(select 1 from public.retention_evidence_classes where identifier='export_artifact' and enabled) then blockers:=blockers||'["retention_policy_unavailable"]';
 elsif coalesce(p_job.completed_at,p_job.created_at)>clock_timestamp()-make_interval(days=>policy.effective_retention_days) then blockers:=blockers||'["retention_period_active"]';end if;
 foreach authority in array array['product','evidence_class','obligation','legal_hold'] loop
  if not exists(select 1 from public.retention_authority_states where organization_id=p_job.organization_id and authority_kind=authority and available and last_reconciled_at is not null) then blockers:=blockers||jsonb_build_array('authority_unavailable:'||authority);end if;
 end loop;
 if exists(select 1 from public.retention_authoritative_facts where organization_id=p_job.organization_id and active and (evidence_class='export_artifact' or reason_kind='legal_hold') and (reason_kind='legal_hold' or protect_through>clock_timestamp())) then blockers:=blockers||'["authoritative_retention_protection"]';end if;
 if exists(select 1 from public.evidence_document_legal_holds where organization_id=p_job.organization_id and released_at is null) or exists(select 1 from public.product_lifecycle_dependency_facts where organization_id=p_job.organization_id and active and authority_kind='legal_hold') then blockers:=blockers||'["legal_hold"]';end if;
 if exists(select 1 from public.organization_export_jobs where organization_id=p_job.organization_id and status in ('queued','running')) then blockers:=blockers||'["tenant_export_active"]';end if;
 select jsonb_build_object('policy',to_jsonb(policy),'authorities',(select jsonb_agg(to_jsonb(s) order by authority_kind) from public.retention_authority_states s where organization_id=p_job.organization_id),
 'facts',(select jsonb_agg(to_jsonb(f) order by source_record_id) from public.retention_authoritative_facts f where organization_id=p_job.organization_id and active and (evidence_class='export_artifact' or reason_kind='legal_hold')),'blockers',blockers,'artifact',p_job.artifact,'objectPaths',p_job.object_paths,'completedAt',p_job.completed_at,'expiresAt',p_job.expires_at) into facts;
 fp:=encode(extensions.digest(public.m15_03_canonical_json(facts),'sha256'),'hex');
 return jsonb_build_object('organizationId',p_job.organization_id,'jobId',p_job.id,'eligible',jsonb_array_length(blockers)=0,'blockers',blockers,'reviewFingerprint',fp);
end $$;
create function public.m15_04_cleanup_review(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_job_id uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a jsonb;j public.support_diagnostic_jobs;begin
 a:=public.m15_04_authority(p_organization_id,p_actor_user_id,p_session_id);if a->>'outcome'<>'ok' then return a;end if;
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_job_id and creator_user_id=p_actor_user_id;
 if not found then return jsonb_build_object('outcome','not_found');end if;
 return jsonb_build_object('outcome','ok','result',public.m15_04_cleanup_policy(j));
end $$;
create function public.m15_04_request_cleanup(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_job_id uuid,p_expected_version integer,p_review_fingerprint text,p_idempotency_key uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a jsonb;j public.support_diagnostic_jobs;r jsonb;begin
 a:=public.m15_04_authority(p_organization_id,p_actor_user_id,p_session_id);if a->>'outcome'<>'ok' then return a;end if;
 perform public.m15_01_lock(p_organization_id);
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_job_id and creator_user_id=p_actor_user_id for update;
 if not found then return jsonb_build_object('outcome','not_found');end if;
 r:=public.m15_04_cleanup_policy(j);
 if p_idempotency_key is not null and j.cleanup_request_key=p_idempotency_key and j.cleanup_review_fingerprint=p_review_fingerprint then return jsonb_build_object('outcome','ok','result',public.m15_04_job_json(j));end if;
 if p_idempotency_key is null or j.version<>p_expected_version or j.cleanup_state not in ('none','blocked') or not (r->>'eligible')::boolean or r->>'reviewFingerprint' is distinct from p_review_fingerprint then return jsonb_build_object('outcome','conflict');end if;
 update public.support_diagnostic_jobs set cleanup_state='requested',cleanup_review_fingerprint=p_review_fingerprint,cleanup_request_key=p_idempotency_key,version=version+1 where organization_id=p_organization_id and id=p_job_id returning * into j;
 perform public.m15_04_audit(j,'cleanup_requested',p_idempotency_key,p_actor_user_id);
 return jsonb_build_object('outcome','ok','result',public.m15_04_job_json(j));
end $$;
create function public.m15_04_claim_cleanup(p_worker_id text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare c record;j public.support_diagnostic_jobs;r jsonb;begin
 if p_worker_id is null or p_worker_id !~ '^[a-zA-Z0-9_-]{1,80}$' then return jsonb_build_object('outcome','invalid');end if;
 if not pg_try_advisory_xact_lock(hashtextextended('m15_04_cleanup_scheduler',0)) then return jsonb_build_object('outcome','empty');end if;
 for c in select organization_id,id from public.support_diagnostic_jobs where cleanup_state='requested' or (cleanup_state='deleting' and cleanup_lease_expires_at<=clock_timestamp()) order by created_at,id limit 100 loop
  perform public.m15_01_lock(c.organization_id);
  select * into j from public.support_diagnostic_jobs where organization_id=c.organization_id and id=c.id for update skip locked;
  if not found then continue;end if;
  r:=public.m15_04_cleanup_policy(j);
  if j.cleanup_attempts>=3 or not (r->>'eligible')::boolean or r->>'reviewFingerprint' is distinct from j.cleanup_review_fingerprint then
   update public.support_diagnostic_jobs set cleanup_state='blocked',cleanup_worker_id=null,cleanup_lease_expires_at=null,version=version+1 where organization_id=j.organization_id and id=j.id;continue;
  end if;
  update public.support_diagnostic_jobs set cleanup_state='deleting',stage='cleanup',cleanup_worker_id=p_worker_id,cleanup_lease_expires_at=clock_timestamp()+interval '60 seconds',cleanup_attempts=cleanup_attempts+1,version=version+1 where organization_id=j.organization_id and id=j.id returning * into j;
  return jsonb_build_object('outcome','ok','result',public.m15_04_internal(j));
 end loop;
 return jsonb_build_object('outcome','empty');
end $$;
create function public.m15_04_authorize_cleanup(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.support_diagnostic_jobs;r jsonb;begin
 perform public.m15_01_lock(p_organization_id);
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_job_id for share;
 if not found then return jsonb_build_object('outcome','not_found');end if;
 r:=public.m15_04_cleanup_policy(j);
 if j.cleanup_state<>'deleting' or j.cleanup_worker_id is distinct from p_worker_id or j.version<>p_expected_version or j.cleanup_lease_expires_at<=clock_timestamp() or not (r->>'eligible')::boolean or r->>'reviewFingerprint' is distinct from j.cleanup_review_fingerprint then return jsonb_build_object('outcome','conflict');end if;
 return jsonb_build_object('outcome','ok','result',public.m15_04_internal(j));
end $$;
create function public.m15_04_finish_cleanup(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer,p_deleted boolean) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.support_diagnostic_jobs;a jsonb;begin
 a:=public.m15_04_authorize_cleanup(p_organization_id,p_job_id,p_worker_id,p_expected_version);if a->>'outcome'<>'ok' then return a;end if;
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_job_id for update;
 if p_deleted is null or (p_deleted and exists(select 1 from storage.objects where bucket_id='support-diagnostics' and name=any(j.object_paths))) then return jsonb_build_object('outcome','conflict');end if;
 update public.support_diagnostic_jobs set cleanup_state=case when p_deleted then 'deleted' when cleanup_attempts<3 then 'requested' else 'blocked' end,state=case when p_deleted then 'deleted' else state end,cleanup_worker_id=null,cleanup_lease_expires_at=null,version=version+1 where organization_id=p_organization_id and id=p_job_id returning * into j;
 perform public.m15_04_audit(j,case when p_deleted then 'cleanup_deleted' else 'cleanup_failed' end,gen_random_uuid());
 return jsonb_build_object('outcome','ok','result',public.m15_04_job_json(j));
end $$;

-- Extend source-owned accounting references, including unpublished attempts.
-- References remain after expiry/deletion so a physical object can never vanish
-- from accounting merely because access or a worker lease ended.
do $$ declare d text;anchor text;begin
 d:=pg_get_functiondef('public.m15_02_generated_objects(uuid,text,text)'::regprocedure);
 anchor:=' ) owned where';
 if position(anchor in d)=0 then raise exception 'M15-04 generated object anchor missing';end if;
 execute replace(d,anchor,E' union all select ''support-diagnostics'',p.path from public.support_diagnostic_jobs j cross join lateral unnest(j.object_paths)p(path) where j.organization_id=p_organization_id\n'||anchor);
 d:=pg_get_functiondef('public.m15_02_object_owners(text,text)'::regprocedure);
 anchor:='from public.reporting_obligation_evidence_packs where storage_bucket=p_bucket and storage_object_path=p_path';
 if position(anchor in d)=0 then raise exception 'M15-04 object owner anchor missing';end if;
 execute replace(d,anchor,anchor||E'\n union select organization_id from public.support_diagnostic_jobs where p_bucket=''support-diagnostics'' and p_path=any(object_paths)');
 d:=pg_get_functiondef('public.m15_02_source_refs(text,jsonb)'::regprocedure);
 anchor:=' when ''audit_export_jobs'' then';
 if position(anchor in d)=0 then raise exception 'M15-04 source reference anchor missing';end if;
 execute replace(d,anchor,E' when ''support_diagnostic_jobs'' then return query select ''support-diagnostics''::text,x from jsonb_array_elements_text(p_row->''object_paths'')x;\n'||anchor);
 d:=pg_get_functiondef('public.m15_01_usage(uuid)'::regprocedure);
 anchor:='''evidence-watermark-exports'',''reporting-evidence'')';
 if position(anchor in d)=0 then raise exception 'M15-04 protected usage anchor missing';end if;
 execute replace(d,anchor,'''evidence-watermark-exports'',''reporting-evidence'',''support-diagnostics'') and (so.bucket_id<>''support-diagnostics'' or exists(select 1 from public.m15_02_generated_objects(p_organization_id,so.bucket_id,so.name)))');
end $$;
create trigger aaa_m15_02_lock before insert or update or delete on public.support_diagnostic_jobs for each row execute function public.m15_02_source_lock();
create trigger m15_02_meter after insert or update or delete on public.support_diagnostic_jobs for each row execute function public.m15_02_source_changed();

-- Tenant exports contain safe metadata only. Diagnostic section bytes, creators,
-- sessions, grants, preview tokens/digests, lease state, paths and manifest content
-- never enter either the record projection or the private artifact inventory.
insert into public.organization_export_sources(source_id,enabled,sort_order)
 values('support_diagnostics',true,(select coalesce(max(sort_order),0)+1 from public.organization_export_sources));
insert into public.organization_export_source_tables(source_id,table_name,tenant_key_column,record_order_column,table_sort)
 values('support_diagnostics','support_diagnostic_jobs','organization_id','id',1);
create function public.m15_04_export_metadata(p_row jsonb) returns jsonb language sql immutable set search_path=pg_catalog,public as $$
 select jsonb_build_object('id',p_row->'id','organization_id',p_row->'organization_id','disclosure_version',p_row->'disclosure_version',
 'consented_at',p_row->'consented_at','created_at',p_row->'created_at','completed_at',p_row->'completed_at','expires_at',p_row->'expires_at',
 'state',p_row->'state','version',p_row->'version','selection',p_row->'selection','selection_digest',p_row->'selection_digest',
 'artifact',p_row->'artifact','cleanup_state',p_row->'cleanup_state','failure_code',p_row->'failure_code')
$$;
do $$ declare d text;anchor text;begin
 d:=pg_get_functiondef('public.m1_export_business_record_jsonb(text,jsonb)'::regprocedure);
 anchor:=E'\n  if p_table_name = ''audit_chain_heads'' then';
 if position(anchor in d)=0 then raise exception 'M15-04 export projection anchor missing';end if;
 execute replace(d,anchor,E'\n  if p_table_name = ''support_diagnostic_jobs'' then return public.m15_04_export_metadata(p_record);end if;\n'||anchor);
 d:=pg_get_functiondef('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure);
 anchor:=E'\n  in share mode;';
 if position(anchor in d)=0 or position('objects.bucket_id <> ''tenant-exports''' in d)=0 then raise exception 'M15-04 export inventory anchor missing';end if;
 d:=replace(d,anchor,', public.support_diagnostic_jobs'||anchor);
 d:=replace(d,'objects.bucket_id <> ''tenant-exports''','objects.bucket_id not in (''tenant-exports'',''support-diagnostics'')');
 execute d;
end $$;

-- All entry points are internal service RPCs. Helper execution stays private.
do $$ declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'm15_04_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 end loop;
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in (
 'm15_04_authority','m15_04_create','m15_04_get','m15_04_list','m15_04_cancel','m15_04_access','m15_04_revalidate',
 'm15_04_issue_grant','m15_04_redeem_grant','m15_04_claim','m15_04_authorize_worker','m15_04_heartbeat','m15_04_checkpoint',
 'm15_04_complete','m15_04_fail','m15_04_logs','m15_04_cleanup_review','m15_04_request_cleanup','m15_04_claim_cleanup','m15_04_authorize_cleanup','m15_04_finish_cleanup') loop
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
