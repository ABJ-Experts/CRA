-- Fence user deactivation against a security-critical routing ACK.
-- A user update waits for these SHARE row locks; after prior deactivation commits, the recheck denies the command.

create or replace function public.m1201_route_task(p_organization_id uuid,p_actor_user_id uuid,p_task_type text,p_source_id uuid,
 p_action text,p_target_user_id uuid,p_group_id uuid,p_expected_route_version bigint,p_expected_source_revision text,
 p_idempotency_key uuid,p_delegation_expires_at timestamptz)
returns table(outcome text,task jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.workflow_task_routes%rowtype; c public.workflow_task_commands%rowtype; s jsonb; v_row jsonb;
 v_digest text; v_owner uuid; v_product uuid; v_assignee uuid; v_source_result record;
begin
 if not public.m1201_source_can(p_organization_id,p_actor_user_id,p_task_type,false) then
  return query select 'not_found'::text,null::jsonb; return; end if;
 if p_source_id is null or p_idempotency_key is null or p_expected_route_version is null or p_expected_route_version<0
  or p_expected_source_revision is null or char_length(p_expected_source_revision) not between 1 and 256
  or p_action is null or p_action not in ('assign','claim','release','delegate','revoke_delegation')
  or (p_action<>'assign' and (p_group_id is not null or (p_action<>'delegate' and p_target_user_id is not null)))
  or (p_action<>'delegate' and p_delegation_expires_at is not null)
  or (p_action='assign' and p_target_user_id is not null and p_group_id is not null)
  or (p_action='delegate' and (p_target_user_id is null or p_target_user_id=p_actor_user_id
   or p_delegation_expires_at is null or p_delegation_expires_at<=clock_timestamp()
   or p_delegation_expires_at>clock_timestamp()+interval '365 days')) then
  return query select 'invalid_request'::text,null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('type',p_task_type,'source',p_source_id,'action',p_action,
  'target',p_target_user_id,'group',p_group_id,'routeVersion',p_expected_route_version,
  'sourceRevision',p_expected_source_revision,'expiresAt',p_delegation_expires_at)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0));
 select * into c from public.workflow_task_commands where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
 if found then
  if c.request_digest<>v_digest then return query select 'conflict'::text,null::jsonb; return; end if;
  v_row:=public.m1201_task_row(p_organization_id,p_actor_user_id,p_task_type,p_source_id);
  if v_row is null then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_row->'routeVersion' is distinct from c.result->'routeVersion'
   or v_row->'sourceRevision' is distinct from c.result->'sourceRevision' then
   return query select 'conflict'::text,v_row; return; end if;
  return query select 'replayed'::text,v_row; return;
 end if;
 -- The permission-version row serializes with role/override writes. Source row locks
 -- serialize the revision check with source completion and owner changes.
 perform 1 from public.organization_permissions_version x where x.organization_id=p_organization_id for share;
 perform 1 from public.users u where u.id=p_actor_user_id and u.is_active for share;
 if not found or not public.m1201_source_can(p_organization_id,p_actor_user_id,p_task_type,false) then
  return query select 'not_found'::text,null::jsonb; return; end if;
 if p_target_user_id is not null then
  perform 1 from public.users u where u.id=p_target_user_id and u.is_active for share;
  if not found then return query select 'invalid_request'::text,null::jsonb; return; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_task_type||':'||p_source_id::text,0));
 if p_task_type='finding_triage' then
  perform 1 from public.vulnerability_findings x where x.organization_id=p_organization_id and x.id=p_source_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  perform 1 from public.vulnerability_finding_triage_states x where x.organization_id=p_organization_id and x.finding_id=p_source_id for update;
 elsif p_task_type='finding_approval' then
  perform 1 from public.vulnerability_finding_assessments x where x.organization_id=p_organization_id and x.id=p_source_id for update;
 elsif p_task_type='report_approval' then
  perform 1 from public.reporting_stage_drafts x where x.organization_id=p_organization_id and x.stage_id=p_source_id for update;
  perform 1 from public.reporting_obligations o join public.reporting_obligation_stages s
   on s.organization_id=o.organization_id and s.obligation_id=o.id
   where s.organization_id=p_organization_id and s.id=p_source_id for update of o;
  perform 1 from public.reporting_obligation_stages x where x.organization_id=p_organization_id and x.id=p_source_id for update;
 elsif p_task_type='evidence_expiry' then
  perform 1 from public.evidence_documents x join public.evidence_document_versions v on v.organization_id=x.organization_id and v.document_id=x.id
   where v.organization_id=p_organization_id and v.id=p_source_id for update of x;
 elsif p_task_type='supplier_request' then
  perform 1 from public.supplier_evidence_requests x where x.organization_id=p_organization_id and x.id=p_source_id for update;
 end if;
 s:=public.m1201_source(p_organization_id,p_actor_user_id,p_task_type,p_source_id);
 if s is null or not coalesce((s->>'active')::boolean,false) then return query select 'not_found'::text,null::jsonb; return; end if;
 perform 1 from public.products p where p.organization_id=p_organization_id and p.id=(s->>'productId')::uuid
  and p.archived_at is null for share;
 if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 if not public.m1201_source_can(p_organization_id,p_actor_user_id,p_task_type,false) then
  return query select 'not_found'::text,null::jsonb; return; end if;
 select * into r from public.workflow_task_routes x where x.organization_id=p_organization_id and x.task_type=p_task_type and x.source_id=p_source_id for update;
 if coalesce(r.version,0)<>p_expected_route_version or s->>'revision'<>p_expected_source_revision then
  return query select 'conflict'::text,public.m1201_task_row(p_organization_id,p_actor_user_id,p_task_type,p_source_id); return; end if;
 if r.source_id is not null and r.source_owner_user_id is distinct from (s->>'owner')::uuid and p_action<>'assign' then
  return query select 'conflict'::text,public.m1201_task_row(p_organization_id,p_actor_user_id,p_task_type,p_source_id); return; end if;
 v_owner:=(s->>'owner')::uuid; v_product:=(s->>'productId')::uuid;
 v_row:=public.m1201_task_row(p_organization_id,p_actor_user_id,p_task_type,p_source_id);
 if p_action='assign' then
  if not public.m1201_assign_can(p_organization_id,p_actor_user_id,p_task_type,p_source_id) then
   return query select 'forbidden'::text,null::jsonb; return; end if;
  if p_target_user_id is not null and not public.m1201_eligible_actor(p_organization_id,p_target_user_id,p_task_type,p_source_id) then
   return query select 'invalid_request'::text,null::jsonb; return; end if;
  if p_group_id is not null then
   perform 1 from public.workflow_task_groups g where g.organization_id=p_organization_id and g.id=p_group_id for share;
   if not found or not exists(select 1 from public.workflow_task_group_members m where m.organization_id=p_organization_id
     and m.group_id=p_group_id and public.m1201_eligible_actor(p_organization_id,m.user_id,p_task_type,p_source_id)) then
    return query select 'invalid_request'::text,null::jsonb; return; end if;
  end if;
  if p_task_type='finding_triage' and p_group_id is null then
   select * into v_source_result from public.assign_finding_triage_atomic(p_organization_id,p_actor_user_id,p_source_id,
    p_target_user_id,(s->>'revision')::integer,p_idempotency_key,null);
   if v_source_result.outcome not in ('updated','replayed') then
    return query select case when v_source_result.outcome='conflict' then 'conflict' else 'invalid_request' end,null::jsonb; return; end if;
   s:=public.m1201_source(p_organization_id,p_actor_user_id,p_task_type,p_source_id);
   v_owner:=(s->>'owner')::uuid;
  end if;
  insert into public.workflow_task_routes(organization_id,task_type,source_id,product_id,source_owner_user_id,
   assignee_user_id,group_id,updated_by)
   values(p_organization_id,p_task_type,p_source_id,v_product,v_owner,
    case when p_task_type='finding_triage' then null else p_target_user_id end,p_group_id,p_actor_user_id)
   on conflict(organization_id,task_type,source_id) do update set product_id=excluded.product_id,
    source_owner_user_id=excluded.source_owner_user_id,assignee_user_id=excluded.assignee_user_id,
    group_id=excluded.group_id,claimed_by_user_id=null,delegated_to_user_id=null,delegation_expires_at=null,
    version=public.workflow_task_routes.version+1,updated_by=p_actor_user_id,updated_at=clock_timestamp();
 elsif p_action='claim' then
  if r.source_id is null or r.group_id is null or not public.m1201_eligible_actor(p_organization_id,p_actor_user_id,p_task_type,p_source_id)
   or exists(select 1 from public.workflow_out_of_office a where a.organization_id=p_organization_id and a.user_id=p_actor_user_id
    and a.starts_at<=clock_timestamp() and a.ends_at>clock_timestamp()) then
   return query select 'forbidden'::text,null::jsonb; return; end if;
  perform 1 from public.workflow_task_groups g where g.organization_id=p_organization_id and g.id=r.group_id for share;
  if not exists(select 1 from public.workflow_task_group_members m where m.organization_id=p_organization_id
    and m.group_id=r.group_id and m.user_id=p_actor_user_id) then return query select 'forbidden'::text,null::jsonb; return; end if;
  if r.claimed_by_user_id is not null and public.m1201_eligible_actor(p_organization_id,r.claimed_by_user_id,p_task_type,p_source_id)
    and exists(select 1 from public.workflow_task_group_members m where m.organization_id=p_organization_id and m.group_id=r.group_id and m.user_id=r.claimed_by_user_id) then
   return query select 'conflict'::text,v_row; return; end if;
  update public.workflow_task_routes set claimed_by_user_id=p_actor_user_id,delegated_to_user_id=null,delegation_expires_at=null,
   version=version+1,updated_by=p_actor_user_id,updated_at=clock_timestamp()
   where organization_id=p_organization_id and task_type=p_task_type and source_id=p_source_id;
 elsif p_action='release' then
  if r.source_id is null or r.claimed_by_user_id is distinct from p_actor_user_id then
   return query select 'forbidden'::text,null::jsonb; return; end if;
  update public.workflow_task_routes set claimed_by_user_id=null,delegated_to_user_id=null,delegation_expires_at=null,
   version=version+1,updated_by=p_actor_user_id,updated_at=clock_timestamp()
   where organization_id=p_organization_id and task_type=p_task_type and source_id=p_source_id;
 elsif p_action='delegate' then
  if (v_row->>'effectiveAssigneeUserId')::uuid is distinct from p_actor_user_id
    or not public.m1201_eligible_actor(p_organization_id,p_actor_user_id,p_task_type,p_source_id)
    or exists(select 1 from public.workflow_out_of_office a where a.organization_id=p_organization_id and a.user_id=p_actor_user_id
     and a.starts_at<=clock_timestamp() and a.ends_at>clock_timestamp())
    or (r.delegated_to_user_id is not null and r.delegation_expires_at>clock_timestamp()) then
   return query select 'forbidden'::text,null::jsonb; return; end if;
  if not public.m1201_eligible_actor(p_organization_id,p_target_user_id,p_task_type,p_source_id)
    or exists(select 1 from public.workflow_out_of_office a where a.organization_id=p_organization_id
     and a.user_id=p_target_user_id and tstzrange(a.starts_at,a.ends_at,'[)') && tstzrange(clock_timestamp(),p_delegation_expires_at,'[)'))
    or exists(select 1 from public.workflow_out_of_office a where a.organization_id=p_organization_id
     and a.substitute_user_id=p_actor_user_id and a.starts_at<=clock_timestamp() and a.ends_at>clock_timestamp()) then
   return query select 'invalid_request'::text,null::jsonb; return; end if;
  if r.source_id is null then
   insert into public.workflow_task_routes(organization_id,task_type,source_id,product_id,source_owner_user_id,
    updated_by,delegated_to_user_id,delegation_expires_at)
    values(p_organization_id,p_task_type,p_source_id,v_product,v_owner,p_actor_user_id,p_target_user_id,p_delegation_expires_at);
  else
   update public.workflow_task_routes set delegated_to_user_id=p_target_user_id,delegation_expires_at=p_delegation_expires_at,
    version=version+1,updated_by=p_actor_user_id,updated_at=clock_timestamp()
    where organization_id=p_organization_id and task_type=p_task_type and source_id=p_source_id;
  end if;
 else
  if r.source_id is null or r.delegated_to_user_id is null or ((v_row->>'effectiveAssigneeUserId')::uuid is distinct from p_actor_user_id
    and not public.m1201_source_can(p_organization_id,p_actor_user_id,p_task_type,true)) then
   return query select 'forbidden'::text,null::jsonb; return; end if;
  update public.workflow_task_routes set delegated_to_user_id=null,delegation_expires_at=null,
   version=version+1,updated_by=p_actor_user_id,updated_at=clock_timestamp()
   where organization_id=p_organization_id and task_type=p_task_type and source_id=p_source_id;
 end if;
 task:=public.m1201_task_row(p_organization_id,p_actor_user_id,p_task_type,p_source_id);
 insert into public.workflow_task_commands(organization_id,actor_user_id,idempotency_key,action,request_digest,outcome,result)
  values(p_organization_id,p_actor_user_id,p_idempotency_key,'task.'||p_action,v_digest,'updated',
   jsonb_build_object('taskType',p_task_type,'sourceId',p_source_id,'routeVersion',task->'routeVersion',
    'sourceRevision',task->'sourceRevision'));
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'workflow.task_'||p_action,'workflow_task_route',p_source_id::text,
   jsonb_build_object('taskType',p_task_type,'idempotencyKey',p_idempotency_key,'targetUserId',p_target_user_id,'groupId',p_group_id,
    'routeVersion',task->'routeVersion'));
 return query select 'updated'::text,task;
end $$;

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
