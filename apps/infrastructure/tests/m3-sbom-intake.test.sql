-- M3 SBOM intake foundation integration tests. Every fixture rolls back.
\set ON_ERROR_STOP on
\timing off

create or replace function pg_temp.check(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then
    raise notice 'ok   %', p_label;
  else
    raise exception 'FAIL %', p_label;
  end if;
end;
$$;

select pg_temp.check(
  'M3 creates exactly the four durable SBOM tables and one private evidence bucket',
  (select not public and file_size_limit = 104857600 from storage.buckets where id = 'sbom-originals')
  and to_regclass('public.sbom_raw_objects') is not null
  and to_regclass('public.sbom_sources') is not null
  and to_regclass('public.sbom_ingest_jobs') is not null
  and to_regclass('public.sbom_ci_credentials') is not null
  and (select count(*) = 4 from pg_class tables
    join pg_namespace namespaces on namespaces.oid = tables.relnamespace
    where namespaces.nspname = 'public' and tables.relkind = 'r'
      and tables.relname like 'sbom_%')
);

select pg_temp.check(
  'SBOM tables are RLS protected and private to service role',
  not exists (
    select 1 from (values
      ('sbom_raw_objects'), ('sbom_sources'), ('sbom_ingest_jobs'), ('sbom_ci_credentials')
    ) expected(table_name)
    join pg_class tables on tables.relname = expected.table_name
    join pg_namespace namespaces on namespaces.oid = tables.relnamespace
    where namespaces.nspname = 'public' and (
      not tables.relrowsecurity or tables.relforcerowsecurity
      or has_table_privilege('public', tables.oid, 'select')
      or has_table_privilege('anon', tables.oid, 'select')
      or has_table_privilege('authenticated', tables.oid, 'select')
    )
  )
  and has_table_privilege('service_role', 'public.sbom_sources', 'select')
  and has_table_privilege('service_role', 'public.sbom_ingest_jobs', 'update')
);

select pg_temp.check(
  'browser roles cannot call security-definer SBOM coordination RPCs',
  not has_function_privilege('authenticated',
    'public.reserve_sbom_source_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,text,text,text,bigint,text,text,timestamptz,uuid)',
    'execute')
  and not has_function_privilege('authenticated',
    'public.finalize_sbom_source_atomic(uuid,uuid,uuid,uuid,text,bigint,text,uuid,uuid)', 'execute')
  and has_function_privilege('service_role',
    'public.claim_sbom_ingest_job(uuid,text,integer)', 'execute')
  and not has_function_privilege('authenticated',
    'public.get_sbom_source_for_completion(uuid,uuid,uuid,uuid,uuid)', 'execute')
);

select pg_temp.check(
  'SBOM evidence media types and CI token identifiers align with the shared contracts',
  (select array_position(allowed_mime_types, 'application/spdx+xml') is not null
    from storage.buckets where id = 'sbom-originals')
  and exists (select 1 from pg_constraint where conrelid = 'public.sbom_ci_credentials'::regclass
    and conname = 'sbom_ci_credentials_token_prefix_check'
    and pg_get_constraintdef(oid) like '%cra_sbom_%')
);

begin;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_product uuid;
  v_release uuid;
  v_source uuid := gen_random_uuid();
  v_key uuid := gen_random_uuid();
  v_hash text := repeat('a', 64);
  v_reservation record;
  v_completion record;
  v_replay record;
  v_completion_source record;
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select p.id, r.id into v_product, v_release
    from public.products p join public.product_releases r
      on r.organization_id = p.organization_id and r.product_id = p.id
   where p.organization_id = v_org
   order by r.created_at
   limit 1;
  if v_release is null then
    raise exception 'seeded org needs a release for SBOM tests';
  end if;

  select * into v_reservation from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_source, 'manual_upload', v_key,
    encode(extensions.digest('reserve-1', 'sha256'), 'hex'), 'bom.json', 'application/json',
    15, v_hash, v_org::text || '/' || v_source::text || '/' || v_hash,
    now() + interval '10 minutes', gen_random_uuid()
  );
  if v_reservation.outcome <> 'created' or (v_reservation.source ->> 'id')::uuid <> v_source then
    raise exception 'valid SBOM reservation failed: %', v_reservation.outcome;
  end if;
  if not exists (select 1 from public.audit_logs where organization_id = v_org
    and action = 'sbom.upload_initiated' and entity_id = v_source::text) then
    raise exception 'reservation audit fact was not transactionally persisted';
  end if;
  select * into v_completion_source from public.get_sbom_source_for_completion(
    v_org, v_source, v_actor, null, v_key
  );
  if v_completion_source.outcome <> 'ready'
    or v_completion_source.storage_bucket <> 'sbom-originals'
    or v_completion_source.storage_key <> v_org::text || '/' || v_source::text || '/' || v_hash then
    raise exception 'completion lookup did not return only the actor-bound pending source';
  end if;

  select * into v_replay from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_source, 'manual_upload', v_key,
    encode(extensions.digest('reserve-1', 'sha256'), 'hex'), 'bom.json', 'application/json',
    15, v_hash, v_org::text || '/' || v_source::text || '/' || v_hash,
    now() + interval '10 minutes', gen_random_uuid()
  );
  if v_replay.outcome <> 'replayed' or (v_replay.source ->> 'id')::uuid <> v_source then
    raise exception 'same idempotency request did not replay reservation';
  end if;

  select * into v_completion from public.finalize_sbom_source_atomic(
    v_org, v_source, v_actor, null, v_hash, 15, 'application/json', v_key, gen_random_uuid()
  );
  if v_completion.outcome <> 'queued'
     or v_completion.job is null
     or (v_completion.job ->> 'status') <> 'queued' then
    raise exception 'verified completion did not create a queued durable job: %', v_completion.outcome;
  end if;
  if (select count(*) from public.sbom_raw_objects where organization_id = v_org and sha256 = v_hash) <> 1
     or (select count(*) from public.sbom_ingest_jobs where organization_id = v_org and source_id = v_source) <> 1 then
    raise exception 'completion did not link immutable evidence and exactly one job';
  end if;
  if not ((v_completion.source ?& array[
      'id', 'organizationId', 'productId', 'releaseId', 'source', 'fileName', 'mediaType',
      'byteSize', 'sha256', 'status', 'createdAt', 'completedAt'
    ]) and not (v_completion.source ? 'stagingStorageKey'))
    or not ((v_completion.job ?& array[
      'id', 'organizationId', 'sourceId', 'releaseId', 'inputSha256', 'correlationId',
      'status', 'progress', 'attempts', 'maxAttempts', 'error', 'result', 'createdAt', 'updatedAt', 'completedAt'
    ]) and v_completion.job->'progress' ? 'message') then
    raise exception 'database JSON crossed a private or incompatible contract boundary';
  end if;

  select * into v_replay from public.finalize_sbom_source_atomic(
    v_org, v_source, v_actor, null, v_hash, 15, 'application/json', v_key, gen_random_uuid()
  );
  if v_replay.outcome <> 'replayed' or (v_replay.job ->> 'id') <> (v_completion.job ->> 'id') then
    raise exception 'duplicate completion created or returned a different job';
  end if;
  begin
    update public.sbom_raw_objects set storage_key = 'tampered'
      where organization_id = v_org and sha256 = v_hash;
    raise exception 'immutable raw object update unexpectedly succeeded';
  exception when object_not_in_prerequisite_state then
    null;
  end;
