-- Observation time is taken under the entity's final-state capture lock.
-- Transaction start can precede a competing committed writer; using it would
-- reorder eligibility deltas across calendar boundaries. Source timestamps for
-- openings, submissions and applied fixes remain in their immutable payloads.
alter table public.vulnerability_finding_lifecycle_facts alter column effective_at set default clock_timestamp();
alter table public.sbom_release_coverage_facts alter column effective_at set default clock_timestamp();
