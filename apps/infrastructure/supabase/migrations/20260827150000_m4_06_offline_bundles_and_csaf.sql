-- CRA-M4-06: signed offline bundle provenance and CSAF source reconciliation.
--
-- Bundle bytes and signatures are deliberately verified before this database
-- boundary.  The database receives only a safe verification receipt and the
-- staged, adapter-normalized records.  Promotion remains transactionally
-- durable: an import cannot change a live feed until every included feed has
-- completed staging and passed the rollback guard.

alter table public.vulnerability_feed_configs
  drop constraint if exists vulnerability_feed_configs_feed_key_check,
  add constraint vulnerability_feed_configs_feed_key_check check (feed_key in (
    'nvd', 'osv', 'cisa_kev', 'epss', 'github_advisory', 'vendor_csaf'
  )),
  add column last_source_snapshot_at timestamptz,
  add column last_bundle_payload_sha256 text
    check (last_bundle_payload_sha256 is null or last_bundle_payload_sha256 ~ '^[a-f0-9]{64}$');

-- Existing mirrors predate a provider-supplied source timestamp.  Their
-- completed-at timestamp is the only honest lower-bound provenance available.
update public.vulnerability_feed_configs
set last_source_snapshot_at = last_complete_snapshot_at
where last_source_snapshot_at is null and last_complete_snapshot_at is not null;

insert into public.vulnerability_feed_configs(
  feed_key, schedule_interval_seconds, stale_threshold_seconds, next_scheduled_at,
  enabled, sync_state, freshness_state, disabled_reason
) values (
  'vendor_csaf', 86400, 172800, now(), false, 'disabled', 'disabled',
  'CSAF provider index is not configured'
) on conflict (feed_key) do nothing;

alter table public.vulnerability_feed_sync_runs
  drop constraint if exists vulnerability_feed_sync_runs_run_kind_check,
  add constraint vulnerability_feed_sync_runs_run_kind_check check (run_kind in (
    'scheduled', 'manual', 'replay', 'offline_bundle_import'
  )),
  add column bundle_import_id uuid,
  add column source_snapshot_at timestamptz,
  add column source_schema_version text,
  add column bundle_payload_sha256 text
    check (bundle_payload_sha256 is null or bundle_payload_sha256 ~ '^[a-f0-9]{64}$');

alter table public.vulnerability_feed_promotion_snapshots
  add column source_snapshot_at timestamptz,
  add column bundle_import_id uuid;

alter table public.vulnerability_feed_events
  drop constraint if exists vulnerability_feed_events_event_type_check,
  add constraint vulnerability_feed_events_event_type_check check (event_type in (
    'sync_queued', 'sync_claimed', 'checkpoint_saved', 'staging_completed', 'sync_promoted',
    'sync_failed', 'sync_dead_lettered', 'sync_replayed', 'freshness_stale', 'freshness_recovered',
    'feed_disabled', 'feed_enabled', 'offline_bundle_staging_started'
  )),
  add column bundle_import_id uuid;

-- Source versions already preserve raw and normalized source assertions.  The
-- reconciliation detail is deliberately immutable alongside that provenance,
-- and lets vendor/public disagreement remain visible without making vendor
-- content authoritative in the public canonical projection.
alter table public.vulnerability_source_record_versions
  add column reconciliation_detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(reconciliation_detail) = 'object');
alter table public.vulnerability_findings
  add column reconciliation_conflict jsonb not null default '{}'::jsonb
    check (jsonb_typeof(reconciliation_conflict) = 'object');

create index vulnerability_feed_configs_source_snapshot_idx
  on public.vulnerability_feed_configs(feed_key, last_source_snapshot_at desc nulls last);
create index vulnerability_feed_sync_runs_bundle_import_idx
  on public.vulnerability_feed_sync_runs(bundle_import_id, feed_key, status)
  where bundle_import_id is not null;
create index vulnerability_feed_promotion_snapshots_bundle_import_idx
  on public.vulnerability_feed_promotion_snapshots(bundle_import_id, feed_key, promotion_sequence)
  where bundle_import_id is not null;
create index vulnerability_source_record_versions_reconciliation_detail_idx
  on public.vulnerability_source_record_versions using gin(reconciliation_detail)
  where reconciliation_detail <> '{}'::jsonb;

create or replace function public.m4_06_capture_reconciliation_detail()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.reconciliation_detail = '{}'::jsonb then
    new.reconciliation_detail := case
      when jsonb_typeof(new.normalized_payload -> 'reconciliationDetail') = 'object'
        then new.normalized_payload -> 'reconciliationDetail'
      when jsonb_typeof(new.normalized_payload -> 'csafProvenance') = 'object'
        then jsonb_build_object('source', 'vendor_csaf', 'assertion', new.normalized_payload -> 'csafProvenance')
      when jsonb_typeof(new.normalized_payload -> 'csaf') = 'object'
        then jsonb_build_object('source', 'vendor_csaf', 'assertion', new.normalized_payload -> 'csaf')
      else '{}'::jsonb
    end;
  end if;
  return new;
end;
$$;
create trigger m4_06_capture_reconciliation_detail_before_write
  before insert on public.vulnerability_source_record_versions
  for each row execute function public.m4_06_capture_reconciliation_detail();

create or replace function public.m4_04_source_version_matching_fingerprint()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.matching_fingerprint := encode(extensions.digest(
    jsonb_strip_nulls(jsonb_build_object(
      'recordState', new.record_state,
      'aliases', new.normalized_payload -> 'aliases',
      'affectedRanges', new.normalized_payload -> 'affectedRanges',
      'nvdConfigurations', new.normalized_payload -> 'nvdConfigurations',
      -- CSAF product status/remediation/product-tree assertions are supplied
      -- here as one immutable normalized value; a change queues targeted
      -- re-evaluation, while transport retrieval metadata stays excluded.
      'csafProvenance', new.normalized_payload -> 'csafProvenance',
      'severity', new.normalized_payload -> 'severity',
      'status', coalesce(new.normalized_payload -> 'status', new.normalized_payload -> 'state')
    ))::text, 'sha256'
  ), 'hex');
  return new;
end;
$$;

create table public.vulnerability_offline_bundle_imports (
  id uuid primary key default gen_random_uuid(),
  bundle_id text not null check (char_length(btrim(bundle_id)) between 1 and 200),
  bundle_version text not null check (char_length(btrim(bundle_version)) between 1 and 100),
  manifest_sha256 text not null unique check (manifest_sha256 ~ '^[a-f0-9]{64}$'),
  signing_key_id text not null check (char_length(btrim(signing_key_id)) between 1 and 200),
  signed_manifest jsonb not null check (jsonb_typeof(signed_manifest) = 'object'),
  verification_receipt jsonb not null check (jsonb_typeof(verification_receipt) = 'object'),
  payload_inventory jsonb not null check (jsonb_typeof(payload_inventory) = 'array'),
  status text not null default 'staging' check (status in (
    'staging', 'promoting', 'completed', 'rejected', 'failed'
  )),
  idempotency_key uuid not null,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  correlation_id uuid not null,
  staging_worker_id text not null check (char_length(btrim(staging_worker_id)) between 1 and 100),
  failure_code text check (failure_code is null or failure_code in (
    'invalid_manifest', 'invalid_signature', 'untrusted_key', 'key_revoked', 'key_expired',
    'incompatible_version', 'payload_inventory_invalid', 'payload_hash_mismatch',
    'payload_size_invalid', 'insufficient_storage', 'rollback_rejected', 'incomplete_staging',
    'promotion_failed', 'unknown_failure'
  )),
  failure_reason text check (failure_reason is null or char_length(btrim(failure_reason)) between 1 and 500),
  promotion_started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (actor_user_id, idempotency_key),
  unique (bundle_id, bundle_version)
);
create index vulnerability_offline_bundle_imports_status_created_idx
  on public.vulnerability_offline_bundle_imports(status, created_at);
create index vulnerability_offline_bundle_imports_actor_created_idx
  on public.vulnerability_offline_bundle_imports(actor_user_id, created_at desc);

alter table public.vulnerability_feed_sync_runs
  add constraint vulnerability_feed_sync_runs_bundle_import_fkey
  foreign key (bundle_import_id) references public.vulnerability_offline_bundle_imports(id) on delete restrict;
alter table public.vulnerability_feed_promotion_snapshots
  add constraint vulnerability_feed_promotion_snapshots_bundle_import_fkey
  foreign key (bundle_import_id) references public.vulnerability_offline_bundle_imports(id) on delete restrict;
alter table public.vulnerability_feed_events
  add constraint vulnerability_feed_events_bundle_import_fkey
  foreign key (bundle_import_id) references public.vulnerability_offline_bundle_imports(id) on delete restrict;

alter table public.vulnerability_offline_bundle_imports enable row level security;
revoke all on public.vulnerability_offline_bundle_imports from public, anon, authenticated;
grant select, insert, update, delete on public.vulnerability_offline_bundle_imports to service_role;

create trigger set_vulnerability_offline_bundle_imports_updated_at before update
  on public.vulnerability_offline_bundle_imports
  for each row execute function public.set_updated_at();

-- A completed run is the source of truth for mirror age.  The capture trigger
-- runs in the same outer promotion transaction; updating its snapshot here is
-- safe and rolls back together with any later included-feed failure.
create or replace function public.m4_06_capture_source_snapshot_provenance()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'completed' and old.status <> 'completed' then
    update public.vulnerability_feed_configs configs
    set last_source_snapshot_at = coalesce(new.source_snapshot_at, new.completed_at),
        last_bundle_payload_sha256 = coalesce(new.bundle_payload_sha256, configs.last_bundle_payload_sha256),
        updated_at = clock_timestamp()
    where configs.feed_key = new.feed_key;
    update public.vulnerability_feed_promotion_snapshots snapshots
    set source_snapshot_at = coalesce(new.source_snapshot_at, new.completed_at),
        bundle_import_id = new.bundle_import_id
    where snapshots.feed_key = new.feed_key and snapshots.run_id = new.id;
  end if;
  return new;
end;
$$;
create trigger m4_06_capture_source_snapshot_provenance_after_complete
  after update of status on public.vulnerability_feed_sync_runs
  for each row execute function public.m4_06_capture_source_snapshot_provenance();