end $$;
rollback;

begin;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid; v_product uuid; v_release uuid; v_source uuid := gen_random_uuid();
  v_job record; v_replay record; v_audit_count integer;
  v_key uuid := gen_random_uuid(); v_hash text := repeat('c', 64);
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select p.id, r.id into v_product, v_release from public.products p join public.product_releases r
    on r.organization_id = p.organization_id and r.product_id = p.id
    where p.organization_id = v_org order by r.created_at limit 1;
  perform * from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_source, 'manual_upload', gen_random_uuid(),
    encode(extensions.digest('replay-keyed', 'sha256'), 'hex'), 'replay.json', 'application/json', 10,
    v_hash, v_org::text || '/' || v_source::text || '/' || v_hash, now() + interval '10 minutes', gen_random_uuid()
  );
  select * into v_job from public.finalize_sbom_source_atomic(
    v_org, v_source, v_actor, null, v_hash, 10, 'application/json', gen_random_uuid()
  );
  update public.sbom_ingest_jobs set status = 'dead_letter', progress_stage = 'dead_letter',
    error_code = 'unknown_failure', dead_lettered_at = now()
    where organization_id = v_org and id = (v_job.job ->> 'id')::uuid;
  select count(*) into v_audit_count from public.audit_logs where organization_id = v_org
    and action = 'sbom.job_replayed' and entity_id = v_job.job ->> 'id';
  select * into v_replay from public.replay_sbom_ingest_job_atomic(
    v_org, v_actor, (v_job.job ->> 'id')::uuid, v_key, gen_random_uuid()
  );
  if v_replay.outcome <> 'queued' then raise exception 'dead-letter replay failed: %', v_replay.outcome; end if;
  select * into v_replay from public.replay_sbom_ingest_job_atomic(
    v_org, v_actor, (v_job.job ->> 'id')::uuid, v_key, gen_random_uuid()
  );
  if v_replay.outcome <> 'replayed'
    or (select count(*) from public.audit_logs where organization_id = v_org
      and action = 'sbom.job_replayed' and entity_id = v_job.job ->> 'id') <> v_audit_count + 1 then
    raise exception 'same replay idempotency key did not return exactly one durable replay';
  end if;
