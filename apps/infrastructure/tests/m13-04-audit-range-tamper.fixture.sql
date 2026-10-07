-- Run only in the disposable synthetic M13 range database. All fixtures roll back.
begin;
do $$ begin
 if current_database() not like 'm13_test_04_range%' then raise exception 'Disposable M13 range database required'; end if;
end $$;
create function pg_temp.check(p_name text,p_ok boolean) returns void language plpgsql as $$ begin
 if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
 raise notice 'PASS: %',p_name;
end $$;
-- Prepare fixture source rows without generating invalidation in this same
-- transaction; production source writes retain all their receipt triggers.
do $$ declare t text; begin
 foreach t in array public.m13_04_scope_dependencies() loop
  if to_regclass('public.'||t) is not null then execute format('alter table public.%I disable trigger m13_04_scope_changed',t); end if;
 end loop;
end $$;
create temp table fixture(org uuid,user_id uuid);
insert into fixture values(gen_random_uuid(),gen_random_uuid());
insert into public.organizations(id,name,slug) select org,'M13 disposable tamper fixture','m13-tamper-'||org from fixture;
insert into public.users(id,email) select user_id,user_id||'@m13.invalid' from fixture;
insert into public.organization_members(organization_id,user_id,role) select org,user_id,'owner' from fixture;
do $$ declare t text; begin
 foreach t in array public.m13_04_scope_dependencies() loop
  if to_regclass('public.'||t) is not null then execute format('alter table public.%I enable trigger m13_04_scope_changed',t); end if;
 end loop;
end $$;
insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
select org,user_id,'organization.range_fixture','organization',org::text,jsonb_build_object('fixture',n) from fixture cross join generate_series(1,3) n;
set constraints m13_02_finalize_audit_chain immediate;
select pg_temp.check('three chained synthetic events',(select last_sequence=3 from public.audit_chain_heads where organization_id=(select org from fixture)));

savepoint modified;
alter table public.audit_logs disable trigger m13_02_guard_audit_mutation;
update public.audit_logs set canonical_content=canonical_content||' ' where organization_id=(select org from fixture) and chain_sequence=2;
alter table public.audit_logs enable trigger m13_02_guard_audit_mutation;
select pg_temp.check('modified canonical differs from actual stored content',(select canonical_content<>public.m13_02_canonical_content(a,chain_sequence) from public.audit_logs a where organization_id=(select org from fixture) and chain_sequence=2));
select pg_temp.check('modified canonical hash breaks',(select encode(extensions.digest(decode(previous_hash,'hex')||convert_to(canonical_content,'UTF8'),'sha256'),'hex')<>content_hash from public.audit_logs where organization_id=(select org from fixture) and chain_sequence=2));
rollback to modified;

savepoint missing;
alter table public.audit_logs disable trigger m13_02_guard_audit_mutation;
delete from public.audit_logs where organization_id=(select org from fixture) and chain_sequence=2;
alter table public.audit_logs enable trigger m13_02_guard_audit_mutation;
do $$ declare f fixture; j jsonb; c jsonb; authorized jsonb; page jsonb; begin
 select * into f from fixture;
 j:=public.m13_04_create_verification(f.org,f.user_id,gen_random_uuid(),'1',null,null,repeat('b',64));
 update public.audit_verification_jobs set scheduled_at='-infinity' where id=(j->>'id')::uuid;
 c:=public.m13_04_claim_verification('m13-tamper');
 perform pg_temp.check('synthetic missing job selected',c->>'id'=j->>'id');
 authorized:=public.m13_04_authorize_verification(f.org,(c->>'id')::uuid,'m13-tamper',(c->>'lease_token')::uuid,(c->>'version')::integer,250,16777216);
 c:=authorized->'job';
 perform pg_temp.check('missing row does not get silently scope-filtered',(authorized->>'complete')::boolean and (authorized->>'scopeAvailable')::boolean);
 page:=public.m13_04_page_verification(f.org,(c->>'id')::uuid,'m13-tamper',(c->>'lease_token')::uuid,(c->>'version')::integer,'0','3',250,16777216);
 perform pg_temp.check('missing middle remains observable as sequence gap',page->'rows'->0->>'chain_sequence'='1' and page->'rows'->1->>'chain_sequence'='3');
 perform pg_temp.check('diagnostic claim durably audited',(select count(*)>0 from public.audit_logs where organization_id is null and action='audit.range.claimed' and entity_id=c->>'id'));
