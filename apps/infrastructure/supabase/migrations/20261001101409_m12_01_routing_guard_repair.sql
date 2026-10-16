create or replace function public.m1201_active_member(p_organization_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id
  join public.organizations o on o.id=m.organization_id and o.is_active
  where m.organization_id=p_organization_id and m.user_id=p_user_id and u.is_active)
$$;

-- Serialized source-linked route changes. Source workflows remain authoritative.
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
  or p_action not in ('assign','claim','release','delegate','revoke_delegation')
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

revoke all on function public.m1201_route_task(uuid,uuid,text,uuid,text,uuid,uuid,bigint,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.m1201_route_task(uuid,uuid,text,uuid,text,uuid,uuid,bigint,text,uuid,timestamptz) to service_role;
create or replace function public.m1201_list_tasks(p_organization_id uuid,p_actor_user_id uuid,p_scope text,p_type text,
 p_state text,p_owner_user_id uuid,p_due_from timestamptz,p_due_to timestamptz,p_cursor text,p_limit integer)
returns table(outcome text,tasks jsonb,next_cursor text,counts jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_filter text; v_cursor jsonb; v_after_due timestamptz; v_after_type text; v_after_id uuid;
 v_rows jsonb; v_extra jsonb; v_counts jsonb; v_last jsonb;
begin
 if not public.m1201_active_member(p_organization_id,p_actor_user_id) or p_scope not in ('mine','group','available','all')
   or p_limit not between 1 and 100 or (p_type is not null and p_type not in ('finding_triage','finding_approval','report_approval','evidence_expiry','supplier_request'))
   or (p_state is not null and p_state not in ('open','overdue','unavailable')) or p_due_from>p_due_to then
  return query select 'invalid_request'::text,null::jsonb,null::text,null::jsonb; return; end if;
 v_filter:=encode(extensions.digest(jsonb_build_object('org',p_organization_id,'actor',p_actor_user_id,'scope',p_scope,
  'type',p_type,'state',p_state,'owner',p_owner_user_id,'from',p_due_from,'to',p_due_to)::text,'sha256'),'hex');
 if p_cursor is not null then
  begin
   if p_cursor !~ '^[A-Za-z0-9_-]{1,2048}$' then raise exception 'bad cursor'; end if;
   v_cursor:=convert_from(decode(translate(p_cursor,'-_','+/')||repeat('=',(4-length(p_cursor)%4)%4),'base64'),'utf8')::jsonb;
   if v_cursor->>'filter' is distinct from v_filter then raise exception 'filter mismatch'; end if;
   v_after_due:=(v_cursor->>'due')::timestamptz; v_after_type:=v_cursor->>'type'; v_after_id:=(v_cursor->>'id')::uuid;
   if v_after_due is null or v_after_id is null or v_after_type not in ('finding_triage','finding_approval','report_approval','evidence_expiry','supplier_request') then
    raise exception 'incomplete cursor'; end if;
  exception when others then return query select 'invalid_request'::text,null::jsonb,null::text,null::jsonb; return; end;
 end if;
 with candidate as (
  select 'finding_triage'::text task_type,id source_id from public.vulnerability_findings
   where organization_id=p_organization_id and status='active' and (human_verdict is null or reevaluation_state='review_required')
  union all select 'finding_approval',id from public.vulnerability_finding_assessments where organization_id=p_organization_id and is_current and approval_state='awaiting_approval'
  union all select 'report_approval',s.id from public.reporting_obligation_stages s
   join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id
   join public.reporting_stage_drafts d on d.organization_id=s.organization_id and d.stage_id=s.id
   where s.organization_id=p_organization_id and s.state in ('running','overdue') and o.status='active' and not o.is_rehearsal
  union all select 'evidence_expiry',v.id from public.evidence_document_versions v
   join public.evidence_documents d on d.organization_id=v.organization_id and d.current_version_id=v.id
   join public.organization_settings settings on settings.organization_id=v.organization_id
   where v.organization_id=p_organization_id and d.lifecycle_state='active' and v.processing_state='clean'
    and v.validity_ends_on<=current_date+coalesce((select max(x) from unnest(settings.evidence_expiry_alert_intervals) x),0)
  union all select 'supplier_request',id from public.supplier_evidence_requests
   where organization_id=p_organization_id and state='open' and review_state<>'accepted'
  union all select task_type,source_id from public.workflow_task_routes where organization_id=p_organization_id
 ), unique_candidate as (
  select distinct task_type,source_id from candidate
 ), rows as (
  select c.task_type,c.source_id,public.m1201_task_row(p_organization_id,p_actor_user_id,c.task_type,c.source_id) task
  from unique_candidate c where p_type is null or c.task_type=p_type
 ), visible as (
  select r.task,r.task_type,r.source_id,coalesce((r.task->>'dueAt')::timestamptz,'infinity'::timestamptz) sort_due
  from rows r where r.task is not null and (p_state is null or r.task->>'state'=p_state)
   and (p_owner_user_id is null or (r.task->>'accountableOwnerUserId')::uuid=p_owner_user_id)
   and (p_due_from is null or (r.task->>'dueAt')::timestamptz>=p_due_from)
   and (p_due_to is null or (r.task->>'dueAt')::timestamptz<=p_due_to)
 ), scoped as (
  select x.*,case when (x.task->>'effectiveAssigneeUserId')::uuid=p_actor_user_id or (x.task->>'actingUserId')::uuid=p_actor_user_id then true else false end mine,
   exists(select 1 from public.workflow_task_group_members m where m.organization_id=p_organization_id
    and m.group_id=(x.task->>'groupId')::uuid and m.user_id=p_actor_user_id) member_group
  from visible x
 ), matching as (
  select * from scoped where p_scope='all' or (p_scope='mine' and mine)
   or (p_scope='group' and member_group) or (p_scope='available' and member_group and task->>'effectiveAssigneeUserId' is null)
 ), page as (
  select * from matching where v_after_id is null or (sort_due,task_type,source_id)>(v_after_due,v_after_type,v_after_id)
  order by sort_due,task_type,source_id limit p_limit+1
 )
 select coalesce((select jsonb_agg(task order by sort_due,task_type,source_id) from (select * from page limit p_limit) q),'[]'::jsonb),
  (select jsonb_build_object('mine',count(*) filter(where mine),'group',count(*) filter(where member_group),
   'available',count(*) filter(where member_group and task->>'effectiveAssigneeUserId' is null)) from scoped),
  (select to_jsonb(q) from (select sort_due,task_type,source_id from page order by sort_due,task_type,source_id offset p_limit limit 1) q)
 into v_rows,v_counts,v_extra;
 if v_extra is not null and jsonb_array_length(v_rows)>0 then v_last:=v_rows->(jsonb_array_length(v_rows)-1); end if;
 if v_extra is not null and jsonb_array_length(v_rows)>0 then
  select translate(trim(trailing '=' from encode(convert_to(jsonb_build_object('filter',v_filter,
   'due',coalesce(v_last->>'dueAt','infinity'),'type',v_last->>'taskType','id',v_last->>'sourceId')::text,'utf8'),'base64')),'+/','-_') into next_cursor;
 else next_cursor:=null; end if;
 return query select 'found'::text,v_rows,next_cursor,v_counts;
end $$;
