-- Isolated local-only fixtures: no seeded data changes survive this transaction.
\set ON_ERROR_STOP on
begin;
create or replace function pg_temp.check(label text, passed boolean) returns void language plpgsql as $$
begin if passed is not true then raise exception 'FAIL %',label; end if; raise notice 'ok %',label; end $$;
select pg_temp.check('immutable classification history exists',to_regclass('public.product_classification_runs') is not null);
select pg_temp.check('actor and exact predecessor FK indexes exist',exists(select 1 from pg_indexes where schemaname='public' and indexname='product_classification_runs_created_by_idx') and exists(select 1 from pg_indexes where schemaname='public' and indexname='product_classification_runs_supersedes_idx'));
select pg_temp.check('RLS enabled and not forced',(select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.product_classification_runs'::regclass));
select pg_temp.check('runtime roles cannot directly access history',not has_table_privilege('service_role','public.product_classification_runs','select,insert,update,delete')
  and not has_table_privilege('authenticated','public.product_classification_runs','select') and not has_table_privilege('anon','public.product_classification_runs','select'));
select pg_temp.check('RPC narrow service grants',has_function_privilege('service_role','public.save_product_classification_atomic(uuid,uuid,uuid,integer,integer,jsonb,text,jsonb,text,uuid)','execute')
  and not has_function_privilege('authenticated','public.save_product_classification_atomic(uuid,uuid,uuid,integer,integer,jsonb,text,jsonb,text,uuid)','execute')
  and not has_function_privilege('anon','public.get_product_classifications_latest(uuid,uuid,uuid[])','execute'));
do $$
begin
  execute 'set local role authenticated';
  begin perform 1 from public.product_classification_runs; raise exception 'FAIL authenticated read allowed';
  exception when insufficient_privilege then null; end;
  begin perform * from public.get_product_classifications_latest(gen_random_uuid(),gen_random_uuid(),array[gen_random_uuid()]); raise exception 'FAIL authenticated RPC allowed';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform pg_temp.check('actual authenticated database access denied',true);
  execute 'set local role service_role';
  begin perform 1 from public.product_classification_runs limit 1; raise exception 'FAIL service direct read allowed';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  perform pg_temp.check('service adapter cannot bypass read RPC authorization',true);
end $$;
select pg_temp.check('export source registered',exists(select 1 from public.organization_export_source_tables where source_id='product_registry' and table_name='product_classification_runs' and tenant_key_column='organization_id'));
select pg_temp.check('export snapshot locks new history',position('public.product_classification_runs' in pg_get_functiondef('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure))>0);
select pg_temp.check('retry credentials excluded from export',public.m1_export_business_record_jsonb('product_classification_runs','{"idempotency_key":"secret","request_digest":"secret","answers":{"scope":"undetermined"}}'::jsonb)='{"answers":{"scope":"undetermined"}}'::jsonb);
select pg_temp.check('database policy matches shared four-question contract',
  public.m2_classification_policy()->>'hash'='5941925c5f13b71bb98a1b9f109c359844b8ac531ad5b9ad0ce072333f6237b3'
  and public.m2_classification_policy()->>'status'='engineering_provisional'
  and jsonb_array_length(public.m2_classification_policy()->'questions')=4);
select pg_temp.check('critical branch derives critical',public.m2_classification_result('{"scope":"in_scope","criticalCoreFunction":"yes","classIICoreFunction":null,"classICoreFunction":null}')='critical');
select pg_temp.check('class II branch derives important II',public.m2_classification_result('{"scope":"in_scope","criticalCoreFunction":"no","classIICoreFunction":"yes","classICoreFunction":null}')='important_class_ii');
select pg_temp.check('class I branch derives important I',public.m2_classification_result('{"scope":"in_scope","criticalCoreFunction":"no","classIICoreFunction":"no","classICoreFunction":"yes"}')='important_class_i');
select pg_temp.check('all no derives default',public.m2_classification_result('{"scope":"in_scope","criticalCoreFunction":"no","classIICoreFunction":"no","classICoreFunction":"no"}')='default');
select pg_temp.check('scope uncertain preserved',public.m2_classification_result('{"scope":"undetermined","criticalCoreFunction":null,"classIICoreFunction":null,"classICoreFunction":null}')='undetermined');
select pg_temp.check('class uncertain preserved',public.m2_classification_result('{"scope":"in_scope","criticalCoreFunction":"no","classIICoreFunction":"undetermined","classICoreFunction":null}')='undetermined');
select pg_temp.check('out of scope preserved',public.m2_classification_result('{"scope":"out_of_scope","criticalCoreFunction":null,"classIICoreFunction":null,"classICoreFunction":null}')='out_of_scope');
select pg_temp.check('hidden stale answer rejected',public.m2_classification_result('{"scope":"in_scope","criticalCoreFunction":"yes","classIICoreFunction":"yes","classICoreFunction":null}') is null);
select pg_temp.check('missing answer rejected',public.m2_classification_result('{"scope":"undetermined","criticalCoreFunction":null,"classIICoreFunction":null}') is null);
select pg_temp.check('unknown field rejected',public.m2_classification_result('{"scope":"undetermined","criticalCoreFunction":null,"classIICoreFunction":null,"classICoreFunction":null,"approved":true}') is null);
select pg_temp.check('malicious answer rejected',public.m2_classification_result('{"scope":"<script>","criticalCoreFunction":null,"classIICoreFunction":null,"classICoreFunction":null}') is null);

create function pg_temp.reject_classification_audit() returns trigger language plpgsql as $$
begin if new.action='product.classification_saved' and current_setting('m2_test.reject_audit',true)='yes' then raise exception 'injected classification audit failure'; end if; return new; end $$;
create trigger m2_test_classification_audit_failure before insert on public.audit_logs for each row execute function pg_temp.reject_classification_audit();
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_viewer uuid;
  v_entity uuid;
  v_product uuid := gen_random_uuid();
  v_key uuid := gen_random_uuid();
  v_policy jsonb := public.m2_classification_policy();
  v_answers jsonb := '{"scope":"in_scope","criticalCoreFunction":"no","classIICoreFunction":"no","classICoreFunction":"yes"}';
  v_saved record;
  v_read record;
  v_result record;
  v_latest uuid;
  v_export record;
  v_claim record;
  v_materialized record;
begin
  select id into v_actor from public.users where email='owner@cra.test';
  select id into v_viewer from public.users where email='viewer@cra.test';
  select id into v_entity from public.organization_legal_entities where organization_id=v_org and is_default;
  insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
  values(v_product,v_org,v_entity,0,'{}','Classification SQL fixture','CLASS-'||v_product,'standalone_software',v_actor,v_actor,v_actor);
  select * into v_result from public.save_product_classification_atomic(v_org,v_viewer,v_product,0,0,v_policy,v_policy->>'hash',v_answers,'unauthorized',v_key);
  perform pg_temp.check('viewer cannot publish classification',v_result.outcome='forbidden');
  select * into v_result from public.save_product_classification_atomic(gen_random_uuid(),v_actor,v_product,0,0,v_policy,v_policy->>'hash',v_answers,'foreign tenant',v_key);
  perform pg_temp.check('tenant substitution denied',v_result.outcome='not_found');
  select * into v_result from public.save_product_classification_atomic(v_org,v_actor,gen_random_uuid(),0,0,v_policy,v_policy->>'hash',v_answers,'foreign product',v_key);
  perform pg_temp.check('missing or foreign product denied',v_result.outcome='not_found');
  select * into v_result from public.save_product_classification_atomic(v_org,v_actor,v_product,0,0,v_policy||'{"status":"legally_approved"}',v_policy->>'hash',v_answers,'fabricated approval',v_key);
  perform pg_temp.check('caller legal approval denied',v_result.outcome='invalid_request');
  select * into v_result from public.save_product_classification_atomic(v_org,v_actor,v_product,0,0,v_policy,repeat('0',64),v_answers,'wrong hash',v_key);
  perform pg_temp.check('policy hash mismatch denied',v_result.outcome='invalid_request');
  select * into v_result from public.save_product_classification_atomic(v_org,v_actor,v_product,0,0,v_policy,v_policy->>'hash',v_answers||'{"classICoreFunction":null}','branch invalid',v_key);
  perform pg_temp.check('invalid branch leaves no run',v_result.outcome='invalid_request' and not exists(select 1 from public.product_classification_runs where product_id=v_product));
  select * into v_saved from public.save_product_classification_atomic(v_org,v_actor,v_product,0,0,v_policy,v_policy->>'hash',v_answers,'<script>alert(1)</script> Human declaration',v_key);
  perform pg_temp.check('saved explicit result and full provenance',v_saved.outcome='saved' and v_saved.run->>'classification'='important_class_i' and v_saved.run->'policySnapshot'=v_policy and v_saved.run->>'revision'='1');
  perform pg_temp.check('malicious-looking rationale remains plain immutable text',v_saved.run->>'rationale'='<script>alert(1)</script> Human declaration');
  perform pg_temp.check('audit fact atomic and minimal',exists(select 1 from public.audit_logs where organization_id=v_org and action='product.classification_saved' and changes->>'classificationRunId'=v_saved.run->>'id' and not changes ? 'answers'));
  select * into v_result from public.save_product_classification_atomic(v_org,v_actor,v_product,0,0,v_policy,v_policy->>'hash',v_answers,'<script>alert(1)</script> Human declaration',v_key);
  perform pg_temp.check('exact retry after restart replays identical run',v_result.outcome='replayed' and v_result.run=v_saved.run);
  select * into v_result from public.save_product_classification_atomic(v_org,v_actor,v_product,0,0,v_policy,v_policy->>'hash',v_answers,'changed retry',v_key);
  perform pg_temp.check('changed retry conflicts',v_result.outcome='idempotency_mismatch');
  select * into v_result from public.save_product_classification_atomic(v_org,v_actor,v_product,0,0,v_policy,v_policy->>'hash',v_answers,'concurrent stale revision',gen_random_uuid());
  perform pg_temp.check('stale simultaneous revision conflicts',v_result.outcome='conflict');
  update public.products set version=version+1 where organization_id=v_org and id=v_product;
  select * into v_result from public.save_product_classification_atomic(v_org,v_actor,v_product,0,1,v_policy,v_policy->>'hash',v_answers,'concurrent stale product',gen_random_uuid());
  perform pg_temp.check('concurrent product edit conflicts',v_result.outcome='conflict');
  select * into v_result from public.save_product_classification_atomic(v_org,v_actor,v_product,1,1,v_policy,v_policy->>'hash',v_answers,'rerun',gen_random_uuid());
  v_latest:=(v_result.run->>'id')::uuid;
  perform pg_temp.check('rerun retains immutable predecessor',v_result.outcome='saved' and v_result.run->>'revision'='2' and v_result.run->>'supersedesId'=v_saved.run->>'id' and (select count(*) from public.product_classification_runs where product_id=v_product)=2);
  select * into v_read from public.get_product_classifications_latest(v_org,v_viewer,array[v_product]);
  perform pg_temp.check('viewer reads latest minimal provisional summary',v_read.outcome='found' and v_read.classifications->0->'latest'->>'revision'='2' and not (v_read.classifications->0->'latest') ? 'answers');
  select * into v_read from public.get_product_classifications_latest(v_org,v_viewer,array[v_product,gen_random_uuid()]);
  perform pg_temp.check('bulk mixed tenant product list fails closed',v_read.outcome='not_found' and v_read.classifications is null);
  select * into v_read from public.get_product_classifications_latest(v_org,v_viewer,array[v_product,v_product]);
  perform pg_temp.check('bulk duplicate list rejected',v_read.outcome='invalid_request');
  select * into v_read from public.get_product_classifications_latest(v_org,v_viewer,array_fill(v_product,array[101]));
  perform pg_temp.check('bulk size bounded',v_read.outcome='invalid_request');
  insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(v_org,'owner','{"can_edit_products":false}')
  on conflict(organization_id,base_role) do update set permissions=excluded.permissions;
  select * into v_result from public.save_product_classification_atomic(v_org,v_actor,v_product,0,0,v_policy,v_policy->>'hash',v_answers,'<script>alert(1)</script> Human declaration',v_key);
  perform pg_temp.check('revoked permission denies exact replay',v_result.outcome='forbidden');
  delete from public.base_role_permission_overrides where organization_id=v_org and base_role='owner';
  perform set_config('m2_test.reject_audit','yes',true);
  begin
    perform * from public.save_product_classification_atomic(v_org,v_actor,v_product,1,2,v_policy,v_policy->>'hash',v_answers,'audit failure rollback',gen_random_uuid());
    raise exception 'FAIL audit injection did not fail';
  exception when raise_exception then
    if sqlerrm<>'injected classification audit failure' then raise; end if;
  end;
  perform set_config('m2_test.reject_audit','no',true);
  perform pg_temp.check('audit failure leaves no partial run',(select count(*) from public.product_classification_runs where product_id=v_product)=2);
  begin update public.product_classification_runs set rationale='overwrite' where id=v_latest; raise exception 'FAIL update allowed';
  exception when sqlstate '55000' then null; end;
  perform pg_temp.check('direct update rejected',(select rationale from public.product_classification_runs where id=v_latest)='rerun');
  begin delete from public.product_classification_runs where id=v_latest; raise exception 'FAIL delete allowed';
  exception when sqlstate '55000' then null; end;
  perform pg_temp.check('direct delete rejected',exists(select 1 from public.product_classification_runs where id=v_latest));
  update public.products set archived_at=clock_timestamp() where id=v_product;
  select * into v_result from public.save_product_classification_atomic(v_org,v_actor,v_product,1,2,v_policy,v_policy->>'hash',v_answers,'archived new run',gen_random_uuid());
  perform pg_temp.check('archived product cannot create run',v_result.outcome='invalid_state');
  select * into v_read from public.get_product_classifications_latest(v_org,v_viewer,array[v_product]);
  perform pg_temp.check('archived history still readable',v_read.outcome='found' and v_read.classifications->0->'latest'->>'revision'='2');
  select * into v_export from public.request_organization_export_atomic(v_org,v_actor,gen_random_uuid(),repeat('e',64),'classification-export-test');
  select * into v_claim from public.claim_organization_export_atomic(v_org,gen_random_uuid(),60);
  select * into v_materialized from public.materialize_organization_export_snapshot_atomic(v_org,v_claim.export_job_id,v_claim.lease_owner,v_claim.checkpoint_version);
  perform pg_temp.check('M1 snapshot includes exact immutable history',v_materialized.outcome='materialized' and
    (select count(*) from public.organization_export_snapshot_records where export_job_id=v_claim.export_job_id
      and table_name='product_classification_runs' and record_payload->>'product_id'=v_product::text)=2);
  perform pg_temp.check('M1 snapshot keeps answers/hash and removes retry credentials',exists(
    select 1 from public.organization_export_snapshot_records where export_job_id=v_claim.export_job_id
      and table_name='product_classification_runs' and record_payload->>'id'=v_latest::text
      and record_payload->'answers'=v_answers and record_payload->'policy_snapshot'=v_policy and record_payload->>'policy_hash'=v_policy->>'hash'
      and not record_payload ? 'request_digest' and not record_payload ? 'idempotency_key'));

end $$;
rollback;