end $$;
rollback to missing;

savepoint truncated;
alter table public.audit_logs disable trigger m13_02_guard_audit_mutation;
delete from public.audit_logs where organization_id=(select org from fixture) and chain_sequence=3;
alter table public.audit_logs enable trigger m13_02_guard_audit_mutation;
do $$ declare f fixture; j jsonb; private jsonb; receipt uuid; begin
 select * into f from fixture;
 j:=public.m13_04_create_verification(f.org,f.user_id,gen_random_uuid(),'1',null,null,repeat('c',64));
 select public.m13_04_private_job(v) into private from public.audit_verification_jobs v where id=(j->>'id')::uuid;
 perform pg_temp.check('truncated tail keeps frozen head boundary',private->>'to_sequence'='3' and private->'frozen_head'->>'observed_sequence'='2');
 receipt:=public.m13_04_security_receipt(f.org,f.user_id,gen_random_uuid(),'audit.range.status_read',(j->>'id')::uuid,repeat('d',64));
 perform pg_temp.check('corrupt tenant head does not block security receipt',(select organization_id is null and chain_sequence is null from public.audit_logs where id=receipt));
end $$;
rollback to truncated;

savepoint missing_head;
delete from public.audit_chain_heads where organization_id=(select org from fixture);
do $$ declare f fixture; j jsonb; private jsonb; begin
 select * into f from fixture;
 j:=public.m13_04_create_verification(f.org,f.user_id,gen_random_uuid(),'1',null,null,repeat('a',64));
 select public.m13_04_private_job(v) into private from public.audit_verification_jobs v where id=(j->>'id')::uuid;
 perform pg_temp.check('missing head diagnostic remains available',private->'frozen_head'='null'::jsonb and private->>'high_water_sequence'='3');
 perform pg_temp.check('missing head creation is durably audited',(select count(*)=1 from public.audit_logs where organization_id is null and action='audit.range.created' and entity_id=j->>'id'));
end $$;
rollback to missing_head;

savepoint hidden;
insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
select org,user_id,'unknown.range_fixture','unknown_source',gen_random_uuid()::text,'{}' from fixture;
set constraints m13_02_finalize_audit_chain immediate;
do $$ declare f fixture; j jsonb; c jsonb; a jsonb; public_result jsonb; begin
 select * into f from fixture;
 j:=public.m13_04_create_verification(f.org,f.user_id,gen_random_uuid(),'1',null,null,repeat('e',64));
 update public.audit_verification_jobs set scheduled_at='-infinity' where id=(j->>'id')::uuid;
 c:=public.m13_04_claim_verification('m13-hidden');
 a:=public.m13_04_authorize_verification(f.org,(c->>'id')::uuid,'m13-hidden',(c->>'lease_token')::uuid,(c->>'version')::integer,250,16777216);
 perform pg_temp.check('unknown source fails closed',not (a->>'scopeAvailable')::boolean);
 perform public.m13_04_finish_unavailable_verification(f.org,(c->>'id')::uuid,'m13-hidden',(c->>'lease_token')::uuid,(c->>'version')::integer,'scope_unavailable');
 public_result:=public.m13_04_read_verification(f.org,f.user_id,(c->>'id')::uuid,gen_random_uuid())->'result';
 perform pg_temp.check('hidden rows and counts suppressed',public_result->>'outcome'='scope_unavailable' and public_result->'checkedCount'='null'::jsonb and public_result->'frozenRange'='null'::jsonb and jsonb_array_length(public_result->'breaks')=0);
end $$;
rollback to hidden;

do $$ declare f fixture; j jsonb; epoch uuid; rotated jsonb; status jsonb; begin
 select * into f from fixture;
 j:=public.m13_04_create_verification(f.org,f.user_id,gen_random_uuid(),'1',null,null,repeat('f',64));
 select audit_dataset_epoch into epoch from public.organizations where id=f.org;
 rotated:=public.m13_04_rotate_dataset_marker(f.org,gen_random_uuid(),epoch,'restored');
 perform pg_temp.check('operator rotates restored epoch',(rotated->>'epoch')::uuid<>epoch);
 status:=public.m13_04_read_verification(f.org,f.user_id,(j->>'id')::uuid,gen_random_uuid());
 perform pg_temp.check('restored dataset invalidates cached result',status->>'status'='stale' and status->>'failureCode'='dataset_changed' and status->'result'->>'outcome'='scope_unavailable');
end $$;
rollback;
