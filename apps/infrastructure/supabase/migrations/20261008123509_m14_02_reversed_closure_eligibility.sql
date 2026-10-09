-- Recompute episode eligibility from authoritative explicit reversals. Ordinary
-- supersession retains approved decisions; source closures have no assessment ID.
-- Existing immutable facts remain unchanged and old dataset pins still replay.
do $migration$
declare definition text;changed text;
begin
 definition:=pg_get_functiondef('public.m14_02_capture_finding(uuid,uuid,boolean)'::regprocedure);
 if position($anchor$ from jsonb_array_elements(episodes)with ordinality v(e,ord)left join public.vulnerability_finding_assessments aa on aa.organization_id=p_org and aa.id=(e->>'assessmentId')::uuid and aa.vex_status in('fixed','not_affected')and aa.approval_state in('approved','approval_not_required');$anchor$in definition)=0 then raise exception 'M14-02 closure eligibility anchor missing';end if;
 changed:=replace(definition,$anchor$ from jsonb_array_elements(episodes)with ordinality v(e,ord)left join public.vulnerability_finding_assessments aa on aa.organization_id=p_org and aa.id=(e->>'assessmentId')::uuid and aa.vex_status in('fixed','not_affected')and aa.approval_state in('approved','approval_not_required');$anchor$,$replacement$ from jsonb_array_elements(episodes)with ordinality v(e,ord)left join public.vulnerability_finding_assessments aa on aa.organization_id=p_org and aa.id=(e->>'assessmentId')::uuid and aa.vex_status in('fixed','not_affected')and aa.approval_state in('approved','approval_not_required') left join public.vulnerability_finding_assessment_bulk_operation_targets reversal on reversal.organization_id=p_org and reversal.id=aa.bulk_operation_target_id where e->>'assessmentId'is null or (aa.id is not null and coalesce(reversal.state,'')<>'undone');$replacement$);
 execute changed;
end $migration$;
