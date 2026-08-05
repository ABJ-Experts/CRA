-- Step 8 — reporting obligation + timer engine (Decision B; BRD §8.3, §11).
-- The database is the ONLY source of truth for deadlines (ADR-006). due_at is
-- always recomputed from an anchor event, never set by hand.

create table reporting_obligation (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references organisation(id),
  product_release_id      uuid references product_release(id),
  finding_id              uuid,                          -- opened from a KEV finding (FR-VULN-011)
  obligation_type         text not null
                            check (obligation_type in ('actively_exploited_vulnerability','severe_incident')),
  awareness_at            timestamptz not null,          -- legally significant, human-asserted
  awareness_basis         text,
  notification_submitted_at timestamptz,                 -- anchor for the severe-incident final report
  remediation_available_at  timestamptz,                 -- anchor for the vulnerability final report (14d)
  affected_member_states  text[] not null default '{}',
  coordinating_csirt      text,
  rule_set_version        text not null,                 -- rules in force when created (FR-RPT-008/FR-SLA-004)
  state                   text not null default 'draft'
                            check (state in ('draft','active','submitted_partial','complete','cancelled')),
  cancelled_reason        text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  created_by              uuid,
  updated_by              uuid,
  version                 integer not null default 1
);
create index reporting_obligation_org_idx on reporting_obligation (organisation_id, state);

create table obligation_stage (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references organisation(id),
  obligation_id     uuid not null references reporting_obligation(id) on delete cascade,
  stage             text not null check (stage in ('early_warning','notification','final_report')),
  anchor_event      text not null check (anchor_event in ('awareness','notification_submitted','remediation_available')),
  duration_interval interval not null,
  due_at            timestamptz,                          -- recomputed on anchor change; null while pending_anchor
  submitted_at      timestamptz,
  state             text not null default 'pending_anchor'
                      check (state in ('pending_anchor','running','submitted','overdue','not_required')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organisation_id, obligation_id, stage)
);
create index obligation_stage_running_idx on obligation_stage (organisation_id, state, due_at);

-- Timeline of anchor/threshold events for audit + reconciliation.
create table obligation_timeline_event (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id),
  obligation_id   uuid not null references reporting_obligation(id) on delete cascade,
  event_type      text not null,
  detail          jsonb not null default '{}',
  occurred_at     timestamptz not null default now()
);
create index obligation_timeline_idx on obligation_timeline_event (organisation_id, obligation_id);

do $$
declare t text;
begin
  foreach t in array array['reporting_obligation','obligation_stage','obligation_timeline_event'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force  row level security', t);
    execute format($f$create policy tenant_isolation on %I
      using      (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
      with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)$f$, t);
    execute format('grant select, insert, update, delete on %I to cras_app', t);
  end loop;
end$$;
