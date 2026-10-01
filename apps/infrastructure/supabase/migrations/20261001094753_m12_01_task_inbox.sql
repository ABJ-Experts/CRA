-- M12-01 stores routing, never a second copy of source task state.
create table public.workflow_task_groups (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null check (char_length(btrim(name)) between 1 and 100 and name=btrim(name)),
 version bigint not null default 1 check(version>0),
 created_by uuid not null references public.users(id),
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(organization_id,id)
);
create unique index workflow_task_groups_org_name on public.workflow_task_groups(organization_id,lower(name));

create table public.workflow_task_group_members (
 organization_id uuid not null,
 group_id uuid not null,
 user_id uuid not null,
 added_by uuid not null references public.users(id),
 added_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,group_id,user_id),
 foreign key(organization_id,group_id) references public.workflow_task_groups(organization_id,id) on delete cascade,
 foreign key(organization_id,user_id) references public.organization_members(organization_id,user_id) on delete cascade
);
create index workflow_task_group_members_user on public.workflow_task_group_members(organization_id,user_id,group_id);

create table public.workflow_task_routes (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 task_type text not null check(task_type in ('finding_triage','finding_approval','report_approval','evidence_expiry','supplier_request')),
 source_id uuid not null,
 product_id uuid,
 source_owner_user_id uuid references public.users(id),
 assignee_user_id uuid references public.users(id),
 group_id uuid,
 claimed_by_user_id uuid references public.users(id),
 delegated_to_user_id uuid references public.users(id),
 delegation_expires_at timestamptz,
 version bigint not null default 1 check(version>0),
 updated_by uuid not null references public.users(id),
 updated_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,task_type,source_id),
 foreign key(organization_id,group_id) references public.workflow_task_groups(organization_id,id) on delete set null (group_id),
 check((delegated_to_user_id is null)=(delegation_expires_at is null)),
 check(group_id is not null or claimed_by_user_id is null)
);
create index workflow_task_routes_assignee on public.workflow_task_routes(organization_id,assignee_user_id,task_type,source_id);
create index workflow_task_routes_group on public.workflow_task_routes(organization_id,group_id,task_type,source_id) where group_id is not null;

create table public.workflow_out_of_office (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references public.users(id),
 substitute_user_id uuid not null references public.users(id),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 version bigint not null default 1 check(version>0),
 created_at timestamptz not null default clock_timestamp(),
 check(starts_at<ends_at and ends_at<=starts_at+interval '365 days' and user_id<>substitute_user_id)
);
create index workflow_out_of_office_substitute on public.workflow_out_of_office(organization_id,substitute_user_id,starts_at,ends_at);
create index workflow_out_of_office_user_time on public.workflow_out_of_office(organization_id,user_id,starts_at,ends_at);

create table public.workflow_task_commands (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 actor_user_id uuid not null references public.users(id),
 idempotency_key uuid not null,
 action text not null,
 request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'),
 outcome text not null,
 result jsonb,
 created_at timestamptz not null default clock_timestamp(),
 unique(organization_id,actor_user_id,idempotency_key)
);

alter table public.workflow_task_groups enable row level security;
alter table public.workflow_task_group_members enable row level security;
alter table public.workflow_task_routes enable row level security;
alter table public.workflow_out_of_office enable row level security;
alter table public.workflow_task_commands enable row level security;
revoke all on public.workflow_task_groups,public.workflow_task_group_members,public.workflow_task_routes,
 public.workflow_out_of_office,public.workflow_task_commands from public,anon,authenticated,service_role;

create function public.m1201_active_member(p_organization_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id
 where m.organization_id=p_organization_id and m.user_id=p_user_id and u.is_active)
$$;

create function public.m1201_group_admin(p_organization_id uuid,p_actor_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id
 where m.organization_id=p_organization_id and m.user_id=p_actor_user_id and m.role in ('owner','admin') and u.is_active)
$$;

