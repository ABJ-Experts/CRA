-- Role and membership writes bump this row; SHARE fences command authorization to their commit order.

create or replace function public.m1201_manage_group(p_organization_id uuid,p_actor_user_id uuid,p_action text,p_group_id uuid,
 p_name text,p_member_user_id uuid,p_expected_version bigint,p_idempotency_key uuid)
returns table(outcome text,"group" jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.workflow_task_groups%rowtype; c public.workflow_task_commands%rowtype; v_digest text; v_group_id uuid;
begin
 if not public.m1201_group_admin(p_organization_id,p_actor_user_id) then return query select 'forbidden'::text,null::jsonb; return; end if;
 if p_idempotency_key is null or p_action is null or p_action not in ('create','update','add_member','remove_member')
   or (p_action in ('create','update') and (p_name is null or p_name<>btrim(p_name) or char_length(p_name) not between 1 and 100))
   or (p_action='create' and p_group_id is not null)
   or (p_action<>'create' and (p_group_id is null or p_expected_version is null or p_expected_version<1))
   or (p_action in ('add_member','remove_member') and p_member_user_id is null) then
  return query select 'invalid_request'::text,null::jsonb; return; end if;
 perform 1 from public.organization_permissions_version x where x.organization_id=p_organization_id for share;
 if not found then return query select 'forbidden'::text,null::jsonb; return; end if;
 perform 1 from public.users u where u.id=p_actor_user_id and u.is_active for share;
 if not found or not public.m1201_group_admin(p_organization_id,p_actor_user_id) then
  return query select 'forbidden'::text,null::jsonb; return; end if;
 if p_action='add_member' then
  perform 1 from public.users u where u.id=p_member_user_id and u.is_active for share;
  if not found or not public.m1201_active_member(p_organization_id,p_member_user_id) then
   return query select 'invalid_request'::text,null::jsonb; return; end if;
 end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('action',p_action,'groupId',p_group_id,'name',p_name,
  'memberId',p_member_user_id,'version',p_expected_version)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0));
 select * into c from public.workflow_task_commands where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
 if found then
  if c.request_digest<>v_digest then return query select 'conflict'::text,null::jsonb;
  else return query select 'replayed'::text,c.result; end if; return; end if;
 if p_action='create' then
  if exists(select 1 from public.workflow_task_groups x where x.organization_id=p_organization_id and lower(x.name)=lower(p_name)) then
   return query select 'conflict'::text,null::jsonb; return; end if;
  insert into public.workflow_task_groups(id,organization_id,name,created_by) values(p_idempotency_key,p_organization_id,p_name,p_actor_user_id)
   returning * into g;
 else
  select * into g from public.workflow_task_groups x where x.organization_id=p_organization_id and x.id=p_group_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if g.version<>p_expected_version then return query select 'conflict'::text,public.m1201_group_json(p_organization_id,p_group_id); return; end if;
  if p_action='update' then
   if exists(select 1 from public.workflow_task_groups x where x.organization_id=p_organization_id and x.id<>p_group_id and lower(x.name)=lower(p_name)) then
    return query select 'conflict'::text,null::jsonb; return; end if;
   update public.workflow_task_groups set name=p_name,version=version+1,updated_at=clock_timestamp()
    where organization_id=p_organization_id and id=p_group_id;
  elsif p_action='add_member' then
   if not public.m1201_active_member(p_organization_id,p_member_user_id) then return query select 'invalid_request'::text,null::jsonb; return; end if;
   insert into public.workflow_task_group_members(organization_id,group_id,user_id,added_by)
    values(p_organization_id,p_group_id,p_member_user_id,p_actor_user_id) on conflict do nothing;
   update public.workflow_task_groups set version=version+1,updated_at=clock_timestamp()
    where organization_id=p_organization_id and id=p_group_id;
  else
   delete from public.workflow_task_group_members where organization_id=p_organization_id and group_id=p_group_id and user_id=p_member_user_id;
   update public.workflow_task_groups set version=version+1,updated_at=clock_timestamp()
    where organization_id=p_organization_id and id=p_group_id;
  end if;
 end if;
 v_group_id:=coalesce(p_group_id,g.id);
 "group":=public.m1201_group_json(p_organization_id,v_group_id);
 insert into public.workflow_task_commands(organization_id,actor_user_id,idempotency_key,action,request_digest,outcome,result)
  values(p_organization_id,p_actor_user_id,p_idempotency_key,'group.'||p_action,v_digest,'updated',"group");
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'workflow.group_'||p_action,'workflow_task_group',v_group_id::text,
   jsonb_build_object('idempotencyKey',p_idempotency_key,'memberUserId',p_member_user_id));
 return query select 'updated'::text,"group";
