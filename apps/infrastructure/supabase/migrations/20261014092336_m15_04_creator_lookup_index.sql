-- Cover the immutable creator FK for source-owned identity/deletion checks.
create index m15_04_creator_lookup on public.support_diagnostic_jobs(creator_user_id);