-- The M5 SQL resolver predates the approval key. Mirror its merge order for
-- source-owned approver eligibility without changing that shared function's callers.
create function public.m1201_source_permission(p_organization_id uuid,p_actor_user_id uuid,p_permission_key text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 with membership as (
  select m.role from public.organization_members m join public.users u on u.id=m.user_id and u.is_active
   join public.organizations o on o.id=m.organization_id and o.is_active
   where m.organization_id=p_organization_id and m.user_id=p_actor_user_id
 ), base_permission as (
  select role,role in ('owner','admin') granted from membership
 ), custom_permission as (
  select bool_or((r.permissions->>p_permission_key)::boolean) granted from membership
   join public.user_role_assignments a on a.organization_id=p_organization_id and a.user_id=p_actor_user_id
   join public.custom_roles r on r.organization_id=a.organization_id and r.id=a.role_id
   where r.is_active and not r.is_deleted and jsonb_typeof(r.permissions->p_permission_key)='boolean'
    and (r.permissions->>p_permission_key)::boolean
 ), override_permission as (
  select case when jsonb_typeof(x.permissions->p_permission_key)='boolean'
   then (x.permissions->>p_permission_key)::boolean end granted
   from base_permission b left join public.base_role_permission_overrides x
    on x.organization_id=p_organization_id and x.base_role=b.role
 ) select p_permission_key='can_approve_findings' and coalesce(
   (select granted from override_permission where granted is not null limit 1),
   (select coalesce(b.granted,false) or coalesce(c.granted,false) from base_permission b cross join custom_permission c),false)
$$;

create function public.m1201_source_can(p_organization_id uuid,p_actor_user_id uuid,p_task_type text,p_edit boolean)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.m1201_active_member(p_organization_id,p_actor_user_id)
  and public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_products') and case p_task_type
  when 'finding_triage' then public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,case when p_edit then 'can_edit_findings' else 'can_view_findings' end)
  when 'finding_approval' then case when p_edit then public.m1201_source_permission(p_organization_id,p_actor_user_id,'can_approve_findings')
   else public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings') end
  when 'report_approval' then public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,
   case when p_edit then 'can_submit_reporting' else 'can_view_findings' end)
  when 'evidence_expiry' then case when p_edit then public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_upload_evidence')
   else public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence') end
  when 'supplier_request' then case when p_edit then public.m9_03_internal_can_review(p_organization_id,p_actor_user_id)
    or public.m9_04_can_manage(p_organization_id,p_actor_user_id)
   else public.m9_02_internal_can(p_organization_id,p_actor_user_id,false) end
  else false end
$$;

