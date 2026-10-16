-- Compute each source-authorized task row once for exact counts and page selection.

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
 ), rows as materialized (
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
