-- Keep already-applied local M3-04 databases aligned with the worker's
-- documented terminal/retryable quality error codes.
create or replace function public.fail_sbom_quality_report(
  p_organization_id uuid,
  p_report_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message text
) returns table(outcome text)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_error_code not in (
    'normalized_document_missing',
    'quality_persistence_unavailable',
    'quality_configuration_unavailable',
    'quality_source_missing',
    'quality_statement_timeout',
    'quality_calculation_failed',
    'provider_unavailable',
    'unexpected_failure'
  )
    or char_length(btrim(coalesce(p_error_message, ''))) not between 1 and 1000 then
    return query select 'invalid_request'::text;
    return;
  end if;

  update public.sbom_quality_reports
  set state = 'failed',
      progress_stage = 'failed',
      lease_owner = null,
      lease_expires_at = null,
      error_code = p_error_code,
      error_message = btrim(p_error_message),
      next_attempt_at = now(),
      updated_at = now()
  where organization_id = p_organization_id
    and id = p_report_id
    and state = 'processing'
    and lease_owner = btrim(p_worker_id)
    and lease_expires_at > now();

  if not found then
    return query select 'not_found'::text;
    return;
  end if;

  return query select 'failed'::text;
end;
$$;

alter function public.fail_sbom_quality_report(uuid, uuid, text, text, text)
  owner to postgres;

revoke all on function public.fail_sbom_quality_report(uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.fail_sbom_quality_report(uuid, uuid, text, text, text)
  to service_role;
