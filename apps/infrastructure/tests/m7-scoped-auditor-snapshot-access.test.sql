begin;
create extension if not exists pgtap;
select plan(34);

select ok(to_regclass('public.technical_file_auditor_snapshot_grants') is not null, 'auditor grant table exists');
select ok(to_regclass('public.technical_file_auditor_sessions') is not null, 'auditor session table exists');
select ok(to_regclass('public.technical_file_auditor_access_events') is not null, 'auditor access-event table exists');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.technical_file_auditor_snapshot_grants'::regclass), 'grants use enabled non-forced RLS');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.technical_file_auditor_sessions'::regclass), 'sessions use enabled non-forced RLS');
select ok((select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.technical_file_auditor_access_events'::regclass), 'access events use enabled non-forced RLS');
select ok(has_table_privilege('service_role','public.technical_file_auditor_snapshot_grants','select,insert,update,delete'), 'service role can manage grants');
select ok(not has_table_privilege('authenticated','public.technical_file_auditor_snapshot_grants','select'), 'authenticated cannot read grants directly');
select ok(not has_table_privilege('anon','public.technical_file_auditor_sessions','select'), 'anon cannot read sessions directly');
select ok(not has_table_privilege('authenticated','public.technical_file_auditor_access_events','select'), 'authenticated cannot read dedicated access audit directly');
select ok((select count(*)=1 from pg_indexes where schemaname='public' and indexname='technical_file_auditor_access_rate_idx'), 'failed redemption rate-limit index exists');
select ok((select count(*)>=1 from pg_constraint where conrelid='public.technical_file_auditor_snapshot_grants'::regclass and pg_get_constraintdef(oid) like '%token_hash%' and pg_get_constraintdef(oid) like '%^[a-f0-9]{64}%'), 'grant token hashes are constrained');
select ok((select count(*)>=1 from pg_constraint where conrelid='public.technical_file_auditor_snapshot_grants'::regclass and pg_get_constraintdef(oid) like '%organization_id, snapshot_id%' and pg_get_constraintdef(oid) like '%technical_file_snapshots%'), 'grant snapshot reference is tenant-scoped');
select ok((select count(*)>=1 from pg_constraint where conrelid='public.technical_file_auditor_snapshot_grants'::regclass and pg_get_constraintdef(oid) like '%organization_id, export_id%' and pg_get_constraintdef(oid) like '%technical_file_snapshot_exports%'), 'grant export reference is tenant-scoped');

select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.create_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,uuid,text)'::regprocedure), 'grant creation is a pinned security-definer RPC');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.redeem_technical_file_auditor_snapshot_grant_atomic(text,uuid,text,timestamptz,text)'::regprocedure), 'redemption is a pinned security-definer RPC');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.get_technical_file_auditor_snapshot_access_atomic(text,text)'::regprocedure), 'auditor access is a pinned security-definer RPC');
select ok((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.get_technical_file_auditor_snapshot_artifact_atomic(text,text)'::regprocedure), 'artifact authorization is a pinned security-definer RPC');
select ok(has_function_privilege('service_role','public.create_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,uuid,text)','execute'), 'service role can create a grant');
select ok(not has_function_privilege('authenticated','public.create_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,uuid,text)','execute'), 'authenticated cannot create grants directly');
select ok(not has_function_privilege('anon','public.redeem_technical_file_auditor_snapshot_grant_atomic(text,uuid,text,timestamptz,text)','execute'), 'anon cannot redeem directly');

select ok(position('can_share_technical_file_snapshots' in pg_get_functiondef('public.create_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,uuid,text)'::regprocedure))>0, 'grant creation checks its dedicated share permission');
select ok(position('status=''ready''' in pg_get_functiondef('public.create_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,uuid,text)'::regprocedure))>0, 'grant creation permits only ready snapshot exports');
select ok(position('for update' in lower(pg_get_functiondef('public.redeem_technical_file_auditor_snapshot_grant_atomic(text,uuid,text,timestamptz,text)'::regprocedure)))>0, 'redemption locks the one-time grant');
select ok(position('redeemed_at is not null' in lower(pg_get_functiondef('public.redeem_technical_file_auditor_snapshot_grant_atomic(text,uuid,text,timestamptz,text)'::regprocedure)))>0, 'redeemed links cannot create another session');
select ok(position('redemption_rate_limited' in pg_get_functiondef('public.redeem_technical_file_auditor_snapshot_grant_atomic(text,uuid,text,timestamptz,text)'::regprocedure))>0, 'redemption failures are rate-limited without storing a raw client address');
select ok(position('v_grant.status<>''active''' in replace(pg_get_functiondef('public.get_technical_file_auditor_snapshot_access_atomic(text,text)'::regprocedure),' ',''))>0, 'every auditor view rechecks grant state');
select ok(position('v_session.revoked_at is not null' in lower(pg_get_functiondef('public.get_technical_file_auditor_snapshot_artifact_atomic(text,text)'::regprocedure)))>0, 'artifact authorization rechecks session revocation');
select ok(position('artifact_delivered' in pg_get_functiondef('public.get_technical_file_auditor_snapshot_artifact_atomic(text,text)'::regprocedure))>0, 'artifact authorization writes dedicated delivery audit evidence');
select ok(position('objectPath' in pg_get_functiondef('public.m7_auditor_scope_json(uuid)'::regprocedure))=0, 'auditor view payload never exposes storage paths');
select ok(position('payload' in pg_get_functiondef('public.m7_auditor_scope_json(uuid)'::regprocedure))>0 and position('superseded' in pg_get_functiondef('public.m7_auditor_scope_json(uuid)'::regprocedure))>0, 'auditor scope is frozen snapshot content with supersession state');
select is((select outcome from public.redeem_technical_file_auditor_snapshot_grant_atomic(repeat('a',64),gen_random_uuid(),repeat('b',64),clock_timestamp()+interval '30 minutes',null)), 'unavailable', 'unknown redemption token is safely unavailable');
select is((select outcome from public.get_technical_file_auditor_snapshot_access_atomic(repeat('a',64),'viewed')), 'unavailable', 'unknown auditor session is safely unavailable');
select is((select outcome from public.get_technical_file_auditor_snapshot_artifact_atomic(repeat('a',64),'pdf')), 'unavailable', 'unknown artifact session is safely unavailable');

select * from finish();
rollback;
