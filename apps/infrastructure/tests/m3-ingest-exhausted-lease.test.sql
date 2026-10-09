-- Real scoped lease-recovery fixture; all writes roll back.
begin;
create function pg_temp.fail_terminal_recovery_audit() returns trigger language plpgsql as $$
begin raise exception 'M3 injected recovery audit failure'; end $$;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_product uuid;
  v_release uuid;
  v_hash text := repeat('d', 64);
  v_source_one uuid := gen_random_uuid();
  v_source_two uuid := gen_random_uuid();
  v_key_one uuid := gen_random_uuid();
  v_key_two uuid := gen_random_uuid();
  v_report jsonb;
  v_job_one record;
  v_job_two record;
  v_claim record;
  v_begin record;
  v_persist record;
  v_finalize record;
  v_audit_count integer;
  v_before jsonb;
  v_document uuid;
  v_component uuid;
  v_staging_document uuid := gen_random_uuid();
  v_staging_component uuid := gen_random_uuid();
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  select p.id, r.id into v_product, v_release from public.products p join public.product_releases r
    on r.organization_id = p.organization_id and r.product_id = p.id
    where p.organization_id = v_org order by r.created_at limit 1;
  v_report := jsonb_build_object(
    'status', 'valid',
    'detected', jsonb_build_object('format', 'cyclonedx', 'serialization', 'json', 'specificationVersion', '1.6'),
    'validator', jsonb_build_object('name', 'CRA streaming SBOM normalizer', 'version', 'm3-test', 'schemaAssetSha256', repeat('a', 64)),
    'diagnostics', '[]'::jsonb,
    'errorCount', 0,
    'warningCount', 0,
    'omittedDiagnosticCount', 0,
    'completedAt', '2026-08-24T00:00:00.000Z'
  );

  perform * from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_source_one, 'manual_upload', v_key_one,
    encode(extensions.digest('normalizer-replay-one', 'sha256'), 'hex'), 'normalizer-replay-one.json', 'application/json', 42,
    v_hash, v_org::text || '/' || v_source_one::text || '/' || v_hash,
    now() + interval '10 minutes', gen_random_uuid()
  );
  select * into v_job_one from public.finalize_sbom_source_atomic(
    v_org, v_source_one, v_actor, null, v_hash, 42, 'application/json', v_key_one, gen_random_uuid()
  );
  update public.sbom_ingest_jobs
     set next_attempt_at = now() + interval '1 day'
   where organization_id = v_org
     and source_id <> v_source_one
     and status in ('queued', 'failed');
  select * into v_claim from public.claim_sbom_ingest_job(v_org, 'normalizer-replay-worker-one', 60);
  if v_claim.outcome <> 'claimed' or (v_claim.work ->> 'sourceId')::uuid <> v_source_one then
    raise exception 'first immutable-hash job was not claimable';
  end if;
  select * into v_begin from public.begin_sbom_document_normalization_atomic(
    v_org, (v_job_one.job ->> 'id')::uuid, 'normalizer-replay-worker-one',
    'CRA streaming SBOM parser', 'm3-test', 'CRA SBOM normalizer', 'm3-03.1',
    'cyclonedx', 'json', '1.6', v_report
  );
  if v_begin.outcome <> 'created' then
    raise exception 'first immutable-hash document was not created: %', v_begin.outcome;
  end if;
  update public.sbom_ingest_jobs set attempt_count=max_attempts,lease_expires_at=now()-interval '1 second'
    where organization_id=v_org and id=(v_job_one.job->>'id')::uuid;
  if not exists(select 1 from public.list_due_sbom_ingest_organizations(500) where organization_id=v_org) then
    raise exception 'Expired final-attempt organization is undiscoverable';
  end if;
  set local role service_role;
  perform * from public.claim_sbom_ingest_job(v_org,'restart-after-final-crash',60);
  if not exists(select 1 from public.sbom_ingest_jobs where organization_id=v_org
    and id=(v_job_one.job->>'id')::uuid and status='dead_letter' and progress_stage='dead_letter'
    and dead_lettered_at is not null and lease_owner is null and lease_expires_at is null) then
    raise exception 'Expired final-attempt worker lease remains stranded';
  end if;
  if not exists(select 1 from public.audit_logs where organization_id=v_org
    and entity_id=(v_job_one.job->>'id') and action='sbom.job_failed'
    and changes->>'terminal'='true' and changes->>'code'='retry_budget_exhausted') then
    raise exception 'Terminal worker recovery was not durably audited';
  end if;
  select count(*) into v_audit_count from public.audit_logs where organization_id=v_org and entity_id=v_job_one.job->>'id' and action='sbom.job_failed';
  perform * from public.claim_sbom_ingest_job(v_org,'repeated-terminal-recovery',60);
  if (select count(*) from public.audit_logs where organization_id=v_org and entity_id=v_job_one.job->>'id' and action='sbom.job_failed')<>v_audit_count then
    raise exception 'Repeated terminal recovery duplicated audit';
  end if;
  reset role;
  -- A live lease remains owned; under-budget expiry remains retryable.
  update public.sbom_ingest_jobs set status='processing',progress_stage='batching',attempt_count=1,
    dead_lettered_at=null,error_code=null,lease_owner='active-worker',lease_expires_at=now()+interval '1 minute'
    where organization_id=v_org and id=(v_job_one.job->>'id')::uuid;
  perform * from public.claim_sbom_ingest_job(v_org,'must-not-steal-live-lease',60);
  if not exists(select 1 from public.sbom_ingest_jobs where id=(v_job_one.job->>'id')::uuid
    and status='processing' and lease_owner='active-worker' and attempt_count=1) then
    raise exception 'Recovery stole a live worker lease';
  end if;
  update public.sbom_ingest_jobs set lease_expires_at=now()-interval '1 second'
    where organization_id=v_org and id=(v_job_one.job->>'id')::uuid;
  perform * from public.claim_sbom_ingest_job(v_org,'under-budget-restart',60);
  if not exists(select 1 from public.sbom_ingest_jobs where id=(v_job_one.job->>'id')::uuid
    and status='processing' and lease_owner='under-budget-restart' and attempt_count=2 and dead_lettered_at is null) then
    raise exception 'Under-budget expired lease was not reclaimed';
  end if;
  -- Security-critical audit failure rolls the terminal state change back.
  update public.sbom_ingest_jobs set attempt_count=max_attempts,lease_expires_at=now()-interval '1 second'
    where organization_id=v_org and id=(v_job_one.job->>'id')::uuid;
  select to_jsonb(j) into v_before from public.sbom_ingest_jobs j where id=(v_job_one.job->>'id')::uuid;
  execute format('create trigger m3_terminal_recovery_audit_failure before insert on public.audit_logs for each row when(new.organization_id=%L::uuid and new.action=%L and new.changes->>%L=%L) execute function pg_temp.fail_terminal_recovery_audit()',v_org,'sbom.job_failed','terminal','true');
  begin
    perform * from public.claim_sbom_ingest_job(v_org,'must-rollback-on-audit-failure',60);
    raise exception 'Recovery unexpectedly succeeded despite audit failure';
  exception when others then
    if sqlerrm<>'M3 injected recovery audit failure' then raise; end if;
  end;
  if (select to_jsonb(j) from public.sbom_ingest_jobs j where id=(v_job_one.job->>'id')::uuid)<>v_before then
    raise exception 'Terminal state survived failed audit transaction';
  end if;
  drop trigger m3_terminal_recovery_audit_failure on public.audit_logs;
  -- Backlog created by the old claim command is discoverable and repaired once.
  update public.sbom_ingest_jobs set status='failed',progress_stage='failed',lease_owner=null,lease_expires_at=null,
    error_code='unknown_failure',next_attempt_at=now()-interval '1 second' where organization_id=v_org and id=(v_job_one.job->>'id')::uuid;
  if not exists(select 1 from public.list_due_sbom_ingest_organizations(500) where organization_id=v_org) then
    raise exception 'Previously stranded exhausted failure is undiscoverable';
  end if;
  set local role service_role;
  perform * from public.claim_sbom_ingest_job(v_org,'rescue-old-exhausted-failure',60);
  if not exists(select 1 from public.sbom_ingest_jobs where id=(v_job_one.job->>'id')::uuid
    and status='dead_letter' and dead_lettered_at is not null) then
    raise exception 'Previously stranded exhausted failure was not repaired';
  end if;
end $$;
rollback;
