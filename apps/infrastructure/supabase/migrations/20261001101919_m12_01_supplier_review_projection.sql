-- Keep supplier tasks aligned with actionable current-revision work, even when M9's aggregate review_state is accepted.
-- Also keep pagination cursors URL-safe across PostgreSQL base64 line wrapping.

create function public.m1201_supplier_actor_can_act(p_organization_id uuid,p_actor_user_id uuid,p_source_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select public.m1201_source_can(p_organization_id,p_actor_user_id,'supplier_request',true)
  and exists(select 1 from public.supplier_evidence_requests q where q.organization_id=p_organization_id and q.id=p_source_id
   and q.state='open' and (
    (public.m9_04_request_has_outstanding_required(q.organization_id,q.current_revision_id)
     and public.m9_04_can_manage(p_organization_id,p_actor_user_id))
    or (public.m9_03_internal_can_review(p_organization_id,p_actor_user_id)
     and exists(select 1 from public.supplier_evidence_submissions sub
       where sub.organization_id=q.organization_id and sub.request_id=q.id and sub.revision_id=q.current_revision_id
        and sub.state='submitted_pending_review'))))
$$;

revoke all on function public.m1201_supplier_actor_can_act(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.m1201_supplier_actor_can_act(uuid,uuid,uuid) to service_role;

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
  select jsonb_build_object('exists',true,'active',q.state='open' and p.archived_at is null
    and supplier.archived_at is null
    and (public.m9_04_request_has_outstanding_required(q.organization_id,rev.id) or exists(select 1 from public.supplier_evidence_submissions sub
     where sub.organization_id=q.organization_id and sub.request_id=q.id and sub.revision_id=rev.id and sub.state='submitted_pending_review')),
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

create or replace function public.m1201_eligible_actor(p_organization_id uuid,p_actor_user_id uuid,p_task_type text,p_source_id uuid)
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
 and (p_task_type<>'supplier_request' or public.m1201_supplier_actor_can_act(p_organization_id,p_actor_user_id,p_source_id))
$$;

create or replace function public.m1201_assign_can(p_organization_id uuid,p_actor_user_id uuid,p_task_type text,p_source_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((public.m1201_source(p_organization_id,p_actor_user_id,p_task_type,p_source_id)->>'active')::boolean,false)
 and case when p_task_type='finding_approval' then public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_findings')
  when p_task_type='supplier_request' then public.m1201_supplier_actor_can_act(p_organization_id,p_actor_user_id,p_source_id)
  else public.m1201_source_can(p_organization_id,p_actor_user_id,p_task_type,true) end
$$;

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
   where organization_id=p_organization_id and state='open'
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
  select translate(trim(trailing '=' from replace(replace(encode(convert_to(jsonb_build_object('filter',v_filter,
   'due',coalesce(v_last->>'dueAt','infinity'),'type',v_last->>'taskType','id',v_last->>'sourceId')::text,'utf8'),'base64'),E'\n',''),E'\r','')),'+/','-_') into next_cursor;
 else next_cursor:=null; end if;
 return query select 'found'::text,v_rows,next_cursor,v_counts;
end $$;
