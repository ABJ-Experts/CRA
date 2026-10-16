-- Reuse the already-authorized live source projection within each task row.
-- Standalone route commands continue to use the source-checking wrappers.

create function public.m1201_eligible_actor_prechecked(p_organization_id uuid,p_actor_user_id uuid,p_task_type text,p_source_id uuid,p_source_active boolean)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.m1201_source_can(p_organization_id,p_actor_user_id,p_task_type,true)
 and coalesce(p_source_active,false)
 and not (p_task_type='finding_approval' and exists(select 1 from public.vulnerability_finding_assessments a
  where a.organization_id=p_organization_id and a.id=p_source_id and a.submitted_by=p_actor_user_id))
 and not (p_task_type='report_approval' and exists(select 1 from public.reporting_stage_drafts d
  where d.organization_id=p_organization_id and d.stage_id=p_source_id and
   (d.created_by_user_id=p_actor_user_id or exists(select 1 from public.reporting_stage_draft_revisions rev
    where rev.organization_id=d.organization_id and rev.draft_id=d.id and rev.changed_by_user_id=p_actor_user_id)))
  and not exists(select 1 from public.organization_members m where m.organization_id=p_organization_id
   and m.user_id=p_actor_user_id and m.role='owner'))
 and (p_task_type<>'supplier_request' or public.m1201_supplier_actor_can_act(p_organization_id,p_actor_user_id,p_source_id))
$$;

create function public.m1201_assign_can_prechecked(p_organization_id uuid,p_actor_user_id uuid,p_task_type text,p_source_id uuid,p_source_active boolean)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(p_source_active,false)
 and case when p_task_type='finding_approval' then public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_findings')
  when p_task_type='supplier_request' then public.m1201_supplier_actor_can_act(p_organization_id,p_actor_user_id,p_source_id)
  else public.m1201_source_can(p_organization_id,p_actor_user_id,p_task_type,true) end
$$;

revoke all on function public.m1201_eligible_actor_prechecked(uuid,uuid,text,uuid,boolean),
 public.m1201_assign_can_prechecked(uuid,uuid,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.m1201_eligible_actor_prechecked(uuid,uuid,text,uuid,boolean),
 public.m1201_assign_can_prechecked(uuid,uuid,text,uuid,boolean) to service_role;

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
  'canDelegate',v_state<>'unavailable' and v_assignee=p_actor_user_id
    and (r.delegated_to_user_id is null or r.delegation_expires_at<=now())
    and not exists(select 1 from public.workflow_out_of_office a where a.organization_id=p_organization_id
     and a.user_id=p_actor_user_id and a.starts_at<=now() and a.ends_at>now())
    and public.m1201_eligible_actor_prechecked(p_organization_id,p_actor_user_id,p_task_type,p_source_id,coalesce((s->>'active')::boolean,false)));
end $$;
