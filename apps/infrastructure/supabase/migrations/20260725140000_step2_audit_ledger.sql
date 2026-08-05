-- Step 2 — Append-only audit ledger with per-organisation SHA-256 hash chain.
-- ADR-012 / FR-AUD-001 (full record) / FR-AUD-002 (append-only) / FR-AUD-003 (chain).

create table audit_event (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references organisation(id),
  sequence         bigint not null,                 -- monotonic per org; a gap is itself alertable
  actor_type       text not null
                     check (actor_type in ('user','service_account','system','ai','operator')),
  actor_id         uuid,
  action           text not null,                   -- verb, e.g. 'product.created'
  resource_type    text not null,
  resource_id      uuid,
  before_state     jsonb,                           -- redacted of secrets by the writer
  after_state      jsonb,
  reason           text,                            -- mandatory for high-sensitivity actions
  correlation_id   uuid,
  ip_address       inet,
  user_agent       text,
  content_hash     text not null,                   -- sha256(canonical(row) + previous_hash)
  previous_hash    text,                            -- head of the per-org chain at write time
  created_at       timestamptz not null default now(),
  unique (organisation_id, sequence)
);
create index audit_event_org_seq_idx on audit_event (organisation_id, sequence);
create index audit_event_resource_idx on audit_event (organisation_id, resource_type, resource_id);

-- Tenant isolation (same pattern as every org-scoped table).
alter table audit_event enable row level security;
alter table audit_event force  row level security;
create policy tenant_isolation on audit_event
  using      (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);

-- ADR-012 / FR-AUD-002: APPEND-ONLY. cras_app may INSERT and SELECT, never
-- UPDATE or DELETE — the ledger is immutable evidence.
grant select, insert on audit_event to cras_app;
revoke update, delete on audit_event from cras_app;
