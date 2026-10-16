-- Keep task reads transaction-stable and match source approval/review eligibility.

create or replace function public.m1201_source(p_organization_id uuid,p_actor_user_id uuid,p_task_type text,p_source_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v jsonb;
begin
 if not public.m1201_source_can(p_organization_id,p_actor_user_id,p_task_type,false) then return null; end if;
 if p_task_type='finding_triage' then
  select jsonb_build_object('exists',true,'active',f.status='active' and (f.human_verdict is null or f.reevaluation_state='review_required')
    and not exists(select 1 from public.vulnerability_finding_suppressions x where x.organization_id=f.organization_id and x.finding_id=f.id and x.is_current and x.ended_at is null and x.expires_at>now())
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
    and not exists(select 1 from public.reporting_stage_approvals a where a.organization_id=s.organization_id and a.stage_id=s.id),
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
    and (public.m9_04_request_has_outstanding_required(q.organization_id,rev.id) or q.review_state='awaiting_review'),
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

create or replace function public.m1201_task_row(p_organization_id uuid,p_actor_user_id uuid,p_task_type text,p_source_id uuid)
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
  if v_due is not null and v_due<now() then v_state:='overdue'; end if;
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
  v_delegate_ok:=r.delegation_expires_at>now() and v_state<>'unavailable'
    and public.m1201_eligible_actor(p_organization_id,r.delegated_to_user_id,p_task_type,p_source_id)
    and not exists(select 1 from public.workflow_out_of_office a where a.organization_id=p_organization_id
     and a.user_id=r.delegated_to_user_id and a.starts_at<=now() and a.ends_at>now());
  if v_delegate_ok then v_acting:=r.delegated_to_user_id; else v_unresolved:=true; end if;
 elsif v_assignee is not null then
  select * into v_ooo from public.workflow_out_of_office a where a.organization_id=p_organization_id and a.user_id=v_assignee
   and a.starts_at<=now() and a.ends_at>now() limit 1;
  if found then
   if v_state<>'unavailable' and public.m1201_eligible_actor(p_organization_id,v_ooo.substitute_user_id,p_task_type,p_source_id)
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
  'canAssign',v_state<>'unavailable' and public.m1201_assign_can(p_organization_id,p_actor_user_id,p_task_type,p_source_id),
  'canClaim',v_state<>'unavailable' and v_group_ok and not v_claim_ok and exists(select 1 from public.workflow_task_group_members m
    where m.organization_id=p_organization_id and m.group_id=r.group_id and m.user_id=p_actor_user_id)
    and not exists(select 1 from public.workflow_out_of_office a where a.organization_id=p_organization_id
     and a.user_id=p_actor_user_id and a.starts_at<=now() and a.ends_at>now())
    and public.m1201_eligible_actor(p_organization_id,p_actor_user_id,p_task_type,p_source_id),
  'canDelegate',v_state<>'unavailable' and v_assignee=p_actor_user_id
    and not exists(select 1 from public.workflow_out_of_office a where a.organization_id=p_organization_id
     and a.user_id=p_actor_user_id and a.starts_at<=now() and a.ends_at>now())
    and public.m1201_eligible_actor(p_organization_id,p_actor_user_id,p_task_type,p_source_id));
end $$;

create or replace function public.m1201_list_absences(p_organization_id uuid,p_actor_user_id uuid)
returns table(outcome text,absences jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.m1201_active_member(p_organization_id,p_actor_user_id) then return query select 'forbidden'::text,null::jsonb; return; end if;
 return query select 'found'::text,coalesce(jsonb_agg(public.m1201_absence_json(a.organization_id,a.id) order by a.starts_at,a.id),'[]'::jsonb)
 from (select organization_id,id,starts_at from public.workflow_out_of_office
  where organization_id=p_organization_id and ends_at>now()
   and (user_id=p_actor_user_id or public.m1201_group_admin(p_organization_id,p_actor_user_id))
  order by starts_at,id limit 1000) a;
end $$;
