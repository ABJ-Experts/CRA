-- Additive scheduling authorities. Three tables only; all tenant references qualified.
create table public.report_definitions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 owner_user_id uuid not null references public.users(id), definition_version integer not null default 1 check(definition_version>0),
 version integer not null default 1 check(version>0),state text not null default 'draft' check(state in ('draft','active','paused','archived')),
 config jsonb not null check(jsonb_typeof(config)='object' and octet_length(config::text)<=65536),
 config_digest text not null check(config_digest ~ '^[a-f0-9]{64}$'), schema_version text not null default 'm14_04_v1', source_schema_digest text not null check(source_schema_digest ~ '^[a-f0-9]{64}$'),
 next_due_at timestamptz, preview_run_id uuid,pause_reason text,create_key uuid not null,
 commands jsonb not null default '{}' check(jsonb_typeof(commands)='object'),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 unique(organization_id,id),unique(organization_id,owner_user_id,create_key)
);
create table public.report_runs (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,definition_id uuid not null,
 definition_version integer not null,owner_user_id uuid not null references public.users(id),
 kind text not null check(kind in ('preview','scheduled')),state text not null default 'scheduled' check(state in ('scheduled','running','succeeded','failed','paused')),
 config jsonb not null,config_digest text not null,schema_version text not null,source_schema_digest text not null,
 scheduled_for timestamptz not null,occurrence_key text not null check(length(occurrence_key)<=200),
 created_at timestamptz not null default clock_timestamp(),finished_at timestamptz,safe_error_code text,
 unique(organization_id,id),unique(organization_id,definition_id,occurrence_key),
 foreign key(organization_id,definition_id) references public.report_definitions(organization_id,id)
);
create unique index report_one_active_run on public.report_runs(organization_id,definition_id) where state in ('scheduled','running');
create table public.report_run_recipients (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,run_id uuid not null,user_id uuid not null references public.users(id),
 generation_state text not null default 'waiting' check(generation_state in ('waiting','running','ready','skipped','failed','revoked')),
 email_state text not null default 'pending' check(email_state in ('pending','off','queued','accepted','uncertain','failed','skipped')),
 export_job_id uuid,manifest jsonb,worker_id text,lease_expires_at timestamptz,version integer not null default 1,
 safe_error_code text,expires_at timestamptz not null default clock_timestamp()+interval '24 hours',created_at timestamptz not null default clock_timestamp(),
 unique(organization_id,id),unique(organization_id,run_id,user_id),
 foreign key(organization_id,run_id) references public.report_runs(organization_id,id),
 foreign key(organization_id,export_job_id) references public.export_jobs(organization_id,id),
 check((worker_id is null)=(lease_expires_at is null))
);
alter table public.report_definitions add constraint report_preview_tenant_fk foreign key(organization_id,preview_run_id) references public.report_runs(organization_id,id);
create index report_due on public.report_definitions(next_due_at,id) where state='active';
create index report_owner on public.report_definitions(organization_id,owner_user_id,created_at desc,id);
create index report_recipient_claim on public.report_run_recipients(generation_state,created_at,id);
create index report_recipient_user on public.report_run_recipients(organization_id,user_id,run_id);
alter table public.report_definitions enable row level security;
alter table public.report_runs enable row level security;
alter table public.report_run_recipients enable row level security;
revoke all on public.report_definitions,public.report_runs,public.report_run_recipients from public,anon,authenticated;
grant select,insert,update on public.report_definitions,public.report_runs,public.report_run_recipients to service_role;
create function public.m14_04_freeze_run() returns trigger language plpgsql set search_path=pg_catalog,public as $$ begin
 if tg_op='DELETE' or (new.id,new.created_at,new.organization_id,new.definition_id,new.definition_version,new.owner_user_id,new.kind,new.config,new.config_digest,new.schema_version,new.source_schema_digest,new.scheduled_for,new.occurrence_key)
 is distinct from (old.id,old.created_at,old.organization_id,old.definition_id,old.definition_version,old.owner_user_id,old.kind,old.config,old.config_digest,old.schema_version,old.source_schema_digest,old.scheduled_for,old.occurrence_key)
 then raise exception 'report_snapshot_immutable' using errcode='55000';end if;return new;end $$;
