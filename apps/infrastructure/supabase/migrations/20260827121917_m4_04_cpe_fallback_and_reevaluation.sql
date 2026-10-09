-- CRA-M4-04: CPE fallback and durable, targeted advisory re-evaluation.
--
-- This migration is deliberately additive.  The existing PURL/OSV job is
-- retained for compatibility; M4-04 adds CPE identity evidence, a bounded
-- re-evaluation queue, and audit-backed human applicability holds without
-- creating a second findings ledger.

alter table public.vulnerability_component_occurrences
  alter column canonical_purl drop not null,
  add column canonical_cpe text,
  add column identity_kind text not null default 'purl'
    check (identity_kind in ('purl', 'cpe')),
  add column purl_type text,
  add column purl_namespace text,
  add column purl_name text,
  add column cpe_part text,
  add column cpe_vendor text,
  add column cpe_product text,
  add column cpe_version text,
  add constraint vulnerability_component_occurrences_identity_check check (
    (canonical_purl is not null and canonical_cpe is null and identity_kind = 'purl')
    or (canonical_purl is null and canonical_cpe is not null and identity_kind = 'cpe')
  ),
  add constraint vulnerability_component_occurrences_cpe_length_check check (
    canonical_cpe is null or char_length(btrim(canonical_cpe)) between 1 and 4096
  );

create index vulnerability_component_occurrences_purl_identity_idx
  on public.vulnerability_component_occurrences(
    purl_type, coalesce(purl_namespace, ''), purl_name, organization_id, release_id, id
  ) where identity_kind = 'purl' and purl_type is not null and purl_name is not null;
create index vulnerability_component_occurrences_cpe_identity_idx
  on public.vulnerability_component_occurrences(
    cpe_part, cpe_vendor, cpe_product, organization_id, release_id, id
  ) where identity_kind = 'cpe' and cpe_part is not null and cpe_vendor is not null and cpe_product is not null;

-- The raw CPE remains immutable provenance. These columns are discovery keys
-- only; the application owns complete CPE parsing and logical evaluation.
alter table public.vulnerability_affected_ranges
  add column cpe_part text,
  add column cpe_vendor text,
  add column cpe_product text,
  add column cpe_version text,
  add column cpe_update text,
  add column cpe_edition text,
  add column cpe_language text,
  add column configuration_path text,
  add column configuration_operator text check (configuration_operator is null or configuration_operator in ('AND', 'OR')),
  add column configuration_negated boolean not null default false,
  add column cpe_vulnerable boolean,
  add column version_start_including text,
  add column version_start_excluding text,
  add column version_end_including text,
  add column version_end_excluding text;

create index vulnerability_affected_ranges_cpe_lookup_idx
  on public.vulnerability_affected_ranges(
    cpe_part, cpe_vendor, cpe_product, source_record_version_id, id
  ) where cpe_part is not null and cpe_vendor is not null and cpe_product is not null;
create index vulnerability_affected_ranges_source_configuration_idx
  on public.vulnerability_affected_ranges(source_record_version_id, configuration_path, id)
  where configuration_path is not null;

