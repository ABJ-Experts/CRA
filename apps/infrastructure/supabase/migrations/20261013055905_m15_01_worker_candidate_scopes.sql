-- This bounded candidate read grants no authority. The local verifier refreshes
-- each candidate's version/digest/config-bound proof before claimers can run.
create function public.m15_01_worker_candidates(
  p_capability text,p_limit integer,p_policy_revision integer,p_configuration_digest text
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if p_capability not in ('ai','frameworks','technical_files','scheduled_reports')
    or p_limit not between 1 and 100 or p_policy_revision<1
    or p_configuration_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_worker_candidate_scope' using errcode='22023';
  end if;
  with candidates as (
    select organization_id,min(created_at) due_at from public.ai_inference_runs
      where p_capability='ai' and (status='queued' or (status='leased' and lease_expires_at<=clock_timestamp()))
      group by organization_id
    union all
    select organization_id,min(updated_at) from public.framework_coverage_scopes
      where p_capability='frameworks' and ((status in ('pending','error') and next_attempt_at<=clock_timestamp())
        or (status='leased' and lease_expires_at<=clock_timestamp())) group by organization_id
    union all
    select organization_id,min(created_at) from public.technical_file_declarations
      where p_capability='technical_files' and (status='prepared' or (status='generating' and lease_expires_at<=clock_timestamp()))
      group by organization_id
    union all
    select organization_id,min(next_due_at) from public.report_definitions
      where p_capability='scheduled_reports' and state='active' and next_due_at<=clock_timestamp() group by organization_id
    union all
    select x.organization_id,min(x.created_at) from public.report_run_recipients x
      join public.report_runs r on r.organization_id=x.organization_id and r.id=x.run_id
      where p_capability='scheduled_reports' and r.state in ('scheduled','running')
        and (x.generation_state='waiting' or (x.generation_state='running' and x.lease_expires_at<=clock_timestamp())) group by x.organization_id
    union all
    select organization_id,min(requested_at) from public.export_jobs
      where p_capability='scheduled_reports' and subject_kind='scheduled' and state in ('queued','capturing','audit_pending','rendering')
        and (lease_expires_at is null or lease_expires_at<=clock_timestamp()) group by organization_id
  ), selected as (
    select c.organization_id,min(c.due_at) due_at,s.verification_checked_at
    from candidates c join public.organization_license_states s on s.organization_id=c.organization_id
    where s.artifact is not null and s.verified_claims->'entitlements' ? p_capability
      and clock_timestamp()>=(s.verified_claims->>'startsAt')::timestamptz
      and greatest(clock_timestamp(),s.time_high_water_at)<(s.verified_claims->>'expiresAt')::timestamptz+interval '30 days'
      and not s.clock_rollback_detected
      -- Fresh negative proofs suppress only this exact activation/config. Their
      -- bounded retry window and oldest-proof ordering keep other tenants fair.
      and not (s.verification_version=s.version and s.verification_artifact_digest=s.artifact_digest
        and s.policy_revision=p_policy_revision and s.configuration_digest=p_configuration_digest
        and s.verification_checked_at>clock_timestamp()-interval '60 seconds'
        and (not s.verification_valid or not(s.effective_capabilities ? p_capability)))
    group by c.organization_id,s.verification_checked_at
    order by s.verification_checked_at nulls first,min(c.due_at),c.organization_id limit p_limit
  )
  select coalesce(jsonb_agg(organization_id order by verification_checked_at nulls first,due_at,organization_id),'[]'::jsonb) into result from selected;
  return result;
end $$;
revoke all on function public.m15_01_worker_candidates(text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.m15_01_worker_candidates(text,integer,integer,text) to service_role;
notify pgrst,'reload schema';