create trigger report_run_immutable before update or delete on public.report_runs for each row execute function public.m14_04_freeze_run();
create function public.m14_04_freeze_recipient() returns trigger language plpgsql set search_path=pg_catalog,public as $$ begin
 if tg_op='DELETE' or (new.id,new.created_at,new.organization_id,new.run_id,new.user_id) is distinct from (old.id,old.created_at,old.organization_id,old.run_id,old.user_id)
 or (old.generation_state='revoked' and new.generation_state<>'revoked') or (old.manifest is not null and new.manifest is distinct from old.manifest)
 or (old.export_job_id is not null and new.export_job_id is distinct from old.export_job_id)
 then raise exception 'report_recipient_immutable' using errcode='55000';end if;return new;end $$;
create trigger report_recipient_immutable before update or delete on public.report_run_recipients for each row execute function public.m14_04_freeze_recipient();
create function public.m14_04_digest(p_value jsonb) returns text language sql immutable set search_path=pg_catalog,public as $$
 select encode(extensions.digest(convert_to(public.m13_02_canonical_json(p_value),'UTF8'),'sha256'),'hex') $$;
create function public.m14_04_member(p_organization_id uuid,p_user_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.m2_active_member(p_organization_id,p_user_id) and exists(select 1 from public.users where id=p_user_id and is_active and email_verified_at is not null) $$;
create function public.m14_04_source_access(p_organization_id uuid,p_user_id uuid,p_config jsonb) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare pol jsonb;perm text;src text;ctx jsonb;begin
 if not public.m14_04_member(p_organization_id,p_user_id) then return false;end if;
 src:=case when p_config->'report'->>'kind'='readiness' then 'technical_files.readiness_report' else p_config->'report'->>'source' end;
 ctx:=case when p_config->'report'->>'kind'='readiness' then jsonb_build_object('productId',p_config->'report'->>'productId') else p_config->'report'->'context' end;
 pol:=public.m14_03_source_policy(src);
 if pol is null or pol->>'subjectKind'<>'member' then return false;end if;
 if pol->>'requiredRole'='owner' and not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role='owner') then return false;end if;
 if pol->>'requiredRole'='admin' and not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_user_id and role in ('owner','admin')) then return false;end if;
 for perm in select jsonb_array_elements_text(pol->'permissions') loop if not public.m14_03_actor_can(p_organization_id,p_user_id,perm) then return false;end if;end loop;
 if ctx ? 'productId' and not exists(select 1 from public.products where organization_id=p_organization_id and id=(ctx->>'productId')::uuid) then return false;end if;
 return true;
