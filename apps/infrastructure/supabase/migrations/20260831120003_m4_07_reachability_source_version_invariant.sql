-- Ensure already-applied M4-07 ledgers retain the clean-migration invariant:
-- every reachability result names the advisory source version it analysed.
alter table public.vulnerability_reachability_results
  alter column source_record_version_id set not null;
