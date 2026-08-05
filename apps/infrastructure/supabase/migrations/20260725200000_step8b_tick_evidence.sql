-- Step 8b — obligation tick bookkeeping + evidence store (BRD §11.4, §12; FR-EVD-001/003).

-- Which escalation thresholds a stage has already notified on, so obligation.tick
-- is idempotent (re-running never double-sends). §11.4 thresholds [.5/.75/.9/1].
alter table obligation_stage
  add column notified_thresholds numeric[] not null default '{}';

-- FR-EVD-001/003: evidence documents. content_hash is captured on upload and
-- re-verified on every retrieval (tamper detection). Bytes live in object storage
-- via the StorageProvider adapter; only metadata + hash are in Postgres.
create table evidence_document (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisation(id),
  title            text not null,
  classification   text not null default 'other'
                     check (classification in
                       ('test_report','conformity_assessment','risk_assessment',
                        'sbom_export','vex_document','audit_log','other')),
  product_id       uuid references product(id),
  owner_user_id    uuid,
  valid_from       date,
  valid_until      date,
  storage_key      text not null,            -- opaque key in the StorageProvider
  content_hash     text not null,            -- sha256 of the bytes at upload (FR-EVD-003)
  content_type     text,
  size_bytes       bigint not null default 0,
  tamper_state     text not null default 'unverified'
                     check (tamper_state in ('unverified','intact','tampered')),
  uploaded_at      timestamptz not null default now(),
  uploaded_by      uuid,
  created_at       timestamptz not null default now()
);
create index evidence_document_org_idx on evidence_document (organisation_id, classification);

do $$
begin
  execute 'alter table evidence_document enable row level security';
  execute 'alter table evidence_document force  row level security';
  execute $f$create policy tenant_isolation on evidence_document
    using      (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
    with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)$f$;
  execute 'grant select, insert, update, delete on evidence_document to cras_app';
end$$;
