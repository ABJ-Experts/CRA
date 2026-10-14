begin;
set local statement_timeout='60s';
create function pg_temp.assert_scope_compatibility(p_ok boolean,p_label text) returns void language plpgsql as $$
begin if not coalesce(p_ok,false) then raise exception 'scope compatibility assertion: %',p_label;end if;end $$;
do $$
declare org uuid:=gen_random_uuid();actor uuid;created jsonb;old_job public.audit_verification_jobs;fresh_job public.audit_verification_jobs;
begin
 select id into strict actor from public.users where email='owner@cra.test';
 insert into public.organizations(id,name,slug) values(org,'M14 range compatibility rollback','m14-range-scope-'||org);
 insert into public.organization_members(organization_id,user_id,role) values(org,actor,'owner');
 insert into public.audit_logs(organization_id,action,entity_type,entity_id) values(org,'organization.fixture','organization',org::text);
 set constraints all immediate;
 created:=public.m13_04_create_verification(org,actor,gen_random_uuid(),'1',null,null,repeat('a',64));
 select * into strict old_job from public.audit_verification_jobs where id=(created->>'id')::uuid;
 -- Freeze both fields as one prior authorization. Its committed predecessor
 -- stays visible and the exclusive upper bound excludes the rollout XID,
 -- independently of the current snapshot or other active transactions.
 select xmin::text::xid8 into old_job.authorization_xid from public.users where id=actor;
 old_job.authorization_snapshot:=format('%s:%s:',old_job.authorization_xid,pg_current_xact_id())::pg_snapshot;
 perform public.m13_04_security_receipt(org,null,gen_random_uuid(),'audit.range.scope_changed',null,repeat('b',64),jsonb_build_object('epoch',old_job.dataset_epoch,'xid',pg_current_xact_id()::text,'policyVersion',1));
 perform pg_temp.assert_scope_compatibility(public.m13_04_current_scope(old_job)='access_changed','old authorization fails closed after policy rollout');
 perform pg_temp.assert_scope_compatibility(public.m13_04_unavailable_result(old_job,'scope_unavailable')->>'authenticityProven'='false','old result confers no new verification authority');
 created:=public.m13_04_create_verification(org,actor,gen_random_uuid(),'1',null,null,repeat('c',64));
 select * into strict fresh_job from public.audit_verification_jobs where id=(created->>'id')::uuid;
 perform pg_temp.assert_scope_compatibility(public.m13_04_current_scope(fresh_job) is null,'fresh authorization proceeds under current predicate');
 perform pg_temp.assert_scope_compatibility(fresh_job.dataset_epoch=old_job.dataset_epoch and fresh_job.from_sequence=old_job.from_sequence and fresh_job.to_sequence=old_job.to_sequence,'policy rollout preserves dataset and frozen range');
 perform pg_temp.assert_scope_compatibility(not exists(select 1 from jsonb_each_text(public.m13_04_dependency_fingerprints()) e where md5(pg_get_functiondef(('public.'||e.key)::regprocedure))<>e.value),'strict static fingerprint gate matches reviewed predicates');
 perform pg_temp.assert_scope_compatibility(not has_function_privilege('authenticated','public.m13_04_dependency_fingerprints()','EXECUTE'),'browser fingerprint grants remain private');
end $$;
rollback;
