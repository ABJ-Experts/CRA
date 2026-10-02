begin;
create extension if not exists pgtap;
select plan(47);

select ok(to_regclass('public.technical_file_snapshots') is not null, 'snapshot table exists');
select ok(to_regclass('public.technical_file_snapshot_exports') is not null, 'export job table exists');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.technical_file_snapshots'::regclass), 'snapshots have enabled non-forced RLS');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.technical_file_snapshot_exports'::regclass), 'export jobs have enabled non-forced RLS');
select ok(has_table_privilege('service_role','public.technical_file_snapshots','select,insert,update,delete'), 'service role can manage snapshots');
select ok(has_table_privilege('service_role','public.technical_file_snapshot_exports','select,insert,update,delete'), 'service role can manage export jobs');
select ok(not has_table_privilege('authenticated','public.technical_file_snapshots','select'), 'authenticated cannot read snapshots directly');
select ok(not has_table_privilege('authenticated','public.technical_file_snapshot_exports','select'), 'authenticated cannot read export jobs directly');

select ok((select count(*)>=1 from pg_constraint where conrelid='public.technical_file_snapshots'::regclass and contype='c' and pg_get_constraintdef(oid) like '%release%audit%'), 'snapshot purpose is constrained');
select ok((select count(*)=1 from pg_constraint where conrelid='public.technical_file_snapshot_exports'::regclass and contype='c' and pg_get_constraintdef(oid) like '%status%queued%generating%ready%'), 'export status is constrained');
select ok((select count(*)>=1 from pg_constraint where conrelid='public.technical_file_snapshot_exports'::regclass and contype='c' and pg_get_constraintdef(oid) like '%pdf_object_path IS NOT NULL%'), 'ready export requires all artifact metadata');
select ok((select count(*)>=1 from pg_constraint where conrelid='public.technical_file_snapshot_exports'::regclass and contype='c' and pg_get_constraintdef(oid) like '%lease_owner IS NOT NULL%'), 'generating export requires a lease');
select ok((select count(*)=1 from pg_indexes where schemaname='public' and indexname='technical_file_snapshots_product_idx'), 'snapshot product index exists');
select ok((select count(*)=1 from pg_indexes where schemaname='public' and indexname='technical_file_snapshot_exports_work_idx'), 'queued work index exists');
select ok((select not public from storage.buckets where id='technical-file-snapshot-exports'), 'snapshot export bucket is private');
select is((select file_size_limit from storage.buckets where id='technical-file-snapshot-exports')::bigint, 26214400::bigint, 'snapshot export bucket enforces the 25MB ceiling');

