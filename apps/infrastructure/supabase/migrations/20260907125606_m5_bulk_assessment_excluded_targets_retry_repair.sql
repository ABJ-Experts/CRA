-- Preserve caller-supplied unavailable UUIDs as generic excluded snapshot
-- results. The parent operation remains tenant-scoped; this deliberately has
-- no finding FK because a forged cross-tenant UUID must not be resolved.
do $$
declare v_constraint text;
begin
  for v_constraint in select conname from pg_constraint where conrelid='public.vulnerability_finding_assessment_bulk_operation_targets'::regclass and ((contype='f' and pg_get_constraintdef(oid) like '%(organization_id, finding_id)%') or (contype='c' and conname like '%state_check')) loop
    execute format('alter table public.vulnerability_finding_assessment_bulk_operation_targets drop constraint %I',v_constraint);
  end loop;
end;
$$;
alter table public.vulnerability_finding_assessment_bulk_operation_targets
  add constraint vulnerability_finding_assessment_bulk_operation_targets_state_check check
  (state in ('pending','applied','excluded','skipped_scope_changed','failed','undone','undo_conflict'));

create or replace function public.m5_bulk_operation_json(p_organization_id uuid, p_operation_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id',o.id,'organizationId',o.organization_id,'kind',o.operation_kind,'selectionMode',o.selection_mode,
    'sourceFindingId',o.source_finding_id,'sourceAssessmentId',o.source_assessment_id,'sourceAssessmentVersion',o.source_assessment_version,
    'assessment',o.submission,'filterSnapshot',o.selection_filters,'snapshotDigest',o.snapshot_digest,'version',o.version,'state',o.state,
    'expiresAt',to_char(o.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'createdAt',to_char(o.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'createdByUserId',o.created_by,
    'counts',jsonb_build_object('selected',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=o.organization_id and t.operation_id=o.id),'eligible',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=o.organization_id and t.operation_id=o.id and t.state not in ('excluded','skipped_scope_changed')),'excluded',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=o.organization_id and t.operation_id=o.id and t.state='excluded'),'pending',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=o.organization_id and t.operation_id=o.id and t.state='pending'),'applied',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=o.organization_id and t.operation_id=o.id and t.state='applied'),'failed',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=o.organization_id and t.operation_id=o.id and t.state='failed'),'skippedScopeChanged',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=o.organization_id and t.operation_id=o.id and t.state='skipped_scope_changed'),'undone',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=o.organization_id and t.operation_id=o.id and t.state='undone'),'undoConflicts',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=o.organization_id and t.operation_id=o.id and t.state='undo_conflict')),
    'targets',coalesce((select jsonb_agg(jsonb_build_object('findingId',t.finding_id,'product',case when p.id is null then null else jsonb_build_object('id',p.id,'name',t.product_name) end,'release',case when r.id is null then null else jsonb_build_object('id',r.id,'name',t.release_name) end,'componentIdentity',t.component_identity,'componentVersion',t.component_version,'initialAssessmentId',t.expected_assessment_id,'initialAssessmentVersion',t.expected_assessment_version,'appliedAssessmentId',t.created_assessment_id,'outcome',t.state,'outcomeMessage',case when t.state='excluded' then 'A selected finding is unavailable.' else t.failure_code end) order by t.ordinal) from public.vulnerability_finding_assessment_bulk_operation_targets t left join public.vulnerability_findings f on f.organization_id=t.organization_id and f.id=t.finding_id left join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id left join public.products p on p.organization_id=r.organization_id and p.id=r.product_id where t.organization_id=o.organization_id and t.operation_id=o.id),'[]'::jsonb)
  ) from public.vulnerability_finding_assessment_bulk_operations o where o.organization_id=p_organization_id and o.id=p_operation_id
$$;
alter function public.m5_bulk_operation_json(uuid,uuid) owner to postgres;
