-- A profile retry must identify the committed source revision without storing
-- or hashing a name or job title. The four-bit mask records only which
-- approved fields were supplied; source values remain in the authorized row.
alter table public.users
  add column profile_audit_version integer not null default 1;
alter table public.users
  add constraint users_profile_audit_version_positive
    check (profile_audit_version > 0);

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
    elsif v_key='fieldMask' and jsonb_typeof(v_value)='number'
      and v_value::text ~ '^([1-9]|1[0-5])$'
    then v_result:=v_result||jsonb_build_object(v_key,v_value);
    elsif v_key in ('active','accepted','enabled','verified','isActive','isDeleted','member')
      and jsonb_typeof(v_value)='boolean'
    then v_result:=v_result||jsonb_build_object(v_key,v_value);
    else v_result:=v_result||jsonb_build_object(v_key,'[REDACTED]');
    end if;
  end loop;
  return v_result;
end $$;

create or replace function public.m13_01_update_profile_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_patch jsonb,
  p_event_key text, p_correlation_id uuid, p_source_ip inet
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  v_user public.users%rowtype;
  v_prior public.audit_logs%rowtype;
  v_field_mask integer;
  v_new_version integer;
  v_outcome text;
begin
  if p_event_key is null or p_correlation_id is null
     or jsonb_typeof(p_patch) <> 'object'
     or p_patch - array['first_name','last_name','job_title','language'] <> '{}'::jsonb
     or exists(select 1 from jsonb_each(p_patch) where jsonb_typeof(value) <> 'string')
  then raise exception 'invalid_profile_patch' using errcode = '22023'; end if;
  v_field_mask := (case when p_patch ? 'first_name' then 1 else 0 end)
    + (case when p_patch ? 'last_name' then 2 else 0 end)
    + (case when p_patch ? 'job_title' then 4 else 0 end)
    + (case when p_patch ? 'language' then 8 else 0 end);

  perform pg_advisory_xact_lock(hashtextextended(
    coalesce(p_organization_id::text, 'security') || ':' || p_event_key, 0));
  if p_organization_id is not null then
    perform 1 from public.organization_permissions_version
      where organization_id = p_organization_id for update;
    if not found then raise exception 'organization_not_found' using errcode = '42501'; end if;
    if not exists (
      select 1 from public.organization_members m
      join public.organizations o on o.id = m.organization_id and o.is_active
      where m.organization_id = p_organization_id and m.user_id = p_actor_user_id
    ) then raise exception 'actor_not_authorized' using errcode = '42501'; end if;
  end if;
  select * into v_user from public.users
    where id = p_actor_user_id and is_active for update nowait;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  select * into v_prior from public.audit_logs
    where event_scope = case when p_organization_id is null then 'security' else 'organization' end
      and organization_id is not distinct from p_organization_id
      and event_key = p_event_key;
  if found then
    if v_field_mask > 0 and v_prior.action = 'user.profile_updated'
       and v_prior.actor_id = p_actor_user_id::text
       and v_prior.entity_type = 'user' and v_prior.entity_id = p_actor_user_id::text
       and v_prior.after_redacted->>'fieldMask' = v_field_mask::text
       and (case when v_prior.after_redacted->>'newVersion' ~ '^[0-9]{1,10}$'
         then (v_prior.after_redacted->>'newVersion')::integer = v_user.profile_audit_version
         else false end)
       and (not p_patch ? 'first_name' or v_user.first_name = p_patch->>'first_name')
       and (not p_patch ? 'last_name' or v_user.last_name = p_patch->>'last_name')
       and (not p_patch ? 'job_title' or v_user.job_title = p_patch->>'job_title')
       and (not p_patch ? 'language' or v_user.language = p_patch->>'language')
    then return jsonb_build_object('status', 'replayed'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;
  if v_field_mask = 0 then return jsonb_build_object('status', 'unchanged'); end if;

  update public.users set
    first_name = coalesce(p_patch->>'first_name', first_name),
    last_name = coalesce(p_patch->>'last_name', last_name),
    job_title = coalesce(p_patch->>'job_title', job_title),
    language = coalesce(p_patch->>'language', language),
    profile_audit_version = profile_audit_version + 1
    where id = p_actor_user_id
    returning profile_audit_version into v_new_version;

  select outcome into v_outcome from public.m13_01_append_audit_event(
    p_organization_id,
    case when p_organization_id is null then 'security' else 'organization' end,
    p_event_key, 'user', p_actor_user_id::text, 'user.profile_updated',
    'user', p_actor_user_id::text, 'completed', p_correlation_id,
    jsonb_build_object('oldVersion', v_new_version - 1),
    jsonb_build_object('newVersion', v_new_version, 'fieldMask', v_field_mask),
    null, p_source_ip, null, p_actor_user_id
  );
  if v_outcome <> 'inserted' then
    raise exception 'audit_event_conflict' using errcode = '23505';
  end if;
  return jsonb_build_object('status', 'updated');
end $$;

alter function public.m13_01_project_v2_audit_json(jsonb) owner to postgres;
alter function public.m13_01_update_profile_atomic(uuid,uuid,jsonb,text,uuid,inet) owner to postgres;
revoke all on function public.m13_01_project_v2_audit_json(jsonb)
  from public,anon,authenticated;
revoke all on function public.m13_01_update_profile_atomic(uuid,uuid,jsonb,text,uuid,inet)
  from public,anon,authenticated,service_role;
grant execute on function public.m13_01_update_profile_atomic(uuid,uuid,jsonb,text,uuid,inet)
  to service_role;
