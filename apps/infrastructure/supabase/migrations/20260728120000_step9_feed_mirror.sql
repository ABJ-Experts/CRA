-- Step 9 — advisory feed ingestion (FR-VULN-001/002).
--
-- The mirror tables created in step 6c are readable by cras_app and explicitly
-- NOT writable by it (BRD §6.1: global reference data is "written only by feed
-- jobs running under an elevated role"). This migration creates that role and
-- the per-feed sync bookkeeping the staleness requirement needs.

-- ---- The feed writer role ---------------------------------------------------
-- Deliberately narrow: DML on the three global mirror tables and nothing else.
-- No BYPASSRLS, no superuser, and no grant on any tenant-scoped table — a feed
-- job has no business reading a customer's products, and SEC-014's boot check
-- would not catch a leak here because these tables carry no organisation_id.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cras_feed') then
    create role cras_feed login noinherit password 'cras_feed_local_dev';
  end if;
end
$$;

grant usage on schema public to cras_feed;
grant select, insert, update, delete on advisory, advisory_affected, advisory_cpe to cras_feed;

-- ---- Per-feed sync state (FR-VULN-002) --------------------------------------
-- One row per feed. `checkpoint` is feed-specific and opaque to the caller: a
-- modified-since timestamp for OSV/NVD, an ETag for KEV, a file date for EPSS.
-- Incremental sync resumes from it, so an interrupted run does not restart.
create table advisory_feed_sync_state (
  feed              text primary key check (feed in ('osv','nvd','ghsa','kev','epss')),
  status            text not null default 'never_run'
                      check (status in ('never_run','running','success','failed')),
  last_attempt_at   timestamptz,
  last_success_at   timestamptz,   -- staleness alerting reads this, never last_attempt_at
  checkpoint        text,
  records_processed bigint not null default 0,
  last_error        text,
  updated_at        timestamptz not null default now()
);

-- Seed a row per feed so the system-health view can report "never run" rather
-- than an empty table, which reads as "no feeds configured".
insert into advisory_feed_sync_state (feed) values
  ('osv'), ('nvd'), ('ghsa'), ('kev'), ('epss')
on conflict (feed) do nothing;

-- Tenants read feed health (FR-ADM-006 system health, dashboard ingestion panel)
-- but never write it.
grant select on advisory_feed_sync_state to cras_app;
revoke insert, update, delete on advisory_feed_sync_state from cras_app;
grant select, insert, update, delete on advisory_feed_sync_state to cras_feed;

-- ---- Indexes for the sync upsert path ---------------------------------------
-- A re-sync of one advisory replaces its affected ranges; without this the
-- delete-by-advisory scans the whole table, which at NVD scale is minutes.
create index advisory_affected_pk_idx on advisory_affected (advisory_pk);
create index advisory_cpe_pk_idx      on advisory_cpe (advisory_pk);

-- KEV/EPSS enrich by public identifier rather than by our surrogate key, and
-- the reevaluate pass looks advisories up the same way.
create index advisory_advisory_id_idx on advisory (advisory_id);

-- FR-VULN-011: "KEV listing raises a high severity alert" — the reevaluate job
-- asks "which advisories became KEV since the last run", so index the flag.
create index advisory_kev_idx on advisory (kev_listed) where kev_listed;
