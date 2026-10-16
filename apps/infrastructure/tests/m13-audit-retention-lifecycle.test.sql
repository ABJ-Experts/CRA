begin;
create extension if not exists pgtap;
select plan(20);
select ok(to_regprocedure('public.m13_02_refresh_audit_retention_atomic(uuid)') is not null,
 'audit retention refresh uses existing tenant source projections');
select is(public.m1_normalize_lifecycle_blockers('[{"kind":"audit_archival","code":"audit_archival_required"}]'),
 '[{"kind":"audit_archival","code":"audit_archival_required"}]'::jsonb,
 'archival blocker survives lifecycle normalization');
select ok(position('audit_archival_required' in pg_get_functiondef('public.claim_organization_purge_atomic(uuid,uuid,integer)'::regprocedure))>0,
 'claim blocks before artifact inventory');
select ok(position('audit_archival_required' in pg_get_functiondef('public.complete_organization_purge_atomic(uuid,uuid,uuid,integer)'::regprocedure))>0,
 'completion independently blocks previously claimed purge');
select ok(exists(select 1 from public.organization_export_source_tables where source_id='audit_logs' and table_name='audit_chain_heads'),
 'tenant export includes activation and chain head');
select is(public.m1_export_business_record_jsonb('audit_logs', '{"canonical_content":"{\"reason\":\"token=retained\"}","chain_sequence":12}'::jsonb)->>'canonical_content',
 '{"reason":"token=retained"}', 'export preserves already-redacted canonical bytes exactly');
select is(public.m1_export_business_record_jsonb('audit_chain_heads','{"last_sequence":9007199254740993,"legacy_count":7}'::jsonb)->>'last_sequence',
 '9007199254740993','export keeps bigint counters as exact decimal strings');
select ok(has_function_privilege('service_role','public.m13_02_refresh_audit_retention_atomic(uuid)','execute'), 'service may request source-owned refresh');
select ok(not has_function_privilege('authenticated','public.m13_02_refresh_audit_retention_atomic(uuid)','execute'), 'browser cannot update retention');
select ok(not has_function_privilege('service_role','public.m13_02_store_audit_retention(uuid,timestamp with time zone,integer,boolean,text)','execute'), 'service cannot supply fabricated retention');
select ok(position('greatest' in lower(pg_get_functiondef('public.m13_02_store_audit_retention(uuid,timestamp with time zone,integer,boolean,text)'::regprocedure)))>0,
 'watermarks cannot shrink');
create temporary table m13_retention_fixture as select id organization_id from public.organizations order by id limit 1;
select public.m13_02_store_audit_retention(organization_id,'2100-01-01',1000,false,'protected') from m13_retention_fixture;
select public.m13_02_store_audit_retention(organization_id,'2090-01-01',10,false,'complete') from m13_retention_fixture;
select is((select required_retention_days from public.audit_chain_heads join m13_retention_fixture using(organization_id)),1000,
 'lower settings cannot lower the observed retention duration');
select is((select protected_through from public.audit_chain_heads join m13_retention_fixture using(organization_id)), '2100-01-01'::timestamptz,
 'lower settings cannot shorten the observed protection date');
select is((select retention_status from public.audit_chain_heads join m13_retention_fixture using(organization_id)), 'protected',
 'a prior future high-watermark cannot be reported complete');
insert into public.retention_authoritative_facts(organization_id,evidence_class,reason_kind,source_record_id,required_retention_days,protect_through)
 select organization_id,'audit_event','evidence_class',gen_random_uuid(),1100,'2101-01-01' from m13_retention_fixture;
update public.retention_authority_states set available=false where organization_id in(select organization_id from m13_retention_fixture);
select public.m13_02_refresh_audit_retention_atomic(organization_id) from m13_retention_fixture;
select is((select protected_through from public.audit_chain_heads join m13_retention_fixture using(organization_id)), '2101-01-01'::timestamptz,
 'longer source protection extends the chain');
select is((select retention_status from public.audit_chain_heads join m13_retention_fixture using(organization_id)), 'unknown',
 'unavailable authorities are incomplete rather than deletion eligible');
select public.m13_02_store_audit_retention(organization_id,null,0,true,'protected') from m13_retention_fixture;
select public.m13_02_store_audit_retention(organization_id,null,0,false,'unknown') from m13_retention_fixture;
select ok((select legal_hold from public.audit_chain_heads join m13_retention_fixture using(organization_id)),
 'incomplete projections cannot release an observed hold');
select public.m13_02_store_audit_retention(organization_id,null,0,false,'complete') from m13_retention_fixture;
select ok(not (select legal_hold from public.audit_chain_heads join m13_retention_fixture using(organization_id)),
 'a complete source-owned reconciliation can observe an approved hold release');
update public.organization_lifecycles set status='purge_scheduled' where organization_id in(select organization_id from m13_retention_fixture);
insert into public.organization_purge_jobs(organization_id,lifecycle_version,purge_after,available_at)
 select organization_id,0,now()-interval '1 day',now()-interval '1 day' from m13_retention_fixture
 on conflict(organization_id) do update set status='scheduled',purge_after=excluded.purge_after,available_at=excluded.available_at;
select is((select outcome from public.claim_organization_purge_atomic((select organization_id from m13_retention_fixture),gen_random_uuid(),30)), 'blocked',
 'actual purge claim blocks before artifact work');
update public.organization_purge_jobs set status='running',lease_owner='00000000-0000-0000-0000-000000000013',lease_expires_at=now()+interval '1 hour'
 where organization_id in(select organization_id from m13_retention_fixture);
update public.organization_lifecycles set status='purging' where organization_id in(select organization_id from m13_retention_fixture);
select is((select outcome from public.complete_organization_purge_atomic((select organization_id from m13_retention_fixture),
 (select id from public.organization_purge_jobs join m13_retention_fixture using(organization_id)),
 '00000000-0000-0000-0000-000000000013',(select checkpoint_version from public.organization_purge_jobs join m13_retention_fixture using(organization_id)))), 'blocked',
 'actual completion independently blocks an already-running purge');
-- Exercise the deferred ledger finalizer for both blocked lifecycle events;
-- the enclosing rollback still preserves every pre-existing development row.
set constraints m13_02_finalize_audit_chain immediate;
select * from finish();
rollback;
