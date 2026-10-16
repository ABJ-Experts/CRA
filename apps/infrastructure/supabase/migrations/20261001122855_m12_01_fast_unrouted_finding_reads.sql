-- Project unrouted M5 triage rows as a set. Source and actor permissions are
-- checked once per read, and owner eligibility once per distinct owner.
-- Routed rows and every other source retain the existing per-row policy path.

create or replace function public.m1201_list_tasks(p_organization_id uuid,p_actor_user_id uuid,p_scope text,p_type text,
 p_state text,p_owner_user_id uuid,p_due_from timestamptz,p_due_to timestamptz,p_cursor text,p_limit integer)
returns table(outcome text,tasks jsonb,next_cursor text,counts jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_filter text; v_cursor jsonb; v_after_due timestamptz; v_after_type text; v_after_id uuid;
 v_rows jsonb; v_extra jsonb; v_counts jsonb; v_last jsonb;
begin
 if not public.m1201_active_member(p_organization_id,p_actor_user_id) or p_scope is null or p_limit is null or p_scope not in ('mine','group','available','all')
   or p_limit not between 1 and 100 or (p_type is not null and p_type not in ('finding_triage','finding_approval','report_approval','evidence_expiry','supplier_request'))
   or (p_state is not null and p_state not in ('open','overdue','unavailable')) or p_due_from>p_due_to then
  return query select 'invalid_request'::text,null::jsonb,null::text,null::jsonb; return; end if;
 v_filter:=encode(extensions.digest(jsonb_build_object('org',p_organization_id,'actor',p_actor_user_id,'scope',p_scope,
  'type',p_type,'state',p_state,'owner',p_owner_user_id,'from',p_due_from,'to',p_due_to)::text,'sha256'),'hex');
 if p_cursor is not null then
  begin
   if char_length(p_cursor) not between 1 and 2048 or p_cursor !~ '^[A-Za-z0-9_-]+$' then raise exception 'bad cursor'; end if;
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
   where organization_id=p_organization_id and state='open'
  union all select task_type,source_id from public.workflow_task_routes where organization_id=p_organization_id
 ), unique_candidate as (
  select distinct task_type,source_id from candidate
 ), finding_access as materialized (
  select public.m1201_source_can(p_organization_id,p_actor_user_id,'finding_triage',false) can_view,
   public.m1201_source_can(p_organization_id,p_actor_user_id,'finding_triage',true) can_edit
 ), fast_finding_source as materialized (
  select f.id source_id,coalesce(s.assignee_user_id,p.responsible_owner_id) owner_user_id,
   left(f.canonical_advisory_id,500) title,
   to_char(public.m1201_finding_triage_due_at(f.organization_id,f.id) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') due_at,
   coalesce(s.version,1)::text source_revision
  from public.vulnerability_findings f
  join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
  join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
  left join public.vulnerability_finding_triage_states s on s.organization_id=f.organization_id and s.finding_id=f.id
  cross join finding_access access
  where f.organization_id=p_organization_id and (p_type is null or p_type='finding_triage')
   and access.can_view and f.status='active' and (f.human_verdict is null or f.reevaluation_state='review_required')
   and r.archived_at is null and p.archived_at is null
   and not exists(select 1 from public.vulnerability_finding_suppressions x where x.organization_id=f.organization_id
    and x.finding_id=f.id and x.is_current and x.ended_at is null and x.expires_at>now())
   and not exists(select 1 from public.workflow_task_routes tr where tr.organization_id=f.organization_id
    and tr.task_type='finding_triage' and tr.source_id=f.id)
 ), fast_owner_access as materialized (
  select owners.owner_user_id,
   public.m1201_eligible_actor_prechecked(p_organization_id,owners.owner_user_id,'finding_triage',null,true) eligible
  from (select distinct owner_user_id from fast_finding_source where owner_user_id is not null) owners
 ), fast_finding_rows as (
  select 'finding_triage'::text task_type,src.source_id,
   jsonb_build_object('organizationId',p_organization_id,'taskType','finding_triage','sourceId',src.source_id,
    'title',src.title,'sourceUrl','/findings?findingId='||src.source_id,'dueAt',src.due_at,
    'state',case when src.due_at::timestamptz<now() then 'overdue' else 'open' end,
    'sourceRevision',src.source_revision,'routeVersion',0,'accountableOwnerUserId',src.owner_user_id,
    'effectiveAssigneeUserId',case when owner_access.eligible then src.owner_user_id else null end,
    'actingUserId',case when owner_access.eligible then
      case when absence.substitute_user_id is not null and substitute.eligible then absence.substitute_user_id
       else src.owner_user_id end else null end,
    'groupId',null,'delegatedToUserId',null,'delegationExpiresAt',null,
    'unresolvedAssignment',(src.owner_user_id is not null and not coalesce(owner_access.eligible,false))
      or (absence.substitute_user_id is not null and not coalesce(substitute.eligible,false)),
    'canAssign',access.can_edit,'canClaim',false,
    'canDelegate',coalesce(src.owner_user_id=p_actor_user_id and owner_access.eligible,false)
     and absence.substitute_user_id is null) task
  from fast_finding_source src
  cross join finding_access access
  left join fast_owner_access owner_access on owner_access.owner_user_id=src.owner_user_id
  left join lateral (select a.substitute_user_id from public.workflow_out_of_office a
   where a.organization_id=p_organization_id and a.user_id=src.owner_user_id
    and a.starts_at<=now() and a.ends_at>now() limit 1) absence on owner_access.eligible
  left join lateral (select public.m1201_eligible_actor_prechecked(p_organization_id,absence.substitute_user_id,
    'finding_triage',null,true) and not exists(select 1 from public.workflow_out_of_office x
    where x.organization_id=p_organization_id and x.user_id=absence.substitute_user_id
     and x.starts_at<=now() and x.ends_at>now()) eligible) substitute on absence.substitute_user_id is not null
 ), rows as materialized (
  select c.task_type,c.source_id,public.m1201_task_row(p_organization_id,p_actor_user_id,c.task_type,c.source_id) task
  from unique_candidate c where (p_type is null or c.task_type=p_type)
   and (c.task_type<>'finding_triage' or exists(select 1 from public.workflow_task_routes tr
    where tr.organization_id=p_organization_id and tr.task_type='finding_triage' and tr.source_id=c.source_id))
  union all select task_type,source_id,task from fast_finding_rows
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
  select translate(trim(trailing '=' from replace(replace(encode(convert_to(jsonb_build_object('filter',v_filter,
   'due',coalesce(v_last->>'dueAt','infinity'),'type',v_last->>'taskType','id',v_last->>'sourceId')::text,'utf8'),'base64'),E'\n',''),E'\r','')),'+/','-_') into next_cursor;
 else next_cursor:=null; end if;
 return query select 'found'::text,v_rows,next_cursor,v_counts;
end $$;


-- An unresolved assignee must still serialize action flags as booleans.
create or replace function public.m1201_task_row(p_organization_id uuid,p_actor_user_id uuid,p_task_type text,p_source_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare s jsonb; r public.workflow_task_routes%rowtype; v_owner uuid; v_assignee uuid; v_acting uuid;
 v_unresolved boolean:=false; v_group_ok boolean; v_group_eligible boolean; v_claim_ok boolean; v_delegate_ok boolean; v_ooo public.workflow_out_of_office%rowtype;
 v_due timestamptz; v_state text;
begin
 s:=public.m1201_source(p_organization_id,p_actor_user_id,p_task_type,p_source_id);
 if s is null and not public.m1201_source_can(p_organization_id,p_actor_user_id,p_task_type,false) then return null; end if;
 select * into r from public.workflow_task_routes where organization_id=p_organization_id and task_type=p_task_type and source_id=p_source_id;
 if s is null then
  if r.source_id is null or r.product_id is null or not exists(select 1 from public.products p
    where p.organization_id=p_organization_id and p.id=r.product_id and p.archived_at is null) then return null; end if;
  v_state:='unavailable';
 elsif not coalesce((s->>'active')::boolean,false) then return null;
 else
  v_state:='open';
  v_due:=nullif(s->>'dueAt','')::timestamptz;
  if v_due is not null and v_due<now() then v_state:='overdue'; end if;
 end if;
 v_owner:=case when s is null then r.source_owner_user_id else (s->>'owner')::uuid end;
 if r.source_id is not null and s is not null and r.source_owner_user_id is distinct from v_owner then
  v_unresolved:=true;
  r.assignee_user_id:=null; r.group_id:=null; r.claimed_by_user_id:=null; r.delegated_to_user_id:=null; r.delegation_expires_at:=null;
 end if;
 v_assignee:=case when r.group_id is not null then null else coalesce(r.assignee_user_id,v_owner) end;
 if v_assignee is not null and (v_state='unavailable' and not public.m1201_active_member(p_organization_id,v_assignee)
   or v_state<>'unavailable' and not public.m1201_eligible_actor_prechecked(p_organization_id,v_assignee,p_task_type,p_source_id,coalesce((s->>'active')::boolean,false))) then
  v_unresolved:=true;
  v_assignee:=case when v_owner is not null and v_owner<>v_assignee
   and public.m1201_eligible_actor_prechecked(p_organization_id,v_owner,p_task_type,p_source_id,coalesce((s->>'active')::boolean,false)) then v_owner else null end;
 end if;
 v_group_ok:=r.group_id is not null and exists(select 1 from public.workflow_task_groups g
   where g.organization_id=p_organization_id and g.id=r.group_id);
 if r.group_id is not null and not v_group_ok then v_unresolved:=true; end if;
 v_group_eligible:=v_group_ok and exists(select 1 from public.workflow_task_group_members m
   where m.organization_id=p_organization_id and m.group_id=r.group_id and
    (v_state='unavailable' and public.m1201_active_member(p_organization_id,m.user_id)
     or v_state<>'unavailable' and public.m1201_eligible_actor_prechecked(p_organization_id,m.user_id,p_task_type,p_source_id,coalesce((s->>'active')::boolean,false))));
 if r.group_id is not null and not v_group_eligible then
  v_unresolved:=true;
  if v_state<>'unavailable' and v_owner is not null and public.m1201_eligible_actor_prechecked(p_organization_id,v_owner,p_task_type,p_source_id,coalesce((s->>'active')::boolean,false)) then
   v_assignee:=v_owner;
  end if;
 end if;
 v_claim_ok:=r.claimed_by_user_id is not null and v_group_ok and public.m1201_active_member(p_organization_id,r.claimed_by_user_id)
   and exists(select 1 from public.workflow_task_group_members m
   where m.organization_id=p_organization_id and m.group_id=r.group_id and m.user_id=r.claimed_by_user_id)
   and (v_state='unavailable' or public.m1201_eligible_actor_prechecked(p_organization_id,r.claimed_by_user_id,p_task_type,p_source_id,coalesce((s->>'active')::boolean,false)));
 if r.claimed_by_user_id is not null and not v_claim_ok then v_unresolved:=true; end if;
 if v_claim_ok then v_assignee:=r.claimed_by_user_id; end if;
 v_acting:=v_assignee;
 if r.delegated_to_user_id is not null then
  v_delegate_ok:=r.delegation_expires_at>now() and v_state<>'unavailable'
    and public.m1201_eligible_actor_prechecked(p_organization_id,r.delegated_to_user_id,p_task_type,p_source_id,coalesce((s->>'active')::boolean,false))
    and not exists(select 1 from public.workflow_out_of_office a where a.organization_id=p_organization_id
     and a.user_id=r.delegated_to_user_id and a.starts_at<=now() and a.ends_at>now());
  if v_delegate_ok then v_acting:=r.delegated_to_user_id; else v_unresolved:=true; end if;
 elsif v_assignee is not null then
  select * into v_ooo from public.workflow_out_of_office a where a.organization_id=p_organization_id and a.user_id=v_assignee
   and a.starts_at<=now() and a.ends_at>now() limit 1;
  if found then
   if v_state<>'unavailable' and public.m1201_eligible_actor_prechecked(p_organization_id,v_ooo.substitute_user_id,p_task_type,p_source_id,coalesce((s->>'active')::boolean,false))
    and not exists(select 1 from public.workflow_out_of_office x where x.organization_id=p_organization_id and x.user_id=v_ooo.substitute_user_id
      and x.starts_at<=now() and x.ends_at>now()) then v_acting:=v_ooo.substitute_user_id;
   else v_unresolved:=true; end if;
  end if;
 end if;
 return jsonb_build_object('organizationId',p_organization_id,'taskType',p_task_type,'sourceId',p_source_id,
  'title',case when v_state='unavailable' then null else s->>'title' end,
  'sourceUrl',case when v_state='unavailable' then null else s->>'url' end,
  'dueAt',case when v_state='unavailable' then null else s->>'dueAt' end,
  'state',v_state,'sourceRevision',case when v_state='unavailable' then null else s->>'revision' end,
  'routeVersion',coalesce(r.version,0),'accountableOwnerUserId',v_owner,
  'effectiveAssigneeUserId',v_assignee,'actingUserId',v_acting,
  'groupId',r.group_id,'delegatedToUserId',r.delegated_to_user_id,
  'delegationExpiresAt',case when r.delegation_expires_at is null then null else to_char(r.delegation_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
  'unresolvedAssignment',v_unresolved,
  'canAssign',v_state<>'unavailable' and public.m1201_assign_can_prechecked(p_organization_id,p_actor_user_id,p_task_type,p_source_id,coalesce((s->>'active')::boolean,false)),
  'canClaim',v_state<>'unavailable' and v_group_ok and not v_claim_ok and exists(select 1 from public.workflow_task_group_members m
    where m.organization_id=p_organization_id and m.group_id=r.group_id and m.user_id=p_actor_user_id)
    and not exists(select 1 from public.workflow_out_of_office a where a.organization_id=p_organization_id
     and a.user_id=p_actor_user_id and a.starts_at<=now() and a.ends_at>now())
    and public.m1201_eligible_actor_prechecked(p_organization_id,p_actor_user_id,p_task_type,p_source_id,coalesce((s->>'active')::boolean,false)),
  'canDelegate',v_state<>'unavailable' and coalesce(v_assignee=p_actor_user_id,false)
    and (r.delegated_to_user_id is null or r.delegation_expires_at<=now())
    and not exists(select 1 from public.workflow_out_of_office a where a.organization_id=p_organization_id
     and a.user_id=p_actor_user_id and a.starts_at<=now() and a.ends_at>now())
    and public.m1201_eligible_actor_prechecked(p_organization_id,p_actor_user_id,p_task_type,p_source_id,coalesce((s->>'active')::boolean,false)));
end $$;
