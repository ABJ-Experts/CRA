-- Reuse M5's SLA projection without materializing its full remediation projection.

create or replace function public.m1201_source(p_organization_id uuid,p_actor_user_id uuid,p_task_type text,p_source_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v jsonb;
begin
 if not public.m1201_source_can(p_organization_id,p_actor_user_id,p_task_type,false) then return null; end if;
 if p_task_type='finding_triage' then
  select jsonb_build_object('exists',true,'active',f.status='active' and (f.human_verdict is null or f.reevaluation_state='review_required')
    and not exists(select 1 from public.vulnerability_finding_suppressions x where x.organization_id=f.organization_id and x.finding_id=f.id and x.is_current and x.ended_at is null and x.expires_at>now())
    and p.archived_at is null and r.archived_at is null,
   'title',left(f.canonical_advisory_id,500),'dueAt',to_char((public.m5_triage_operational_json_m5_04(f.organization_id,f.id)->'internalSla'->>'dueAt')::timestamptz
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