-- Defined before preflight so PL/pgSQL validates all referenced routines when
-- the migration is applied, rather than deferring a missing-function error to
-- the first administrator upload.
create or replace function public.vulnerability_offline_bundle_import_json(p_import_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select case when imports.id is null then null else jsonb_strip_nulls(jsonb_build_object(
    'id', imports.id, 'bundleId', imports.bundle_id, 'bundleVersion', imports.bundle_version,
    'manifestSha256', imports.manifest_sha256, 'signingKeyId', imports.signing_key_id,
    'status', imports.status, 'verificationReceipt', imports.verification_receipt,
    'payloads', imports.payload_inventory, 'failureCode', imports.failure_code,
    -- Only application-selected, bounded reason codes are stored.  Never
    -- project a provider response, detached signature, or file-system path.
    'failureReason', imports.failure_reason, 'createdAt', imports.created_at,
    'promotionStartedAt', imports.promotion_started_at, 'completedAt', imports.completed_at,
    'runs', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', runs.id, 'feedKey', runs.feed_key, 'status', runs.status,
      'expectedRecordCount', runs.expected_record_count, 'recordsReceived', runs.records_received,
      'recordsPromoted', runs.records_promoted, 'sourceSnapshotAt', runs.source_snapshot_at,
      'sourceSchemaVersion', runs.source_schema_version, 'failureCode', runs.failure_code
    )) order by runs.feed_key) from public.vulnerability_feed_sync_runs runs
      where runs.bundle_import_id = imports.id), '[]'::jsonb)
  )) end
  from public.vulnerability_offline_bundle_imports imports where imports.id = p_import_id;
$$;

