-- Align older local installations with the immutable undo projection used by
-- clean installs. A first bulk revision resolves to absent after undo.
create or replace function public.m5_bulk_effective_assessment_id(
  p_organization_id uuid, p_finding_id uuid
) returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select case when exists(
    select 1 from public.vulnerability_finding_assessments current_assessment
      join public.vulnerability_finding_assessment_bulk_operation_targets t
        on t.organization_id=current_assessment.organization_id and t.id=current_assessment.bulk_operation_target_id
      where current_assessment.organization_id=p_organization_id and current_assessment.finding_id=p_finding_id
        and current_assessment.is_current and t.state='undone'
  ) then (
    select t.previous_assessment_id from public.vulnerability_finding_assessments current_assessment
      join public.vulnerability_finding_assessment_bulk_operation_targets t
        on t.organization_id=current_assessment.organization_id and t.id=current_assessment.bulk_operation_target_id
      where current_assessment.organization_id=p_organization_id and current_assessment.finding_id=p_finding_id
        and current_assessment.is_current and t.state='undone'
  ) else (
    select current_assessment.id from public.vulnerability_finding_assessments current_assessment
      where current_assessment.organization_id=p_organization_id and current_assessment.finding_id=p_finding_id and current_assessment.is_current
  ) end
$$;

alter function public.m5_bulk_effective_assessment_id(uuid,uuid) owner to postgres;
revoke all on function public.m5_bulk_effective_assessment_id(uuid,uuid) from public, anon, authenticated;
