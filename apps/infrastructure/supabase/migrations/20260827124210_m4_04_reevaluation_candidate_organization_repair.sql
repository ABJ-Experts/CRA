-- This repair was applied to the local migration catalogue during the M4-04
-- review. Keep its source in version control so fresh environments receive
-- the same unambiguous, indexed tenant-discovery query.
create or replace function public.list_vulnerability_reevaluation_candidate_organizations(
  p_job_id uuid, p_lease_owner text, p_after_organization_id uuid default null,
  p_limit integer default 100
) returns table(organization_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_reevaluation_jobs%rowtype;
begin
  if p_job_id is null or char_length(btrim(coalesce(p_lease_owner, ''))) not between 1 and 100
     or p_limit not between 1 and 500 then return; end if;
  select * into v_job from public.vulnerability_reevaluation_jobs jobs
  where jobs.id = p_job_id and jobs.scope = 'discovery';
  if not found or v_job.status <> 'leased' or v_job.lease_owner <> btrim(p_lease_owner)
     or v_job.lease_expires_at <= clock_timestamp() then return; end if;
  return query
  with indexed_occurrences as (
    select distinct occurrences.organization_id
    from public.vulnerability_affected_ranges ranges
    join public.vulnerability_component_occurrences occurrences on (
      (ranges.purl_type is not null and occurrences.identity_kind = 'purl'
       and occurrences.purl_type = ranges.purl_type
       and coalesce(occurrences.purl_namespace, '') = coalesce(ranges.purl_namespace, '')
       and occurrences.purl_name = ranges.purl_name)
      or (ranges.cpe_part is not null and occurrences.identity_kind = 'cpe'
       and occurrences.cpe_part = ranges.cpe_part
       and occurrences.cpe_vendor = ranges.cpe_vendor
       and occurrences.cpe_product = ranges.cpe_product)
    )
    where ranges.source_record_version_id = v_job.source_record_version_id
  ), existing_findings as (
    select distinct findings.organization_id
    from public.vulnerability_findings findings
    where findings.vulnerability_id = v_job.vulnerability_id and findings.status = 'active'
  )
  select candidate_organizations.organization_id
  from (
    select indexed_occurrences.organization_id from indexed_occurrences
    union
    select existing_findings.organization_id from existing_findings
  ) candidate_organizations
  where p_after_organization_id is null or candidate_organizations.organization_id > p_after_organization_id
  order by candidate_organizations.organization_id limit p_limit;
end;
$$;

revoke execute on function public.list_vulnerability_reevaluation_candidate_organizations(
  uuid, text, uuid, integer
) from public, anon, authenticated;
grant execute on function public.list_vulnerability_reevaluation_candidate_organizations(
  uuid, text, uuid, integer
) to service_role;
alter function public.list_vulnerability_reevaluation_candidate_organizations(uuid, text, uuid, integer) owner to postgres;