create or replace function public.populate_vulnerability_affected_range_matching_keys()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.purl_type := lower(nullif(btrim(coalesce(new.purl_type, new.range_value ->> 'purlType', '')), ''));
  new.purl_namespace := nullif(btrim(coalesce(new.purl_namespace, new.range_value ->> 'purlNamespace', '')), '');
  new.purl_name := lower(nullif(btrim(coalesce(new.purl_name, new.range_value ->> 'purlName', '')), ''));
  new.cpe_part := lower(nullif(btrim(coalesce(new.cpe_part, new.range_value ->> 'cpePart', new.range_value #>> '{cpe,part}', '')), ''));
  new.cpe_vendor := lower(nullif(btrim(coalesce(new.cpe_vendor, new.range_value ->> 'cpeVendor', new.range_value #>> '{cpe,vendor}', '')), ''));
  new.cpe_product := lower(nullif(btrim(coalesce(new.cpe_product, new.range_value ->> 'cpeProduct', new.range_value #>> '{cpe,product}', '')), ''));
  new.cpe_version := nullif(btrim(coalesce(new.cpe_version, new.range_value ->> 'cpeVersion', new.range_value #>> '{cpe,version}', '')), '');
  new.cpe_update := nullif(btrim(coalesce(new.cpe_update, new.range_value ->> 'cpeUpdate', new.range_value #>> '{cpe,update}', '')), '');
  new.cpe_edition := nullif(btrim(coalesce(new.cpe_edition, new.range_value ->> 'cpeEdition', new.range_value #>> '{cpe,edition}', '')), '');
  new.cpe_language := nullif(btrim(coalesce(new.cpe_language, new.range_value ->> 'cpeLanguage', new.range_value #>> '{cpe,language}', '')), '');
  new.configuration_path := nullif(btrim(coalesce(new.configuration_path, new.range_value ->> 'configurationPath', '')), '');
  new.configuration_operator := upper(nullif(btrim(coalesce(new.configuration_operator, new.range_value ->> 'operator', '')), ''));
  new.configuration_negated := coalesce(new.configuration_negated, (new.range_value ->> 'negated')::boolean, false);
  new.cpe_vulnerable := coalesce(new.cpe_vulnerable, (new.range_value ->> 'vulnerable')::boolean);
  new.version_start_including := nullif(btrim(coalesce(new.version_start_including, new.range_value ->> 'versionStartIncluding', '')), '');
  new.version_start_excluding := nullif(btrim(coalesce(new.version_start_excluding, new.range_value ->> 'versionStartExcluding', '')), '');
  new.version_end_including := nullif(btrim(coalesce(new.version_end_including, new.range_value ->> 'versionEndIncluding', '')), '');
  new.version_end_excluding := nullif(btrim(coalesce(new.version_end_excluding, new.range_value ->> 'versionEndExcluding', '')), '');
  if new.event_sequence = '[]'::jsonb and jsonb_typeof(new.range_value -> 'events') = 'array' then
    new.event_sequence := new.range_value -> 'events';
  elsif new.event_sequence = '[]'::jsonb then
    new.event_sequence := case when jsonb_strip_nulls(jsonb_build_object(
      'introduced', new.range_value ->> 'introduced', 'fixed', new.range_value ->> 'fixed',
      'lastAffected', new.range_value ->> 'lastAffected'
    )) = '{}'::jsonb then '[]'::jsonb else jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'introduced', new.range_value ->> 'introduced', 'fixed', new.range_value ->> 'fixed',
      'lastAffected', new.range_value ->> 'lastAffected'
    ))) end;
  end if;
  return new;
end;
$$;

create or replace function public.upsert_vulnerability_component_occurrence_m4_04(
  p_organization_id uuid, p_document_id uuid, p_release_id uuid, p_component_id uuid,
  p_canonical_purl text, p_canonical_cpe text, p_identity_kind text, p_component_version text,
  p_purl_type text default null, p_purl_namespace text default null, p_purl_name text default null,
  p_cpe_part text default null, p_cpe_vendor text default null, p_cpe_product text default null,
  p_cpe_version text default null
) returns table(outcome text, occurrence_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_occurrence_id uuid; v_identity text;
begin
  if p_organization_id is null or p_document_id is null or p_release_id is null or p_component_id is null
     or p_identity_kind not in ('purl', 'cpe')
     or (p_identity_kind = 'purl' and char_length(btrim(coalesce(p_canonical_purl, ''))) not between 1 and 4096)
     or (p_identity_kind = 'cpe' and char_length(btrim(coalesce(p_canonical_cpe, ''))) not between 1 and 4096)
     or not exists (select 1 from public.sbom_components components where components.organization_id = p_organization_id
       and components.document_id = p_document_id and components.id = p_component_id)
     or not exists (select 1 from public.product_releases releases where releases.organization_id = p_organization_id
       and releases.id = p_release_id) then return query select 'not_found'::text, null::uuid; return; end if;
  v_identity := case when p_identity_kind = 'purl' then btrim(p_canonical_purl) else btrim(p_canonical_cpe) end;
  insert into public.vulnerability_component_occurrences(
    organization_id, document_id, release_id, component_id, canonical_purl, canonical_cpe, identity_kind,
    component_identity, component_version, purl_type, purl_namespace, purl_name,
    cpe_part, cpe_vendor, cpe_product, cpe_version, last_evaluated_at
  ) values (
    p_organization_id, p_document_id, p_release_id, p_component_id,
    case when p_identity_kind = 'purl' then btrim(p_canonical_purl) else null end,
    case when p_identity_kind = 'cpe' then btrim(p_canonical_cpe) else null end,
    p_identity_kind, v_identity, nullif(btrim(p_component_version), ''),
    lower(nullif(btrim(p_purl_type), '')), nullif(btrim(p_purl_namespace), ''), lower(nullif(btrim(p_purl_name), '')),
    lower(nullif(btrim(p_cpe_part), '')), lower(nullif(btrim(p_cpe_vendor), '')), lower(nullif(btrim(p_cpe_product), '')),
    nullif(btrim(p_cpe_version), ''), clock_timestamp()
  ) on conflict (organization_id, document_id, release_id, component_id) do update set
    canonical_purl = excluded.canonical_purl, canonical_cpe = excluded.canonical_cpe,
    identity_kind = excluded.identity_kind, component_identity = excluded.component_identity,
    component_version = excluded.component_version, purl_type = excluded.purl_type,
    purl_namespace = excluded.purl_namespace, purl_name = excluded.purl_name,
    cpe_part = excluded.cpe_part, cpe_vendor = excluded.cpe_vendor, cpe_product = excluded.cpe_product,
    cpe_version = excluded.cpe_version, last_evaluated_at = excluded.last_evaluated_at,
    updated_at = clock_timestamp()
  returning id into v_occurrence_id;
  return query select 'upserted'::text, v_occurrence_id;
end;
$$;

alter table public.vulnerability_match_jobs
  add column nvd_promotion_sequence bigint not null default 0 check (nvd_promotion_sequence >= 0),
  add column nvd_mirror_captured_at timestamptz;

create or replace function public.enqueue_vulnerability_match_job_atomic(
  p_organization_id uuid, p_document_id uuid, p_release_id uuid,
  p_correlation_id uuid, p_requested_by uuid default null
) returns table(outcome text, job_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_osv_snapshot bigint; v_osv_snapshot_at timestamptz;
  v_nvd_snapshot bigint; v_nvd_snapshot_at timestamptz; v_trigger_key text; v_job uuid;
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
  v_trigger_key := 'document:' || p_document_id::text || ':release:' || p_release_id::text
    || ':osv:' || coalesce(v_osv_snapshot, 0)::text || ':nvd:' || coalesce(v_nvd_snapshot, 0)::text;
  insert into public.vulnerability_match_jobs(
    organization_id, document_id, release_id, osv_promotion_sequence, mirror_captured_at,
    nvd_promotion_sequence, nvd_mirror_captured_at, correlation_id, requested_by, trigger_key
  ) values (p_organization_id, p_document_id, p_release_id, coalesce(v_osv_snapshot, 0), v_osv_snapshot_at,
    coalesce(v_nvd_snapshot, 0), v_nvd_snapshot_at, p_correlation_id, p_requested_by, v_trigger_key)
  on conflict (organization_id, trigger_key) do update set due_at = least(public.vulnerability_match_jobs.due_at, clock_timestamp()),
    updated_at = clock_timestamp()
  returning id into v_job;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_requested_by, 'vulnerability.match_queued', 'vulnerability_match_job', v_job::text,
    jsonb_build_object('documentId', p_document_id, 'releaseId', p_release_id,
      'osvPromotionSequence', coalesce(v_osv_snapshot, 0), 'nvdPromotionSequence', coalesce(v_nvd_snapshot, 0),
      'correlationId', p_correlation_id));
  return query select 'queued'::text, v_job;
end;
$$;

create or replace function public.list_vulnerability_match_components(
  p_organization_id uuid, p_job_id uuid, p_lease_owner text, p_limit integer default 250
) returns table(component jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_match_jobs%rowtype;
begin
  if p_organization_id is null or p_job_id is null or char_length(btrim(coalesce(p_lease_owner, ''))) not between 1 and 100
     or p_limit not between 1 and 1000 then return; end if;
  select * into v_job from public.vulnerability_match_jobs jobs
  where jobs.organization_id = p_organization_id and jobs.id = p_job_id;
  if not found or v_job.status <> 'leased' or v_job.lease_owner <> btrim(p_lease_owner)
     or v_job.lease_expires_at <= clock_timestamp() then return; end if;
  return query select jsonb_build_object('id', components.id, 'canonicalPurl', components.canonical_purl,
    'canonicalCpe', components.cpe, 'ecosystem', components.ecosystem, 'version', components.normalized_version,
    'sourceOffset', components.source_offset)
  from public.sbom_components components
  where components.organization_id = p_organization_id and components.document_id = v_job.document_id
    and (components.source_offset, components.id) > (v_job.checkpoint_source_offset,
      coalesce(v_job.checkpoint_component_id, '00000000-0000-0000-0000-000000000000'::uuid))
  order by components.source_offset, components.id limit p_limit;
end;
$$;

create or replace function public.list_vulnerability_match_nvd_candidates(
  p_organization_id uuid, p_job_id uuid, p_lease_owner text,
  p_cpe_part text, p_cpe_vendor text, p_cpe_product text
) returns table(candidate jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_match_jobs%rowtype;
begin
  if p_organization_id is null or p_job_id is null or char_length(btrim(coalesce(p_lease_owner, ''))) not between 1 and 100
     or char_length(btrim(coalesce(p_cpe_part, ''))) not between 1 and 20
     or char_length(btrim(coalesce(p_cpe_vendor, ''))) not between 1 and 255
     or char_length(btrim(coalesce(p_cpe_product, ''))) not between 1 and 255 then return; end if;
  select * into v_job from public.vulnerability_match_jobs jobs where jobs.organization_id = p_organization_id and jobs.id = p_job_id;
  if not found or v_job.status <> 'leased' or v_job.lease_owner <> btrim(p_lease_owner)
     or v_job.lease_expires_at <= clock_timestamp() then return; end if;
  return query select jsonb_build_object('affectedRangeId', ranges.id, 'sourceRecordId', snapshots.source_record_id,
    'sourceRecordVersionId', snapshots.source_record_version_id, 'vulnerabilityId', snapshots.vulnerability_id,
    'canonicalAdvisoryId', vulnerabilities.canonical_id, 'sourceFeedKey', 'nvd', 'rangeValue', ranges.range_value,
    'eventSequence', ranges.event_sequence, 'configurationPath', ranges.configuration_path,
    'operator', ranges.configuration_operator, 'negated', ranges.configuration_negated, 'vulnerable', ranges.cpe_vulnerable,
    'cpe', jsonb_strip_nulls(jsonb_build_object('part', ranges.cpe_part, 'vendor', ranges.cpe_vendor,
      'product', ranges.cpe_product, 'version', ranges.cpe_version, 'update', ranges.cpe_update,
      'edition', ranges.cpe_edition, 'language', ranges.cpe_language, 'versionStartIncluding', ranges.version_start_including,
      'versionStartExcluding', ranges.version_start_excluding, 'versionEndIncluding', ranges.version_end_including,
      'versionEndExcluding', ranges.version_end_excluding)), 'normalizedPayload', versions.normalized_payload)
  from public.vulnerability_feed_snapshot_source_records snapshots
  join public.vulnerability_affected_ranges ranges on ranges.source_record_version_id = snapshots.source_record_version_id
  join public.vulnerability_source_record_versions versions on versions.id = snapshots.source_record_version_id
  join public.vulnerabilities vulnerabilities on vulnerabilities.id = snapshots.vulnerability_id
  where snapshots.feed_key = 'nvd' and snapshots.promotion_sequence = v_job.nvd_promotion_sequence
    and snapshots.record_state = 'active' and ranges.cpe_part = lower(btrim(p_cpe_part))
    and ranges.cpe_vendor = lower(btrim(p_cpe_vendor)) and ranges.cpe_product = lower(btrim(p_cpe_product))
  order by snapshots.vulnerability_id, ranges.id;
end;
$$;

-- Keep the established worker signature while widening its durable boundary to
-- CPE/NVD. The worker supplies method-specific evidence; SQL verifies the
-- pinned feed snapshot and never turns a CPE candidate into a PURL result.
create or replace function public.persist_vulnerability_match_page_atomic(
  p_organization_id uuid, p_job_id uuid, p_lease_owner text,
  p_expected_checkpoint_version integer, p_processed_component_ids jsonb,
  p_results jsonb, p_is_final boolean
) returns table(outcome text, processed_count integer, matched_count integer,
  reviewable_count integer, superseded_count integer, checkpoint_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_match_jobs%rowtype; v_component record; v_item record;
  v_occurrence_id uuid; v_finding public.vulnerability_findings%rowtype; v_processed integer := 0;
  v_matched integer := 0; v_reviewable integer := 0; v_superseded integer := 0;
  v_next_offset bigint; v_next_id uuid; v_method text; v_snapshot bigint;
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
  for v_component in
    select components.id, components.source_offset, components.canonical_purl, components.cpe,
      components.normalized_version, processed."identityKind", processed."componentIdentity",
      processed."canonicalPurl" as processed_canonical_purl,
      processed."canonicalCpe" as processed_canonical_cpe,
      processed."componentVersion", processed."purlType", processed."purlNamespace",
      processed."purlName", processed."cpePart", processed."cpeVendor",
      processed."cpeProduct", processed."cpeVersion"
    from public.sbom_components components
    join jsonb_to_recordset(p_processed_component_ids) as processed(
      "componentId" uuid, "identityKind" text, "componentIdentity" text,
      "canonicalPurl" text, "canonicalCpe" text, "componentVersion" text,
      "purlType" text, "purlNamespace" text, "purlName" text,
      "cpePart" text, "cpeVendor" text, "cpeProduct" text, "cpeVersion" text
    ) on processed."componentId" = components.id
    where components.organization_id = p_organization_id and components.document_id = v_job.document_id
    order by components.source_offset, components.id
  loop
    v_method := v_component."identityKind";
    if v_method = 'purl' and nullif(btrim(v_component.processed_canonical_purl), '') is not null then
      insert into public.vulnerability_component_occurrences(
        organization_id, document_id, release_id, component_id, canonical_purl, canonical_cpe,
        identity_kind, component_identity, component_version, purl_type, purl_namespace,
        purl_name, last_evaluated_at
      ) values (p_organization_id, v_job.document_id, v_job.release_id, v_component.id,
        btrim(v_component.processed_canonical_purl), null, 'purl',
        coalesce(nullif(btrim(v_component."componentIdentity"), ''), btrim(v_component.processed_canonical_purl)),
        nullif(btrim(coalesce(v_component."componentVersion", v_component.normalized_version)), ''),
        lower(nullif(btrim(v_component."purlType"), '')), nullif(btrim(v_component."purlNamespace"), ''),
        lower(nullif(btrim(v_component."purlName"), '')), clock_timestamp())
      on conflict (organization_id, document_id, release_id, component_id) do update set
        canonical_purl = excluded.canonical_purl, canonical_cpe = null, identity_kind = 'purl',
        component_identity = excluded.component_identity, component_version = excluded.component_version,
        purl_type = excluded.purl_type, purl_namespace = excluded.purl_namespace,
        purl_name = excluded.purl_name, cpe_part = null, cpe_vendor = null,
        cpe_product = null, cpe_version = null, last_evaluated_at = excluded.last_evaluated_at,
        updated_at = clock_timestamp()
      returning id into v_occurrence_id;
    elsif v_method = 'cpe' and nullif(btrim(v_component.processed_canonical_cpe), '') is not null then
      insert into public.vulnerability_component_occurrences(
        organization_id, document_id, release_id, component_id, canonical_purl, canonical_cpe,
        identity_kind, component_identity, component_version, cpe_part, cpe_vendor, cpe_product,
        cpe_version, last_evaluated_at
      ) values (p_organization_id, v_job.document_id, v_job.release_id, v_component.id,
        null, btrim(v_component.processed_canonical_cpe), 'cpe',
        coalesce(nullif(btrim(v_component."componentIdentity"), ''), btrim(v_component.processed_canonical_cpe)),
        nullif(btrim(coalesce(v_component."componentVersion", v_component.normalized_version)), ''),
        lower(nullif(btrim(v_component."cpePart"), '')), lower(nullif(btrim(v_component."cpeVendor"), '')),
        lower(nullif(btrim(v_component."cpeProduct"), '')), nullif(btrim(v_component."cpeVersion"), ''),
        clock_timestamp())
      on conflict (organization_id, document_id, release_id, component_id) do update set
        canonical_purl = null, canonical_cpe = excluded.canonical_cpe, identity_kind = 'cpe',
        component_identity = excluded.component_identity, component_version = excluded.component_version,
        cpe_part = excluded.cpe_part, cpe_vendor = excluded.cpe_vendor, cpe_product = excluded.cpe_product,
        cpe_version = excluded.cpe_version, last_evaluated_at = excluded.last_evaluated_at,
        updated_at = clock_timestamp()
      returning id into v_occurrence_id;
    end if;
    v_processed := v_processed + 1; v_next_offset := v_component.source_offset; v_next_id := v_component.id;
  end loop;
  if v_processed <> jsonb_array_length(p_processed_component_ids) then
    return query select 'not_found'::text,0,0,0,0,v_job.checkpoint_version; return;
  end if;
  for v_item in select * from jsonb_to_recordset(p_results) as items(
    "componentId" uuid, "outcome" text, "reviewCode" text, "affectedRangeId" uuid,
    "sourceRecordId" uuid, "sourceRecordVersionId" uuid, "vulnerabilityId" uuid,
    "canonicalAdvisoryId" text, "matchMethod" text, "sourceFeedKey" text,
    "comparatorName" text, "comparatorVersion" text, "evaluatedComponentValue" text,
    "affectedRange" jsonb, "eventSequence" jsonb, "evaluatedAt" timestamptz,
    "confidence" numeric, "confidenceTableVersion" text, "confidenceExplanation" text
  ) loop
    if v_item."outcome" not in ('affected','not_affected','reviewable')
       or v_item."matchMethod" not in ('purl_osv','cpe_nvd')
       or v_item."sourceFeedKey" <> (case when v_item."matchMethod" = 'purl_osv' then 'osv' else 'nvd' end) then
      return query select 'invalid_request'::text,0,0,0,0,v_job.checkpoint_version; return;
    end if;
    select id into v_occurrence_id from public.vulnerability_component_occurrences occurrences
    where occurrences.organization_id = p_organization_id and occurrences.document_id = v_job.document_id
      and occurrences.release_id = v_job.release_id and occurrences.component_id = v_item."componentId";
    if v_occurrence_id is null or not exists (select 1 from jsonb_to_recordset(p_processed_component_ids) as processed(
      "componentId" uuid
    ) where processed."componentId" = v_item."componentId") then
      return query select 'invalid_request'::text,0,0,0,0,v_job.checkpoint_version; return;
    end if;
    v_snapshot := case when v_item."matchMethod" = 'purl_osv' then v_job.osv_promotion_sequence else v_job.nvd_promotion_sequence end;
    if v_item."outcome" in ('affected','not_affected') and not exists (
      select 1 from public.vulnerability_feed_snapshot_source_records snapshots
      join public.vulnerability_affected_ranges ranges on ranges.id = v_item."affectedRangeId"
        and ranges.source_record_version_id = snapshots.source_record_version_id
      where snapshots.feed_key = v_item."sourceFeedKey" and snapshots.promotion_sequence = v_snapshot
        and snapshots.source_record_id = v_item."sourceRecordId" and snapshots.source_record_version_id = v_item."sourceRecordVersionId"
        and snapshots.vulnerability_id = v_item."vulnerabilityId" and snapshots.record_state = 'active') then
      return query select 'invalid_request'::text,0,0,0,0,v_job.checkpoint_version; return;
    end if;
    insert into public.vulnerability_match_evaluations(
      organization_id, match_job_id, occurrence_id, source_feed_key, source_record_id, source_record_version_id,
      vulnerability_id, affected_range_id, outcome, review_code, match_method, comparator_name, comparator_version,
      evaluated_component_value, affected_range, event_sequence, evaluated_at
    ) values (p_organization_id, v_job.id, v_occurrence_id, v_item."sourceFeedKey", v_item."sourceRecordId",
      v_item."sourceRecordVersionId", v_item."vulnerabilityId", v_item."affectedRangeId", v_item."outcome",
      v_item."reviewCode", v_item."matchMethod", v_item."comparatorName", v_item."comparatorVersion",
      v_item."evaluatedComponentValue", v_item."affectedRange", v_item."eventSequence", coalesce(v_item."evaluatedAt", clock_timestamp()))
    on conflict (organization_id, match_job_id, occurrence_id, coalesce(affected_range_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update
      set outcome = excluded.outcome, review_code = excluded.review_code, match_method = excluded.match_method,
        comparator_name = excluded.comparator_name, comparator_version = excluded.comparator_version,
        evaluated_component_value = excluded.evaluated_component_value, affected_range = excluded.affected_range,
        event_sequence = excluded.event_sequence, evaluated_at = excluded.evaluated_at;
    if v_item."outcome" = 'reviewable' then v_reviewable := v_reviewable + 1;
    elsif v_item."outcome" = 'affected' then
      if char_length(btrim(coalesce(v_item."canonicalAdvisoryId", ''))) not between 1 and 300
         or v_item."confidence" is null or v_item."confidence" not between 0 and 1
         or char_length(btrim(coalesce(v_item."confidenceTableVersion", ''))) not between 1 and 100
         or char_length(btrim(coalesce(v_item."confidenceExplanation", ''))) not between 1 and 1000
         or v_item."affectedRange" is null or v_item."eventSequence" is null
         or char_length(btrim(coalesce(v_item."comparatorName", ''))) not between 1 and 100
         or char_length(btrim(coalesce(v_item."comparatorVersion", ''))) not between 1 and 100 then
        return query select 'invalid_request'::text,0,0,0,0,v_job.checkpoint_version; return;
      end if;
      insert into public.vulnerability_findings(
        organization_id, release_id, component_identity, canonical_advisory_id, vulnerability_id, source_feed_key,
        source_record_id, source_record_version_id, affected_range_id, match_method, comparator_name, comparator_version,
        evaluated_component_value, affected_range, event_sequence, confidence, confidence_table_version,
        confidence_explanation, automatic_verdict, reevaluation_state, status, last_evaluated_at, last_seen_job_id
      ) select p_organization_id, v_job.release_id, occurrences.component_identity, btrim(v_item."canonicalAdvisoryId"),
        v_item."vulnerabilityId", v_item."sourceFeedKey", v_item."sourceRecordId", v_item."sourceRecordVersionId",
        v_item."affectedRangeId", v_item."matchMethod", v_item."comparatorName", v_item."comparatorVersion",
        v_item."evaluatedComponentValue", v_item."affectedRange", v_item."eventSequence", v_item."confidence",
        v_item."confidenceTableVersion", v_item."confidenceExplanation", 'affected', 'unchanged', 'active',
        coalesce(v_item."evaluatedAt", clock_timestamp()), v_job.id
      from public.vulnerability_component_occurrences occurrences where occurrences.id = v_occurrence_id
      on conflict (organization_id, release_id, component_identity, canonical_advisory_id) do update set
        vulnerability_id = excluded.vulnerability_id, source_feed_key = excluded.source_feed_key,
        source_record_id = excluded.source_record_id, source_record_version_id = excluded.source_record_version_id,
        affected_range_id = excluded.affected_range_id, match_method = excluded.match_method,
        comparator_name = excluded.comparator_name, comparator_version = excluded.comparator_version,
        evaluated_component_value = excluded.evaluated_component_value, affected_range = excluded.affected_range,
        event_sequence = excluded.event_sequence, confidence = greatest(public.vulnerability_findings.confidence, excluded.confidence),
        confidence_table_version = case when excluded.confidence >= public.vulnerability_findings.confidence then excluded.confidence_table_version else public.vulnerability_findings.confidence_table_version end,
        confidence_explanation = case when excluded.confidence >= public.vulnerability_findings.confidence then excluded.confidence_explanation else public.vulnerability_findings.confidence_explanation end,
        automatic_verdict = 'affected', reevaluation_state = case when public.vulnerability_findings.human_verdict is not null
          and public.vulnerability_findings.human_verdict <> 'affected' then 'review_required' else 'unchanged' end,
        proposed_state = case when public.vulnerability_findings.human_verdict is not null
          and public.vulnerability_findings.human_verdict <> 'affected' then jsonb_build_object('automaticVerdict','affected','reason','match_refresh') else '{}'::jsonb end,
        status = 'active', superseded_at = null, last_evaluated_at = excluded.last_evaluated_at,
        last_seen_job_id = excluded.last_seen_job_id, updated_at = clock_timestamp()
      returning * into v_finding;
      insert into public.vulnerability_finding_component_occurrences(finding_id, occurrence_id, organization_id, state, last_evaluated_at, last_seen_job_id)
      values (v_finding.id, v_occurrence_id, p_organization_id, 'active', coalesce(v_item."evaluatedAt", clock_timestamp()), v_job.id)
      on conflict (finding_id, occurrence_id) do update set state = 'active', superseded_at = null,
        last_evaluated_at = excluded.last_evaluated_at, last_seen_job_id = excluded.last_seen_job_id, updated_at = clock_timestamp();
      v_matched := v_matched + 1;
    end if;
  end loop;
  if p_is_final then
    update public.vulnerability_finding_component_occurrences links set state = 'superseded', superseded_at = clock_timestamp(), updated_at = clock_timestamp()
    from public.vulnerability_component_occurrences occurrences where links.organization_id = p_organization_id
      and links.occurrence_id = occurrences.id and occurrences.document_id = v_job.document_id
      and occurrences.release_id = v_job.release_id and links.state = 'active' and links.last_seen_job_id is distinct from v_job.id;
    update public.vulnerability_findings findings set status = 'superseded', superseded_at = clock_timestamp(), updated_at = clock_timestamp()
    where findings.organization_id = p_organization_id and findings.release_id = v_job.release_id and findings.status = 'active'
      and not exists (select 1 from public.vulnerability_finding_component_occurrences links
        where links.finding_id = findings.id and links.organization_id = p_organization_id and links.state = 'active');
    get diagnostics v_superseded = row_count;
  end if;
  update public.vulnerability_match_jobs jobs set status = case when p_is_final then 'completed' else 'queued' end,
    checkpoint_source_offset = case when p_is_final then jobs.checkpoint_source_offset else coalesce(v_next_offset, jobs.checkpoint_source_offset) end,
    checkpoint_component_id = case when p_is_final then jobs.checkpoint_component_id else coalesce(v_next_id, jobs.checkpoint_component_id) end,
    checkpoint_version = jobs.checkpoint_version + 1, processed_component_count = jobs.processed_component_count + v_processed,
    matched_component_count = jobs.matched_component_count + v_matched, reviewable_component_count = jobs.reviewable_component_count + v_reviewable,
    lease_owner = null, lease_expires_at = null, completed_at = case when p_is_final then clock_timestamp() else null end,
    due_at = case when p_is_final then jobs.due_at else clock_timestamp() end, updated_at = clock_timestamp()
  where jobs.organization_id = p_organization_id and jobs.id = v_job.id returning jobs.checkpoint_version into v_job.checkpoint_version;
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, v_job.requested_by, 'vulnerability.match_page_persisted', 'vulnerability_match_job', v_job.id::text,
    jsonb_build_object('processedCount',v_processed,'matchedCount',v_matched,'reviewableCount',v_reviewable,'supersededCount',v_superseded,'final',p_is_final));
  return query select case when p_is_final then 'completed' else 'queued' end, v_processed, v_matched, v_reviewable, v_superseded, v_job.checkpoint_version;
end;
$$;

alter table public.vulnerability_source_record_versions
  add column matching_fingerprint text;
create index vulnerability_source_record_versions_matching_fingerprint_idx
  on public.vulnerability_source_record_versions(source_record_id, matching_fingerprint)
  where matching_fingerprint is not null;

-- Matching-relevant payload material deliberately excludes retrieval timestamps
-- and provider transport metadata. Feed adapters must retain the original NVD
-- tree under nvdConfigurations; this trigger makes its current stable shape
-- observable to the re-evaluation queue.
create or replace function public.m4_04_source_version_matching_fingerprint()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.matching_fingerprint := encode(extensions.digest(
    jsonb_strip_nulls(jsonb_build_object(
      'recordState', new.record_state,
      'aliases', new.normalized_payload -> 'aliases',
      'affectedRanges', new.normalized_payload -> 'affectedRanges',
      'nvdConfigurations', new.normalized_payload -> 'nvdConfigurations',
      'severity', new.normalized_payload -> 'severity',
      'status', coalesce(new.normalized_payload -> 'status', new.normalized_payload -> 'state')
    ))::text,
    'sha256'
  ), 'hex');
  return new;
end;
$$;
drop trigger if exists m4_04_source_version_matching_fingerprint_before_write
  on public.vulnerability_source_record_versions;
create trigger m4_04_source_version_matching_fingerprint_before_write
  before insert or update of record_state, normalized_payload
  on public.vulnerability_source_record_versions
  for each row execute function public.m4_04_source_version_matching_fingerprint();
-- Existing versions are immutable by design. They remain intentionally null:
-- they predate M4-04 and must not be rewritten merely to manufacture history.
-- Every new promoted version receives a fingerprint in the before-write trigger.
alter table public.vulnerability_source_record_versions
  add constraint vulnerability_source_record_versions_matching_fingerprint_check
    check (matching_fingerprint ~ '^[a-f0-9]{64}$');

alter table public.vulnerability_findings
  drop constraint vulnerability_findings_match_method_check,
  add constraint vulnerability_findings_match_method_check check (match_method in ('purl_osv', 'cpe_nvd')),
  add column automatic_verdict text not null default 'affected'
    check (automatic_verdict in ('affected', 'not_affected', 'source_unavailable')),
  add column human_verdict text check (human_verdict is null or human_verdict in ('affected', 'not_affected')),
  add column human_rationale text check (human_rationale is null or char_length(btrim(human_rationale)) between 1 and 2000),
  add column human_assessed_by uuid references public.users(id) on delete set null,
  add column human_assessed_at timestamptz,
  add column proposed_state jsonb not null default '{}'::jsonb check (jsonb_typeof(proposed_state) = 'object'),
  add column reevaluation_state text not null default 'unchanged'
    check (reevaluation_state in ('re_evaluating', 'unchanged', 'materially_changed', 'review_required', 'source_unavailable')),
  add column closed_at timestamptz,
  add column closure_reason text check (closure_reason is null or closure_reason in ('advisory_withdrawn', 'affected_range_removed', 'component_removed')),
  add constraint vulnerability_findings_human_assessment_pair_check check (
    (human_verdict is null and human_rationale is null and human_assessed_by is null and human_assessed_at is null)
    or (human_verdict is not null and human_rationale is not null and human_assessed_by is not null and human_assessed_at is not null)
  ),
  add constraint vulnerability_findings_closure_pair_check check (
    (closed_at is null and closure_reason is null) or (closed_at is not null and closure_reason is not null)
  );
create index vulnerability_findings_source_version_idx
  on public.vulnerability_findings(organization_id, source_record_id, source_record_version_id, status, id);
create index vulnerability_findings_review_state_idx
  on public.vulnerability_findings(organization_id, reevaluation_state, updated_at desc, id)
  where reevaluation_state in ('materially_changed', 'review_required', 'source_unavailable');

alter table public.vulnerability_match_evaluations
  drop constraint vulnerability_match_evaluations_match_method_check,
  add constraint vulnerability_match_evaluations_match_method_check
    check (match_method in ('purl_osv', 'cpe_nvd')),
  drop constraint vulnerability_match_evaluations_review_code_check,
  add constraint vulnerability_match_evaluations_review_code_check check (review_code is null or review_code in (
    'unsupported_ecosystem', 'purl_ecosystem_mismatch', 'invalid_purl', 'unparseable_version',
    'unsupported_range', 'invalid_cpe', 'unsupported_cpe_binding', 'platform_constraint_unresolved',
    'malformed_configuration', 'unresolved_configuration'
  ));
alter table public.vulnerability_matching_accuracy_metrics
  drop constraint vulnerability_matching_accuracy_metrics_match_method_check,
  add constraint vulnerability_matching_accuracy_metrics_match_method_check
    check (match_method in ('purl_osv', 'cpe_nvd'));

-- One queue serves both bounded global discovery and tenant-scoped work. The
-- partial unique indexes are the idempotency boundary when feeds promote the
-- same material source version repeatedly.
create table public.vulnerability_reevaluation_jobs (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('discovery', 'tenant')),
  organization_id uuid references public.organizations(id) on delete cascade,
  source_record_id uuid not null references public.vulnerability_source_records(id) on delete restrict,
  source_record_version_id uuid not null references public.vulnerability_source_record_versions(id) on delete restrict,
  vulnerability_id uuid not null references public.vulnerabilities(id) on delete restrict,
  source_matching_fingerprint text not null check (source_matching_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued' check (status in ('queued', 'leased', 'retrying', 'completed', 'dead_letter')),
  correlation_id uuid not null,
  trigger_key text not null check (char_length(btrim(trigger_key)) between 1 and 300),
  checkpoint jsonb not null default '{}'::jsonb check (jsonb_typeof(checkpoint) = 'object'),
  checkpoint_version integer not null default 0 check (checkpoint_version >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  max_attempts integer not null default 12 check (max_attempts between 1 and 20),
  due_at timestamptz not null default clock_timestamp(),
  lease_owner text check (lease_owner is null or char_length(btrim(lease_owner)) between 1 and 100),
  lease_expires_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'),
  last_error_message text check (last_error_message is null or char_length(btrim(last_error_message)) between 1 and 1000),
  started_at timestamptz,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'discovery' and organization_id is null) or (scope = 'tenant' and organization_id is not null)),
  check ((lease_owner is null) = (lease_expires_at is null))
);
create unique index vulnerability_reevaluation_jobs_discovery_idempotency_idx
  on public.vulnerability_reevaluation_jobs(source_record_version_id, source_matching_fingerprint)
  where scope = 'discovery' and status in ('queued', 'leased', 'retrying', 'completed');
create unique index vulnerability_reevaluation_jobs_tenant_idempotency_idx
  on public.vulnerability_reevaluation_jobs(organization_id, source_record_version_id, source_matching_fingerprint)
  where scope = 'tenant' and status in ('queued', 'leased', 'retrying', 'completed');
create index vulnerability_reevaluation_jobs_discovery_due_idx
  on public.vulnerability_reevaluation_jobs(due_at, id)
  where scope = 'discovery' and status in ('queued', 'retrying');
create index vulnerability_reevaluation_jobs_tenant_due_idx
  on public.vulnerability_reevaluation_jobs(organization_id, due_at, id)
  where scope = 'tenant' and status in ('queued', 'retrying');
create index vulnerability_reevaluation_jobs_expired_lease_idx
  on public.vulnerability_reevaluation_jobs(scope, organization_id, lease_expires_at, id)
  where status = 'leased';

alter table public.vulnerability_reevaluation_jobs enable row level security;
revoke all on table public.vulnerability_reevaluation_jobs from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.vulnerability_reevaluation_jobs to service_role;
drop trigger if exists set_vulnerability_reevaluation_jobs_updated_at on public.vulnerability_reevaluation_jobs;
create trigger set_vulnerability_reevaluation_jobs_updated_at
  before update on public.vulnerability_reevaluation_jobs
  for each row execute function public.set_updated_at();

create or replace function public.enqueue_vulnerability_reevaluation_for_source_version(
  p_source_record_version_id uuid,
  p_correlation_id uuid
) returns table(outcome text, job_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_record public.vulnerability_source_records%rowtype;
  v_version public.vulnerability_source_record_versions%rowtype;
  v_job_id uuid;
begin
  if p_source_record_version_id is null or p_correlation_id is null then
    return query select 'invalid_request'::text, null::uuid;
    return;
  end if;
  select records.* into v_record
  from public.vulnerability_source_records records
  join public.vulnerability_source_record_versions versions
    on versions.source_record_id = records.id
  where versions.id = p_source_record_version_id
    and records.current_version_id = versions.id;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  select * into v_version from public.vulnerability_source_record_versions
  where id = p_source_record_version_id;
  insert into public.vulnerability_reevaluation_jobs(
    scope, organization_id, source_record_id, source_record_version_id, vulnerability_id,
    source_matching_fingerprint, correlation_id, trigger_key
  ) values (
    'discovery', null, v_record.id, v_version.id, v_record.vulnerability_id,
    v_version.matching_fingerprint, p_correlation_id,
    'source-version:' || v_version.id::text || ':fingerprint:' || v_version.matching_fingerprint
  ) on conflict (source_record_version_id, source_matching_fingerprint)
    where scope = 'discovery' and status in ('queued', 'leased', 'retrying', 'completed')
    do update set due_at = least(public.vulnerability_reevaluation_jobs.due_at, clock_timestamp()),
      updated_at = clock_timestamp()
  returning id into v_job_id;
  insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
  values (null, 'vulnerability.reevaluation_discovery_queued', 'vulnerability_reevaluation_job',
    v_job_id::text, jsonb_build_object('sourceRecordId', v_record.id,
      'sourceRecordVersionId', v_version.id, 'vulnerabilityId', v_record.vulnerability_id,
      'matchingFingerprint', v_version.matching_fingerprint, 'correlationId', p_correlation_id));
  return query select 'queued'::text, v_job_id;
end;
$$;

-- Promotion changes the current immutable version pointer. Enqueueing is a
-- small durable fact in the same transaction; expensive tenant discovery is
-- deferred to the worker.
create or replace function public.m4_04_enqueue_reevaluation_after_source_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_old_fingerprint text;
  v_new_fingerprint text;
begin
  if new.current_version_id is not distinct from old.current_version_id
     or new.current_version_id is null then
    return new;
  end if;
  select matching_fingerprint into v_new_fingerprint
  from public.vulnerability_source_record_versions where id = new.current_version_id;
  select matching_fingerprint into v_old_fingerprint
  from public.vulnerability_source_record_versions where id = old.current_version_id;
  if v_new_fingerprint is distinct from v_old_fingerprint then
    perform outcome from public.enqueue_vulnerability_reevaluation_for_source_version(
      new.current_version_id, gen_random_uuid()
    );
  end if;
  return new;
end;
$$;
drop trigger if exists m4_04_enqueue_reevaluation_after_source_change
  on public.vulnerability_source_records;
create trigger m4_04_enqueue_reevaluation_after_source_change
  after update of current_version_id on public.vulnerability_source_records
  for each row execute function public.m4_04_enqueue_reevaluation_after_source_change();

create or replace function public.claim_vulnerability_reevaluation_discovery_job_atomic(
  p_lease_owner text,
  p_lease_seconds integer
) returns table(outcome text, job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_reevaluation_jobs%rowtype;
begin
  if char_length(btrim(coalesce(p_lease_owner, ''))) not between 1 and 100
     or p_lease_seconds not between 30 and 900 then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  select * into v_job from public.vulnerability_reevaluation_jobs jobs
  where jobs.scope = 'discovery'
    and ((jobs.status in ('queued', 'retrying') and jobs.due_at <= clock_timestamp())
      or (jobs.status = 'leased' and jobs.lease_expires_at <= clock_timestamp()))
  order by jobs.due_at, jobs.id for update skip locked limit 1;
  if not found then
    return query select 'none_available'::text, null::jsonb;
    return;
  end if;
  update public.vulnerability_reevaluation_jobs jobs
  set status = 'leased', lease_owner = btrim(p_lease_owner),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      checkpoint_version = jobs.checkpoint_version + 1,
      delivery_attempts = jobs.delivery_attempts + 1,
      started_at = coalesce(jobs.started_at, clock_timestamp()),
      last_error_code = null, last_error_message = null, updated_at = clock_timestamp()
  where jobs.id = v_job.id
  returning * into v_job;
  return query select 'claimed'::text, jsonb_build_object(
    'id', v_job.id, 'scope', v_job.scope, 'sourceRecordId', v_job.source_record_id,
    'sourceRecordVersionId', v_job.source_record_version_id, 'vulnerabilityId', v_job.vulnerability_id,
    'sourceMatchingFingerprint', v_job.source_matching_fingerprint,
    'checkpoint', v_job.checkpoint, 'checkpointVersion', v_job.checkpoint_version,
    'correlationId', v_job.correlation_id, 'deliveryAttempts', v_job.delivery_attempts
  );
end;
$$;

create or replace function public.fail_vulnerability_reevaluation_discovery_job_atomic(
  p_job_id uuid, p_lease_owner text, p_expected_checkpoint_version integer,
  p_error_code text, p_error_message text, p_retryable boolean
) returns table(outcome text, checkpoint_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_reevaluation_jobs%rowtype;
begin
  if p_job_id is null or p_expected_checkpoint_version is null
     or char_length(btrim(coalesce(p_lease_owner, ''))) not between 1 and 100
     or coalesce(p_error_code, '') !~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'
     or char_length(btrim(coalesce(p_error_message, ''))) not between 1 and 1000
     or p_retryable is null then return query select 'invalid_request'::text, null::integer; return; end if;
  select * into v_job from public.vulnerability_reevaluation_jobs jobs
  where jobs.scope = 'discovery' and jobs.id = p_job_id for update;
  if not found then return query select 'not_found'::text, null::integer; return; end if;
  if v_job.status <> 'leased' or v_job.lease_owner <> btrim(p_lease_owner)
     or v_job.lease_expires_at <= clock_timestamp() or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_job.checkpoint_version; return;
  end if;
  update public.vulnerability_reevaluation_jobs jobs set
    status = case when p_retryable and jobs.delivery_attempts < jobs.max_attempts then 'retrying' else 'dead_letter' end,
    due_at = case when p_retryable and jobs.delivery_attempts < jobs.max_attempts
      then clock_timestamp() + make_interval(secs => least(900, 30 * power(2, greatest(0, jobs.delivery_attempts - 1))::integer)) else jobs.due_at end,
    dead_lettered_at = case when p_retryable and jobs.delivery_attempts < jobs.max_attempts then null else clock_timestamp() end,
    lease_owner = null, lease_expires_at = null, checkpoint_version = jobs.checkpoint_version + 1,
    last_error_code = p_error_code, last_error_message = btrim(p_error_message), updated_at = clock_timestamp()
  where jobs.id = v_job.id returning * into v_job;
  insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
  values (null, 'vulnerability.reevaluation_discovery_failed', 'vulnerability_reevaluation_job', v_job.id::text,
    jsonb_build_object('errorCode', p_error_code, 'retryable', p_retryable, 'status', v_job.status));
  return query select v_job.status, v_job.checkpoint_version;
end;
$$;

create or replace function public.list_vulnerability_reevaluation_candidate_organizations(
  p_job_id uuid,
  p_lease_owner text,
  p_after_organization_id uuid default null,
  p_limit integer default 100
) returns table(organization_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_reevaluation_jobs%rowtype;
begin
  if p_job_id is null or char_length(btrim(coalesce(p_lease_owner, ''))) not between 1 and 100
     or p_limit not between 1 and 500 then return; end if;
  select * into v_job from public.vulnerability_reevaluation_jobs jobs
  where jobs.id = p_job_id and jobs.scope = 'discovery';
  if not found or v_job.status <> 'leased' or v_job.lease_owner <> btrim(p_lease_owner)
     or v_job.lease_expires_at <= clock_timestamp() then return; end if;
  return query
  with indexed_occurrences as (
    select distinct occurrences.organization_id
    from public.vulnerability_affected_ranges ranges
    join public.vulnerability_component_occurrences occurrences on (
      (ranges.purl_type is not null and occurrences.identity_kind = 'purl'
       and occurrences.purl_type = ranges.purl_type
       and coalesce(occurrences.purl_namespace, '') = coalesce(ranges.purl_namespace, '')
       and occurrences.purl_name = ranges.purl_name)
      or (ranges.cpe_part is not null and occurrences.identity_kind = 'cpe'
       and occurrences.cpe_part = ranges.cpe_part
       and occurrences.cpe_vendor = ranges.cpe_vendor
       and occurrences.cpe_product = ranges.cpe_product)
    )
    where ranges.source_record_version_id = v_job.source_record_version_id
  ), existing_findings as (
    select distinct findings.organization_id
    from public.vulnerability_findings findings
    where findings.vulnerability_id = v_job.vulnerability_id and findings.status = 'active'
  )
  select candidate_organizations.org_id
  from (
    select indexed_occurrences.organization_id as org_id from indexed_occurrences
    union
    select existing_findings.organization_id as org_id from existing_findings
  ) candidate_organizations
  where p_after_organization_id is null or candidate_organizations.org_id > p_after_organization_id
  order by candidate_organizations.org_id limit p_limit;
end;
$$;

create or replace function public.persist_vulnerability_reevaluation_discovery_page_atomic(
  p_job_id uuid,
  p_lease_owner text,
  p_expected_checkpoint_version integer,
  p_organization_ids uuid[],
  p_after_organization_id uuid,
  p_is_final boolean
) returns table(outcome text, checkpoint_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_reevaluation_jobs%rowtype; v_invalid boolean := false;
begin
  if p_job_id is null or char_length(btrim(coalesce(p_lease_owner, ''))) not between 1 and 100
     or p_expected_checkpoint_version is null or p_organization_ids is null or p_is_final is null then
    return query select 'invalid_request'::text, null::integer; return;
  end if;
  select * into v_job from public.vulnerability_reevaluation_jobs jobs
  where jobs.id = p_job_id and jobs.scope = 'discovery' for update;
  if not found then return query select 'not_found'::text, null::integer; return; end if;
  if v_job.status <> 'leased' or v_job.lease_owner <> btrim(p_lease_owner)
     or v_job.lease_expires_at <= clock_timestamp()
     or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_job.checkpoint_version; return;
  end if;
  if cardinality(p_organization_ids) <> cardinality(array(select distinct unnest(p_organization_ids))) then
    v_invalid := true;
  end if;
  if not v_invalid and exists (
    select 1 from unnest(p_organization_ids) ids
    where not exists (select 1 from public.list_vulnerability_reevaluation_candidate_organizations(
      v_job.id, p_lease_owner, (v_job.checkpoint ->> 'organizationId')::uuid, 500
    ) candidates where candidates.organization_id = ids)
  ) then v_invalid := true; end if;
  if v_invalid then return query select 'invalid_request'::text, v_job.checkpoint_version; return; end if;
  insert into public.vulnerability_reevaluation_jobs(
    scope, organization_id, source_record_id, source_record_version_id, vulnerability_id,
    source_matching_fingerprint, correlation_id, trigger_key
  ) select 'tenant', ids, v_job.source_record_id, v_job.source_record_version_id,
    v_job.vulnerability_id, v_job.source_matching_fingerprint, v_job.correlation_id,
    'source-version:' || v_job.source_record_version_id::text || ':org:' || ids::text
  from unnest(p_organization_ids) ids
  on conflict (organization_id, source_record_version_id, source_matching_fingerprint)
    where scope = 'tenant' and status in ('queued', 'leased', 'retrying', 'completed')
    do update set due_at = least(public.vulnerability_reevaluation_jobs.due_at, clock_timestamp()),
      updated_at = clock_timestamp();
  update public.vulnerability_reevaluation_jobs jobs set
    status = case when p_is_final then 'completed' else 'queued' end,
    checkpoint = case when p_is_final then jobs.checkpoint else jsonb_build_object('organizationId', p_after_organization_id) end,
    checkpoint_version = jobs.checkpoint_version + 1,
    processed_count = jobs.processed_count + cardinality(p_organization_ids),
    lease_owner = null, lease_expires_at = null,
    completed_at = case when p_is_final then clock_timestamp() else null end,
    due_at = case when p_is_final then jobs.due_at else clock_timestamp() end,
    updated_at = clock_timestamp()
  where jobs.id = v_job.id returning jobs.checkpoint_version into v_job.checkpoint_version;
  insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
  values (null, 'vulnerability.reevaluation_discovery_page_persisted', 'vulnerability_reevaluation_job',
    v_job.id::text, jsonb_build_object('organizations', to_jsonb(p_organization_ids),
      'afterOrganizationId', p_after_organization_id, 'final', p_is_final));
  return query select case when p_is_final then 'completed' else 'queued' end, v_job.checkpoint_version;
end;
$$;

create or replace function public.list_due_vulnerability_reevaluation_organizations(
  p_limit integer default 1000
) returns table(organization_id uuid)
language sql security definer set search_path = public, pg_temp as $$
  select distinct jobs.organization_id
  from public.vulnerability_reevaluation_jobs jobs
  where p_limit between 1 and 1000 and jobs.scope = 'tenant'
    and ((jobs.status in ('queued', 'retrying') and jobs.due_at <= clock_timestamp())
      or (jobs.status = 'leased' and jobs.lease_expires_at <= clock_timestamp()))
  order by jobs.organization_id
  limit p_limit
$$;

create or replace function public.claim_vulnerability_reevaluation_job_atomic(
  p_organization_id uuid,
  p_lease_owner text,
  p_lease_seconds integer
) returns table(outcome text, job jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_reevaluation_jobs%rowtype;
begin
  if p_organization_id is null or char_length(btrim(coalesce(p_lease_owner, ''))) not between 1 and 100
     or p_lease_seconds not between 30 and 900 then
    return query select 'invalid_request'::text, null::jsonb;
    return;
  end if;
  select * into v_job from public.vulnerability_reevaluation_jobs jobs
  where jobs.scope = 'tenant' and jobs.organization_id = p_organization_id
    and ((jobs.status in ('queued', 'retrying') and jobs.due_at <= clock_timestamp())
      or (jobs.status = 'leased' and jobs.lease_expires_at <= clock_timestamp()))
  order by jobs.due_at, jobs.id for update skip locked limit 1;
  if not found then return query select 'none_available'::text, null::jsonb; return; end if;
  update public.vulnerability_reevaluation_jobs jobs
  set status = 'leased', lease_owner = btrim(p_lease_owner),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      checkpoint_version = jobs.checkpoint_version + 1,
      delivery_attempts = jobs.delivery_attempts + 1,
      started_at = coalesce(jobs.started_at, clock_timestamp()),
      last_error_code = null, last_error_message = null, updated_at = clock_timestamp()
  where jobs.organization_id = p_organization_id and jobs.id = v_job.id
  returning * into v_job;
  return query select 'claimed'::text, jsonb_build_object(
    'id', v_job.id, 'scope', v_job.scope, 'organizationId', v_job.organization_id,
    'sourceRecordId', v_job.source_record_id, 'sourceRecordVersionId', v_job.source_record_version_id,
    'vulnerabilityId', v_job.vulnerability_id, 'sourceMatchingFingerprint', v_job.source_matching_fingerprint,
    'checkpoint', v_job.checkpoint, 'checkpointVersion', v_job.checkpoint_version,
    'correlationId', v_job.correlation_id, 'deliveryAttempts', v_job.delivery_attempts
  );
end;
$$;

create or replace function public.list_vulnerability_reevaluation_candidates(
  p_organization_id uuid,
  p_job_id uuid,
  p_lease_owner text,
  p_limit integer default 250
) returns table(candidate jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_reevaluation_jobs%rowtype; v_after uuid;
begin
  if p_organization_id is null or p_job_id is null
     or char_length(btrim(coalesce(p_lease_owner, ''))) not between 1 and 100
     or p_limit not between 1 and 1000 then return; end if;
  select * into v_job from public.vulnerability_reevaluation_jobs jobs
  where jobs.scope = 'tenant' and jobs.organization_id = p_organization_id and jobs.id = p_job_id;
  if not found or v_job.status <> 'leased' or v_job.lease_owner <> btrim(p_lease_owner)
     or v_job.lease_expires_at <= clock_timestamp() then return; end if;
  begin v_after := nullif(v_job.checkpoint ->> 'occurrenceId', '')::uuid;
  exception when invalid_text_representation then return; end;
  return query
  with current_ranges as (
    select ranges.* from public.vulnerability_affected_ranges ranges
    where ranges.source_record_version_id = v_job.source_record_version_id
  ), candidate_occurrences as (
    select distinct occurrences.id
    from public.vulnerability_component_occurrences occurrences
    join current_ranges ranges on (
      (ranges.purl_type is not null and occurrences.identity_kind = 'purl'
       and occurrences.purl_type = ranges.purl_type
       and coalesce(occurrences.purl_namespace, '') = coalesce(ranges.purl_namespace, '')
       and occurrences.purl_name = ranges.purl_name)
      or (ranges.cpe_part is not null and occurrences.identity_kind = 'cpe'
       and occurrences.cpe_part = ranges.cpe_part
       and occurrences.cpe_vendor = ranges.cpe_vendor
       and occurrences.cpe_product = ranges.cpe_product)
    )
    where occurrences.organization_id = p_organization_id
  ), relevant_occurrences as (
    select occurrences.id from public.vulnerability_component_occurrences occurrences
    join candidate_occurrences candidates on candidates.id = occurrences.id
    union
    select links.occurrence_id from public.vulnerability_finding_component_occurrences links
    join public.vulnerability_findings findings on findings.id = links.finding_id
      and findings.organization_id = links.organization_id
    where links.organization_id = p_organization_id and links.state = 'active'
      and findings.vulnerability_id = v_job.vulnerability_id and findings.status = 'active'
  )
  select jsonb_build_object(
    'occurrenceId', occurrences.id, 'documentId', occurrences.document_id, 'releaseId', occurrences.release_id,
    'componentId', occurrences.component_id, 'componentIdentity', occurrences.component_identity,
    'componentVersion', occurrences.component_version, 'ecosystem', components.ecosystem,
    'canonicalPurl', occurrences.canonical_purl,
    'canonicalCpe', occurrences.canonical_cpe, 'identityKind', occurrences.identity_kind,
    'purl', jsonb_strip_nulls(jsonb_build_object('type', occurrences.purl_type,
      'namespace', occurrences.purl_namespace, 'name', occurrences.purl_name)),
    'cpe', jsonb_strip_nulls(jsonb_build_object('part', occurrences.cpe_part,
      'vendor', occurrences.cpe_vendor, 'product', occurrences.cpe_product, 'version', occurrences.cpe_version)),
    'sourceRecordId', v_job.source_record_id, 'sourceRecordVersionId', v_job.source_record_version_id,
    'sourceFeedKey', source_records.feed_key, 'sourceStatus', versions.record_state,
    'vulnerabilityId', v_job.vulnerability_id, 'canonicalAdvisoryId', vulnerabilities.canonical_id,
    'aliases', coalesce((select jsonb_agg(aliases.alias order by lower(aliases.alias))
      from public.vulnerability_aliases aliases
      where aliases.vulnerability_id = v_job.vulnerability_id), '[]'::jsonb),
    'normalizedPayload', versions.normalized_payload,
    'materialChanges', to_jsonb(array_remove(array[
      case when source_records.record_state <> 'active' then 'status' end,
      case when exists (select 1 from public.vulnerability_findings prior
        where prior.organization_id = p_organization_id and prior.vulnerability_id = v_job.vulnerability_id
          and prior.source_record_version_id is distinct from v_job.source_record_version_id) then 'affected_range' end,
      case when exists (select 1 from public.vulnerability_findings prior
        join public.vulnerability_source_record_versions prior_versions on prior_versions.id = prior.source_record_version_id
        where prior.organization_id = p_organization_id and prior.vulnerability_id = v_job.vulnerability_id
          and prior_versions.normalized_payload -> 'severity' is distinct from versions.normalized_payload -> 'severity') then 'severity' end,
      case when exists (select 1 from public.vulnerability_findings prior
        join public.vulnerability_source_record_versions prior_versions on prior_versions.id = prior.source_record_version_id
        where prior.organization_id = p_organization_id and prior.vulnerability_id = v_job.vulnerability_id
          and prior_versions.normalized_payload -> 'aliases' is distinct from versions.normalized_payload -> 'aliases') then 'aliases' end
    ], null)),
    'ranges', coalesce((select jsonb_agg(jsonb_build_object('id', ranges.id, 'ecosystem', ranges.ecosystem,
      'packageName', ranges.package_name, 'purlType', ranges.purl_type, 'purlNamespace', ranges.purl_namespace,
      'purlName', ranges.purl_name, 'rangeType', ranges.range_type, 'rangeValue', ranges.range_value,
      'eventSequence', ranges.event_sequence, 'configurationPath', ranges.configuration_path,
      'operator', ranges.configuration_operator, 'negated', ranges.configuration_negated,
      'vulnerable', ranges.cpe_vulnerable, 'cpe', jsonb_strip_nulls(jsonb_build_object(
        'part', ranges.cpe_part, 'vendor', ranges.cpe_vendor, 'product', ranges.cpe_product,
        'version', ranges.cpe_version, 'update', ranges.cpe_update, 'edition', ranges.cpe_edition,
        'language', ranges.cpe_language, 'versionStartIncluding', ranges.version_start_including,
        'versionStartExcluding', ranges.version_start_excluding, 'versionEndIncluding', ranges.version_end_including,
        'versionEndExcluding', ranges.version_end_excluding))) order by ranges.id)
      from current_ranges ranges where (ranges.purl_type is not null and occurrences.identity_kind = 'purl'
        and occurrences.purl_type = ranges.purl_type and coalesce(occurrences.purl_namespace, '') = coalesce(ranges.purl_namespace, '')
        and occurrences.purl_name = ranges.purl_name) or (ranges.cpe_part is not null and occurrences.identity_kind = 'cpe'
        and occurrences.cpe_part = ranges.cpe_part and occurrences.cpe_vendor = ranges.cpe_vendor
        and occurrences.cpe_product = ranges.cpe_product)), '[]'::jsonb),
    'findings', coalesce((select jsonb_agg(jsonb_build_object('id', findings.id,
      'canonicalAdvisoryId', findings.canonical_advisory_id, 'automaticVerdict', findings.automatic_verdict,
      'humanVerdict', findings.human_verdict, 'reevaluationState', findings.reevaluation_state,
      'proposedState', findings.proposed_state, 'status', findings.status) order by findings.id)
      from public.vulnerability_findings findings
      join public.vulnerability_finding_component_occurrences links on links.finding_id = findings.id
        and links.organization_id = findings.organization_id and links.state = 'active'
      where findings.organization_id = p_organization_id and links.occurrence_id = occurrences.id
        and findings.vulnerability_id = v_job.vulnerability_id), '[]'::jsonb)
  )
  from public.vulnerability_component_occurrences occurrences
  join relevant_occurrences relevant on relevant.id = occurrences.id
  join public.sbom_components components on components.organization_id = occurrences.organization_id
    and components.document_id = occurrences.document_id and components.id = occurrences.component_id
  join public.vulnerability_source_records source_records on source_records.id = v_job.source_record_id
  join public.vulnerability_source_record_versions versions on versions.id = v_job.source_record_version_id
  join public.vulnerabilities vulnerabilities on vulnerabilities.id = v_job.vulnerability_id
  where occurrences.organization_id = p_organization_id and (v_after is null or occurrences.id > v_after)
  order by occurrences.id limit p_limit;
end;
$$;

create or replace function public.persist_vulnerability_reevaluation_page_atomic(
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
  v_item record;
  v_occurrence public.vulnerability_component_occurrences%rowtype;
  v_finding public.vulnerability_findings%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_processed integer := 0;
  v_created integer := 0;
  v_review_required integer := 0;
begin
  if p_organization_id is null or p_job_id is null
     or char_length(btrim(coalesce(p_lease_owner, ''))) not between 1 and 100
     or p_expected_checkpoint_version is null or jsonb_typeof(p_transitions) <> 'array'
     or p_is_final is null then
    return query select 'invalid_request'::text, 0, 0, 0, null::integer;
    return;
  end if;
  select * into v_job from public.vulnerability_reevaluation_jobs jobs
  where jobs.scope = 'tenant' and jobs.organization_id = p_organization_id and jobs.id = p_job_id
  for update;
  if not found then return query select 'not_found'::text, 0, 0, 0, null::integer; return; end if;
  if v_job.status <> 'leased' or v_job.lease_owner <> btrim(p_lease_owner)
     or v_job.lease_expires_at <= clock_timestamp()
     or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, 0, 0, 0, v_job.checkpoint_version; return;
  end if;
  if not p_is_final and (p_next_occurrence_id is null or not exists (
    select 1 from public.list_vulnerability_reevaluation_candidates(
      p_organization_id, p_job_id, p_lease_owner, 1000
    ) candidates where (candidates.candidate ->> 'occurrenceId')::uuid = p_next_occurrence_id
  )) then return query select 'invalid_request'::text, 0, 0, 0, v_job.checkpoint_version; return; end if;
  for v_item in select * from jsonb_to_recordset(p_transitions) as items(
    "occurrenceId" uuid, "findingId" uuid, "automaticVerdict" text,
    "reevaluationState" text, "transitionReason" text, "proposedState" jsonb,
    "evidence" jsonb
  ) loop
    if v_item."occurrenceId" is null or v_item."automaticVerdict" not in ('affected', 'not_affected', 'source_unavailable')
       or v_item."reevaluationState" not in ('unchanged', 'materially_changed', 'review_required', 'source_unavailable', 'closed')
       or v_item."proposedState" is null or jsonb_typeof(v_item."proposedState") <> 'object'
       or v_item."evidence" is null or jsonb_typeof(v_item."evidence") <> 'object' then
      return query select 'invalid_request'::text, 0, 0, 0, v_job.checkpoint_version; return;
    end if;
    select * into v_occurrence from public.vulnerability_component_occurrences occurrences
    where occurrences.organization_id = p_organization_id and occurrences.id = v_item."occurrenceId";
    if not found then return query select 'not_found'::text, 0, 0, 0, v_job.checkpoint_version; return; end if;
    if v_item."findingId" is not null then
      select * into v_finding from public.vulnerability_findings findings
      where findings.organization_id = p_organization_id and findings.id = v_item."findingId" for update;
    else
      select findings.* into v_finding from public.vulnerability_findings findings
      where findings.organization_id = p_organization_id and findings.release_id = v_occurrence.release_id
        and findings.component_identity = v_occurrence.component_identity
        and findings.canonical_advisory_id = btrim(coalesce(v_item."evidence" ->> 'canonicalAdvisoryId', ''))
      for update;
    end if;
    if not found then
      if v_item."automaticVerdict" <> 'affected'
         or char_length(btrim(coalesce(v_item."evidence" ->> 'canonicalAdvisoryId', ''))) not between 1 and 300
         or (v_item."evidence" ->> 'affectedRangeId') is null
         or (v_item."evidence" ->> 'sourceRecordId')::uuid <> v_job.source_record_id
         or (v_item."evidence" ->> 'sourceRecordVersionId')::uuid <> v_job.source_record_version_id
         or (v_item."evidence" ->> 'vulnerabilityId')::uuid <> v_job.vulnerability_id
         or coalesce(v_item."evidence" ->> 'matchMethod', '') not in ('purl_osv', 'cpe_nvd')
         or coalesce(v_item."evidence" ->> 'sourceFeedKey', '') not in ('osv', 'nvd') then
        return query select 'invalid_request'::text, 0, 0, 0, v_job.checkpoint_version; return;
      end if;
      insert into public.vulnerability_findings(
        organization_id, release_id, component_identity, canonical_advisory_id, vulnerability_id,
        source_feed_key, source_record_id, source_record_version_id, affected_range_id, match_method,
        comparator_name, comparator_version, evaluated_component_value, affected_range, event_sequence,
        confidence, confidence_table_version, confidence_explanation, automatic_verdict,
        reevaluation_state, proposed_state, status, last_evaluated_at
      ) values (
        p_organization_id, v_occurrence.release_id, v_occurrence.component_identity,
        btrim(v_item."evidence" ->> 'canonicalAdvisoryId'), v_job.vulnerability_id,
        v_item."evidence" ->> 'sourceFeedKey', v_job.source_record_id, v_job.source_record_version_id,
        (v_item."evidence" ->> 'affectedRangeId')::uuid, v_item."evidence" ->> 'matchMethod',
        btrim(v_item."evidence" ->> 'comparatorName'), btrim(v_item."evidence" ->> 'comparatorVersion'),
        btrim(v_item."evidence" ->> 'evaluatedComponentValue'), v_item."evidence" -> 'affectedRange',
        coalesce(v_item."evidence" -> 'eventSequence', '[]'::jsonb), (v_item."evidence" ->> 'confidence')::numeric,
        btrim(v_item."evidence" ->> 'confidenceTableVersion'), btrim(v_item."evidence" ->> 'confidenceExplanation'),
        'affected', 'materially_changed', v_item."proposedState", 'active', clock_timestamp()
      ) returning * into v_finding;
      insert into public.vulnerability_finding_component_occurrences(
        finding_id, occurrence_id, organization_id, state, last_evaluated_at
      ) values (v_finding.id, v_occurrence.id, p_organization_id, 'active', clock_timestamp())
      on conflict (finding_id, occurrence_id) do update set state = 'active', superseded_at = null,
        last_evaluated_at = excluded.last_evaluated_at, updated_at = clock_timestamp();
      v_created := v_created + 1;
      v_before := '{}'::jsonb;
    else
      v_before := jsonb_strip_nulls(jsonb_build_object(
        'automaticVerdict', v_finding.automatic_verdict, 'humanVerdict', v_finding.human_verdict,
        'reevaluationState', v_finding.reevaluation_state, 'proposedState', v_finding.proposed_state,
        'status', v_finding.status, 'sourceRecordVersionId', v_finding.source_record_version_id
      ));
      update public.vulnerability_findings findings set
        automatic_verdict = case when v_item."reevaluationState" = 'source_unavailable'
          then findings.automatic_verdict else v_item."automaticVerdict" end,
        source_feed_key = coalesce(nullif(v_item."evidence" ->> 'sourceFeedKey', ''), findings.source_feed_key),
        source_record_id = v_job.source_record_id, source_record_version_id = v_job.source_record_version_id,
        affected_range_id = coalesce((v_item."evidence" ->> 'affectedRangeId')::uuid, findings.affected_range_id),
        match_method = coalesce(nullif(v_item."evidence" ->> 'matchMethod', ''), findings.match_method),
        comparator_name = coalesce(nullif(v_item."evidence" ->> 'comparatorName', ''), findings.comparator_name),
        comparator_version = coalesce(nullif(v_item."evidence" ->> 'comparatorVersion', ''), findings.comparator_version),
        evaluated_component_value = coalesce(nullif(v_item."evidence" ->> 'evaluatedComponentValue', ''), findings.evaluated_component_value),
        affected_range = coalesce(v_item."evidence" -> 'affectedRange', findings.affected_range),
        event_sequence = coalesce(v_item."evidence" -> 'eventSequence', findings.event_sequence),
        confidence = coalesce((v_item."evidence" ->> 'confidence')::numeric, findings.confidence),
        confidence_table_version = coalesce(nullif(v_item."evidence" ->> 'confidenceTableVersion', ''), findings.confidence_table_version),
        confidence_explanation = coalesce(nullif(v_item."evidence" ->> 'confidenceExplanation', ''), findings.confidence_explanation),
        reevaluation_state = case when v_item."reevaluationState" = 'source_unavailable' then 'source_unavailable'
          when v_item."reevaluationState" = 'closed' then 'materially_changed'
          when v_finding.human_verdict is not null
          and v_finding.human_verdict <> v_item."automaticVerdict" then 'review_required'
          else v_item."reevaluationState" end,
        proposed_state = case when v_finding.human_verdict is not null
          and v_finding.human_verdict <> v_item."automaticVerdict"
          then v_item."proposedState" else '{}'::jsonb end,
        closed_at = case when v_item."reevaluationState" = 'closed' then clock_timestamp() else null end,
        closure_reason = case when v_item."reevaluationState" = 'closed' then v_item."transitionReason" else null end,
        last_evaluated_at = clock_timestamp(), updated_at = clock_timestamp()
      where findings.organization_id = p_organization_id and findings.id = v_finding.id
      returning * into v_finding;
      if v_finding.reevaluation_state = 'review_required' then v_review_required := v_review_required + 1; end if;
    end if;
    v_after := jsonb_strip_nulls(jsonb_build_object(
      'automaticVerdict', v_finding.automatic_verdict, 'humanVerdict', v_finding.human_verdict,
      'effectiveVerdict', coalesce(v_finding.human_verdict, v_finding.automatic_verdict),
      'reevaluationState', v_finding.reevaluation_state, 'proposedState', v_finding.proposed_state,
      'status', v_finding.status, 'sourceRecordVersionId', v_finding.source_record_version_id
    ));
    insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, case when v_before = '{}'::jsonb then 'vulnerability.finding_created_by_reevaluation'
      else 'vulnerability.finding_reevaluated' end, 'vulnerability_finding', v_finding.id::text,
      jsonb_build_object('jobId', v_job.id, 'sourceRecordId', v_job.source_record_id,
        'sourceRecordVersionId', v_job.source_record_version_id, 'before', v_before,
        'proposed', v_item."proposedState", 'after', v_after, 'transitionReason', v_item."transitionReason"));
    v_processed := v_processed + 1;
  end loop;
  update public.vulnerability_reevaluation_jobs jobs set
    status = case when p_is_final then 'completed' else 'queued' end,
    checkpoint = case when p_is_final then jobs.checkpoint else jsonb_build_object('occurrenceId', p_next_occurrence_id) end,
    checkpoint_version = jobs.checkpoint_version + 1,
    processed_count = jobs.processed_count + v_processed,
    lease_owner = null, lease_expires_at = null,
    completed_at = case when p_is_final then clock_timestamp() else null end,
    due_at = case when p_is_final then jobs.due_at else clock_timestamp() end,
    updated_at = clock_timestamp()
  where jobs.organization_id = p_organization_id and jobs.id = v_job.id
  returning jobs.checkpoint_version into v_job.checkpoint_version;
  return query select case when p_is_final then 'completed' else 'queued' end,
    v_processed, v_created, v_review_required, v_job.checkpoint_version;
end;
$$;

create or replace function public.fail_vulnerability_reevaluation_job_atomic(
  p_organization_id uuid, p_job_id uuid, p_lease_owner text,
  p_expected_checkpoint_version integer, p_error_code text, p_error_message text,
  p_retryable boolean
) returns table(outcome text, checkpoint_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.vulnerability_reevaluation_jobs%rowtype;
begin
  if p_organization_id is null or p_job_id is null or p_expected_checkpoint_version is null
     or char_length(btrim(coalesce(p_lease_owner, ''))) not between 1 and 100
     or coalesce(p_error_code, '') !~ '^[a-z0-9][a-z0-9_.:-]{0,99}$'
     or char_length(btrim(coalesce(p_error_message, ''))) not between 1 and 1000
     or p_retryable is null then return query select 'invalid_request'::text, null::integer; return; end if;
  select * into v_job from public.vulnerability_reevaluation_jobs jobs
  where jobs.scope = 'tenant' and jobs.organization_id = p_organization_id and jobs.id = p_job_id for update;
  if not found then return query select 'not_found'::text, null::integer; return; end if;
  if v_job.status <> 'leased' or v_job.lease_owner <> btrim(p_lease_owner)
     or v_job.lease_expires_at <= clock_timestamp() or v_job.checkpoint_version <> p_expected_checkpoint_version then
    return query select 'conflict'::text, v_job.checkpoint_version; return;
  end if;
  update public.vulnerability_reevaluation_jobs jobs set
    status = case when p_retryable and jobs.delivery_attempts < jobs.max_attempts then 'retrying' else 'dead_letter' end,
    due_at = case when p_retryable and jobs.delivery_attempts < jobs.max_attempts
      then clock_timestamp() + make_interval(secs => least(900, 30 * power(2, greatest(0, jobs.delivery_attempts - 1))::integer)) else jobs.due_at end,
    dead_lettered_at = case when p_retryable and jobs.delivery_attempts < jobs.max_attempts then null else clock_timestamp() end,
    lease_owner = null, lease_expires_at = null, checkpoint_version = jobs.checkpoint_version + 1,
    last_error_code = p_error_code, last_error_message = btrim(p_error_message), updated_at = clock_timestamp()
  where jobs.organization_id = p_organization_id and jobs.id = v_job.id
  returning * into v_job;
  insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'vulnerability.reevaluation_failed', 'vulnerability_reevaluation_job', v_job.id::text,
    jsonb_build_object('errorCode', p_error_code, 'retryable', p_retryable, 'status', v_job.status));
  return query select v_job.status, v_job.checkpoint_version;
end;
$$;

create or replace function public.record_vulnerability_finding_human_verdict_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_document_id uuid,
  p_finding_id uuid,
  p_verdict text,
  p_rationale text,
  p_idempotency_key uuid
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_finding public.vulnerability_findings%rowtype; v_before jsonb; v_after jsonb; v_existing jsonb; v_payload jsonb;
begin
  if p_organization_id is null or p_actor_user_id is null or p_document_id is null or p_finding_id is null or p_idempotency_key is null
     or p_verdict not in ('affected', 'not_affected')
     or char_length(btrim(coalesce(p_rationale, ''))) not between 1 and 2000
     or not public.m4_03_actor_can_edit_findings(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  -- Audit facts are the durable idempotency store. The transaction lock closes
  -- the read/insert race without adding a second command table.
  perform pg_advisory_xact_lock(hashtextextended(p_finding_id::text || ':' || p_idempotency_key::text, 0));
  select changes -> 'after' into v_existing from public.audit_logs logs
  where logs.organization_id = p_organization_id and logs.action = 'vulnerability.finding_human_verdict_recorded'
    and logs.entity_type = 'vulnerability_finding' and logs.entity_id = p_finding_id::text
    and logs.changes ->> 'idempotencyKey' = p_idempotency_key::text
  order by logs.created_at desc, logs.id desc limit 1;
  if found then
    if v_existing #>> '{assessment,verdict}' = p_verdict and v_existing #>> '{assessment,rationale}' = btrim(p_rationale) then
      return query select 'recorded'::text, v_existing;
    end if;
    return query select 'idempotency_conflict'::text, null::jsonb;
    return;
  end if;
  select * into v_finding from public.vulnerability_findings findings
  where findings.organization_id = p_organization_id and findings.id = p_finding_id
    and exists (
      select 1 from public.vulnerability_finding_component_occurrences links
      join public.vulnerability_component_occurrences occurrences on occurrences.id = links.occurrence_id
        and occurrences.organization_id = links.organization_id
      where links.finding_id = findings.id and links.organization_id = findings.organization_id
        and links.state = 'active' and occurrences.document_id = p_document_id
    ) for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;
  v_before := jsonb_strip_nulls(jsonb_build_object('humanVerdict', v_finding.human_verdict,
    'humanRationale', v_finding.human_rationale, 'humanAssessedAt', v_finding.human_assessed_at,
    'effectiveVerdict', coalesce(v_finding.human_verdict, v_finding.automatic_verdict),
    'reevaluationState', v_finding.reevaluation_state));
  update public.vulnerability_findings findings set
    human_verdict = p_verdict, human_rationale = btrim(p_rationale),
    human_assessed_by = p_actor_user_id, human_assessed_at = clock_timestamp(),
    reevaluation_state = case when findings.automatic_verdict <> p_verdict then 'review_required' else 'unchanged' end,
    proposed_state = case when findings.automatic_verdict <> p_verdict then jsonb_build_object(
      'automaticVerdict', findings.automatic_verdict, 'reason', 'human_assessment_conflict') else '{}'::jsonb end,
    updated_at = clock_timestamp()
  where findings.organization_id = p_organization_id and findings.id = p_finding_id
  returning * into v_finding;
  -- Fetch the exact, document-scoped finding. Paging the normal results RPC
  -- here could turn a successful write beyond the first 100 rows into a
  -- response parse failure after the transaction had already committed.
  select jsonb_build_object(
    'id', findings.id, 'releaseId', findings.release_id,
    'componentId', occurrences.component_id, 'componentPurl', occurrences.canonical_purl,
    'componentCpe', occurrences.canonical_cpe, 'componentVersion', occurrences.component_version,
    'advisoryId', findings.canonical_advisory_id, 'vulnerabilityId', findings.vulnerability_id,
    'sourceFeedKey', findings.source_feed_key, 'sourceRecordId', findings.source_record_id,
    'sourceRecordVersionId', findings.source_record_version_id, 'affectedRangeId', findings.affected_range_id,
    'outcome', 'affected', 'matchMethod', findings.match_method,
    'cpeSpecificity', case when findings.match_method = 'cpe_nvd' then
      coalesce(findings.affected_range ->> 'm4CpeSpecificity', 'broad_family') else null end,
    'cpeConfigurationEvidence', case when findings.match_method = 'cpe_nvd' then
      coalesce(findings.affected_range -> 'm4CpeConfigurationEvidence', '{}'::jsonb) else null end,
    'comparator', jsonb_build_object('name', findings.comparator_name, 'version', findings.comparator_version),
    'affectedRange', findings.affected_range, 'eventSequence', findings.event_sequence,
    'confidence', findings.confidence, 'confidenceTableVersion', findings.confidence_table_version,
    'confidenceExplanation', findings.confidence_explanation, 'firstDetectedAt', findings.first_detected_at,
    'lastEvaluatedAt', findings.last_evaluated_at, 'reEvaluationState', findings.reevaluation_state,
    'proposedState', findings.proposed_state, 'closedAt', findings.closed_at, 'closureReason', findings.closure_reason,
    'humanAssessment', case when findings.human_verdict is null then null else jsonb_build_object(
      'verdict', findings.human_verdict, 'rationale', findings.human_rationale,
      'assessedByUserId', findings.human_assessed_by, 'assessedAt', findings.human_assessed_at) end,
    'aliases', coalesce((select jsonb_agg(aliases.alias order by lower(aliases.alias))
      from public.vulnerability_aliases aliases where aliases.vulnerability_id = findings.vulnerability_id), '[]'::jsonb)
  ) into v_payload
  from public.vulnerability_findings findings
  join public.vulnerability_finding_component_occurrences links on links.finding_id = findings.id
    and links.organization_id = findings.organization_id and links.state = 'active'
  join public.vulnerability_component_occurrences occurrences on occurrences.id = links.occurrence_id
    and occurrences.organization_id = findings.organization_id
  where findings.organization_id = p_organization_id and findings.id = v_finding.id
    and occurrences.document_id = p_document_id
  order by occurrences.id
  limit 1;
  v_after := jsonb_build_object('finding', v_payload, 'assessment', jsonb_build_object(
    'verdict', v_finding.human_verdict, 'rationale', v_finding.human_rationale,
    'assessedByUserId', v_finding.human_assessed_by, 'assessedAt', v_finding.human_assessed_at));
  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'vulnerability.finding_human_verdict_recorded',
    'vulnerability_finding', p_finding_id::text,
    jsonb_build_object('before', v_before, 'proposed', v_finding.proposed_state, 'after', v_after,
      'idempotencyKey', p_idempotency_key));
  return query select 'recorded'::text, v_after;
end;
$$;

create or replace function public.list_vulnerability_finding_reevaluation_history(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_document_id uuid,
  p_finding_id uuid,
  p_page integer default 1,
  p_page_size integer default 50
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rows jsonb;
begin
  if p_organization_id is null or p_actor_user_id is null or p_document_id is null or p_finding_id is null
     or p_page not between 1 and 1000000 or p_page_size not between 1 and 100 or not public.sbom_actor_can_view(p_organization_id, p_actor_user_id)
     or not exists (
       select 1 from public.vulnerability_findings findings
       join public.vulnerability_finding_component_occurrences links on links.finding_id = findings.id
         and links.organization_id = findings.organization_id and links.state = 'active'
       join public.vulnerability_component_occurrences occurrences on occurrences.id = links.occurrence_id
         and occurrences.organization_id = findings.organization_id
       where findings.organization_id = p_organization_id and findings.id = p_finding_id
         and occurrences.document_id = p_document_id
     ) then return query select 'not_found'::text, null::jsonb; return; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', logs.id, 'findingId', p_finding_id,
    'transition', case when logs.action = 'vulnerability.finding_created_by_reevaluation' then 'created'
      when logs.action = 'vulnerability.finding_human_verdict_recorded'
        then coalesce(logs.changes #>> '{after,finding,reEvaluationState}', 'unchanged')
      else coalesce(logs.changes #>> '{after,reevaluationState}', case when logs.changes ->> 'transitionReason' = 'advisory_withdrawn' then 'closed' else 'unchanged' end) end,
    'occurredAt', logs.created_at, 'actorUserId', logs.user_id,
    'beforeState', logs.changes -> 'before', 'proposedState', logs.changes -> 'proposed', 'afterState', logs.changes -> 'after',
    'sourceRecordId', logs.changes ->> 'sourceRecordId',
    'sourceRecordVersionId', logs.changes ->> 'sourceRecordVersionId',
    'reason', coalesce(logs.changes ->> 'transitionReason', logs.changes ->> 'reason'))
    order by logs.created_at desc, logs.id desc), '[]'::jsonb) into v_rows
  from (
    select * from public.audit_logs logs
    where logs.organization_id = p_organization_id and logs.entity_type = 'vulnerability_finding'
      and logs.entity_id = p_finding_id::text
      and logs.action in ('vulnerability.finding_created_by_reevaluation', 'vulnerability.finding_reevaluated',
        'vulnerability.finding_human_verdict_recorded')
    order by logs.created_at desc, logs.id desc
    offset (p_page - 1) * p_page_size limit p_page_size
  ) logs;
  return query select 'found'::text, jsonb_build_object('rows', v_rows,
    'total', (select count(*) from public.audit_logs logs where logs.organization_id = p_organization_id
      and logs.entity_type = 'vulnerability_finding' and logs.entity_id = p_finding_id::text
      and logs.action in ('vulnerability.finding_created_by_reevaluation', 'vulnerability.finding_reevaluated',
        'vulnerability.finding_human_verdict_recorded')),
    'page', p_page, 'pageSize', p_page_size,
    'pageCount', greatest(1, ceil((select count(*) from public.audit_logs logs where logs.organization_id = p_organization_id
      and logs.entity_type = 'vulnerability_finding' and logs.entity_id = p_finding_id::text
      and logs.action in ('vulnerability.finding_created_by_reevaluation', 'vulnerability.finding_reevaluated',
        'vulnerability.finding_human_verdict_recorded'))::numeric / p_page_size)::integer));
end;
$$;

create or replace function public.list_vulnerability_match_results_for_document_page(
  p_organization_id uuid, p_actor_user_id uuid, p_document_id uuid,
  p_include_low_confidence boolean, p_include_reviewable boolean,
  p_page integer default 1, p_page_size integer default 50, p_q text default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total integer := 0; v_results jsonb := '[]'::jsonb;
begin
  if p_organization_id is null or p_actor_user_id is null or p_document_id is null
     or p_include_low_confidence is null or p_include_reviewable is null
     or p_page not between 1 and 1000000 or p_page_size not between 1 and 100
     or p_q is not null and char_length(btrim(p_q)) > 200
     or not public.sbom_actor_can_view(p_organization_id, p_actor_user_id)
     or not exists (select 1 from public.sbom_documents documents
       where documents.organization_id = p_organization_id and documents.id = p_document_id) then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  with latest_completed_job as (
    select jobs.id from public.vulnerability_match_jobs jobs
    where jobs.organization_id = p_organization_id and jobs.document_id = p_document_id and jobs.status = 'completed'
    order by jobs.completed_at desc nulls last, jobs.created_at desc, jobs.id desc limit 1
  ), affected as (
    select jsonb_build_object('id', findings.id, 'releaseId', findings.release_id,
      'componentId', occurrences.component_id, 'componentPurl', occurrences.canonical_purl,
      'componentCpe', occurrences.canonical_cpe, 'componentVersion', occurrences.component_version,
      'advisoryId', findings.canonical_advisory_id, 'vulnerabilityId', findings.vulnerability_id,
      'sourceFeedKey', findings.source_feed_key, 'sourceRecordId', findings.source_record_id,
      'sourceRecordVersionId', findings.source_record_version_id, 'affectedRangeId', findings.affected_range_id,
      'outcome', 'affected', 'matchMethod', findings.match_method,
      'cpeSpecificity', case when findings.match_method = 'cpe_nvd' then
        coalesce(findings.affected_range ->> 'm4CpeSpecificity', case when nullif(occurrences.cpe_version, '') is not null
          and occurrences.cpe_version not in ('*', '-') then 'version_specific' else 'broad_family' end) else null end,
      'cpeConfigurationEvidence', case when findings.match_method = 'cpe_nvd' then coalesce(
        findings.affected_range -> 'm4CpeConfigurationEvidence', jsonb_build_object(
        'configurationPath', ranges.configuration_path, 'operator', ranges.configuration_operator,
        'negated', ranges.configuration_negated, 'vulnerable', ranges.cpe_vulnerable,
        'cpe', jsonb_strip_nulls(jsonb_build_object('part', ranges.cpe_part, 'vendor', ranges.cpe_vendor,
          'product', ranges.cpe_product, 'version', ranges.cpe_version, 'versionStartIncluding', ranges.version_start_including,
          'versionStartExcluding', ranges.version_start_excluding, 'versionEndIncluding', ranges.version_end_including,
          'versionEndExcluding', ranges.version_end_excluding)))) else null end,
      'comparator', jsonb_build_object('name', findings.comparator_name, 'version', findings.comparator_version),
      'affectedRange', findings.affected_range, 'eventSequence', findings.event_sequence,
      'confidence', findings.confidence, 'confidenceTableVersion', findings.confidence_table_version,
      'confidenceExplanation', findings.confidence_explanation, 'firstDetectedAt', findings.first_detected_at,
      'lastEvaluatedAt', findings.last_evaluated_at, 'reEvaluationState', findings.reevaluation_state,
      'proposedState', findings.proposed_state, 'closedAt', findings.closed_at, 'closureReason', findings.closure_reason,
      'humanAssessment', case when findings.human_verdict is null then null else jsonb_build_object('verdict', findings.human_verdict,
        'rationale', findings.human_rationale, 'assessedByUserId', findings.human_assessed_by, 'assessedAt', findings.human_assessed_at) end,
      'aliases', coalesce((select jsonb_agg(aliases.alias order by lower(aliases.alias)) from public.vulnerability_aliases aliases
        where aliases.vulnerability_id = findings.vulnerability_id), '[]'::jsonb)) as payload,
      findings.confidence as confidence, 0 as kind, findings.id as result_id,
      concat_ws(' ', findings.canonical_advisory_id, occurrences.canonical_purl, occurrences.canonical_cpe, occurrences.component_version) as search_text
    from public.vulnerability_findings findings
    join public.vulnerability_finding_component_occurrences links on links.finding_id = findings.id
      and links.organization_id = findings.organization_id and links.state = 'active'
    join public.vulnerability_component_occurrences occurrences on occurrences.id = links.occurrence_id
      and occurrences.organization_id = findings.organization_id
    join public.vulnerability_affected_ranges ranges on ranges.id = findings.affected_range_id
    where findings.organization_id = p_organization_id and occurrences.document_id = p_document_id
      and findings.status = 'active' and (p_include_low_confidence or findings.confidence >= 0.9)
  ), reviewable as (
    select jsonb_build_object('id', evaluations.id, 'releaseId', occurrences.release_id,
      'componentId', occurrences.component_id, 'componentPurl', occurrences.canonical_purl,
      'componentCpe', occurrences.canonical_cpe, 'componentVersion', coalesce(nullif(occurrences.component_version, ''), 'unknown'),
      'outcome', 'reviewable', 'reviewCode', evaluations.review_code, 'matchMethod', evaluations.match_method,
      'comparatorName', evaluations.comparator_name, 'comparatorVersion', evaluations.comparator_version,
      'sourceFeedKey', evaluations.source_feed_key, 'sourceRecordId', evaluations.source_record_id,
      'sourceRecordVersionId', evaluations.source_record_version_id, 'affectedRangeId', evaluations.affected_range_id,
      'evaluatedAt', evaluations.evaluated_at) as payload, 0::numeric as confidence, 1 as kind, evaluations.id as result_id,
      concat_ws(' ', evaluations.review_code, occurrences.canonical_purl, occurrences.canonical_cpe, occurrences.component_version) as search_text
    from public.vulnerability_match_evaluations evaluations
    join latest_completed_job latest on latest.id = evaluations.match_job_id
    join public.vulnerability_component_occurrences occurrences on occurrences.id = evaluations.occurrence_id
      and occurrences.organization_id = evaluations.organization_id
    where evaluations.organization_id = p_organization_id and occurrences.document_id = p_document_id
      and evaluations.outcome = 'reviewable' and p_include_reviewable
  ), results as (select * from affected union all select * from reviewable), filtered as (
    select * from results where p_q is null or search_text ilike '%' || btrim(p_q) || '%'
  ), paged as (
    select * from filtered order by kind, confidence desc, result_id offset (p_page - 1) * p_page_size limit p_page_size
  )
  select (select count(*)::integer from filtered),
    coalesce((select jsonb_agg(payload order by kind, confidence desc, result_id) from paged), '[]'::jsonb)
  into v_total, v_results;
  return query select 'found'::text, jsonb_build_object('results', v_results, 'total', v_total);
end;
$$;

revoke execute on function public.upsert_vulnerability_component_occurrence_m4_04(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
revoke execute on function public.list_vulnerability_match_nvd_candidates(
  uuid, uuid, text, text, text, text
) from public, anon, authenticated;
revoke execute on function public.enqueue_vulnerability_reevaluation_for_source_version(
  uuid, uuid
) from public, anon, authenticated;
revoke execute on function public.claim_vulnerability_reevaluation_discovery_job_atomic(
  text, integer
) from public, anon, authenticated;
revoke execute on function public.fail_vulnerability_reevaluation_discovery_job_atomic(
  uuid, text, integer, text, text, boolean
) from public, anon, authenticated;
revoke execute on function public.list_vulnerability_reevaluation_candidate_organizations(
  uuid, text, uuid, integer
) from public, anon, authenticated;
revoke execute on function public.persist_vulnerability_reevaluation_discovery_page_atomic(
  uuid, text, integer, uuid[], uuid, boolean
) from public, anon, authenticated;
revoke execute on function public.list_due_vulnerability_reevaluation_organizations(
  integer
) from public, anon, authenticated;
revoke execute on function public.claim_vulnerability_reevaluation_job_atomic(
  uuid, text, integer
) from public, anon, authenticated;
revoke execute on function public.list_vulnerability_reevaluation_candidates(
  uuid, uuid, text, integer
) from public, anon, authenticated;
revoke execute on function public.persist_vulnerability_reevaluation_page_atomic(
  uuid, uuid, text, integer, jsonb, uuid, boolean
) from public, anon, authenticated;
revoke execute on function public.fail_vulnerability_reevaluation_job_atomic(
  uuid, uuid, text, integer, text, text, boolean
) from public, anon, authenticated;
revoke execute on function public.record_vulnerability_finding_human_verdict_atomic(
  uuid, uuid, uuid, uuid, text, text, uuid
) from public, anon, authenticated;
revoke execute on function public.list_vulnerability_finding_reevaluation_history(
  uuid, uuid, uuid, uuid, integer, integer
) from public, anon, authenticated;

grant execute on function public.upsert_vulnerability_component_occurrence_m4_04(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text, text, text, text
) to service_role;
grant execute on function public.list_vulnerability_match_nvd_candidates(
  uuid, uuid, text, text, text, text
) to service_role;
grant execute on function public.enqueue_vulnerability_reevaluation_for_source_version(
  uuid, uuid
) to service_role;
grant execute on function public.claim_vulnerability_reevaluation_discovery_job_atomic(
  text, integer
) to service_role;
grant execute on function public.fail_vulnerability_reevaluation_discovery_job_atomic(
  uuid, text, integer, text, text, boolean
) to service_role;
grant execute on function public.list_vulnerability_reevaluation_candidate_organizations(
  uuid, text, uuid, integer
) to service_role;
grant execute on function public.persist_vulnerability_reevaluation_discovery_page_atomic(
  uuid, text, integer, uuid[], uuid, boolean
) to service_role;
grant execute on function public.list_due_vulnerability_reevaluation_organizations(
  integer
) to service_role;
grant execute on function public.claim_vulnerability_reevaluation_job_atomic(
  uuid, text, integer
) to service_role;
grant execute on function public.list_vulnerability_reevaluation_candidates(
  uuid, uuid, text, integer
) to service_role;
grant execute on function public.persist_vulnerability_reevaluation_page_atomic(
  uuid, uuid, text, integer, jsonb, uuid, boolean
) to service_role;
grant execute on function public.fail_vulnerability_reevaluation_job_atomic(
  uuid, uuid, text, integer, text, text, boolean
) to service_role;
grant execute on function public.record_vulnerability_finding_human_verdict_atomic(
  uuid, uuid, uuid, uuid, text, text, uuid
) to service_role;
grant execute on function public.list_vulnerability_finding_reevaluation_history(
  uuid, uuid, uuid, uuid, integer, integer
) to service_role;

-- KEV remains an automatic escalation only. A retained human not-affected
-- verdict must not become a new KEV trigger merely because its advisory moved.
do $$
declare v_definition text;
begin
  select replace(
    pg_get_functiondef('public.reconcile_vulnerability_kev_alerts_for_release(uuid, uuid)'::regprocedure),
    'and findings.status = ''active''',
    'and findings.status = ''active'' and coalesce(findings.human_verdict, findings.automatic_verdict) = ''affected'''
  ) into v_definition;
  execute v_definition;
end;
$$;
drop trigger if exists reconcile_kev_alert_after_finding_change on public.vulnerability_findings;
create trigger reconcile_kev_alert_after_finding_change
  after insert or delete or update of release_id, vulnerability_id, status, automatic_verdict, human_verdict
  on public.vulnerability_findings
  for each row execute function public.m4_03_reconcile_kev_alert_after_finding_change();

alter function public.populate_vulnerability_affected_range_matching_keys() owner to postgres;
alter function public.upsert_vulnerability_component_occurrence_m4_04(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text) owner to postgres;
alter function public.enqueue_vulnerability_match_job_atomic(uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function public.list_vulnerability_match_components(uuid,uuid,text,integer) owner to postgres;
alter function public.list_vulnerability_match_nvd_candidates(uuid,uuid,text,text,text,text) owner to postgres;
alter function public.persist_vulnerability_match_page_atomic(uuid,uuid,text,integer,jsonb,jsonb,boolean) owner to postgres;
alter function public.m4_04_source_version_matching_fingerprint() owner to postgres;
alter function public.enqueue_vulnerability_reevaluation_for_source_version(uuid,uuid) owner to postgres;
alter function public.m4_04_enqueue_reevaluation_after_source_change() owner to postgres;
alter function public.claim_vulnerability_reevaluation_discovery_job_atomic(text,integer) owner to postgres;
alter function public.fail_vulnerability_reevaluation_discovery_job_atomic(uuid,text,integer,text,text,boolean) owner to postgres;
alter function public.list_vulnerability_reevaluation_candidate_organizations(uuid,text,uuid,integer) owner to postgres;
alter function public.persist_vulnerability_reevaluation_discovery_page_atomic(uuid,text,integer,uuid[],uuid,boolean) owner to postgres;
alter function public.list_due_vulnerability_reevaluation_organizations(integer) owner to postgres;
alter function public.claim_vulnerability_reevaluation_job_atomic(uuid,text,integer) owner to postgres;
alter function public.list_vulnerability_reevaluation_candidates(uuid,uuid,text,integer) owner to postgres;
alter function public.persist_vulnerability_reevaluation_page_atomic(uuid,uuid,text,integer,jsonb,uuid,boolean) owner to postgres;
alter function public.fail_vulnerability_reevaluation_job_atomic(uuid,uuid,text,integer,text,text,boolean) owner to postgres;
alter function public.record_vulnerability_finding_human_verdict_atomic(uuid,uuid,uuid,uuid,text,text,uuid) owner to postgres;
alter function public.list_vulnerability_finding_reevaluation_history(uuid,uuid,uuid,uuid,integer,integer) owner to postgres;
alter function public.list_vulnerability_match_results_for_document_page(uuid,uuid,uuid,boolean,boolean,integer,integer,text) owner to postgres;

revoke all on function
  public.populate_vulnerability_affected_range_matching_keys(),
  public.upsert_vulnerability_component_occurrence_m4_04(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text),
  public.enqueue_vulnerability_match_job_atomic(uuid,uuid,uuid,uuid,uuid),
  public.list_vulnerability_match_components(uuid,uuid,text,integer),
  public.list_vulnerability_match_nvd_candidates(uuid,uuid,text,text,text,text),
  public.persist_vulnerability_match_page_atomic(uuid,uuid,text,integer,jsonb,jsonb,boolean),
  public.m4_04_source_version_matching_fingerprint(),
  public.enqueue_vulnerability_reevaluation_for_source_version(uuid,uuid),
  public.m4_04_enqueue_reevaluation_after_source_change(),
  public.claim_vulnerability_reevaluation_discovery_job_atomic(text,integer),
  public.fail_vulnerability_reevaluation_discovery_job_atomic(uuid,text,integer,text,text,boolean),
  public.list_vulnerability_reevaluation_candidate_organizations(uuid,text,uuid,integer),
  public.persist_vulnerability_reevaluation_discovery_page_atomic(uuid,text,integer,uuid[],uuid,boolean),
  public.list_due_vulnerability_reevaluation_organizations(integer),
  public.claim_vulnerability_reevaluation_job_atomic(uuid,text,integer),
  public.list_vulnerability_reevaluation_candidates(uuid,uuid,text,integer),
  public.persist_vulnerability_reevaluation_page_atomic(uuid,uuid,text,integer,jsonb,uuid,boolean),
  public.fail_vulnerability_reevaluation_job_atomic(uuid,uuid,text,integer,text,text,boolean),
  public.record_vulnerability_finding_human_verdict_atomic(uuid,uuid,uuid,uuid,text,text,uuid),
  public.list_vulnerability_finding_reevaluation_history(uuid,uuid,uuid,uuid,integer,integer),
  public.list_vulnerability_match_results_for_document_page(uuid,uuid,uuid,boolean,boolean,integer,integer,text)
from public, anon, authenticated;
grant execute on function
  public.upsert_vulnerability_component_occurrence_m4_04(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text),
  public.enqueue_vulnerability_match_job_atomic(uuid,uuid,uuid,uuid,uuid),
  public.list_vulnerability_match_components(uuid,uuid,text,integer),
  public.list_vulnerability_match_nvd_candidates(uuid,uuid,text,text,text,text),
  public.persist_vulnerability_match_page_atomic(uuid,uuid,text,integer,jsonb,jsonb,boolean),
  public.enqueue_vulnerability_reevaluation_for_source_version(uuid,uuid),
  public.claim_vulnerability_reevaluation_discovery_job_atomic(text,integer),
  public.fail_vulnerability_reevaluation_discovery_job_atomic(uuid,text,integer,text,text,boolean),
  public.list_vulnerability_reevaluation_candidate_organizations(uuid,text,uuid,integer),
  public.persist_vulnerability_reevaluation_discovery_page_atomic(uuid,text,integer,uuid[],uuid,boolean),
  public.list_due_vulnerability_reevaluation_organizations(integer),
  public.claim_vulnerability_reevaluation_job_atomic(uuid,text,integer),
  public.list_vulnerability_reevaluation_candidates(uuid,uuid,text,integer),
  public.persist_vulnerability_reevaluation_page_atomic(uuid,uuid,text,integer,jsonb,uuid,boolean),
  public.fail_vulnerability_reevaluation_job_atomic(uuid,uuid,text,integer,text,text,boolean),
  public.record_vulnerability_finding_human_verdict_atomic(uuid,uuid,uuid,uuid,text,text,uuid),
  public.list_vulnerability_finding_reevaluation_history(uuid,uuid,uuid,uuid,integer,integer),
  public.list_vulnerability_match_results_for_document_page(uuid,uuid,uuid,boolean,boolean,integer,integer,text)
to service_role;
