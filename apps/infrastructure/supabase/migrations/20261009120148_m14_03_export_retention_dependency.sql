-- M14-03 retention dependency is a diagnostic projection, never deletion authority.
-- Existing M1 generic cleanup remains unavailable; M8's irreversible document
-- deletion decision does not authorize deletion of derived export snapshots.
create function public.m14_03_export_cleanup_eligibility(
 p_organization_id uuid,p_job_id uuid,p_cleanup_run_id uuid default null,
 p_lease_owner uuid default null,p_expected_checkpoint_version integer default null
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public as $$
declare
 v_job public.export_jobs%rowtype;
 v_run public.retention_cleanup_runs%rowtype;
 v_item public.retention_cleanup_items%rowtype;
 v_policy public.organization_retention_policies%rowtype;
 v_blockers jsonb := '["cleanup_authority_unavailable"]'::jsonb;
 v_authority text;
 v_watermark timestamptz;
begin
 select * into v_job from public.export_jobs
 where organization_id=p_organization_id and id=p_job_id;
 if not found then
  return jsonb_build_object('eligible',false,'blockers',jsonb_build_array('not_found'),'deletionAuthorized',false);
 end if;
 if v_job.state in ('queued','capturing','audit_pending','rendering') or v_job.worker_id is not null then
  v_blockers:=v_blockers || '["export_work_in_progress"]'::jsonb;
 end if;
 if v_job.expires_at>now() then
  v_blockers:=v_blockers || '["artifact_availability_active"]'::jsonb;
 end if;
 select * into v_policy from public.organization_retention_policies
 where organization_id=p_organization_id and evidence_class='export_artifact';
 if not found or not exists(select 1 from public.retention_evidence_classes
    where identifier='export_artifact' and enabled) then
  v_blockers:=v_blockers || '["retention_policy_unavailable"]'::jsonb;
 elsif v_job.requested_at>now()-make_interval(days=>v_policy.effective_retention_days) then
  v_blockers:=v_blockers || '["retention_period_active"]'::jsonb;
 end if;
 foreach v_authority in array array['product','evidence_class','obligation','legal_hold'] loop
  if not exists(select 1 from public.retention_authority_states s
    where s.organization_id=p_organization_id and s.authority_kind=v_authority
      and s.available and s.last_reconciled_at is not null) then
   v_blockers:=v_blockers || jsonb_build_array('authority_unavailable:' || v_authority);
  end if;
 end loop;
 if exists(select 1 from public.retention_authoritative_facts f
   where f.organization_id=p_organization_id and f.active
     and (f.evidence_class='export_artifact' or f.reason_kind='legal_hold')
     and (f.reason_kind='legal_hold' or f.protect_through>now())) then
  v_blockers:=v_blockers || '["authoritative_retention_protection"]'::jsonb;
 end if;
 -- Derived rows may contain evidence from multiple products. Until a deletion
 -- authority binds the exact immutable source set, any tenant evidence hold
 -- conservatively protects the derived artifact. No names or counts escape.
 if exists(select 1 from public.evidence_document_legal_holds h
   where h.organization_id=p_organization_id and h.released_at is null) then
  v_blockers:=v_blockers || '["evidence_legal_hold"]'::jsonb;
 end if;
 if exists(select 1 from public.product_lifecycle_dependency_facts f
   where f.organization_id=p_organization_id and f.active and f.authority_kind='legal_hold'
     and exists(select 1 from public.export_snapshot_rows r
       where r.organization_id=p_organization_id and r.job_id=p_job_id and r.product_id=f.product_id)) then
  v_blockers:=v_blockers || '["product_legal_hold"]'::jsonb;
 end if;
 select * into v_run from public.retention_cleanup_runs
 where organization_id=p_organization_id and id=p_cleanup_run_id;
 if not found or p_lease_owner is null or p_expected_checkpoint_version is null
   or v_run.lease_owner is null or v_run.lease_expires_at is null
   or v_run.evidence_class<>'export_artifact' or v_run.status<>'running'
   or v_run.lease_owner is distinct from p_lease_owner or v_run.lease_expires_at<=now()
   or v_run.checkpoint_version is distinct from p_expected_checkpoint_version then
  v_blockers:=v_blockers || '["cleanup_lease_unavailable"]'::jsonb;
 else
  select * into v_item from public.retention_cleanup_items
  where organization_id=p_organization_id and cleanup_run_id=p_cleanup_run_id
    and evidence_class='export_artifact' and source_record_id=p_job_id and status='pending';
  if not found or v_item.observed_at is distinct from v_job.requested_at then
   v_blockers:=v_blockers || '["cleanup_candidate_unavailable"]'::jsonb;
  else
   select protected_through into v_watermark from public.evidence_protection_watermarks
   where organization_id=p_organization_id and evidence_class='export_artifact';
   if not found then
    v_blockers:=v_blockers || '["protection_watermark_unavailable"]'::jsonb;
   elsif v_item.protection_watermark<v_watermark then
    v_blockers:=v_blockers || '["protection_watermark_changed"]'::jsonb;
   end if;
  end if;
 end if;
 return jsonb_build_object('eligible',false,'deletionAuthorized',false,
   'evidenceClass','export_artifact','blockers',v_blockers,
   'auditArchivalRequired',true,'availabilityExpired',v_job.expires_at<=now());
end $$;
revoke all on function public.m14_03_export_cleanup_eligibility(uuid,uuid,uuid,uuid,integer)
 from public,anon,authenticated;
grant execute on function public.m14_03_export_cleanup_eligibility(uuid,uuid,uuid,uuid,integer) to service_role;
comment on function public.m14_03_export_cleanup_eligibility(uuid,uuid,uuid,uuid,integer) is
 'Read-only dependency projection. Always denies deletion until an approved source-owned cleanup/archival boundary exists; expiry is not deletion authority.';