select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid)'::regprocedure), 'snapshot creator is a pinned security-definer RPC');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.create_technical_file_snapshot_export_atomic(uuid,uuid,uuid,uuid,uuid)'::regprocedure), 'export creator is a pinned security-definer RPC');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.claim_technical_file_snapshot_export(uuid,integer)'::regprocedure), 'worker claim RPC is a pinned security-definer RPC');
select ok(has_function_privilege('service_role','public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid)','execute'), 'service role can create snapshots');
select ok(not has_function_privilege('authenticated','public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid)','execute'), 'authenticated cannot create snapshots directly');
select ok(position('for update' in lower(pg_get_functiondef('public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid)'::regprocedure))) > 0, 'snapshot creator locks the technical-file revision');
select ok(position('technical_file.snapshot_created' in pg_get_functiondef('public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid)'::regprocedure)) > 0, 'snapshot creation audits inside the RPC');
select ok(position('idempotencyKey' in pg_get_functiondef('public.create_technical_file_snapshot_export_atomic(uuid,uuid,uuid,uuid,uuid)'::regprocedure)) > 0, 'export creation stores an idempotency key');
select ok(position('technical_file.snapshot_export_downloaded' in pg_get_functiondef('public.record_technical_file_snapshot_export_download_atomic(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure)) > 0, 'download authorization records after the signed URL is issued');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.get_technical_file_snapshot_export(uuid,uuid,uuid,uuid,uuid)'::regprocedure), 'export detail is a pinned security-definer RPC');
select ok(position('objectPath' in pg_get_functiondef('public.m7_snapshot_export_json(uuid,uuid)'::regprocedure)) = 0, 'public export JSON never exposes private object paths');
select ok(position('''m7_04_v1''' in pg_get_functiondef('public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid)'::regprocedure)) > 0, 'snapshot payload uses the contract schema version');
select ok(position('payload_byte_length' in pg_get_functiondef('public.m7_snapshot_json(uuid,uuid)'::regprocedure)) > 0, 'snapshot JSON includes the bounded payload length');
select ok(position('technical_file.snapshot_export_failed' in pg_get_functiondef('public.fail_technical_file_snapshot_export_atomic(uuid,uuid,uuid,text)'::regprocedure)) > 0, 'worker failure is audited durably');
select ok((select count(*)=1 from pg_constraint where conrelid='public.technical_file_snapshot_exports'::regclass and conname='technical_file_snapshot_exports_failure_code_check' and pg_get_constraintdef(oid) like '%snapshot_unavailable%' and pg_get_constraintdef(oid) like '%artifact_too_large%' and pg_get_constraintdef(oid) like '%storage_unavailable%' and pg_get_constraintdef(oid) like '%source_unavailable%' and pg_get_constraintdef(oid) like '%worker_unavailable%' and pg_get_constraintdef(oid) like '%unknown%'), 'export failure codes match the worker and contract terminal states');
select ok((select tgname='technical_file_snapshot_immutable' from pg_trigger where tgrelid='public.technical_file_snapshots'::regclass and not tgisinternal), 'snapshot immutability trigger exists');
select ok(position('payload is immutable' in pg_get_functiondef('public.m7_reject_technical_file_snapshot_mutation()'::regprocedure)) > 0, 'snapshot trigger rejects payload mutation');
select ok(position('successor.technical_file_id <> old.technical_file_id' in pg_get_functiondef('public.m7_reject_technical_file_snapshot_mutation()'::regprocedure)) > 0, 'snapshot supersession requires the same technical file');
select ok(position('successor.product_id <> old.product_id' in pg_get_functiondef('public.m7_reject_technical_file_snapshot_mutation()'::regprocedure)) > 0 and position('successor.created_at <= old.created_at' in pg_get_functiondef('public.m7_reject_technical_file_snapshot_mutation()'::regprocedure)) > 0, 'snapshot supersession is product-bound and one-way to a later snapshot');
select ok(position('overallStatus' in pg_get_functiondef('public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid)'::regprocedure)) > 0, 'snapshot readiness uses the readiness contract status key');
select ok(position('commandDigest' in pg_get_functiondef('public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid)'::regprocedure)) > 0, 'snapshot creation persists and compares an idempotency command digest');
select ok(position('lock table public.technical_file_sections' in lower(pg_get_functiondef('public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid)'::regprocedure))) = 0, 'snapshot creation does not take global cross-tenant table locks');
select ok(position('lease_expires_at<=clock_timestamp()' in replace(pg_get_functiondef('public.claim_technical_file_snapshot_export(uuid,integer)'::regprocedure),' ','')) > 0, 'expired export leases can be reclaimed');
select is(public.m7_snapshot_timestamp_utc('2026-09-14 13:00:00+00'::timestamptz), '2026-09-14T13:00:00.000Z', 'snapshot timestamps are RFC3339 without literal quote characters');
select ok(position('m7_snapshot_timestamp_utc(clock_timestamp())' in pg_get_functiondef('public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid)'::regprocedure)) > 0, 'snapshot payload uses the RFC3339 timestamp formatter');
select is((select outcome from public.create_technical_file_snapshot_atomic(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,'audit',null,'auditor requested this state',gen_random_uuid())), 'forbidden', 'unverified tenant actor cannot create a snapshot');

create temporary table m7_snapshot_failure_fixture as
select
  s.organization_id,
  s.id as snapshot_id,
  gen_random_uuid() as export_id,
  gen_random_uuid() as worker_id
from public.technical_file_snapshots s
limit 1;

insert into public.technical_file_snapshot_exports(
  id,organization_id,snapshot_id,requested_by,idempotency_key,payload_digest,
  status,lease_owner,lease_expires_at
)
select
  fixture.export_id,fixture.organization_id,fixture.snapshot_id,
  (select id from public.users limit 1),gen_random_uuid(),repeat('a',64),
  'generating',fixture.worker_id,clock_timestamp() + interval '5 minutes'
from m7_snapshot_failure_fixture fixture;

select is(
  (
    select failed.outcome
    from m7_snapshot_failure_fixture fixture
    cross join lateral public.fail_technical_file_snapshot_export_atomic(
      fixture.organization_id,fixture.export_id,fixture.worker_id,'artifact_too_large'
    ) failed
  ),
  'failed',
  'worker failure code accepted by the RPC reaches a durable failed terminal state'
);
select is(
  (
    select failure_code
    from public.technical_file_snapshot_exports export
    join m7_snapshot_failure_fixture fixture on fixture.export_id=export.id
  ),
  'artifact_too_large',
  'terminal failed export stores the contract failure code'
);
select throws_ok(
  $$insert into public.technical_file_snapshot_exports(
      organization_id,snapshot_id,requested_by,idempotency_key,payload_digest,status,failure_code
    ) select organization_id,snapshot_id,(select id from public.users limit 1),gen_random_uuid(),repeat('b',64),'failed','renderer_failed'
      from m7_snapshot_failure_fixture$$,
  '23514',
  'new row for relation "technical_file_snapshot_exports" violates check constraint "technical_file_snapshot_exports_failure_code_check"',
  'new failure-code constraint rejects legacy values outside the contract'
);

create temporary table m7_snapshot_idempotency_fixture as
select
  file.organization_id,
  owner_user.id as actor_user_id,
  file.product_id,
  file.version as expected_version,
  gen_random_uuid() as idempotency_key
from public.technical_files file
join public.users owner_user on lower(owner_user.email)='owner@cra.test'
where file.status='active'
  and public.m7_technical_file_actor_can(
    file.organization_id,owner_user.id,'can_snapshot_technical_files'
  )
limit 1;

select is(
  (
    select created.outcome
    from m7_snapshot_idempotency_fixture fixture
    cross join lateral public.create_technical_file_snapshot_atomic(
      fixture.organization_id,fixture.actor_user_id,fixture.product_id,
      fixture.expected_version,'audit',null,'snapshot idempotency fixture',fixture.idempotency_key
    ) created
  ),
  'created',
  'first snapshot command is created'
);
select is(
  (
    select replay.outcome
    from m7_snapshot_idempotency_fixture fixture
    cross join lateral public.create_technical_file_snapshot_atomic(
      fixture.organization_id,fixture.actor_user_id,fixture.product_id,
      fixture.expected_version + 1,'audit',null,'snapshot idempotency fixture',fixture.idempotency_key
    ) replay
  ),
  'idempotency_conflict',
  'same snapshot idempotency key with a changed command is rejected'
);

select * from finish();
rollback;
