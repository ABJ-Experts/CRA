-- Forward repair for deployments that applied the initial M5-03 expansion
-- before its function bodies were lint-corrected. No existing assessment or
-- bulk snapshot data is removed.
alter table public.vulnerability_finding_assessment_bulk_operations
  drop constraint vulnerability_finding_assessment_bulk_operations_state_check;
alter table public.vulnerability_finding_assessment_bulk_operations
  add constraint vulnerability_finding_assessment_bulk_operations_state_check check
  (state in ('previewed', 'executing', 'scope_changed', 'partially_completed', 'completed', 'undone', 'expired'));

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

-- Read-side undo projection: an undone first bulk revision is honestly absent;
-- an undone revision with a predecessor resolves to that immutable predecessor.
create or replace function public.get_finding_vex_assessment(
  p_organization_id uuid, p_actor_user_id uuid, p_finding_id uuid
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_effective_id uuid;
begin
  if not public.m5_vex_active_member(p_organization_id, p_actor_user_id) or p_finding_id is null
    or not exists (select 1 from public.vulnerability_findings findings where findings.organization_id=p_organization_id and findings.id=p_finding_id and findings.status='active') then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  select public.m5_bulk_effective_assessment_id(p_organization_id,p_finding_id) into v_effective_id;
  return query select 'found'::text,jsonb_build_object(
    'assessment',case when v_effective_id is null then null else public.m5_vex_assessment_json(p_organization_id,v_effective_id) end,
    'history',coalesce((select jsonb_agg(public.m5_vex_history_event_json(p_organization_id,e.id) order by e.occurred_at,e.id) from public.vulnerability_finding_assessment_history_events e join public.vulnerability_finding_assessments a on a.organization_id=e.organization_id and a.id=e.assessment_id where e.organization_id=p_organization_id and a.finding_id=p_finding_id),'[]'::jsonb));
end;
$$;

alter function public.m5_bulk_effective_assessment_id(uuid,uuid) owner to postgres;
alter function public.get_finding_vex_assessment(uuid,uuid,uuid) owner to postgres;
revoke all on function public.m5_bulk_effective_assessment_id(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_finding_vex_assessment(uuid,uuid,uuid) to service_role;
