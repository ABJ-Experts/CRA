-- M5-06 compatibility correction. Publication workers need a compact job
-- projection that includes the durable logical event key, job kind and target
-- registry key; earlier databases only exposed UI-facing job fields.

create or replace function public.m5_vex_publication_job_json(
  p_organization_id uuid, p_job_id uuid
) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', jobs.id,
    'organizationId', jobs.organization_id,
    'exportId', jobs.snapshot_id,
    'targetId', jobs.target_id,
    'eventKey', jobs.event_key,
    'kind', jobs.job_kind,
    'targetKey', targets.target_key,
    'state', jobs.delivery_state,
    'attempts', jobs.attempt_count,
    'version', jobs.version,
    'lastErrorCode', jobs.last_error_code,
    'lastErrorMessage', jobs.last_error_detail,
    'publishedAt', case
      when jobs.completed_at is null then null
      else public.m2_utc_z(jobs.completed_at)
    end,
    'replacedByExportId', jobs.replaced_by_snapshot_id,
    'withdrawnAt', case
      when jobs.delivery_state = 'withdrawn' then public.m2_utc_z(jobs.completed_at)
      else null
    end,
    'withdrawnReason', jobs.withdrawal_reason,
    'createdAt', public.m2_utc_z(jobs.created_at),
    'updatedAt', public.m2_utc_z(jobs.updated_at)
  )
  from public.vulnerability_vex_publication_jobs jobs
  join public.vulnerability_vex_publication_targets targets
    on targets.organization_id = jobs.organization_id
   and targets.id = jobs.target_id
  where jobs.organization_id = p_organization_id
    and jobs.id = p_job_id
$$;

alter function public.m5_vex_publication_job_json(uuid,uuid)
  owner to postgres;

revoke all on function public.m5_vex_publication_job_json(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.m5_vex_publication_job_json(uuid,uuid)
  to service_role;
