-- Step 6c — vulnerability advisory mirror (GLOBAL reference, no organisation_id,
-- read-only to tenants) + tenant-scoped findings (BRD §6.1 data classes, §8.3).

-- ---- Global advisory mirror (written only by elevated feed jobs) -------------
create table advisory (
  id            uuid primary key default gen_random_uuid(),
  source        text not null check (source in ('osv','nvd','ghsa','vendor')),
  advisory_id   text not null,
  summary       text,
  cvss_base     numeric(3,1),
  cvss_vector   text,
  epss_score    numeric(6,5),
  kev_listed    boolean not null default false,
  kev_added_at  timestamptz,
  cwe_ids       text[] not null default '{}',
  published_at  timestamptz,
  modified_at   timestamptz,
  unique (source, advisory_id)
);

create table advisory_affected (
  id            uuid primary key default gen_random_uuid(),
  advisory_pk   uuid not null references advisory(id) on delete cascade,
  ecosystem     text not null,
  package_name  text not null,
  namespace     text,
  introduced    text,
  fixed         text,
  last_affected text
);
create index advisory_affected_lookup_idx on advisory_affected (ecosystem, package_name);

create table advisory_cpe (
  id                       uuid primary key default gen_random_uuid(),
  advisory_pk              uuid not null references advisory(id) on delete cascade,
  cpe                      text not null,
  version_start_including  text,
  version_end_excluding    text,
  version_specific         boolean not null default false
);

grant select on advisory, advisory_affected, advisory_cpe to cras_app;
revoke insert, update, delete on advisory, advisory_affected, advisory_cpe from cras_app;

-- ---- Findings (tenant-scoped, the component x advisory match) ----------------
create table finding (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references organisation(id),
  product_release_id uuid not null references product_release(id),
  sbom_component_id  uuid not null references sbom_component(id),
  advisory_pk        uuid not null references advisory(id),
  advisory_source    text not null,
  advisory_id        text not null,
  match_method       text not null
                       check (match_method in ('purl_exact','purl_range','cpe_match','cpe_not_in_execute_path','manual')),
  match_confidence   numeric(3,2) not null,
  cvss_base          numeric(3,1),
  epss_score         numeric(6,5),
  kev_listed         boolean not null default false,
  vex_status         text not null default 'not_assessed'
                       check (vex_status in ('not_assessed','under_investigation','affected','not_affected','fixed')),
  vex_justification  text,
  state              text not null default 'open'
                       check (state in ('open','in_triage','awaiting_approval','closed','suppressed','reopened')),
  priority_score     numeric,
  first_detected_at  timestamptz not null default now(),
  last_evaluated_at  timestamptz not null default now(),
  suppression_expires_at timestamptz,
  version            integer not null default 1,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid,
  updated_by         uuid,
  unique (organisation_id, sbom_component_id, advisory_pk)  -- one finding per (component, advisory)
);
create index finding_release_idx on finding (organisation_id, product_release_id);
create index finding_state_idx   on finding (organisation_id, state);

alter table finding enable row level security;
alter table finding force  row level security;
create policy tenant_isolation on finding
  using      (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid)
  with check (organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid);
grant select, insert, update, delete on finding to cras_app;