end $$;
create function public.m14_04_validate_config(p_organization_id uuid,p_actor_user_id uuid,p_config jsonb) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare uid text;src text;pol jsonb;col text;begin
 if p_config is null or jsonb_typeof(p_config)<>'object' or not(p_config ?& array['title','report','schedule','dateWindow','recipientUserIds','emailEnabled'])
 or p_config - array['title','report','schedule','dateWindow','recipientUserIds','emailEnabled'] <> '{}'::jsonb
 or jsonb_typeof(p_config->'title')<>'string' or length(btrim(p_config->>'title')) not between 1 and 120 or jsonb_typeof(p_config->'emailEnabled')<>'boolean'
 or jsonb_typeof(p_config->'recipientUserIds')<>'array' or jsonb_array_length(p_config->'recipientUserIds') not between 1 and 20
 or (select count(distinct value) from jsonb_array_elements_text(p_config->'recipientUserIds'))<>jsonb_array_length(p_config->'recipientUserIds')
 then raise exception 'invalid_report_configuration' using errcode='22023';end if;
 if jsonb_typeof(p_config->'schedule')<>'object' or not(p_config->'schedule' ?& array['frequency','timezone','localTime']) or (p_config->'schedule')-array['frequency','timezone','localTime','weekday','monthDay']<>'{}'::jsonb or p_config->'schedule'->>'frequency' is null or p_config->'schedule'->>'localTime' is null or p_config->'schedule'->>'timezone' is null or p_config->'schedule'->>'frequency' not in ('daily','weekly','monthly') or p_config->'schedule'->>'localTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
 or not exists(select 1 from pg_timezone_names where name=p_config->'schedule'->>'timezone')
 or (p_config->'schedule'->>'frequency'='weekly' and coalesce((p_config->'schedule'->>'weekday')::int,-1) not between 0 and 6)
 or (p_config->'schedule'->>'frequency'='monthly' and coalesce((p_config->'schedule'->>'monthDay')::int,0) not between 1 and 31)
 or jsonb_typeof(p_config->'dateWindow')<>'object' or p_config->'dateWindow'->>'kind' is null or (p_config->'dateWindow')-array['kind','days']<>'{}'::jsonb or p_config->'dateWindow'->>'kind' not in ('fixed','rolling') or (p_config->'dateWindow'->>'kind'='rolling' and coalesce((p_config->'dateWindow'->>'days')::int,0) not in (7,30,90))
 then raise exception 'invalid_report_schedule' using errcode='22023';end if;
 if jsonb_typeof(p_config->'report')<>'object' or p_config->'report'->>'kind' is null then raise exception 'invalid_report_source' using errcode='22023';end if;
 if p_config->'report'->>'kind'='list' then
 src:=p_config->'report'->>'source';pol:=public.m14_03_source_policy(src);
 if not(p_config->'report' ?& array['kind','source','format','context','filters']) or (p_config->'report')-array['kind','source','format','context','filters','columns']<>'{}'::jsonb or pol is null or pol->>'subjectKind'<>'member' or p_config->'report'->>'format' not in ('csv','xlsx')
 or jsonb_typeof(p_config->'report'->'filters')<>'object' or jsonb_typeof(p_config->'report'->'context')<>'object'
 or p_config->'report'->'filters' ?| array['page','pageSize','cursor','limit','datasetToken','snapshotToken']
 or p_config::text ~ '"(_[^"]*|sql|script|snapshotToken|datasetToken)"\s*:'
 then raise exception 'invalid_report_source' using errcode='22023';end if;
 if p_config->'report' ? 'columns' and (jsonb_typeof(p_config->'report'->'columns')<>'array' or jsonb_array_length(p_config->'report'->'columns') not between 1 and 100) then raise exception 'invalid_report_columns' using errcode='22023';end if;
 for col in select jsonb_array_elements_text(coalesce(p_config->'report'->'columns',pol->'columns')) loop
 if not(pol->'columns' ? col) then raise exception 'invalid_report_columns' using errcode='22023';end if;end loop;
 elsif p_config->'report'->>'kind'<>'readiness' or not(p_config->'report' ? 'productId') or (p_config->'report')-array['kind','productId']<>'{}'::jsonb then raise exception 'invalid_report_source' using errcode='22023';end if;
 if not public.m14_04_source_access(p_organization_id,p_actor_user_id,p_config) then raise exception 'report_access_denied' using errcode='42501';end if;
 for uid in select jsonb_array_elements_text(p_config->'recipientUserIds') loop
 if not public.m14_04_member(p_organization_id,uid::uuid) then raise exception 'report_recipient_ineligible' using errcode='42501';end if;end loop;