-- Source projection is evaluated at read/action time; the route never contains a title or status.
create function public.m1201_source(p_organization_id uuid,p_actor_user_id uuid,p_task_type text,p_source_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v jsonb; v_state text;
begin
 if not public.m1201_source_can(p_organization_id,p_actor_user_id,p_task_type,false) then return null; end if;
 if p_task_type='finding_triage' then
  select jsonb_build_object('exists',true,'active',f.status='active' and (f.human_verdict is null or f.reevaluation_state='review_required')
    and not exists(select 1 from public.vulnerability_finding_suppressions x where x.organization_id=f.organization_id and x.finding_id=f.id and x.is_current and x.ended_at is null and x.expires_at>clock_timestamp())
    and p.archived_at is null and r.archived_at is null,
   'title',left(f.canonical_advisory_id,500),'dueAt',to_char((public.m5_triage_operational_json(f.organization_id,f.id)->'internalSla'->>'dueAt')::timestamptz
    at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
   'owner',coalesce(s.assignee_user_id,p.responsible_owner_id),'productId',p.id,'revision',coalesce(s.version,1)::text,
   'url','/findings?findingId='||f.id)
   into v from public.vulnerability_findings f join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
    join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
    left join public.vulnerability_finding_triage_states s on s.organization_id=f.organization_id and s.finding_id=f.id
   where f.organization_id=p_organization_id and f.id=p_source_id;
 elsif p_task_type='finding_approval' then
  select jsonb_build_object('exists',true,'active',a.is_current and a.approval_state='awaiting_approval' and f.status='active'
    and p.archived_at is null and r.archived_at is null,
   'title',left(f.canonical_advisory_id||' assessment',500),'dueAt',null,'owner',p.responsible_owner_id,
   'productId',p.id,'revision',a.version::text,'url','/findings?findingId='||f.id||'&assessmentId='||a.id)
   into v from public.vulnerability_finding_assessments a join public.vulnerability_findings f on f.organization_id=a.organization_id and f.id=a.finding_id
    join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
    join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
   where a.organization_id=p_organization_id and a.id=p_source_id;
 elsif p_task_type='report_approval' then
  select jsonb_build_object('exists',true,'active',o.status='active' and not o.is_rehearsal
    and s.state in ('running','overdue') and p.archived_at is null and r.archived_at is null
    and d.id is not null and public.m6_reporting_draft_complete(d.content,public.m6_reporting_stage_field_definitions(o.obligation_type,s.stage_kind),d.member_states)
    and public.m6_reporting_draft_payload_valid(d.content,d.field_provenance,d.member_states,o.obligation_type,s.stage_kind)
    and not coalesce((d.field_provenance->'_template'->>'reviewRequired')::boolean,false)
    and not exists(select 1 from public.reporting_stage_approvals a where a.organization_id=s.organization_id and a.stage_id=s.id and a.draft_id=d.id and a.draft_revision=d.version),
   'title',left(replace(s.stage_kind,'_',' ')||' report approval',500),'dueAt',to_char(s.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
   'owner',p.responsible_owner_id,'productId',p.id,'revision',s.version::text||':'||coalesce(d.version,0)::text,
   'url','/reporting?obligationId='||o.id||'&stageId='||s.id)
   into v from public.reporting_obligation_stages s join public.reporting_obligations o on o.organization_id=s.organization_id and o.id=s.obligation_id
    left join public.reporting_stage_drafts d on d.organization_id=s.organization_id and d.stage_id=s.id
    left join public.product_releases r on r.organization_id=d.organization_id and r.id=d.release_id
    left join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
   where s.organization_id=p_organization_id and s.id=p_source_id;
 elsif p_task_type='evidence_expiry' then
  select jsonb_build_object('exists',true,'active',d.current_version_id=v.id and d.lifecycle_state='active' and v.processing_state='clean'
    and p.archived_at is null and public.m8_evidence_validity_status(v.validity_starts_on,v.validity_ends_on,settings.evidence_expiry_alert_intervals) in ('expiring_soon','expired'),
   'title',left(v.title,500),'dueAt',to_char((v.validity_ends_on+1)::timestamp,'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
   'owner',v.owner_user_id,'productId',p.id,'revision',v.version_number::text,
   'url','/products/'||p.id||'/evidence?documentId='||d.id||'&versionId='||v.id)
   into v from public.evidence_document_versions v join public.evidence_documents d on d.organization_id=v.organization_id and d.id=v.document_id
    join public.evidence_document_version_products vp on vp.organization_id=v.organization_id and vp.version_id=v.id
    join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id
    join public.organization_settings settings on settings.organization_id=v.organization_id
   where v.organization_id=p_organization_id and v.id=p_source_id order by (p.archived_at is null) desc,p.id limit 1;
 elsif p_task_type='supplier_request' then
  select jsonb_build_object('exists',true,'active',q.state='open' and q.review_state<>'accepted' and p.archived_at is null
    and supplier.archived_at is null
    and public.m9_04_request_has_outstanding_required(q.organization_id,rev.id),
   'title',left(rev.portal_title,500),'dueAt',to_char(rev.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'owner',q.internal_owner_user_id,
   'productId',p.id,'revision',q.version::text||':'||rev.revision_number::text||':'||q.review_state,
   'url','/suppliers/'||q.supplier_id||'?requestId='||q.id)
   into v from public.supplier_evidence_requests q join public.supplier_evidence_request_revisions rev
    on rev.organization_id=q.organization_id and rev.id=q.current_revision_id
    join public.products p on p.organization_id=q.organization_id and p.id=q.product_id
    join public.supplier_organizations supplier on supplier.organization_id=q.organization_id and supplier.id=q.supplier_id
   where q.organization_id=p_organization_id and q.id=p_source_id;
 end if;
 return v;
end $$;

create function public.m1201_eligible_actor(p_organization_id uuid,p_actor_user_id uuid,p_task_type text,p_source_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.m1201_source_can(p_organization_id,p_actor_user_id,p_task_type,true)
 and coalesce((public.m1201_source(p_organization_id,p_actor_user_id,p_task_type,p_source_id)->>'active')::boolean,false)
 and not (p_task_type='finding_approval' and exists(select 1 from public.vulnerability_finding_assessments a
  where a.organization_id=p_organization_id and a.id=p_source_id and a.submitted_by=p_actor_user_id))
 and not (p_task_type='report_approval' and exists(select 1 from public.reporting_stage_drafts d
  where d.organization_id=p_organization_id and d.stage_id=p_source_id and
   (d.created_by_user_id=p_actor_user_id or exists(select 1 from public.reporting_stage_draft_revisions rev
    where rev.organization_id=d.organization_id and rev.draft_id=d.id and rev.changed_by_user_id=p_actor_user_id)))
  and not exists(select 1 from public.organization_members m where m.organization_id=p_organization_id
   and m.user_id=p_actor_user_id and m.role='owner'))
 and not (p_task_type='supplier_request' and exists(select 1 from public.supplier_evidence_requests q
  where q.organization_id=p_organization_id and q.id=p_source_id and
   ((q.review_state in ('pending_response','re_requested') and not public.m9_04_can_manage(p_organization_id,p_actor_user_id))
    or (q.review_state not in ('pending_response','re_requested') and not public.m9_03_internal_can_review(p_organization_id,p_actor_user_id)))))
$$;

create function public.m1201_assign_can(p_organization_id uuid,p_actor_user_id uuid,p_task_type text,p_source_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((public.m1201_source(p_organization_id,p_actor_user_id,p_task_type,p_source_id)->>'active')::boolean,false)
 and case when p_task_type='finding_approval' then public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_findings')
  else public.m1201_source_can(p_organization_id,p_actor_user_id,p_task_type,true) end
$$;

create function public.m1201_task_row(p_organization_id uuid,p_actor_user_id uuid,p_task_type text,p_source_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare s jsonb; r public.workflow_task_routes%rowtype; v_owner uuid; v_assignee uuid; v_acting uuid;
 v_unresolved boolean:=false; v_group_ok boolean; v_group_eligible boolean; v_claim_ok boolean; v_delegate_ok boolean; v_ooo public.workflow_out_of_office%rowtype;
 v_due timestamptz; v_state text;
begin
 if not public.m1201_source_can(p_organization_id,p_actor_user_id,p_task_type,false) then return null; end if;
 s:=public.m1201_source(p_organization_id,p_actor_user_id,p_task_type,p_source_id);
 select * into r from public.workflow_task_routes where organization_id=p_organization_id and task_type=p_task_type and source_id=p_source_id;
 if s is null then
  if r.source_id is null or r.product_id is null or not exists(select 1 from public.products p
    where p.organization_id=p_organization_id and p.id=r.product_id and p.archived_at is null) then return null; end if;
  v_state:='unavailable';
 elsif not coalesce((s->>'active')::boolean,false) then return null;
 else
  v_state:='open';
  v_due:=nullif(s->>'dueAt','')::timestamptz;
  if v_due is not null and v_due<clock_timestamp() then v_state:='overdue'; end if;
 end if;
 v_owner:=case when s is null then r.source_owner_user_id else (s->>'owner')::uuid end;
 if r.source_id is not null and s is not null and r.source_owner_user_id is distinct from v_owner then
  v_unresolved:=true;
  r.assignee_user_id:=null; r.group_id:=null; r.claimed_by_user_id:=null; r.delegated_to_user_id:=null; r.delegation_expires_at:=null;
 end if;
 v_assignee:=case when r.group_id is not null then null else coalesce(r.assignee_user_id,v_owner) end;
 if v_assignee is not null and (v_state='unavailable' and not public.m1201_active_member(p_organization_id,v_assignee)
   or v_state<>'unavailable' and not public.m1201_eligible_actor(p_organization_id,v_assignee,p_task_type,p_source_id)) then
  v_unresolved:=true;
  v_assignee:=case when v_owner is not null and v_owner<>v_assignee
   and public.m1201_eligible_actor(p_organization_id,v_owner,p_task_type,p_source_id) then v_owner else null end;
 end if;
 v_group_ok:=r.group_id is not null and exists(select 1 from public.workflow_task_groups g
   where g.organization_id=p_organization_id and g.id=r.group_id);
 if r.group_id is not null and not v_group_ok then v_unresolved:=true; end if;
 v_group_eligible:=v_group_ok and exists(select 1 from public.workflow_task_group_members m
   where m.organization_id=p_organization_id and m.group_id=r.group_id and
    (v_state='unavailable' and public.m1201_active_member(p_organization_id,m.user_id)
     or v_state<>'unavailable' and public.m1201_eligible_actor(p_organization_id,m.user_id,p_task_type,p_source_id)));
 if r.group_id is not null and not v_group_eligible then
  v_unresolved:=true;
  if v_state<>'unavailable' and v_owner is not null and public.m1201_eligible_actor(p_organization_id,v_owner,p_task_type,p_source_id) then
   v_assignee:=v_owner;
  end if;
 end if;
 v_claim_ok:=r.claimed_by_user_id is not null and v_group_ok and public.m1201_active_member(p_organization_id,r.claimed_by_user_id)
   and exists(select 1 from public.workflow_task_group_members m
   where m.organization_id=p_organization_id and m.group_id=r.group_id and m.user_id=r.claimed_by_user_id)
   and (v_state='unavailable' or public.m1201_eligible_actor(p_organization_id,r.claimed_by_user_id,p_task_type,p_source_id));
 if r.claimed_by_user_id is not null and not v_claim_ok then v_unresolved:=true; end if;
 if v_claim_ok then v_assignee:=r.claimed_by_user_id; end if;
 v_acting:=v_assignee;
 if r.delegated_to_user_id is not null then
  v_delegate_ok:=r.delegation_expires_at>clock_timestamp() and v_state<>'unavailable'
    and public.m1201_eligible_actor(p_organization_id,r.delegated_to_user_id,p_task_type,p_source_id)
    and not exists(select 1 from public.workflow_out_of_office a where a.organization_id=p_organization_id
     and a.user_id=r.delegated_to_user_id and a.starts_at<=clock_timestamp() and a.ends_at>clock_timestamp());
  if v_delegate_ok then v_acting:=r.delegated_to_user_id; else v_unresolved:=true; end if;
 elsif v_assignee is not null then
  select * into v_ooo from public.workflow_out_of_office a where a.organization_id=p_organization_id and a.user_id=v_assignee
   and a.starts_at<=clock_timestamp() and a.ends_at>clock_timestamp() limit 1;
  if found then
   if v_state<>'unavailable' and public.m1201_eligible_actor(p_organization_id,v_ooo.substitute_user_id,p_task_type,p_source_id)
    and not exists(select 1 from public.workflow_out_of_office x where x.organization_id=p_organization_id and x.user_id=v_ooo.substitute_user_id
      and x.starts_at<=clock_timestamp() and x.ends_at>clock_timestamp()) then v_acting:=v_ooo.substitute_user_id;
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
  'canAssign',v_state<>'unavailable' and public.m1201_assign_can(p_organization_id,p_actor_user_id,p_task_type,p_source_id),
  'canClaim',v_state<>'unavailable' and v_group_ok and not v_claim_ok and exists(select 1 from public.workflow_task_group_members m
    where m.organization_id=p_organization_id and m.group_id=r.group_id and m.user_id=p_actor_user_id)
    and not exists(select 1 from public.workflow_out_of_office a where a.organization_id=p_organization_id
     and a.user_id=p_actor_user_id and a.starts_at<=clock_timestamp() and a.ends_at>clock_timestamp())
    and public.m1201_eligible_actor(p_organization_id,p_actor_user_id,p_task_type,p_source_id),
  'canDelegate',v_state<>'unavailable' and v_assignee=p_actor_user_id
    and not exists(select 1 from public.workflow_out_of_office a where a.organization_id=p_organization_id
     and a.user_id=p_actor_user_id and a.starts_at<=clock_timestamp() and a.ends_at>clock_timestamp())
    and public.m1201_eligible_actor(p_organization_id,p_actor_user_id,p_task_type,p_source_id));
end $$;

create function public.m1201_list_tasks(p_organization_id uuid,p_actor_user_id uuid,p_scope text,p_type text,
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
 ), rows as (
  select distinct c.task_type,c.source_id,public.m1201_task_row(p_organization_id,p_actor_user_id,c.task_type,c.source_id) task
  from candidate c where p_type is null or c.task_type=p_type
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

create function public.m1201_get_task(p_organization_id uuid,p_actor_user_id uuid,p_task_type text,p_source_id uuid)
returns table(outcome text,task jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 task:=public.m1201_task_row(p_organization_id,p_actor_user_id,p_task_type,p_source_id);
 if task is null then return query select 'not_found'::text,null::jsonb; else return query select 'found'::text,task; end if;
end $$;

create function public.m1201_eligible_assignees(p_organization_id uuid,p_actor_user_id uuid,p_task_type text,p_source_id uuid)
returns table(outcome text,users jsonb,groups jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.m1201_assign_can(p_organization_id,p_actor_user_id,p_task_type,p_source_id) then
  return query select 'forbidden'::text,null::jsonb,null::jsonb; return; end if;
 return query select 'found'::text,
  coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'displayName',left(coalesce(nullif(btrim(concat_ws(' ',u.first_name,u.last_name)),''),u.email),200)) order by u.email)
   from (select u.id,u.email,u.first_name,u.last_name from public.organization_members m join public.users u on u.id=m.user_id
    where m.organization_id=p_organization_id and u.is_active and public.m1201_eligible_actor(p_organization_id,u.id,p_task_type,p_source_id)
    order by u.email limit 1000) u),'[]'::jsonb),
  coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.name)
   from (select g.id,g.name from public.workflow_task_groups g where g.organization_id=p_organization_id and exists(select 1 from public.workflow_task_group_members gm
    where gm.organization_id=g.organization_id and gm.group_id=g.id and public.m1201_eligible_actor(p_organization_id,gm.user_id,p_task_type,p_source_id))
    order by g.name limit 1000) g),'[]'::jsonb);
end $$;

create function public.m1201_group_json(p_organization_id uuid,p_group_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',g.id,'name',g.name,'version',g.version,
  'memberCount',(select count(*) from public.workflow_task_group_members m join public.users u on u.id=m.user_id and u.is_active
   where m.organization_id=g.organization_id and m.group_id=g.id))
 from public.workflow_task_groups g where g.organization_id=p_organization_id and g.id=p_group_id
$$;

create function public.m1201_list_groups(p_organization_id uuid,p_actor_user_id uuid)
returns table(outcome text,groups jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.m1201_active_member(p_organization_id,p_actor_user_id) then return query select 'forbidden'::text,null::jsonb; return; end if;
 return query select 'found'::text,coalesce(jsonb_agg(public.m1201_group_json(g.organization_id,g.id) order by g.name),'[]'::jsonb)
 from (select organization_id,id,name from public.workflow_task_groups where organization_id=p_organization_id order by name,id limit 1000) g;
end $$;

create function public.m1201_get_group(p_organization_id uuid,p_actor_user_id uuid,p_group_id uuid)
returns table(outcome text,"group" jsonb,members jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.m1201_group_admin(p_organization_id,p_actor_user_id) then
  return query select 'forbidden'::text,null::jsonb,null::jsonb; return; end if;
 "group":=public.m1201_group_json(p_organization_id,p_group_id);
 if "group" is null then return query select 'not_found'::text,null::jsonb,null::jsonb; return; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'displayName',left(coalesce(nullif(btrim(concat_ws(' ',u.first_name,u.last_name)),''),u.email),200)) order by u.email),'[]'::jsonb)
  into members from (select u.id,u.email,u.first_name,u.last_name from public.workflow_task_group_members gm join public.users u on u.id=gm.user_id
  where gm.organization_id=p_organization_id and gm.group_id=p_group_id and u.is_active order by u.email limit 1000) u;
 return query select 'found'::text,"group",members;
end $$;

create function public.m1201_manage_group(p_organization_id uuid,p_actor_user_id uuid,p_action text,p_group_id uuid,
 p_name text,p_member_user_id uuid,p_expected_version bigint,p_idempotency_key uuid)
returns table(outcome text,"group" jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.workflow_task_groups%rowtype; c public.workflow_task_commands%rowtype; v_digest text; v_group_id uuid;
begin
 if not public.m1201_group_admin(p_organization_id,p_actor_user_id) then return query select 'forbidden'::text,null::jsonb; return; end if;
 if p_idempotency_key is null or p_action not in ('create','update','add_member','remove_member')
   or (p_action in ('create','update') and (p_name is null or p_name<>btrim(p_name) or char_length(p_name) not between 1 and 100))
   or (p_action='create' and p_group_id is not null)
   or (p_action<>'create' and (p_group_id is null or p_expected_version is null or p_expected_version<1))
   or (p_action in ('add_member','remove_member') and p_member_user_id is null) then
  return query select 'invalid_request'::text,null::jsonb; return; end if;
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

create function public.m1201_absence_json(p_organization_id uuid,p_absence_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',a.id,'userId',a.user_id,'substituteUserId',a.substitute_user_id,
  'startsAt',to_char(a.starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'endsAt',to_char(a.ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'version',a.version)
 from public.workflow_out_of_office a where a.organization_id=p_organization_id and a.id=p_absence_id
$$;

create function public.m1201_list_absences(p_organization_id uuid,p_actor_user_id uuid)
returns table(outcome text,absences jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.m1201_active_member(p_organization_id,p_actor_user_id) then return query select 'forbidden'::text,null::jsonb; return; end if;
 return query select 'found'::text,coalesce(jsonb_agg(public.m1201_absence_json(a.organization_id,a.id) order by a.starts_at,a.id),'[]'::jsonb)
 from (select organization_id,id,starts_at from public.workflow_out_of_office
  where organization_id=p_organization_id and ends_at>clock_timestamp()
   and (user_id=p_actor_user_id or public.m1201_group_admin(p_organization_id,p_actor_user_id))
  order by starts_at,id limit 1000) a;
end $$;

create function public.m1201_member_candidates(p_organization_id uuid,p_actor_user_id uuid)
returns table(outcome text,users jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.m1201_active_member(p_organization_id,p_actor_user_id) then return query select 'forbidden'::text,null::jsonb; return; end if;
 return query select 'found'::text,coalesce(jsonb_agg(jsonb_build_object('id',u.id,
  'displayName',left(coalesce(nullif(btrim(concat_ws(' ',u.first_name,u.last_name)),''),'Member '||left(u.id::text,8)),200)) order by u.email),'[]'::jsonb)
 from (select u.id,u.email,u.first_name,u.last_name from public.organization_members m join public.users u on u.id=m.user_id
  where m.organization_id=p_organization_id and u.is_active order by u.email limit 1000) u;
end $$;

create function public.m1201_manage_absence(p_organization_id uuid,p_actor_user_id uuid,p_action text,p_absence_id uuid,
 p_starts_at timestamptz,p_ends_at timestamptz,p_substitute_user_id uuid,p_expected_version bigint,p_idempotency_key uuid)
returns table(outcome text,absence jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.workflow_out_of_office%rowtype; c public.workflow_task_commands%rowtype; v_digest text;
begin
 if not public.m1201_active_member(p_organization_id,p_actor_user_id) then return query select 'forbidden'::text,null::jsonb; return; end if;
 if p_idempotency_key is null or p_action not in ('create','delete') or (p_action='create' and
  (p_absence_id is not null or p_starts_at is null or p_ends_at is null or p_starts_at>=p_ends_at
   or p_ends_at>p_starts_at+interval '365 days' or p_substitute_user_id is null or p_substitute_user_id=p_actor_user_id))
  or (p_action='delete' and (p_absence_id is null or p_expected_version is null)) then
  return query select 'invalid_request'::text,null::jsonb; return; end if;
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

do $$ declare p record; begin
 for p in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname like 'm1201_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',p.signature);
 end loop;
end $$;
grant execute on function public.m1201_list_tasks(uuid,uuid,text,text,text,uuid,timestamptz,timestamptz,text,integer),
 public.m1201_get_task(uuid,uuid,text,uuid),public.m1201_eligible_assignees(uuid,uuid,text,uuid),
 public.m1201_list_groups(uuid,uuid),public.m1201_get_group(uuid,uuid,uuid),
 public.m1201_manage_group(uuid,uuid,text,uuid,text,uuid,bigint,uuid),
 public.m1201_list_absences(uuid,uuid),public.m1201_manage_absence(uuid,uuid,text,uuid,timestamptz,timestamptz,uuid,bigint,uuid),
 public.m1201_member_candidates(uuid,uuid) to service_role;