-- `p_payloads` is a checked application-side receipt, not untrusted multipart
-- bytes.  Each item is exactly `{feedKey, sourceSnapshotAt, payloadSha256,
-- schemaVersion, expectedRecordCount}`.  The verifier has already checked the
-- signature and observed byte hashes before it calls this durable preflight.
create or replace function public.preflight_vulnerability_offline_bundle_import(
  p_bundle_id text,
  p_bundle_version text,
  p_manifest_sha256 text,
  p_signing_key_id text,
  p_manifest jsonb,
  p_verification_receipt jsonb,
  p_actor_user_id uuid,
  p_idempotency_key uuid,
  p_correlation_id uuid,
  p_payloads jsonb,
  p_staging_worker_id text
) returns table(outcome text, import jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.vulnerability_offline_bundle_imports%rowtype;
  v_payload record;
  v_config public.vulnerability_feed_configs%rowtype;
  v_import public.vulnerability_offline_bundle_imports%rowtype;
  v_run_id uuid;
  v_seen_feeds text[] := array[]::text[];
begin
  if char_length(btrim(coalesce(p_bundle_id, ''))) not between 1 and 200
     or char_length(btrim(coalesce(p_bundle_version, ''))) not between 1 and 100
     or coalesce(p_manifest_sha256, '') !~ '^[a-f0-9]{64}$'
     or char_length(btrim(coalesce(p_signing_key_id, ''))) not between 1 and 200
     or jsonb_typeof(p_manifest) <> 'object' or jsonb_typeof(p_verification_receipt) <> 'object'
     or p_actor_user_id is null or p_idempotency_key is null or p_correlation_id is null
     or jsonb_typeof(p_payloads) <> 'array' or jsonb_array_length(p_payloads) not between 1 and 6
     or char_length(btrim(coalesce(p_staging_worker_id, ''))) not between 1 and 100 then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  if not exists (select 1 from public.users where id = p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_existing from public.vulnerability_offline_bundle_imports
  where manifest_sha256 = p_manifest_sha256 for update;
  if found then
    if v_existing.status in ('staging', 'failed') and v_existing.staging_worker_id = btrim(p_staging_worker_id) then
      update public.vulnerability_feed_sync_runs set lease_expires_at = clock_timestamp() + interval '30 minutes',
        updated_at = clock_timestamp()
      where bundle_import_id = v_existing.id and status = 'processing'
        and lease_owner = v_existing.staging_worker_id;
    end if;
    return query select 'replayed'::text, public.vulnerability_offline_bundle_import_json(v_existing.id); return;
  end if;
  select * into v_existing from public.vulnerability_offline_bundle_imports
  where actor_user_id = p_actor_user_id and idempotency_key = p_idempotency_key for update;
  if found then
    if v_existing.manifest_sha256 = p_manifest_sha256 then
      if v_existing.status in ('staging', 'failed') and v_existing.staging_worker_id = btrim(p_staging_worker_id) then
        update public.vulnerability_feed_sync_runs set lease_expires_at = clock_timestamp() + interval '30 minutes',
          updated_at = clock_timestamp()
        where bundle_import_id = v_existing.id and status = 'processing'
          and lease_owner = v_existing.staging_worker_id;
      end if;
      return query select 'replayed'::text, public.vulnerability_offline_bundle_import_json(v_existing.id);
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb; return;
  end if;
  for v_payload in select * from jsonb_to_recordset(p_payloads) as payload(
    "feedKey" text, "sourceSnapshotAt" timestamptz, "payloadSha256" text,
    "schemaVersion" text, "expectedRecordCount" integer
  ) order by "feedKey" loop
    if v_payload."feedKey" not in ('nvd', 'osv', 'cisa_kev', 'epss', 'github_advisory', 'vendor_csaf')
       or v_payload."sourceSnapshotAt" is null or coalesce(v_payload."payloadSha256", '') !~ '^[a-f0-9]{64}$'
       or char_length(btrim(coalesce(v_payload."schemaVersion", ''))) not between 1 and 100
       or v_payload."expectedRecordCount" is null or v_payload."expectedRecordCount" < 0
       or v_payload."feedKey" = any(v_seen_feeds) then
      return query select 'invalid_request'::text, null::jsonb; return;
    end if;
    v_seen_feeds := array_append(v_seen_feeds, v_payload."feedKey");
  end loop;
  -- Stable config locking prevents two overlapping bundles from independently
  -- passing a rollback check and then reversing each other.
  for v_config in select * from public.vulnerability_feed_configs
    where feed_key = any(v_seen_feeds) order by feed_key for update loop
    select * into v_payload from jsonb_to_recordset(p_payloads) as payload(
      "feedKey" text, "sourceSnapshotAt" timestamptz, "payloadSha256" text,
      "schemaVersion" text, "expectedRecordCount" integer
    ) where "feedKey" = v_config.feed_key;
    if not v_config.enabled and v_config.feed_key <> 'vendor_csaf' then
      return query select 'disabled'::text, null::jsonb; return;
    end if;
    if v_config.last_bundle_payload_sha256 is distinct from v_payload."payloadSha256"
       and v_config.last_source_snapshot_at is not null
       and v_payload."sourceSnapshotAt" < v_config.last_source_snapshot_at then
      return query select 'rollback_rejected'::text, null::jsonb; return;
    end if;
  end loop;
  insert into public.vulnerability_offline_bundle_imports(
    bundle_id, bundle_version, manifest_sha256, signing_key_id, signed_manifest,
    verification_receipt, payload_inventory, idempotency_key, actor_user_id,
    correlation_id, staging_worker_id
  ) values (
    btrim(p_bundle_id), btrim(p_bundle_version), p_manifest_sha256, btrim(p_signing_key_id), p_manifest,
    p_verification_receipt, p_payloads, p_idempotency_key, p_actor_user_id, p_correlation_id,
    btrim(p_staging_worker_id)
  ) returning * into v_import;
  for v_payload in select * from jsonb_to_recordset(p_payloads) as payload(
    "feedKey" text, "sourceSnapshotAt" timestamptz, "payloadSha256" text,
    "schemaVersion" text, "expectedRecordCount" integer
  ) order by "feedKey" loop
    insert into public.vulnerability_feed_sync_runs(
      feed_key, run_kind, status, correlation_id, requested_by, bundle_import_id,
      source_snapshot_at, source_schema_version, bundle_payload_sha256,
      expected_record_count, staging_complete, attempt_count, max_attempts,
      lease_owner, lease_expires_at, started_at
    ) values (
      v_payload."feedKey", 'offline_bundle_import', 'processing', p_correlation_id, p_actor_user_id, v_import.id,
      v_payload."sourceSnapshotAt", btrim(v_payload."schemaVersion"), v_payload."payloadSha256",
      null, false, 1, 5, btrim(p_staging_worker_id), clock_timestamp() + interval '30 minutes', clock_timestamp()
    ) returning id into v_run_id;
    insert into public.vulnerability_feed_events(feed_key, run_id, actor_user_id, correlation_id, event_type,
      detail, bundle_import_id)
    values (v_payload."feedKey", v_run_id, p_actor_user_id, p_correlation_id, 'offline_bundle_staging_started',
      jsonb_build_object('bundleId', v_import.bundle_id, 'manifestSha256', v_import.manifest_sha256,
        'sourceSnapshotAt', v_payload."sourceSnapshotAt", 'schemaVersion', v_payload."schemaVersion"), v_import.id);
  end loop;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (null, p_actor_user_id, 'vulnerability.offline_bundle_preflighted', 'vulnerability_offline_bundle_import',
    v_import.id::text, jsonb_build_object('bundleId', v_import.bundle_id, 'bundleVersion', v_import.bundle_version,
      'manifestSha256', v_import.manifest_sha256, 'signingKeyId', v_import.signing_key_id,
      'feedCount', jsonb_array_length(p_payloads), 'correlationId', p_correlation_id));
  return query select 'preflight_created'::text, public.vulnerability_offline_bundle_import_json(v_import.id);
exception when unique_violation then
  select * into v_existing from public.vulnerability_offline_bundle_imports where manifest_sha256 = p_manifest_sha256;
  if found then return query select 'replayed'::text, public.vulnerability_offline_bundle_import_json(v_existing.id); end if;
  return query select 'conflict'::text, null::jsonb;
end;
$$;

-- The JSON projection intentionally never returns a detached signature, raw
-- provider payload or any deployment key material.
create or replace function public.vulnerability_offline_bundle_import_json(p_import_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select case when imports.id is null then null else jsonb_build_object(
    'id', imports.id,
    'status', case imports.status
      when 'staging' then 'awaiting_confirmation'
      when 'promoting' then 'promoting'
      when 'completed' then 'completed'
      when 'rejected' then 'rejected'
      else 'failed' end,
    'bundleSha256', imports.manifest_sha256,
    'manifest', imports.signed_manifest,
    'signature', imports.verification_receipt,
    'compatibility', jsonb_build_object('status', 'compatible', 'reason', null),
    'estimatedChanges', jsonb_build_object(
      'recordsToCreate', 0,
      'recordsToUpdate', 0,
      'recordsToWithdraw', 0
    ),
    'sourceSnapshotAt', (select max(runs.source_snapshot_at) from public.vulnerability_feed_sync_runs runs
      where runs.bundle_import_id = imports.id),
    'sourceSnapshotAgeSeconds', (select least(2147483647::numeric,
      greatest(0::numeric, extract(epoch from clock_timestamp() - max(runs.source_snapshot_at))))::integer
      from public.vulnerability_feed_sync_runs runs where runs.bundle_import_id = imports.id),
    'failureCode', case imports.failure_code
      when 'rollback_rejected' then 'bundle_rollback_rejected'
      when 'incompatible_version' then 'compatibility_incompatible'
      when 'insufficient_storage' then 'disk_capacity_unavailable'
      when 'invalid_manifest' then 'manifest_invalid'
      when 'payload_hash_mismatch' then 'payload_hash_mismatch'
      when 'payload_inventory_invalid' then 'payload_inventory_invalid'
      when 'invalid_signature' then 'signature_invalid'
      when 'untrusted_key' then 'untrusted_key'
      when 'key_revoked' then 'untrusted_key'
      when 'key_expired' then 'untrusted_key'
      else case when imports.failure_code is null then null else 'unknown' end end,
    'createdAt', imports.created_at,
    'updatedAt', imports.updated_at,
    'completedAt', imports.completed_at,
    'runs', coalesce((select jsonb_agg(jsonb_build_object(
      'id', runs.id,
      'feedKey', runs.feed_key
    ) order by runs.feed_key) from public.vulnerability_feed_sync_runs runs
      where runs.bundle_import_id = imports.id), '[]'::jsonb)
  ) end
  from public.vulnerability_offline_bundle_imports imports where imports.id = p_import_id;
$$;

create or replace function public.get_vulnerability_offline_bundle_import(
  p_import_id uuid
) returns table(outcome text, import jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_import_id is null then return query select 'invalid_request'::text, null::jsonb; return; end if;
  if not exists (select 1 from public.vulnerability_offline_bundle_imports where id = p_import_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  return query select 'found'::text, public.vulnerability_offline_bundle_import_json(p_import_id);
end;
$$;

create or replace function public.confirm_vulnerability_offline_bundle_import(
  p_import_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key uuid
) returns table(outcome text, import jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_import public.vulnerability_offline_bundle_imports%rowtype;
  v_run public.vulnerability_feed_sync_runs%rowtype;
  v_config public.vulnerability_feed_configs%rowtype;
  v_payload record;
  v_promotion record;
begin
  if p_import_id is null or p_actor_user_id is null or p_idempotency_key is null then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;
  select * into v_import from public.vulnerability_offline_bundle_imports where id = p_import_id for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  if v_import.actor_user_id <> p_actor_user_id then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  if v_import.status = 'completed' then
    return query select 'already_promoted'::text, public.vulnerability_offline_bundle_import_json(v_import.id); return;
  end if;
  if v_import.status not in ('staging', 'failed') then
    return query select 'conflict'::text, public.vulnerability_offline_bundle_import_json(v_import.id); return;
  end if;
  -- Retain command idempotency separately from preflight idempotency: a retry
  -- of confirmation must not need to re-upload bytes.
  if p_idempotency_key <> v_import.idempotency_key and exists (
    select 1 from public.audit_logs logs where logs.organization_id is null
      and logs.action = 'vulnerability.offline_bundle_confirmed'
      and logs.entity_type = 'vulnerability_offline_bundle_import' and logs.entity_id = v_import.id::text
      and logs.changes ->> 'confirmationIdempotencyKey' = p_idempotency_key::text
  ) then
    return query select 'already_promoted'::text, public.vulnerability_offline_bundle_import_json(v_import.id); return;
  end if;
  -- Lock configurations in lexical order before promoting any feed.
  for v_config in select configs.* from public.vulnerability_feed_configs configs
    join public.vulnerability_feed_sync_runs runs on runs.feed_key = configs.feed_key
    where runs.bundle_import_id = v_import.id order by configs.feed_key for update loop
    select * into v_payload from jsonb_to_recordset(v_import.payload_inventory) as payload(
      "feedKey" text, "sourceSnapshotAt" timestamptz, "payloadSha256" text,
      "schemaVersion" text, "expectedRecordCount" integer
    ) where "feedKey" = v_config.feed_key;
    if v_config.last_bundle_payload_sha256 is distinct from v_payload."payloadSha256"
       and v_config.last_source_snapshot_at is not null
       and v_payload."sourceSnapshotAt" < v_config.last_source_snapshot_at then
      update public.vulnerability_offline_bundle_imports set status = 'rejected', failure_code = 'rollback_rejected',
        failure_reason = 'A changed feed snapshot predates the active source snapshot',
        completed_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = v_import.id;
      return query select 'rollback_rejected'::text, public.vulnerability_offline_bundle_import_json(v_import.id); return;
    end if;
  end loop;
  if exists (select 1 from public.vulnerability_feed_sync_runs runs
    where runs.bundle_import_id = v_import.id and (runs.status <> 'processing' or not runs.staging_complete
      or runs.expected_record_count is null or runs.lease_owner <> v_import.staging_worker_id
      or runs.lease_expires_at <= clock_timestamp()
      or (select count(*) from public.vulnerability_feed_staged_records staged where staged.run_id = runs.id)
          <> runs.expected_record_count)) then
    return query select 'incomplete_staging'::text, public.vulnerability_offline_bundle_import_json(v_import.id); return;
  end if;
  update public.vulnerability_offline_bundle_imports set status = 'promoting', promotion_started_at = clock_timestamp(),
    updated_at = clock_timestamp() where id = v_import.id;
  -- Existing feed promotion is deliberately called inside this single SQL
  -- transaction.  Any exception rolls back all preceding feed promotions and
  -- preserves the active mirror exactly as it was.
  for v_run in select * from public.vulnerability_feed_sync_runs
    where bundle_import_id = v_import.id order by feed_key for update loop
    select * into v_promotion from public.promote_vulnerability_feed_sync(v_run.id, v_import.staging_worker_id);
    if v_promotion.outcome not in ('promoted', 'already_promoted') then
      raise exception using errcode = 'P0001', message = 'offline bundle promotion failed: ' || v_promotion.outcome;
    end if;
  end loop;
  update public.vulnerability_offline_bundle_imports set status = 'completed', completed_at = clock_timestamp(),
    failure_code = null, failure_reason = null, updated_at = clock_timestamp() where id = v_import.id;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (null, p_actor_user_id, 'vulnerability.offline_bundle_confirmed', 'vulnerability_offline_bundle_import',
    v_import.id::text, jsonb_build_object('bundleId', v_import.bundle_id, 'manifestSha256', v_import.manifest_sha256,
      'confirmationIdempotencyKey', p_idempotency_key, 'correlationId', v_import.correlation_id));
  return query select 'promoted'::text, public.vulnerability_offline_bundle_import_json(v_import.id);
exception when others then
  -- The subtransaction is rolled back before this handler executes.  A durable
  -- safe failure fact is then written without leaking a provider response.
  update public.vulnerability_offline_bundle_imports set status = 'failed', failure_code = 'promotion_failed',
    failure_reason = 'Bundle promotion did not complete',
    completed_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = p_import_id and status <> 'completed';
  return query select 'promotion_failed'::text, public.vulnerability_offline_bundle_import_json(p_import_id);
end;
$$;

-- Vendor assertions are source-specific.  This helper joins a CSAF source
-- record to a canonical advisory only when the adapter supplied a proven alias
-- target; it never rewrites the canonical vulnerability's public fields.
create or replace function public.reconcile_vendor_csaf_source_record(
  p_source_record_id uuid,
  p_canonical_vulnerability_id uuid,
  p_reconciliation_detail jsonb
) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source public.vulnerability_source_records%rowtype;
begin
  if p_source_record_id is null or p_canonical_vulnerability_id is null
     or jsonb_typeof(p_reconciliation_detail) <> 'object' then return 'invalid_request'; end if;
  select * into v_source from public.vulnerability_source_records where id = p_source_record_id for update;
  if not found or v_source.feed_key <> 'vendor_csaf'
     or not exists (select 1 from public.vulnerabilities where id = p_canonical_vulnerability_id) then return 'not_found'; end if;
  update public.vulnerability_source_records set vulnerability_id = p_canonical_vulnerability_id,
    updated_at = clock_timestamp() where id = p_source_record_id;
  -- Version rows are immutable; insert-time adapter normalization carries the
  -- detail on new versions.  Existing immutable versions remain untouched.
  return 'reconciled';
end;
$$;

create or replace function public.get_vulnerability_csaf_reconciliation_detail(
  p_canonical_id text
) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with target as (
    select id, canonical_id, updated_at
    from public.vulnerabilities
    where canonical_id = btrim(p_canonical_id)
  ), assertions as (
    select jsonb_build_object(
      'sourceFeed', records.feed_key,
      'sourceRecordId', records.source_record_key,
      'status', versions.record_state,
      'assertedAt', versions.source_updated_at,
      'publisher', case when records.feed_key = 'vendor_csaf'
        then nullif(versions.normalized_payload #>> '{csafProvenance,publisherName}', '')
        else records.feed_key end
    ) as assertion
    from target
    join public.vulnerability_source_records records on records.vulnerability_id = target.id
    join public.vulnerability_source_record_versions versions on versions.id = records.current_version_id
    where records.feed_key in ('vendor_csaf', 'nvd', 'osv', 'github_advisory')
  ), conflicts as (
    select distinct jsonb_array_elements_text(
      case when jsonb_typeof(versions.reconciliation_detail -> 'conflicts') = 'array'
        then versions.reconciliation_detail -> 'conflicts' else '[]'::jsonb end
    ) as conflict
    from target
    join public.vulnerability_source_records records on records.vulnerability_id = target.id
    join public.vulnerability_source_record_versions versions on versions.id = records.current_version_id
    where records.feed_key = 'vendor_csaf'
  )
  select case when not exists (select 1 from target)
      or not exists (select 1 from assertions)
    then null
    else jsonb_build_object(
      'canonicalId', (select canonical_id from target),
      'vendorTrackingId', coalesce(
        (select versions.normalized_payload #>> '{csafProvenance,trackingId}'
         from target
         join public.vulnerability_source_records records on records.vulnerability_id = target.id
         join public.vulnerability_source_record_versions versions on versions.id = records.current_version_id
         where records.feed_key = 'vendor_csaf'
         order by versions.promoted_at desc limit 1),
        (select canonical_id from target)
      ),
      'sourceAssertions', (select jsonb_agg(assertion order by assertion ->> 'sourceFeed', assertion ->> 'sourceRecordId') from assertions),
      'conflicts', coalesce((select jsonb_agg(conflict order by conflict) from conflicts), '[]'::jsonb),
      'updatedAt', (select updated_at from target)
    ) end;
$$;

-- The generic mirror promoter predates CSAF and projects the staged canonical
-- row before it updates a source record.  Reassert the newest public-source
-- projection after a CSAF pointer changes.  This keeps the vendor assertion
-- and its immutable version while making precedence explicit: vendor status
-- can never silently overwrite a CVE/GHSA/OSV public projection.
create or replace function public.m4_06_restore_public_projection_after_csaf()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_public_version public.vulnerability_source_record_versions%rowtype;
begin
  if new.feed_key <> 'vendor_csaf' or new.current_version_id is null then return new; end if;
  select versions.* into v_public_version
  from public.vulnerability_source_records records
  join public.vulnerability_source_record_versions versions on versions.id = records.current_version_id
  where records.vulnerability_id = new.vulnerability_id and records.feed_key <> 'vendor_csaf'
    and records.current_version_id is not null
  order by coalesce(versions.source_updated_at, versions.promoted_at) desc, versions.id desc
  limit 1;
  if found then
    update public.vulnerabilities vulnerabilities set
      lifecycle_state = v_public_version.record_state,
      title = coalesce(nullif(v_public_version.normalized_payload ->> 'title', ''), vulnerabilities.title),
      summary = coalesce(nullif(v_public_version.normalized_payload ->> 'summary', ''), vulnerabilities.summary),
      published_at = coalesce(vulnerabilities.published_at, nullif(v_public_version.normalized_payload ->> 'publishedAt', '')::timestamptz),
      modified_at = coalesce(v_public_version.source_updated_at,
        nullif(v_public_version.normalized_payload ->> 'modifiedAt', '')::timestamptz, vulnerabilities.modified_at),
      withdrawn_at = case when v_public_version.record_state in ('withdrawn', 'rejected', 'deleted')
        then coalesce(vulnerabilities.withdrawn_at, clock_timestamp()) else null end,
      severity = case when coalesce(v_public_version.normalized_payload -> 'severity', '{}'::jsonb) <> '{}'::jsonb
        then v_public_version.normalized_payload -> 'severity' else vulnerabilities.severity end,
      updated_at = clock_timestamp()
    where vulnerabilities.id = new.vulnerability_id;
  end if;
  return new;
end;
$$;
create trigger m4_06_restore_public_projection_after_csaf_source_insert
  after insert on public.vulnerability_source_records
  for each row execute function public.m4_06_restore_public_projection_after_csaf();
create trigger m4_06_restore_public_projection_after_csaf_source_change
  after update of current_version_id on public.vulnerability_source_records
  for each row execute function public.m4_06_restore_public_projection_after_csaf();

-- CSAF uses the same deterministic PURL/CPE indexes as M4-04.  The worker
-- calls these candidates only after its PURL-first/CPE-fallback policy has
-- selected the appropriate identity.  A vendor range never replaces a public
-- source assertion because `sourceFeedKey` is retained in the result.
alter table public.vulnerability_match_jobs
  add column vendor_csaf_promotion_sequence bigint not null default 0
    check (vendor_csaf_promotion_sequence >= 0),
  add column vendor_csaf_mirror_captured_at timestamptz;

alter table public.vulnerability_findings
  drop constraint if exists vulnerability_findings_match_method_check,
  add constraint vulnerability_findings_match_method_check
    check (match_method in ('purl_osv', 'cpe_nvd'));
alter table public.vulnerability_match_evaluations
  drop constraint if exists vulnerability_match_evaluations_match_method_check,
  add constraint vulnerability_match_evaluations_match_method_check
    check (match_method in ('purl_osv', 'cpe_nvd'));
alter table public.vulnerability_matching_accuracy_metrics
  drop constraint if exists vulnerability_matching_accuracy_metrics_match_method_check,
  add constraint vulnerability_matching_accuracy_metrics_match_method_check
    check (match_method in ('purl_osv', 'cpe_nvd'));

-- Pin CSAF exactly as OSV/NVD are pinned.  Existing match jobs keep a zero
-- sequence and therefore cannot unexpectedly begin consuming vendor data.
create or replace function public.enqueue_vulnerability_match_job_atomic(
  p_organization_id uuid, p_document_id uuid, p_release_id uuid,
  p_correlation_id uuid, p_requested_by uuid default null
) returns table(outcome text, job_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_osv_snapshot bigint; v_osv_snapshot_at timestamptz;
  v_nvd_snapshot bigint; v_nvd_snapshot_at timestamptz;
  v_csaf_snapshot bigint; v_csaf_snapshot_at timestamptz;
  v_trigger_key text; v_job uuid;
begin
  if p_organization_id is null or p_document_id is null or p_release_id is null or p_correlation_id is null
     or not exists (select 1 from public.sbom_documents documents join public.sbom_document_sources sources
       on sources.organization_id = documents.organization_id and sources.document_id = documents.id
       where documents.organization_id = p_organization_id and documents.id = p_document_id
         and documents.state = 'completed' and sources.release_id = p_release_id)
     or not exists (select 1 from public.product_releases releases where releases.organization_id = p_organization_id
       and releases.id = p_release_id)
     or (p_requested_by is not null and not exists (select 1 from public.users users where users.id = p_requested_by)) then
    return query select 'not_found'::text, null::uuid; return;
  end if;
  select current_promotion_sequence into v_osv_snapshot from public.vulnerability_feed_configs where feed_key = 'osv';
  select completed_at into v_osv_snapshot_at from public.vulnerability_feed_promotion_snapshots
    where feed_key = 'osv' and promotion_sequence = coalesce(v_osv_snapshot, 0);
  select current_promotion_sequence into v_nvd_snapshot from public.vulnerability_feed_configs where feed_key = 'nvd';
  select completed_at into v_nvd_snapshot_at from public.vulnerability_feed_promotion_snapshots
    where feed_key = 'nvd' and promotion_sequence = coalesce(v_nvd_snapshot, 0);
  select current_promotion_sequence into v_csaf_snapshot from public.vulnerability_feed_configs where feed_key = 'vendor_csaf';
  select completed_at into v_csaf_snapshot_at from public.vulnerability_feed_promotion_snapshots
    where feed_key = 'vendor_csaf' and promotion_sequence = coalesce(v_csaf_snapshot, 0);
  v_trigger_key := 'document:' || p_document_id::text || ':release:' || p_release_id::text
    || ':osv:' || coalesce(v_osv_snapshot, 0)::text || ':nvd:' || coalesce(v_nvd_snapshot, 0)::text
    || ':vendor-csaf:' || coalesce(v_csaf_snapshot, 0)::text;
  insert into public.vulnerability_match_jobs(
    organization_id, document_id, release_id, osv_promotion_sequence, mirror_captured_at,
    nvd_promotion_sequence, nvd_mirror_captured_at, vendor_csaf_promotion_sequence,
    vendor_csaf_mirror_captured_at, correlation_id, requested_by, trigger_key
  ) values (
    p_organization_id, p_document_id, p_release_id, coalesce(v_osv_snapshot, 0), v_osv_snapshot_at,
    coalesce(v_nvd_snapshot, 0), v_nvd_snapshot_at, coalesce(v_csaf_snapshot, 0),
    v_csaf_snapshot_at, p_correlation_id, p_requested_by, v_trigger_key
  ) on conflict (organization_id, trigger_key) do update set
    due_at = least(public.vulnerability_match_jobs.due_at, clock_timestamp()), updated_at = clock_timestamp()
  returning id into v_job;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_requested_by, 'vulnerability.match_queued', 'vulnerability_match_job', v_job::text,
    jsonb_build_object('documentId', p_document_id, 'releaseId', p_release_id,
      'osvPromotionSequence', coalesce(v_osv_snapshot, 0), 'nvdPromotionSequence', coalesce(v_nvd_snapshot, 0),
      'vendorCsafPromotionSequence', coalesce(v_csaf_snapshot, 0), 'correlationId', p_correlation_id));
  return query select 'queued'::text, v_job;
end;
$$;

create or replace function public.list_vulnerability_match_csaf_purl_candidates(
  p_organization_id uuid, p_job_id uuid, p_lease_owner text,
  p_purl_type text, p_purl_namespace text, p_purl_name text
) returns table(candidate jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_match_jobs%rowtype;
begin
  if p_organization_id is null or p_job_id is null
    or char_length(btrim(coalesce(p_lease_owner, ''))) not between 1 and 100
    or char_length(btrim(coalesce(p_purl_type, ''))) not between 1 and 100
    or char_length(btrim(coalesce(p_purl_name, ''))) not between 1 and 300 then return; end if;
  select * into v_job from public.vulnerability_match_jobs jobs
  where jobs.organization_id = p_organization_id and jobs.id = p_job_id;
  if not found or v_job.status <> 'leased' or v_job.lease_owner <> btrim(p_lease_owner)
    or v_job.lease_expires_at <= clock_timestamp() then return; end if;
  return query
  select jsonb_build_object('affectedRangeId', ranges.id, 'sourceRecordId', snapshots.source_record_id,
    'sourceRecordVersionId', snapshots.source_record_version_id, 'vulnerabilityId', snapshots.vulnerability_id,
    'canonicalAdvisoryId', vulnerabilities.canonical_id, 'sourceFeedKey', 'vendor_csaf',
    'ecosystem', ranges.ecosystem, 'packageName', ranges.package_name, 'purlType', ranges.purl_type,
    'purlNamespace', ranges.purl_namespace, 'purlName', ranges.purl_name, 'rangeType', ranges.range_type,
    'rangeValue', ranges.range_value, 'eventSequence', ranges.event_sequence,
    'normalizedPayload', versions.normalized_payload, 'reconciliationDetail', versions.reconciliation_detail)
  from public.vulnerability_feed_snapshot_source_records snapshots
  join public.vulnerability_affected_ranges ranges on ranges.source_record_version_id = snapshots.source_record_version_id
  join public.vulnerability_source_record_versions versions on versions.id = snapshots.source_record_version_id
  join public.vulnerabilities vulnerabilities on vulnerabilities.id = snapshots.vulnerability_id
  where snapshots.feed_key = 'vendor_csaf' and snapshots.promotion_sequence = v_job.vendor_csaf_promotion_sequence
    and snapshots.record_state = 'active' and ranges.purl_type = lower(btrim(p_purl_type))
    and coalesce(ranges.purl_namespace, '') = coalesce(nullif(btrim(p_purl_namespace), ''), '')
    and ranges.purl_name = lower(btrim(p_purl_name))
  order by snapshots.vulnerability_id, ranges.id;
end;
$$;

create or replace function public.list_vulnerability_match_csaf_cpe_candidates(
  p_organization_id uuid, p_job_id uuid, p_lease_owner text,
  p_cpe_part text, p_cpe_vendor text, p_cpe_product text
) returns table(candidate jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_match_jobs%rowtype;
begin
  if p_organization_id is null or p_job_id is null
    or char_length(btrim(coalesce(p_lease_owner, ''))) not between 1 and 100
    or char_length(btrim(coalesce(p_cpe_part, ''))) not between 1 and 20
    or char_length(btrim(coalesce(p_cpe_vendor, ''))) not between 1 and 255
    or char_length(btrim(coalesce(p_cpe_product, ''))) not between 1 and 255 then return; end if;
  select * into v_job from public.vulnerability_match_jobs jobs
  where jobs.organization_id = p_organization_id and jobs.id = p_job_id;
  if not found or v_job.status <> 'leased' or v_job.lease_owner <> btrim(p_lease_owner)
    or v_job.lease_expires_at <= clock_timestamp() then return; end if;
  return query
  select jsonb_build_object('affectedRangeId', ranges.id, 'sourceRecordId', snapshots.source_record_id,
    'sourceRecordVersionId', snapshots.source_record_version_id, 'vulnerabilityId', snapshots.vulnerability_id,
    'canonicalAdvisoryId', vulnerabilities.canonical_id, 'sourceFeedKey', 'vendor_csaf',
    'rangeValue', ranges.range_value, 'eventSequence', ranges.event_sequence,
    'configurationPath', ranges.configuration_path, 'operator', ranges.configuration_operator,
    'negated', ranges.configuration_negated, 'vulnerable', ranges.cpe_vulnerable,
    'cpe', jsonb_strip_nulls(jsonb_build_object('part', ranges.cpe_part, 'vendor', ranges.cpe_vendor,
      'product', ranges.cpe_product, 'version', ranges.cpe_version, 'update', ranges.cpe_update,
      'edition', ranges.cpe_edition, 'language', ranges.cpe_language,
      'versionStartIncluding', ranges.version_start_including, 'versionStartExcluding', ranges.version_start_excluding,
      'versionEndIncluding', ranges.version_end_including, 'versionEndExcluding', ranges.version_end_excluding,
      'criteria', coalesce(ranges.range_value ->> 'criteria', ranges.range_value ->> 'cpe23Uri'))),
    'normalizedPayload', versions.normalized_payload, 'reconciliationDetail', versions.reconciliation_detail)
  from public.vulnerability_feed_snapshot_source_records snapshots
  join public.vulnerability_affected_ranges ranges on ranges.source_record_version_id = snapshots.source_record_version_id
  join public.vulnerability_source_record_versions versions on versions.id = snapshots.source_record_version_id
  join public.vulnerabilities vulnerabilities on vulnerabilities.id = snapshots.vulnerability_id
  where snapshots.feed_key = 'vendor_csaf' and snapshots.promotion_sequence = v_job.vendor_csaf_promotion_sequence
    and snapshots.record_state = 'active' and ranges.cpe_part = lower(btrim(p_cpe_part))
    and ranges.cpe_vendor = lower(btrim(p_cpe_vendor)) and ranges.cpe_product = lower(btrim(p_cpe_product))
  order by snapshots.vulnerability_id, ranges.id;
end;
$$;

-- M4-04 discovery is already feed-neutral: its indexed PURL/CPE lookup and
-- durable source-version trigger enqueue CSAF rows automatically.  Its write
-- boundary predates the CSAF method names, so this narrowly scoped wrapper
-- reuses the same finding identity, human-hold and audit transition logic,
-- then restores CSAF provenance before returning.  It is intentionally a
-- wrapper rather than a second findings table or queue.
create or replace function public.persist_vulnerability_csaf_reevaluation_page_atomic(
  p_organization_id uuid,
  p_job_id uuid,
  p_lease_owner text,
  p_expected_checkpoint_version integer,
  p_transitions jsonb,
  p_next_occurrence_id uuid,
  p_is_final boolean
) returns table(outcome text, processed_count integer, created_count integer,
  review_required_count integer, checkpoint_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job public.vulnerability_reevaluation_jobs%rowtype;
  v_compat_transitions jsonb;
  v_result record;
begin
  select * into v_job from public.vulnerability_reevaluation_jobs jobs
  join public.vulnerability_source_records records on records.id = jobs.source_record_id
  where jobs.organization_id = p_organization_id and jobs.id = p_job_id and records.feed_key = 'vendor_csaf';
  if not found then return query select 'not_found'::text, 0, 0, 0, null::integer; return; end if;
  if jsonb_typeof(p_transitions) <> 'array' then
    return query select 'invalid_request'::text, 0, 0, 0, null::integer; return;
  end if;
  -- The established function verifies job/occurrence/range ownership and
  -- preserves human assessments.  It receives an internal compatibility
  -- method only for its pre-CSAF input guard; the final rows below contain the
  -- actual CSAF method and feed, and an explicit reconciliation audit fact.
  select coalesce(jsonb_agg(jsonb_set(
    jsonb_set(value, '{evidence,sourceFeedKey}',
      case when value #>> '{evidence,matchMethod}' = 'purl_osv' then '"osv"'::jsonb else '"nvd"'::jsonb end, true),
    '{evidence,matchMethod}',
      case when value #>> '{evidence,matchMethod}' = 'purl_osv' then '"purl_osv"'::jsonb else '"cpe_nvd"'::jsonb end, true)
  ), '[]'::jsonb) into v_compat_transitions
  from jsonb_array_elements(p_transitions);
  select * into v_result from public.persist_vulnerability_reevaluation_page_atomic(
    p_organization_id, p_job_id, p_lease_owner, p_expected_checkpoint_version,
    v_compat_transitions, p_next_occurrence_id, p_is_final
  );
  if v_result.outcome in ('completed', 'queued') then
    update public.vulnerability_findings findings set
      source_feed_key = 'vendor_csaf',
      reconciliation_conflict = coalesce(findings.reconciliation_conflict,
        '{}'::jsonb), updated_at = clock_timestamp()
    where findings.organization_id = p_organization_id
      and findings.source_record_version_id = v_job.source_record_version_id;
    insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'vulnerability.csaf_reevaluation_provenance_applied',
      'vulnerability_reevaluation_job', p_job_id::text,
      jsonb_build_object('sourceFeedKey', 'vendor_csaf',
        'sourceRecordVersionId', v_job.source_record_version_id));
  end if;
  return query select v_result.outcome, v_result.processed_count, v_result.created_count,
    v_result.review_required_count, v_result.checkpoint_version;
end;
$$;

-- Generalize the established M4-04 re-evaluation write boundary.  Candidate
-- discovery is already feed-neutral; this keeps the same hold/review/closure
-- rules while accepting CSAF provenance with the existing PURL/CPE algorithms.
create or replace function public.persist_vulnerability_reevaluation_page_atomic(
  p_organization_id uuid,p_job_id uuid,p_lease_owner text,p_expected_checkpoint_version integer,
  p_transitions jsonb,p_next_occurrence_id uuid,p_is_final boolean
) returns table(outcome text,processed_count integer,created_count integer,
  review_required_count integer,checkpoint_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job public.vulnerability_reevaluation_jobs%rowtype; v_item record;
  v_occurrence public.vulnerability_component_occurrences%rowtype;
  v_finding public.vulnerability_findings%rowtype; v_before jsonb; v_after jsonb;
  v_processed integer:=0; v_created integer:=0; v_review_required integer:=0;
begin
  if p_organization_id is null or p_job_id is null or p_expected_checkpoint_version is null
    or char_length(btrim(coalesce(p_lease_owner,''))) not between 1 and 100
    or jsonb_typeof(p_transitions)<>'array' or p_is_final is null then
    return query select 'invalid_request'::text,0,0,0,null::integer; return;
  end if;
  select * into v_job from public.vulnerability_reevaluation_jobs jobs
  where jobs.scope='tenant' and jobs.organization_id=p_organization_id and jobs.id=p_job_id for update;
  if not found then return query select 'not_found'::text,0,0,0,null::integer; return; end if;
  if v_job.status<>'leased' or v_job.lease_owner<>btrim(p_lease_owner) or v_job.lease_expires_at<=clock_timestamp()
    or v_job.checkpoint_version<>p_expected_checkpoint_version then
    return query select 'conflict'::text,0,0,0,v_job.checkpoint_version; return;
  end if;
  if not p_is_final and (p_next_occurrence_id is null or not exists (
    select 1 from public.list_vulnerability_reevaluation_candidates(p_organization_id,p_job_id,p_lease_owner,1000) candidates
    where (candidates.candidate->>'occurrenceId')::uuid=p_next_occurrence_id
  )) then return query select 'invalid_request'::text,0,0,0,v_job.checkpoint_version; return; end if;
  for v_item in select * from jsonb_to_recordset(p_transitions) as items(
    "occurrenceId" uuid,"findingId" uuid,"automaticVerdict" text,"reevaluationState" text,
    "transitionReason" text,"proposedState" jsonb,"evidence" jsonb
  ) loop
    if v_item."occurrenceId" is null or v_item."automaticVerdict" not in ('affected','not_affected','source_unavailable')
      or v_item."reevaluationState" not in ('unchanged','materially_changed','review_required','source_unavailable','closed')
      or jsonb_typeof(v_item."proposedState")<>'object' or jsonb_typeof(v_item."evidence")<>'object' then
      return query select 'invalid_request'::text,0,0,0,v_job.checkpoint_version; return;
    end if;
    select * into v_occurrence from public.vulnerability_component_occurrences occurrences
    where occurrences.organization_id=p_organization_id and occurrences.id=v_item."occurrenceId";
    if not found then return query select 'not_found'::text,0,0,0,v_job.checkpoint_version; return; end if;
    if v_item."findingId" is not null then
      select * into v_finding from public.vulnerability_findings findings
      where findings.organization_id=p_organization_id and findings.id=v_item."findingId" for update;
    else
      select findings.* into v_finding from public.vulnerability_findings findings
      where findings.organization_id=p_organization_id and findings.release_id=v_occurrence.release_id
        and findings.component_identity=v_occurrence.component_identity
        and findings.canonical_advisory_id=btrim(coalesce(v_item."evidence"->>'canonicalAdvisoryId','')) for update;
    end if;
    if not found then
      if v_item."automaticVerdict"<>'affected'
        or char_length(btrim(coalesce(v_item."evidence"->>'canonicalAdvisoryId',''))) not between 1 and 300
        or (v_item."evidence"->>'affectedRangeId') is null
        or (v_item."evidence"->>'sourceRecordId')::uuid<>v_job.source_record_id
        or (v_item."evidence"->>'sourceRecordVersionId')::uuid<>v_job.source_record_version_id
        or (v_item."evidence"->>'vulnerabilityId')::uuid<>v_job.vulnerability_id
        or (v_item."evidence"->>'matchMethod',v_item."evidence"->>'sourceFeedKey') not in (
          ('purl_osv','osv'),('cpe_nvd','nvd'),('purl_osv','vendor_csaf'),('cpe_nvd','vendor_csaf')
        ) then return query select 'invalid_request'::text,0,0,0,v_job.checkpoint_version; return; end if;
      insert into public.vulnerability_findings(
        organization_id,release_id,component_identity,canonical_advisory_id,vulnerability_id,source_feed_key,source_record_id,
        source_record_version_id,affected_range_id,match_method,comparator_name,comparator_version,evaluated_component_value,
        affected_range,event_sequence,confidence,confidence_table_version,confidence_explanation,automatic_verdict,
        reevaluation_state,proposed_state,status,last_evaluated_at
      ) values (p_organization_id,v_occurrence.release_id,v_occurrence.component_identity,btrim(v_item."evidence"->>'canonicalAdvisoryId'),
        v_job.vulnerability_id,v_item."evidence"->>'sourceFeedKey',v_job.source_record_id,v_job.source_record_version_id,
        (v_item."evidence"->>'affectedRangeId')::uuid,v_item."evidence"->>'matchMethod',btrim(v_item."evidence"->>'comparatorName'),
        btrim(v_item."evidence"->>'comparatorVersion'),btrim(v_item."evidence"->>'evaluatedComponentValue'),v_item."evidence"->'affectedRange',
        coalesce(v_item."evidence"->'eventSequence','[]'::jsonb),(v_item."evidence"->>'confidence')::numeric,
        btrim(v_item."evidence"->>'confidenceTableVersion'),btrim(v_item."evidence"->>'confidenceExplanation'),
        'affected','materially_changed',v_item."proposedState",'active',clock_timestamp()) returning * into v_finding;
      insert into public.vulnerability_finding_component_occurrences(finding_id,occurrence_id,organization_id,state,last_evaluated_at)
      values(v_finding.id,v_occurrence.id,p_organization_id,'active',clock_timestamp())
      on conflict(finding_id,occurrence_id) do update set state='active',superseded_at=null,last_evaluated_at=excluded.last_evaluated_at,updated_at=clock_timestamp();
      v_created:=v_created+1; v_before:='{}'::jsonb;
    else
      v_before:=jsonb_strip_nulls(jsonb_build_object('automaticVerdict',v_finding.automatic_verdict,'humanVerdict',v_finding.human_verdict,
        'reevaluationState',v_finding.reevaluation_state,'proposedState',v_finding.proposed_state,'status',v_finding.status,
        'sourceRecordVersionId',v_finding.source_record_version_id));
      update public.vulnerability_findings findings set
        automatic_verdict=case when v_item."reevaluationState"='source_unavailable' then findings.automatic_verdict else v_item."automaticVerdict" end,
        source_feed_key=coalesce(nullif(v_item."evidence"->>'sourceFeedKey',''),findings.source_feed_key),source_record_id=v_job.source_record_id,
        source_record_version_id=v_job.source_record_version_id,affected_range_id=coalesce((v_item."evidence"->>'affectedRangeId')::uuid,findings.affected_range_id),
        match_method=coalesce(nullif(v_item."evidence"->>'matchMethod',''),findings.match_method),
        comparator_name=coalesce(nullif(v_item."evidence"->>'comparatorName',''),findings.comparator_name),
        comparator_version=coalesce(nullif(v_item."evidence"->>'comparatorVersion',''),findings.comparator_version),
        evaluated_component_value=coalesce(nullif(v_item."evidence"->>'evaluatedComponentValue',''),findings.evaluated_component_value),
        affected_range=coalesce(v_item."evidence"->'affectedRange',findings.affected_range),event_sequence=coalesce(v_item."evidence"->'eventSequence',findings.event_sequence),
        confidence=coalesce((v_item."evidence"->>'confidence')::numeric,findings.confidence),
        confidence_table_version=coalesce(nullif(v_item."evidence"->>'confidenceTableVersion',''),findings.confidence_table_version),
        confidence_explanation=coalesce(nullif(v_item."evidence"->>'confidenceExplanation',''),findings.confidence_explanation),
        reevaluation_state=case when v_item."reevaluationState"='source_unavailable' then 'source_unavailable'
          when v_item."reevaluationState"='closed' then 'materially_changed'
          when findings.human_verdict is not null and findings.human_verdict<>v_item."automaticVerdict" then 'review_required' else v_item."reevaluationState" end,
        proposed_state=case when findings.human_verdict is not null and findings.human_verdict<>v_item."automaticVerdict" then v_item."proposedState" else '{}'::jsonb end,
        closed_at=case when v_item."reevaluationState"='closed' then clock_timestamp() else null end,
        closure_reason=case when v_item."reevaluationState"='closed' then v_item."transitionReason" else null end,
        last_evaluated_at=clock_timestamp(),updated_at=clock_timestamp()
      where findings.organization_id=p_organization_id and findings.id=v_finding.id returning * into v_finding;
      if v_finding.reevaluation_state='review_required' then v_review_required:=v_review_required+1; end if;
    end if;
    v_after:=jsonb_strip_nulls(jsonb_build_object('automaticVerdict',v_finding.automatic_verdict,'humanVerdict',v_finding.human_verdict,
      'effectiveVerdict',coalesce(v_finding.human_verdict,v_finding.automatic_verdict),'reevaluationState',v_finding.reevaluation_state,
      'proposedState',v_finding.proposed_state,'status',v_finding.status,'sourceRecordVersionId',v_finding.source_record_version_id));
    insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes)
    values(p_organization_id,case when v_before='{}'::jsonb then 'vulnerability.finding_created_by_reevaluation' else 'vulnerability.finding_reevaluated' end,
      'vulnerability_finding',v_finding.id::text,jsonb_build_object('jobId',v_job.id,'sourceRecordId',v_job.source_record_id,
      'sourceRecordVersionId',v_job.source_record_version_id,'before',v_before,'proposed',v_item."proposedState",'after',v_after,
      'transitionReason',v_item."transitionReason",'sourceFeedKey',v_item."evidence"->>'sourceFeedKey'));
    v_processed:=v_processed+1;
  end loop;
  update public.vulnerability_reevaluation_jobs jobs set status=case when p_is_final then 'completed' else 'queued' end,
    checkpoint=case when p_is_final then jobs.checkpoint else jsonb_build_object('occurrenceId',p_next_occurrence_id) end,
    checkpoint_version=jobs.checkpoint_version+1,processed_count=jobs.processed_count+v_processed,lease_owner=null,lease_expires_at=null,
    completed_at=case when p_is_final then clock_timestamp() else null end,due_at=case when p_is_final then jobs.due_at else clock_timestamp() end,
    updated_at=clock_timestamp() where jobs.organization_id=p_organization_id and jobs.id=v_job.id returning jobs.checkpoint_version into v_job.checkpoint_version;
  return query select case when p_is_final then 'completed' else 'queued' end,v_processed,v_created,v_review_required,v_job.checkpoint_version;
end;
$$;

-- Backwards-compatible CSAF-specific entry point retained for any in-flight
-- worker deployment.  New code calls the generalized M4-04 function above;
-- this forwards without rewriting source provenance.
create or replace function public.persist_vulnerability_csaf_reevaluation_page_atomic(
  p_organization_id uuid,p_job_id uuid,p_lease_owner text,p_expected_checkpoint_version integer,
  p_transitions jsonb,p_next_occurrence_id uuid,p_is_final boolean
) returns table(outcome text,processed_count integer,created_count integer,
  review_required_count integer,checkpoint_version integer)
language sql security definer set search_path = public, pg_temp as $$
  select * from public.persist_vulnerability_reevaluation_page_atomic(
    p_organization_id,p_job_id,p_lease_owner,p_expected_checkpoint_version,p_transitions,p_next_occurrence_id,p_is_final
  );
$$;

-- Preserve the M4-04 persistence protocol while adding a third pinned source.
-- This is one finding ledger: the existing unique advisory/component identity,
-- human assessment and supersession rules remain the conflict boundary.
create or replace function public.persist_vulnerability_match_page_atomic(
  p_organization_id uuid, p_job_id uuid, p_lease_owner text,
  p_expected_checkpoint_version integer, p_processed_component_ids jsonb,
  p_results jsonb, p_is_final boolean
) returns table(outcome text, processed_count integer, matched_count integer,
  reviewable_count integer, superseded_count integer, checkpoint_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job public.vulnerability_match_jobs%rowtype; v_component record; v_item record;
  v_occurrence_id uuid; v_finding public.vulnerability_findings%rowtype;
  v_processed integer := 0; v_matched integer := 0; v_reviewable integer := 0;
  v_superseded integer := 0; v_next_offset bigint; v_next_id uuid;
  v_method text; v_snapshot bigint;
begin
  if p_organization_id is null or p_job_id is null or p_expected_checkpoint_version is null
    or char_length(btrim(coalesce(p_lease_owner, ''))) not between 1 and 100
    or jsonb_typeof(p_processed_component_ids) <> 'array' or jsonb_typeof(p_results) <> 'array'
    or p_is_final is null then return query select 'invalid_request'::text,0,0,0,0,null::integer; return; end if;
  select * into v_job from public.vulnerability_match_jobs jobs
  where jobs.organization_id = p_organization_id and jobs.id = p_job_id for update;
  if not found then return query select 'not_found'::text,0,0,0,0,null::integer; return; end if;
  if v_job.status <> 'leased' or v_job.lease_owner <> btrim(p_lease_owner)
    or v_job.lease_expires_at <= clock_timestamp() or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text,0,0,0,0,v_job.checkpoint_version; return;
  end if;
  if exists (select 1 from jsonb_array_elements(p_processed_component_ids) value where jsonb_typeof(value) <> 'object')
    or exists (select 1 from jsonb_array_elements(p_results) value where jsonb_typeof(value) <> 'object') then
    return query select 'invalid_request'::text,0,0,0,0,v_job.checkpoint_version; return;
  end if;
  for v_component in select components.id, components.source_offset, components.normalized_version,
      processed."identityKind", processed."componentIdentity", processed."canonicalPurl" as canonical_purl,
      processed."canonicalCpe" as canonical_cpe, processed."componentVersion", processed."purlType",
      processed."purlNamespace", processed."purlName", processed."cpePart", processed."cpeVendor",
      processed."cpeProduct", processed."cpeVersion"
    from public.sbom_components components join jsonb_to_recordset(p_processed_component_ids) as processed(
      "componentId" uuid, "identityKind" text, "componentIdentity" text, "canonicalPurl" text,
      "canonicalCpe" text, "componentVersion" text, "purlType" text, "purlNamespace" text,
      "purlName" text, "cpePart" text, "cpeVendor" text, "cpeProduct" text, "cpeVersion" text
    ) on processed."componentId" = components.id
    where components.organization_id = p_organization_id and components.document_id = v_job.document_id
    order by components.source_offset, components.id loop
    v_method := v_component."identityKind";
    if v_method = 'purl' and nullif(btrim(v_component.canonical_purl), '') is not null then
      insert into public.vulnerability_component_occurrences(
        organization_id,document_id,release_id,component_id,canonical_purl,canonical_cpe,identity_kind,
        component_identity,component_version,purl_type,purl_namespace,purl_name,last_evaluated_at
      ) values (p_organization_id,v_job.document_id,v_job.release_id,v_component.id,btrim(v_component.canonical_purl),null,'purl',
        coalesce(nullif(btrim(v_component."componentIdentity"),''),btrim(v_component.canonical_purl)),
        nullif(btrim(coalesce(v_component."componentVersion",v_component.normalized_version)),''),
        lower(nullif(btrim(v_component."purlType"),'')),nullif(btrim(v_component."purlNamespace"),''),
        lower(nullif(btrim(v_component."purlName"),'')),clock_timestamp())
      on conflict (organization_id,document_id,release_id,component_id) do update set
        canonical_purl=excluded.canonical_purl,canonical_cpe=null,identity_kind='purl',component_identity=excluded.component_identity,
        component_version=excluded.component_version,purl_type=excluded.purl_type,purl_namespace=excluded.purl_namespace,
        purl_name=excluded.purl_name,cpe_part=null,cpe_vendor=null,cpe_product=null,cpe_version=null,
        last_evaluated_at=excluded.last_evaluated_at,updated_at=clock_timestamp() returning id into v_occurrence_id;
    elsif v_method = 'cpe' and nullif(btrim(v_component.canonical_cpe), '') is not null then
      insert into public.vulnerability_component_occurrences(
        organization_id,document_id,release_id,component_id,canonical_purl,canonical_cpe,identity_kind,
        component_identity,component_version,cpe_part,cpe_vendor,cpe_product,cpe_version,last_evaluated_at
      ) values (p_organization_id,v_job.document_id,v_job.release_id,v_component.id,null,btrim(v_component.canonical_cpe),'cpe',
        coalesce(nullif(btrim(v_component."componentIdentity"),''),btrim(v_component.canonical_cpe)),
        nullif(btrim(coalesce(v_component."componentVersion",v_component.normalized_version)),''),
        lower(nullif(btrim(v_component."cpePart"),'')),lower(nullif(btrim(v_component."cpeVendor"),'')),
        lower(nullif(btrim(v_component."cpeProduct"),'')),nullif(btrim(v_component."cpeVersion"),''),clock_timestamp())
      on conflict (organization_id,document_id,release_id,component_id) do update set
        canonical_purl=null,canonical_cpe=excluded.canonical_cpe,identity_kind='cpe',component_identity=excluded.component_identity,
        component_version=excluded.component_version,cpe_part=excluded.cpe_part,cpe_vendor=excluded.cpe_vendor,
        cpe_product=excluded.cpe_product,cpe_version=excluded.cpe_version,last_evaluated_at=excluded.last_evaluated_at,
        updated_at=clock_timestamp() returning id into v_occurrence_id;
    else return query select 'invalid_request'::text,0,0,0,0,v_job.checkpoint_version; return;
    end if;
    v_processed := v_processed + 1; v_next_offset := v_component.source_offset; v_next_id := v_component.id;
  end loop;
  if v_processed <> jsonb_array_length(p_processed_component_ids) then
    return query select 'not_found'::text,0,0,0,0,v_job.checkpoint_version; return;
  end if;
  for v_item in select * from jsonb_to_recordset(p_results) as items(
    "componentId" uuid,"outcome" text,"reviewCode" text,"affectedRangeId" uuid,"sourceRecordId" uuid,
    "sourceRecordVersionId" uuid,"vulnerabilityId" uuid,"canonicalAdvisoryId" text,"matchMethod" text,
    "sourceFeedKey" text,"comparatorName" text,"comparatorVersion" text,"evaluatedComponentValue" text,
    "affectedRange" jsonb,"eventSequence" jsonb,"evaluatedAt" timestamptz,"confidence" numeric,
    "confidenceTableVersion" text,"confidenceExplanation" text
  ) loop
    if v_item."outcome" not in ('affected','not_affected','reviewable')
      or (v_item."matchMethod" = 'purl_osv' and v_item."sourceFeedKey" not in ('osv','vendor_csaf'))
      or (v_item."matchMethod" = 'cpe_nvd' and v_item."sourceFeedKey" not in ('nvd','vendor_csaf'))
      then return query select 'invalid_request'::text,0,0,0,0,v_job.checkpoint_version; return; end if;
    select id into v_occurrence_id from public.vulnerability_component_occurrences occurrences
    where occurrences.organization_id=p_organization_id and occurrences.document_id=v_job.document_id
      and occurrences.release_id=v_job.release_id and occurrences.component_id=v_item."componentId";
    if v_occurrence_id is null or not exists (select 1 from jsonb_to_recordset(p_processed_component_ids) as processed("componentId" uuid)
      where processed."componentId"=v_item."componentId") then return query select 'invalid_request'::text,0,0,0,0,v_job.checkpoint_version; return; end if;
    v_snapshot := case v_item."sourceFeedKey" when 'osv' then v_job.osv_promotion_sequence
      when 'nvd' then v_job.nvd_promotion_sequence else v_job.vendor_csaf_promotion_sequence end;
    if v_item."outcome" in ('affected','not_affected') and not exists (
      select 1 from public.vulnerability_feed_snapshot_source_records snapshots
      join public.vulnerability_affected_ranges ranges on ranges.id=v_item."affectedRangeId"
        and ranges.source_record_version_id=snapshots.source_record_version_id
      where snapshots.feed_key=v_item."sourceFeedKey" and snapshots.promotion_sequence=v_snapshot
        and snapshots.source_record_id=v_item."sourceRecordId" and snapshots.source_record_version_id=v_item."sourceRecordVersionId"
        and snapshots.vulnerability_id=v_item."vulnerabilityId" and snapshots.record_state='active'
    ) then return query select 'invalid_request'::text,0,0,0,0,v_job.checkpoint_version; return; end if;
    insert into public.vulnerability_match_evaluations(
      organization_id,match_job_id,occurrence_id,source_feed_key,source_record_id,source_record_version_id,vulnerability_id,
      affected_range_id,outcome,review_code,match_method,comparator_name,comparator_version,evaluated_component_value,
      affected_range,event_sequence,evaluated_at
    ) values (p_organization_id,v_job.id,v_occurrence_id,v_item."sourceFeedKey",v_item."sourceRecordId",v_item."sourceRecordVersionId",
      v_item."vulnerabilityId",v_item."affectedRangeId",v_item."outcome",v_item."reviewCode",v_item."matchMethod",
      v_item."comparatorName",v_item."comparatorVersion",v_item."evaluatedComponentValue",v_item."affectedRange",
      v_item."eventSequence",coalesce(v_item."evaluatedAt",clock_timestamp())) on conflict
      (organization_id,match_job_id,occurrence_id,coalesce(affected_range_id,'00000000-0000-0000-0000-000000000000'::uuid)) do update set
      outcome=excluded.outcome,review_code=excluded.review_code,match_method=excluded.match_method,
      comparator_name=excluded.comparator_name,comparator_version=excluded.comparator_version,
      evaluated_component_value=excluded.evaluated_component_value,affected_range=excluded.affected_range,
      event_sequence=excluded.event_sequence,evaluated_at=excluded.evaluated_at;
    if v_item."outcome"='reviewable' then v_reviewable := v_reviewable+1;
    elsif v_item."outcome"='affected' then
      if char_length(btrim(coalesce(v_item."canonicalAdvisoryId",''))) not between 1 and 300 or v_item."confidence" is null
        or v_item."confidence" not between 0 and 1 or char_length(btrim(coalesce(v_item."confidenceTableVersion",''))) not between 1 and 100
        or char_length(btrim(coalesce(v_item."confidenceExplanation",''))) not between 1 and 1000
        or v_item."affectedRange" is null or v_item."eventSequence" is null
        or char_length(btrim(coalesce(v_item."comparatorName",''))) not between 1 and 100
        or char_length(btrim(coalesce(v_item."comparatorVersion",''))) not between 1 and 100 then
        return query select 'invalid_request'::text,0,0,0,0,v_job.checkpoint_version; return;
      end if;
      insert into public.vulnerability_findings(
        organization_id,release_id,component_identity,canonical_advisory_id,vulnerability_id,source_feed_key,source_record_id,
        source_record_version_id,affected_range_id,match_method,comparator_name,comparator_version,evaluated_component_value,
        affected_range,event_sequence,confidence,confidence_table_version,confidence_explanation,automatic_verdict,
        reevaluation_state,status,last_evaluated_at,last_seen_job_id
      ) select p_organization_id,v_job.release_id,occurrences.component_identity,btrim(v_item."canonicalAdvisoryId"),v_item."vulnerabilityId",
        v_item."sourceFeedKey",v_item."sourceRecordId",v_item."sourceRecordVersionId",v_item."affectedRangeId",v_item."matchMethod",
        v_item."comparatorName",v_item."comparatorVersion",v_item."evaluatedComponentValue",v_item."affectedRange",
        v_item."eventSequence",v_item."confidence",v_item."confidenceTableVersion",v_item."confidenceExplanation",'affected','unchanged','active',
        coalesce(v_item."evaluatedAt",clock_timestamp()),v_job.id from public.vulnerability_component_occurrences occurrences where occurrences.id=v_occurrence_id
      on conflict (organization_id,release_id,component_identity,canonical_advisory_id) do update set
        vulnerability_id=excluded.vulnerability_id,source_feed_key=excluded.source_feed_key,source_record_id=excluded.source_record_id,
        source_record_version_id=excluded.source_record_version_id,affected_range_id=excluded.affected_range_id,match_method=excluded.match_method,
        comparator_name=excluded.comparator_name,comparator_version=excluded.comparator_version,evaluated_component_value=excluded.evaluated_component_value,
        affected_range=excluded.affected_range,event_sequence=excluded.event_sequence,confidence=greatest(public.vulnerability_findings.confidence,excluded.confidence),
        confidence_table_version=case when excluded.confidence>=public.vulnerability_findings.confidence then excluded.confidence_table_version else public.vulnerability_findings.confidence_table_version end,
        confidence_explanation=case when excluded.confidence>=public.vulnerability_findings.confidence then excluded.confidence_explanation else public.vulnerability_findings.confidence_explanation end,
        automatic_verdict='affected',reevaluation_state=case when public.vulnerability_findings.human_verdict is not null and public.vulnerability_findings.human_verdict<>'affected' then 'review_required' else 'unchanged' end,
        proposed_state=case when public.vulnerability_findings.human_verdict is not null and public.vulnerability_findings.human_verdict<>'affected' then jsonb_build_object('automaticVerdict','affected','reason','match_refresh') else '{}'::jsonb end,
        status='active',superseded_at=null,last_evaluated_at=excluded.last_evaluated_at,last_seen_job_id=excluded.last_seen_job_id,updated_at=clock_timestamp()
      returning * into v_finding;
      insert into public.vulnerability_finding_component_occurrences(finding_id,occurrence_id,organization_id,state,last_evaluated_at,last_seen_job_id)
      values (v_finding.id,v_occurrence_id,p_organization_id,'active',coalesce(v_item."evaluatedAt",clock_timestamp()),v_job.id)
      on conflict (finding_id,occurrence_id) do update set state='active',superseded_at=null,last_evaluated_at=excluded.last_evaluated_at,
        last_seen_job_id=excluded.last_seen_job_id,updated_at=clock_timestamp();
      v_matched := v_matched+1;
    end if;
  end loop;
  if p_is_final then
    update public.vulnerability_finding_component_occurrences links set state='superseded',superseded_at=clock_timestamp(),updated_at=clock_timestamp()
    from public.vulnerability_component_occurrences occurrences where links.organization_id=p_organization_id and links.occurrence_id=occurrences.id
      and occurrences.document_id=v_job.document_id and occurrences.release_id=v_job.release_id and links.state='active'
      and links.last_seen_job_id is distinct from v_job.id;
    update public.vulnerability_findings findings set status='superseded',superseded_at=clock_timestamp(),updated_at=clock_timestamp()
    where findings.organization_id=p_organization_id and findings.release_id=v_job.release_id and findings.status='active'
      and not exists (select 1 from public.vulnerability_finding_component_occurrences links where links.finding_id=findings.id
        and links.organization_id=p_organization_id and links.state='active');
    get diagnostics v_superseded=row_count;
  end if;
  update public.vulnerability_match_jobs jobs set status=case when p_is_final then 'completed' else 'queued' end,
    checkpoint_source_offset=case when p_is_final then jobs.checkpoint_source_offset else coalesce(v_next_offset,jobs.checkpoint_source_offset) end,
    checkpoint_component_id=case when p_is_final then jobs.checkpoint_component_id else coalesce(v_next_id,jobs.checkpoint_component_id) end,
    checkpoint_version=jobs.checkpoint_version+1,processed_component_count=jobs.processed_component_count+v_processed,
    matched_component_count=jobs.matched_component_count+v_matched,reviewable_component_count=jobs.reviewable_component_count+v_reviewable,
    lease_owner=null,lease_expires_at=null,completed_at=case when p_is_final then clock_timestamp() else null end,
    due_at=case when p_is_final then jobs.due_at else clock_timestamp() end,updated_at=clock_timestamp()
  where jobs.organization_id=p_organization_id and jobs.id=v_job.id returning jobs.checkpoint_version into v_job.checkpoint_version;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values (p_organization_id,v_job.requested_by,'vulnerability.match_page_persisted','vulnerability_match_job',v_job.id::text,
    jsonb_build_object('processedCount',v_processed,'matchedCount',v_matched,'reviewableCount',v_reviewable,'supersededCount',v_superseded,'final',p_is_final));
  return query select case when p_is_final then 'completed' else 'queued' end,v_processed,v_matched,v_reviewable,v_superseded,v_job.checkpoint_version;
end;
$$;

alter function public.m4_06_capture_source_snapshot_provenance() owner to postgres;
alter function public.m4_06_capture_reconciliation_detail() owner to postgres;
alter function public.preflight_vulnerability_offline_bundle_import(text,text,text,text,jsonb,jsonb,uuid,uuid,uuid,jsonb,text) owner to postgres;
alter function public.vulnerability_offline_bundle_import_json(uuid) owner to postgres;
alter function public.get_vulnerability_offline_bundle_import(uuid) owner to postgres;
alter function public.confirm_vulnerability_offline_bundle_import(uuid,uuid,uuid) owner to postgres;
alter function public.reconcile_vendor_csaf_source_record(uuid,uuid,jsonb) owner to postgres;
alter function public.get_vulnerability_csaf_reconciliation_detail(text) owner to postgres;
alter function public.m4_06_restore_public_projection_after_csaf() owner to postgres;
alter function public.enqueue_vulnerability_match_job_atomic(uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function public.persist_vulnerability_match_page_atomic(uuid,uuid,text,integer,jsonb,jsonb,boolean) owner to postgres;
alter function public.persist_vulnerability_reevaluation_page_atomic(uuid,uuid,text,integer,jsonb,uuid,boolean) owner to postgres;
alter function public.list_vulnerability_match_csaf_purl_candidates(uuid,uuid,text,text,text,text) owner to postgres;
alter function public.list_vulnerability_match_csaf_cpe_candidates(uuid,uuid,text,text,text,text) owner to postgres;
alter function public.persist_vulnerability_csaf_reevaluation_page_atomic(uuid,uuid,text,integer,jsonb,uuid,boolean) owner to postgres;

revoke all on function public.m4_06_capture_source_snapshot_provenance() from public, anon, authenticated;
revoke all on function public.m4_06_capture_reconciliation_detail() from public, anon, authenticated;
revoke all on function public.preflight_vulnerability_offline_bundle_import(text,text,text,text,jsonb,jsonb,uuid,uuid,uuid,jsonb,text) from public, anon, authenticated;
revoke all on function public.vulnerability_offline_bundle_import_json(uuid) from public, anon, authenticated;
revoke all on function public.get_vulnerability_offline_bundle_import(uuid) from public, anon, authenticated;
revoke all on function public.confirm_vulnerability_offline_bundle_import(uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.reconcile_vendor_csaf_source_record(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.get_vulnerability_csaf_reconciliation_detail(text) from public, anon, authenticated;
revoke all on function public.m4_06_restore_public_projection_after_csaf() from public, anon, authenticated;
revoke all on function public.enqueue_vulnerability_match_job_atomic(uuid,uuid,uuid,uuid,uuid) from public, anon, authenticated;
revoke all on function public.persist_vulnerability_match_page_atomic(uuid,uuid,text,integer,jsonb,jsonb,boolean) from public, anon, authenticated;
revoke all on function public.persist_vulnerability_reevaluation_page_atomic(uuid,uuid,text,integer,jsonb,uuid,boolean) from public, anon, authenticated;
revoke all on function public.list_vulnerability_match_csaf_purl_candidates(uuid,uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.list_vulnerability_match_csaf_cpe_candidates(uuid,uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.persist_vulnerability_csaf_reevaluation_page_atomic(uuid,uuid,text,integer,jsonb,uuid,boolean) from public, anon, authenticated;
grant execute on function public.preflight_vulnerability_offline_bundle_import(text,text,text,text,jsonb,jsonb,uuid,uuid,uuid,jsonb,text) to service_role;
grant execute on function public.vulnerability_offline_bundle_import_json(uuid) to service_role;
grant execute on function public.get_vulnerability_offline_bundle_import(uuid) to service_role;
grant execute on function public.confirm_vulnerability_offline_bundle_import(uuid,uuid,uuid) to service_role;
grant execute on function public.reconcile_vendor_csaf_source_record(uuid,uuid,jsonb) to service_role;
grant execute on function public.get_vulnerability_csaf_reconciliation_detail(text) to service_role;
grant execute on function public.persist_vulnerability_match_page_atomic(uuid,uuid,text,integer,jsonb,jsonb,boolean) to service_role;
grant execute on function public.persist_vulnerability_reevaluation_page_atomic(uuid,uuid,text,integer,jsonb,uuid,boolean) to service_role;
grant execute on function public.list_vulnerability_match_csaf_purl_candidates(uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.list_vulnerability_match_csaf_cpe_candidates(uuid,uuid,text,text,text,text) to service_role;
grant execute on function public.persist_vulnerability_csaf_reevaluation_page_atomic(uuid,uuid,text,integer,jsonb,uuid,boolean) to service_role;