exception when unique_violation then return query select 'conflict'::text,null::jsonb;
end $$;

create or replace function public.m1201_manage_absence(p_organization_id uuid,p_actor_user_id uuid,p_action text,p_absence_id uuid,
 p_starts_at timestamptz,p_ends_at timestamptz,p_substitute_user_id uuid,p_expected_version bigint,p_idempotency_key uuid)
returns table(outcome text,absence jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.workflow_out_of_office%rowtype; c public.workflow_task_commands%rowtype; v_digest text;
begin
 if not public.m1201_active_member(p_organization_id,p_actor_user_id) then return query select 'forbidden'::text,null::jsonb; return; end if;
 if p_idempotency_key is null or p_action is null or p_action not in ('create','delete') or (p_action='create' and
  (p_absence_id is not null or p_starts_at is null or p_ends_at is null or p_starts_at>=p_ends_at
   or p_ends_at>p_starts_at+interval '365 days' or p_substitute_user_id is null or p_substitute_user_id=p_actor_user_id))
  or (p_action='delete' and (p_absence_id is null or p_expected_version is null)) then
  return query select 'invalid_request'::text,null::jsonb; return; end if;
 perform 1 from public.organization_permissions_version x where x.organization_id=p_organization_id for share;
 if not found then return query select 'forbidden'::text,null::jsonb; return; end if;
 perform 1 from public.users u where u.id=p_actor_user_id and u.is_active for share;
 if not found or not public.m1201_active_member(p_organization_id,p_actor_user_id) then
  return query select 'forbidden'::text,null::jsonb; return; end if;
 if p_action='create' then
  perform 1 from public.users u where u.id=p_substitute_user_id and u.is_active for share;
  if not found or not public.m1201_active_member(p_organization_id,p_substitute_user_id) then
   return query select 'invalid_request'::text,null::jsonb; return; end if;
 end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('action',p_action,'id',p_absence_id,'startsAt',p_starts_at,
  'endsAt',p_ends_at,'substituteId',p_substitute_user_id,'version',p_expected_version)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0));
 select * into c from public.workflow_task_commands where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
 if found then
  if c.request_digest<>v_digest then return query select 'conflict'::text,null::jsonb;
  else return query select 'replayed'::text,c.result; end if; return; end if;
 if p_action='create' then
  if not public.m1201_active_member(p_organization_id,p_substitute_user_id) then return query select 'invalid_request'::text,null::jsonb; return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||least(p_actor_user_id,p_substitute_user_id)::text||':absence',0));
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||greatest(p_actor_user_id,p_substitute_user_id)::text||':absence',0));
  if exists(select 1 from public.workflow_out_of_office x where x.organization_id=p_organization_id
    and (x.user_id=p_actor_user_id or x.user_id=p_substitute_user_id or x.substitute_user_id=p_actor_user_id)
    and tstzrange(x.starts_at,x.ends_at,'[)') && tstzrange(p_starts_at,p_ends_at,'[)')) then
   return query select 'conflict'::text,null::jsonb; return; end if;
  insert into public.workflow_out_of_office(id,organization_id,user_id,substitute_user_id,starts_at,ends_at)
   values(p_idempotency_key,p_organization_id,p_actor_user_id,p_substitute_user_id,p_starts_at,p_ends_at) returning * into a;
  absence:=public.m1201_absence_json(p_organization_id,a.id);
 else
  select * into a from public.workflow_out_of_office x where x.organization_id=p_organization_id and x.id=p_absence_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if a.user_id<>p_actor_user_id and not public.m1201_group_admin(p_organization_id,p_actor_user_id) then
   return query select 'forbidden'::text,null::jsonb; return; end if;
  if a.version<>p_expected_version then return query select 'conflict'::text,public.m1201_absence_json(p_organization_id,a.id); return; end if;
  delete from public.workflow_out_of_office where organization_id=p_organization_id and id=a.id;
  absence:=null;
 end if;
 insert into public.workflow_task_commands(organization_id,actor_user_id,idempotency_key,action,request_digest,outcome,result)
  values(p_organization_id,p_actor_user_id,p_idempotency_key,'absence.'||p_action,v_digest,'updated',absence);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'workflow.absence_'||p_action,'workflow_out_of_office',a.id::text,
   jsonb_build_object('idempotencyKey',p_idempotency_key,'userId',a.user_id,'substituteUserId',a.substitute_user_id,
    'startsAt',a.starts_at,'endsAt',a.ends_at));
 return query select 'updated'::text,absence;
end $$;