end $$;
-- Enumerate local calendar days. Roundtrip rejects gaps; inspect nearby offsets
-- to select the earliest UTC instant in a fold, including half-hour DST zones.
create function public.m14_04_next_occurrence(p_schedule jsonb,p_after timestamptz) returns timestamptz language plpgsql stable set search_path=pg_catalog,public as $$
declare tz text:=p_schedule->>'timezone';d date;wall timestamp;base timestamptz;candidate timestamptz;first_at timestamptz;i int;shift int;begin
 for i in 0..370 loop
 d:=(p_after at time zone tz)::date+i;
 if p_schedule->>'frequency'='weekly' and extract(dow from d)::int<>(p_schedule->>'weekday')::int then continue;end if;
 if p_schedule->>'frequency'='monthly' and extract(day from d)::int<>least((p_schedule->>'monthDay')::int,extract(day from (date_trunc('month',d)+interval '1 month - 1 day'))::int) then continue;end if;
 wall:=d+(p_schedule->>'localTime')::time;base:=wall at time zone tz;first_at:=null;
 for shift in -180..180 loop
 candidate:=base+make_interval(mins=>shift);
 if candidate at time zone tz=wall and (first_at is null or candidate<first_at) then first_at:=candidate;end if;
 end loop;
 if first_at>p_after then return first_at;end if;
 end loop;
 raise exception 'report_schedule_unavailable' using errcode='22023';end $$;
create function public.m14_04_audit(p_org uuid,p_actor uuid,p_entity uuid,p_action text,p_key uuid,p_details jsonb default '{}') returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare outcome text;begin
 select x.outcome into outcome from public.m13_01_append_audit_event(p_org,'organization','reports.'||p_action||':'||p_key,
 'user',p_actor::text,'reports.'||p_action,'scheduled_report',p_entity::text,'completed',p_key,null,p_details,null,null,null,p_actor) x;
 if outcome='conflict' then raise exception 'report_audit_conflict' using errcode='40001';end if;end $$;
create function public.m14_04_definition_json(d public.report_definitions) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('id',d.id,'ownerUserId',d.owner_user_id,'definitionVersion',d.definition_version,'version',d.version,'state',d.state,'config',d.config,'configDigest',d.config_digest,'schemaVersion',d.schema_version,'nextDueAt',d.next_due_at,'previewRunId',d.preview_run_id,'pauseReason',d.pause_reason,'createdAt',d.created_at,'updatedAt',d.updated_at) $$;
create function public.m14_04_run_json(r public.report_runs) returns jsonb language sql stable set search_path=pg_catalog,public as $$
 select jsonb_build_object('id',r.id,'definitionId',r.definition_id,'definitionVersion',r.definition_version,'kind',r.kind,'state',r.state,'scheduledFor',r.scheduled_for,'occurrenceKey',r.occurrence_key,'createdAt',r.created_at,'finishedAt',r.finished_at,'safeErrorCode',r.safe_error_code) $$;
-- Membership removal is permanent for existing recipient grants, even if the
-- same user later rejoins. Definition ownership is never transferred.
create function public.m14_04_membership_removed() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin
 if not exists(select 1 from public.report_definitions where organization_id=old.organization_id and owner_user_id=old.user_id) and not exists(select 1 from public.report_run_recipients where organization_id=old.organization_id and user_id=old.user_id) then return old;end if;
 update public.report_run_recipients set generation_state='revoked',email_state=case when email_state in ('accepted','uncertain') then email_state else 'skipped' end,safe_error_code='membership_removed',worker_id=null,lease_expires_at=null,version=version+1 where organization_id=old.organization_id and (user_id=old.user_id or run_id in(select id from public.report_runs where organization_id=old.organization_id and owner_user_id=old.user_id)) and generation_state<>'revoked';
 update public.report_definitions set state='paused',pause_reason='owner_access_lost',next_due_at=null,version=version+1 where organization_id=old.organization_id and owner_user_id=old.user_id and state<>'archived';
 perform public.m14_04_audit(old.organization_id,old.user_id,old.user_id,'membership_revoked',gen_random_uuid());return old;end $$;
create trigger report_membership_removed before delete on public.organization_members for each row execute function public.m14_04_membership_removed();
do $$ declare f record;begin for f in select oid::regprocedure as sig from pg_proc where pronamespace='public'::regnamespace and proname like 'm14_04_%' loop execute format('revoke all on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);end loop;end $$;
