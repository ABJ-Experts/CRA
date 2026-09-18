-- M6-04 closes the pre-approval metadata endpoint. It has no draft revision,
-- digest, or fresh proof, so allowing it would bypass the approval boundary.
create or replace function public.record_reporting_obligation_stage_submission_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_obligation_id uuid,p_stage_kind text,
  p_submitted_at timestamptz,p_submission_reference text,p_expected_version integer,
  p_idempotency_key uuid,p_correlation_id uuid default null
) returns table(outcome text,result jsonb) language sql security definer set search_path = public, pg_temp as $$
  select 'approval_required'::text, null::jsonb
$$;

alter function public.record_reporting_obligation_stage_submission_atomic(uuid,uuid,uuid,text,timestamptz,text,integer,uuid,uuid) owner to postgres;
revoke all on function public.record_reporting_obligation_stage_submission_atomic(uuid,uuid,uuid,text,timestamptz,text,integer,uuid,uuid) from public, anon, authenticated;
grant execute on function public.record_reporting_obligation_stage_submission_atomic(uuid,uuid,uuid,text,timestamptz,text,integer,uuid,uuid) to service_role;
