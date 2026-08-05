-- Step 9b — the scheduler capability (FR-SLA-005/007, FR-JOB-001).
--
-- Background jobs are tenant-scoped by design: obligation.tick, sbom.match and
-- the OSV demand sync all run inside withTenant. But SOMETHING has to enumerate
-- which organisations exist in order to fan out to them, and cras_app cannot —
-- the organisation RLS policy admits only rows the caller is a member of, so a
-- context-free query correctly returns zero.
--
-- The narrowest capability that solves it: one role that can read organisation
-- IDENTIFIERS and nothing else. It cannot read a legal name, a product, an SBOM,
-- a finding or an audit row. What it learns is how many tenants exist, which the
-- platform operator running the process already knows.
--
-- Rejected alternative: granting cras_app BYPASSRLS, or widening the organisation
-- policy. Both would silently disable isolation everywhere to solve a scheduling
-- problem, which is precisely the failure SEC-014 exists to make impossible.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cras_scheduler') then
    create role cras_scheduler login noinherit password 'cras_scheduler_local_dev';
  end if;
end
$$;

grant usage on schema public to cras_scheduler;

-- Column-level: id and lifecycle only. Not legal_name, not the manufacturer
-- contact, not the onboarding state.
grant select (id, deleted_at) on organisation to cras_scheduler;

-- RLS is FORCEd on organisation, so a grant alone yields nothing without a
-- policy. This one is deliberately `for select` and scoped `to cras_scheduler`,
-- so it cannot widen what any other role sees.
drop policy if exists scheduler_enumerate on organisation;
create policy scheduler_enumerate on organisation
  for select to cras_scheduler
  using (true);
