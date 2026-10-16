-- M13-01: additive audit envelope. Existing source-owned transactional writers
-- remain version 1; new events use a complete version 2 envelope.
alter table public.audit_logs
  add column schema_version integer not null default 1,
  add column event_scope text,
  add column event_key text,
  add column actor_type text,
  add column actor_id text,
  add column outcome text,
  add column correlation_id uuid,
  add column before_redacted jsonb,
  add column after_redacted jsonb,
  add column reason text,
  add column redaction_version integer;

alter table public.audit_logs
  add constraint audit_logs_schema_version_check check (schema_version in (1,2)),
  add constraint audit_logs_v2_complete check (
    schema_version <> 2 or (
      event_scope in ('organization','security')
      and event_key is not null and length(event_key) between 8 and 200
      and event_key ~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      and actor_type in ('user','service_account','system','ai','operator')
      and actor_id is not null and length(actor_id) between 1 and 200
      and actor_id ~ '^[a-z0-9][a-z0-9:_/-]{0,199}$'
      and (actor_type not in ('user','operator')
        or actor_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      and outcome in ('intent','completed','failed','denied','cancelled')
      and correlation_id is not null
      and entity_type ~ '^[a-z][a-z0-9_.:-]{0,159}$'
      and action ~ '^[a-z][a-z0-9_.:-]{0,159}$'
      and (entity_id is null
        or entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or entity_id in ('anonymous','owner','admin','member','viewer'))
      and (reason is null or length(reason) <= 500)
      and redaction_version = 1
      and ((event_scope='organization' and organization_id is not null)
        or (event_scope='security' and organization_id is null))
    )
  ),
  add constraint audit_logs_v2_json_objects check (
    (before_redacted is null or jsonb_typeof(before_redacted)='object')
    and (after_redacted is null or jsonb_typeof(after_redacted)='object')
    and (before_redacted is null or pg_column_size(before_redacted) <= 16384)
    and (after_redacted is null or pg_column_size(after_redacted) <= 16384)
  );

create unique index audit_logs_v2_organization_key
  on public.audit_logs(organization_id,event_key)
  where schema_version=2 and event_scope='organization';

create unique index audit_logs_v2_security_key
  on public.audit_logs(event_key)
  where schema_version=2 and event_scope='security';

create index audit_logs_v2_correlation
  on public.audit_logs(correlation_id,created_at desc)
  where schema_version=2;

-- Redact before a value reaches the heap, including direct legacy SQL writers.
-- This guard intentionally preserves ordinary legacy keys because several
-- existing idempotency paths read their audit metadata. New v2 producers must
-- also project approved fields before invoking the append routine.
create or replace function public.m13_01_redact_audit_text(p_value text)
returns text language plpgsql immutable set search_path=public,pg_temp as $$
begin
  if p_value is null then return null; end if;
  if p_value ~* '^(bearer|basic)[[:space:]]+'
    or p_value ~ '^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$'
    or p_value ~* '(sb_secret_|sk-[A-Za-z0-9_-]{12,})'
    or p_value ~* '[?&](token|access_token|refresh_token|signature|sig|api_key|apikey|secret|code)='
  then return '[REDACTED]'; end if;
  return p_value;
end $$;

create or replace function public.m13_01_redact_audit_json(p_value jsonb,p_key text default null)
returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare v_key text; v_value jsonb; v_result jsonb; v_compact_key text;
begin
  if p_value is null then return null; end if;
  v_compact_key:=regexp_replace(lower(coalesce(p_key,'')),'[^a-z0-9]','','g');
  if v_compact_key ~ '(password|passphrase|passcode|onetimecode|otptoken|totp|recoverycode|recoveryhash|codehash|accesstoken|refreshtoken|sessiontoken|authtoken|bearertoken|tokenhash|apikey|privatekey|secret|credential|authorization|cookie|signedurl|originalvalue|correctedvalue|sourcespan|rawprompt|promptcontent|requestbody|responsebody|rawpayload|rawcontent|documentcontent)'
    or v_compact_key in ('token','otp','prompt','content','payload','raw','signature')
  then return to_jsonb('[REDACTED]'::text); end if;
  case jsonb_typeof(p_value)
    when 'object' then
      v_result:='{}'::jsonb;
      for v_key,v_value in select key,value from jsonb_each(p_value) loop
        v_result:=v_result||jsonb_build_object(v_key,public.m13_01_redact_audit_json(v_value,v_key));
      end loop;
      return v_result;
    when 'array' then
      select coalesce(jsonb_agg(public.m13_01_redact_audit_json(value,p_key) order by ordinality),'[]'::jsonb)
        into v_result from jsonb_array_elements(p_value) with ordinality;
      return v_result;
    when 'string' then
      return to_jsonb(public.m13_01_redact_audit_text(p_value #>> '{}'));
    else return p_value;
  end case;
end $$;

-- V2 never accepts arbitrary before/after content. Only structural references,
-- codes, counters and booleans survive; every other value is a marker. This is
-- deliberately stricter than the legacy guard above so existing replay logic
-- can continue reading its historical `changes` keys.
create or replace function public.m13_01_project_v2_audit_json(p_value jsonb)
returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare v_key text; v_value jsonb; v_result jsonb:='{}'::jsonb; v_text text;
begin
  if p_value is null then return null; end if;
  if jsonb_typeof(p_value)<>'object' then
    raise exception 'audit before/after must be objects' using errcode='22023';
  end if;
  for v_key,v_value in select key,value from jsonb_each(p_value) loop
    v_text:=case when jsonb_typeof(v_value)='string' then v_value #>> '{}' else null end;
    if v_key in ('actorId','artifactId','attemptId','eventId','evidenceVersionId',
      'factorId','fieldId','memberId','organizationId','productId','requestId',
      'roleId','runId','sessionId','sourceId','submissionId','userId')
      and v_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then v_result:=v_result||jsonb_build_object(v_key,v_value);
    elsif v_key in ('decision','model','outcome','promptVersion','reasonCode',
      'stage','state','status','role','baseRole','permissionKey')
      and v_text ~ '^[a-z][a-z0-9_.:-]{0,119}$' and v_text !~ '[0-9]{4,}'
    then v_result:=v_result||jsonb_build_object(v_key,v_value);
    elsif v_key in ('attemptCount','count','newVersion','oldVersion','version')
      and jsonb_typeof(v_value)='number' and v_value::text ~ '^(0|[1-9][0-9]{0,9})$'
    then v_result:=v_result||jsonb_build_object(v_key,v_value);
    elsif v_key in ('active','accepted','enabled','verified','isActive','isDeleted','member')
      and jsonb_typeof(v_value)='boolean'
    then v_result:=v_result||jsonb_build_object(v_key,v_value);
    else v_result:=v_result||jsonb_build_object(v_key,'[REDACTED]');
    end if;
  end loop;
  return v_result;
end $$;

create or replace function public.m13_01_project_v2_reason(p_reason text)
returns text language sql immutable set search_path=public,pg_temp as $$
  select case when p_reason is null then null
    when p_reason ~ '^[a-z][a-z0-9_.:-]{0,120}$' and p_reason !~ '[0-9]{4,}' then p_reason
    else '[REDACTED]' end
$$;

create or replace function public.m13_01_guard_audit_insert()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  new.changes:=public.m13_01_redact_audit_json(new.changes);
  if new.schema_version=2 then
    new.before_redacted:=public.m13_01_project_v2_audit_json(new.before_redacted);
    new.after_redacted:=public.m13_01_project_v2_audit_json(new.after_redacted);
    new.reason:=public.m13_01_project_v2_reason(new.reason);
    -- User-Agent is caller-controlled free text and has no audit requirement.
    new.user_agent:=null;
  else
    new.before_redacted:=public.m13_01_redact_audit_json(new.before_redacted);
    new.after_redacted:=public.m13_01_redact_audit_json(new.after_redacted);
    new.reason:=public.m13_01_redact_audit_text(new.reason);
  end if;
  new.user_agent:=public.m13_01_redact_audit_text(new.user_agent);
  new.actor_email:=public.m13_01_redact_audit_text(new.actor_email);
  new.entity_id:=public.m13_01_redact_audit_text(new.entity_id);
  if new.schema_version=2 then
    new.event_key:=public.m13_01_redact_audit_text(new.event_key);
    new.actor_id:=public.m13_01_redact_audit_text(new.actor_id);
  end if;
  return new;
end $$;

create trigger m13_01_guard_audit_insert
  before insert on public.audit_logs
  for each row execute function public.m13_01_guard_audit_insert();

-- The caller's domain write and this function run in the same PostgreSQL
-- transaction. The insert is never best effort. A duplicate key with an
-- identical redacted envelope replays; a changed envelope conflicts.
create or replace function public.m13_01_append_audit_event(
  p_organization_id uuid,
  p_scope text,
  p_event_key text,
  p_actor_type text,
  p_actor_id text,
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_outcome text,
  p_correlation_id uuid,
  p_before_redacted jsonb,
  p_after_redacted jsonb,
  p_reason text,
  p_ip_address inet,
  p_user_agent text,
  p_user_id uuid default null
) returns table(outcome text,audit_id uuid)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.audit_logs%rowtype; v_inserted uuid;
  v_before jsonb; v_after jsonb; v_reason text; v_agent text; v_entity_id text;
begin
  if p_scope not in ('organization','security') or p_scope is null
    or (p_scope='organization' and p_organization_id is null)
    or (p_scope='security' and p_organization_id is not null)
    or p_correlation_id is null or p_event_key is null
    or length(p_event_key) not between 8 and 200
    or public.m13_01_redact_audit_text(p_event_key) is distinct from p_event_key
    or p_actor_type not in ('user','service_account','system','ai','operator')
    or p_actor_type is null or nullif(btrim(p_actor_id),'') is null
    or public.m13_01_redact_audit_text(p_actor_id) is distinct from p_actor_id
    or p_actor_id !~ '^[a-z0-9][a-z0-9:_/-]{0,199}$'
    or (p_actor_type in ('user','operator')
      and p_actor_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    or p_outcome not in ('intent','completed','failed','denied','cancelled')
    or p_outcome is null or nullif(btrim(p_action),'') is null
    or nullif(btrim(p_entity_type),'') is null
    or (p_before_redacted is not null and jsonb_typeof(p_before_redacted)<>'object')
    or (p_after_redacted is not null and jsonb_typeof(p_after_redacted)<>'object')
    or (p_before_redacted is not null and pg_column_size(p_before_redacted)>16384)
    or (p_after_redacted is not null and pg_column_size(p_after_redacted)>16384)
  then raise exception 'invalid audit envelope' using errcode='22023'; end if;
  v_before:=public.m13_01_project_v2_audit_json(p_before_redacted);
  v_after:=public.m13_01_project_v2_audit_json(p_after_redacted);
  v_reason:=public.m13_01_project_v2_reason(p_reason);
  v_agent:=null;
  v_entity_id:=public.m13_01_redact_audit_text(p_entity_id);
  insert into public.audit_logs(
    organization_id,user_id,action,entity_type,entity_id,ip_address,user_agent,
    schema_version,event_scope,event_key,actor_type,actor_id,outcome,
    correlation_id,before_redacted,after_redacted,reason,redaction_version
  ) values (
    p_organization_id,p_user_id,p_action,p_entity_type,v_entity_id,p_ip_address,v_agent,
    2,p_scope,p_event_key,p_actor_type,p_actor_id,p_outcome,
    p_correlation_id,v_before,v_after,v_reason,1
  ) on conflict do nothing returning id into v_inserted;
  if v_inserted is not null then
    return query select 'inserted'::text,v_inserted;
    return;
  end if;
  select * into v_existing from public.audit_logs a
    where a.schema_version=2 and a.event_scope=p_scope and a.event_key=p_event_key
      and ((p_scope='security' and a.organization_id is null)
        or (p_scope='organization' and a.organization_id=p_organization_id));
  if not found then raise exception 'audit identity collision' using errcode='23505'; end if;
  if v_existing.user_id is not distinct from p_user_id
    and v_existing.actor_type=p_actor_type and v_existing.actor_id=p_actor_id
    and v_existing.action=p_action and v_existing.entity_type=p_entity_type
    and v_existing.entity_id is not distinct from v_entity_id
    and v_existing.outcome=p_outcome
    and v_existing.before_redacted is not distinct from v_before
    and v_existing.after_redacted is not distinct from v_after
    and v_existing.reason is not distinct from v_reason
  then return query select 'replayed'::text,v_existing.id;
  else return query select 'conflict'::text,v_existing.id;
  end if;
end $$;

alter function public.m13_01_redact_audit_text(text) owner to postgres;
alter function public.m13_01_redact_audit_json(jsonb,text) owner to postgres;
alter function public.m13_01_project_v2_audit_json(jsonb) owner to postgres;
alter function public.m13_01_project_v2_reason(text) owner to postgres;
alter function public.m13_01_guard_audit_insert() owner to postgres;
alter function public.m13_01_append_audit_event(uuid,text,text,text,text,text,text,text,text,uuid,jsonb,jsonb,text,inet,text,uuid) owner to postgres;

revoke all on function public.m13_01_redact_audit_text(text) from public,anon,authenticated;
revoke all on function public.m13_01_redact_audit_json(jsonb,text) from public,anon,authenticated;
revoke all on function public.m13_01_project_v2_audit_json(jsonb) from public,anon,authenticated;
revoke all on function public.m13_01_project_v2_reason(text) from public,anon,authenticated;
revoke all on function public.m13_01_guard_audit_insert() from public,anon,authenticated,service_role;
revoke all on function public.m13_01_append_audit_event(uuid,text,text,text,text,text,text,text,text,uuid,jsonb,jsonb,text,inet,text,uuid)
  from public,anon,authenticated;
grant execute on function public.m13_01_append_audit_event(uuid,text,text,text,text,text,text,text,text,uuid,jsonb,jsonb,text,inet,text,uuid)
  to service_role;

-- Keep the established append-only grant boundary and nonforced RLS model.
revoke update,delete,truncate on public.audit_logs from service_role;