end $$;
rollback;

begin;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_product uuid;
  v_release uuid;
  v_source uuid := gen_random_uuid();
  v_foreign_org uuid := gen_random_uuid();
  v_foreign_source uuid := gen_random_uuid();
  v_result record;
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select p.id, r.id into v_product, v_release from public.products p join public.product_releases r
    on r.organization_id = p.organization_id and r.product_id = p.id
    where p.organization_id = v_org order by r.created_at limit 1;
  select * into v_result from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_source, 'manual_upload', gen_random_uuid(),
    encode(extensions.digest('zero', 'sha256'), 'hex'), 'empty.json', 'application/json', 0,
    repeat('0', 64), v_org::text || '/' || v_source::text || '/' || repeat('0', 64),
    now() + interval '10 minutes', gen_random_uuid()
  );
  if v_result.outcome <> 'invalid_request'
     or exists(select 1 from public.sbom_sources where organization_id = v_org and id = v_source) then
    raise exception 'zero byte input was not rejected before source creation';
  end if;

  select * into v_result from public.reserve_sbom_source_atomic(
    v_foreign_org, v_product, v_release, v_actor, null, v_foreign_source, 'manual_upload', gen_random_uuid(),
    encode(extensions.digest('foreign', 'sha256'), 'hex'), 'bom.json', 'application/json', 1,
    repeat('1', 64), v_foreign_org::text || '/' || v_foreign_source::text || '/' || repeat('1', 64),
    now() + interval '10 minutes', gen_random_uuid()
  );
  if v_result.outcome <> 'not_found' then
    raise exception 'cross-tenant release identifier was disclosed';
  end if;
end $$;
rollback;

begin;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_product uuid;
  v_release uuid;
  v_source uuid := gen_random_uuid();
  v_key uuid := gen_random_uuid();
  v_job record;
  v_claim record;
  v_failed record;
  v_replayed record;
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select p.id, r.id into v_product, v_release from public.products p join public.product_releases r
    on r.organization_id = p.organization_id and r.product_id = p.id
    where p.organization_id = v_org order by r.created_at limit 1;
  perform * from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_source, 'manual_upload', v_key,
    encode(extensions.digest('worker', 'sha256'), 'hex'), 'worker.json', 'application/json', 10,
    repeat('b', 64), v_org::text || '/' || v_source::text || '/' || repeat('b', 64),
    now() + interval '10 minutes', gen_random_uuid()
  );
  select * into v_job from public.finalize_sbom_source_atomic(
    v_org, v_source, v_actor, null, repeat('b', 64), 10, 'application/json', v_key, gen_random_uuid()
  );
  select * into v_claim from public.claim_sbom_ingest_job(v_org, 'sql-worker', 60);
  if v_claim.outcome <> 'claimed' or (v_claim.job ->> 'status') <> 'processing' then
    raise exception 'queued job was not atomically claimed';
  end if;
  select * into v_failed from public.fail_sbom_ingest_job(
    v_org, (v_job.job ->> 'id')::uuid, 'sql-worker', 'provider_unavailable'
  );
  if v_failed.outcome <> 'retrying' or (v_failed.job ->> 'status') <> 'failed' then
    raise exception 'failure was not durably recorded for bounded retry';
  end if;
  update public.sbom_ingest_jobs set next_attempt_at = now() - interval '1 second'
    where organization_id = v_org and id = (v_job.job ->> 'id')::uuid;
  select * into v_claim from public.claim_sbom_ingest_job(v_org, 'sql-worker-2', 60);
  perform * from public.complete_sbom_ingest_job(
    v_org, (v_job.job ->> 'id')::uuid, 'sql-worker-2'
  );
  select * into v_replayed from public.replay_sbom_ingest_job_atomic(
    v_org, v_actor, (v_job.job ->> 'id')::uuid, gen_random_uuid()
  );
  if v_replayed.outcome <> 'invalid_state' then
    raise exception 'completed job accepted an unsafe operator replay';
  end if;
end $$;
rollback;
