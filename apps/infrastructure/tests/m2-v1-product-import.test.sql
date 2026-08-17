-- M2 V1 product/release import integration tests. Fixtures always roll back.

\set ON_ERROR_STOP on
\timing off

create or replace function pg_temp.check(p_label text,p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice 'ok   %',p_label;
  else raise exception 'FAIL %',p_label; end if;
end;
$$;

create or replace function pg_temp.import_page_plan(p_org uuid,p_import uuid)
returns text language plpgsql as $$
declare v_line text; v_plan text:='';
begin
  perform set_config('enable_seqscan','off',true);
  for v_line in execute format(
    'explain (costs off) select * from public.product_import_rows where organization_id=%L::uuid and import_id=%L::uuid order by source_row_number limit 100',
    p_org,p_import)
  loop v_plan:=v_plan||E'\n'||v_line; end loop;
  return v_plan;
end;
$$;

select pg_temp.check('import storage and the minimal two-table model are installed',
  (select not public and file_size_limit=10485760 from storage.buckets where id='product-imports')
  and to_regclass('public.product_import_jobs') is not null
  and to_regclass('public.product_import_rows') is not null
  and (select count(*)=2 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and c.relname like 'product_import%'));

select pg_temp.check('import state is service-only and indexed',
  (select relrowsecurity from pg_class where oid='public.product_import_jobs'::regclass)
  and (select relrowsecurity from pg_class where oid='public.product_import_rows'::regclass)
  and not has_table_privilege('authenticated','public.product_import_jobs','select')
  and not has_table_privilege('anon','public.product_import_rows','select')
  and has_table_privilege('service_role','public.product_import_jobs','select')
  and exists(select 1 from pg_indexes where schemaname='public' and indexname='product_import_claim_idx')
  and exists(select 1 from pg_indexes where schemaname='public' and indexname='product_import_rows_page_idx'));

select pg_temp.check('browser roles cannot execute import coordination',
  not has_function_privilege('authenticated',
    'public.create_product_import_job(uuid,uuid,uuid,uuid,text,text,integer,text,uuid)','execute')
  and not has_function_privilege('authenticated',
    'public.commit_product_import_atomic(uuid,uuid,uuid,text,uuid)','execute')
  and has_function_privilege('service_role',
    'public.claim_product_import_job_by_id(uuid,uuid,text,integer)','execute'));

begin;
do $$
declare
  v_org uuid:=gen_random_uuid(); v_actor uuid; v_job uuid:=gen_random_uuid();
  v_jobs record; v_rows record;
begin
  select id into v_actor from public.users where email='owner@cra.test';
  insert into public.organizations(id,name,slug)
  values(v_org,'Import pagination test','import-pagination-'||replace(v_org::text,'-',''));
  insert into public.organization_members(organization_id,user_id,role)
  values(v_org,v_actor,'owner');

  select * into v_jobs from public.list_product_import_jobs(v_org,v_actor,null,1,20);
  if v_jobs.outcome<>'found' or (v_jobs.imports->>'total')::integer<>0
     or (v_jobs.imports->>'pageCount')::integer<>1
     or jsonb_array_length(v_jobs.imports->'rows')<>0 then
    raise exception 'empty import job page violates the shared pagination contract';
  end if;

  perform * from public.create_product_import_job(v_org,v_actor,v_job,gen_random_uuid(),repeat('0',64),
    'empty.csv',1,v_org::text||'/'||v_job::text||'/source.csv',gen_random_uuid());
  select * into v_rows from public.list_product_import_rows(v_org,v_actor,v_job,null,1,20);
  if v_rows.outcome<>'found' or (v_rows.rows->>'total')::integer<>0
     or (v_rows.rows->>'pageCount')::integer<>1
     or jsonb_array_length(v_rows.rows->'rows')<>0 then
    raise exception 'empty import row page violates the shared pagination contract';
  end if;
end $$;
rollback;

begin;
do $$
declare
  v_org uuid:=gen_random_uuid(); v_actor uuid; v_import uuid:=gen_random_uuid();
  v_hash text:=repeat('4',64); v_claim record; v_export record; v_export_claim record;
  v_materialized record; v_job_payload jsonb; v_row_payload jsonb;
begin
  select id into v_actor from public.users where email='owner@cra.test';
  insert into public.organizations(id,name,slug)
  values(v_org,'Import export test','import-export-'||replace(v_org::text,'-',''));
  insert into public.organization_members(organization_id,user_id,role)
  values(v_org,v_actor,'owner');

  perform * from public.create_product_import_job(v_org,v_actor,v_import,gen_random_uuid(),v_hash,
    'private-source-name.csv',100,v_org::text||'/'||v_import::text||'/source.csv',gen_random_uuid());
  select * into v_claim from public.claim_product_import_job_by_id(v_org,v_import,'sql-export',60);
  perform * from public.save_product_import_rows_page(v_org,v_import,'sql-export',v_hash,
    jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid(),'sourceRowNumber',2,'rowHash',repeat('5',64),
      'rowType','product','proposedAction','create','result','planned',
      'productInternalCode','EXPORT-SAFE','productInternalCodeNormalized','export-safe',
      'proposed',jsonb_build_object('name','=PRIVATE RAW CELL','internalCode','EXPORT-SAFE'),
      'issues',jsonb_build_array(jsonb_build_object(
        'severity','warning','code','import_test_warning','field','name','message','Safe warning')))));

  select * into v_export from public.request_organization_export_atomic(
    v_org,v_actor,gen_random_uuid(),repeat('6',64),'product-import-export-test');
  select * into v_export_claim from public.claim_organization_export_atomic(
    v_org,gen_random_uuid(),60);
  select * into v_materialized from public.materialize_organization_export_snapshot_atomic(
    v_org,v_export_claim.export_job_id,v_export_claim.lease_owner,v_export_claim.checkpoint_version);
  if v_export.outcome<>'created' or v_materialized.outcome<>'materialized' then
    raise exception 'product import export snapshot was not materialized';
  end if;

  select record_payload into v_job_payload from public.organization_export_snapshot_records
   where organization_id=v_org and export_job_id=v_export_claim.export_job_id
     and source_id='product_registry' and table_name='product_import_jobs';
  select record_payload into v_row_payload from public.organization_export_snapshot_records
   where organization_id=v_org and export_job_id=v_export_claim.export_job_id
     and source_id='product_registry' and table_name='product_import_rows';
  if v_job_payload is null or v_job_payload->>'content_hash'<>v_hash
     or v_job_payload ?| array[
       'original_filename','source_object_path','report_object_path','work_kind',
       'upload_idempotency_key','upload_request_digest','commit_idempotency_key',
       'commit_request_digest','checkpoint_row_number','next_attempt_at','lease_owner',
       'lease_expires_at','source_deleted_at','report_deleted_at'] then
    raise exception 'product import job export exposed private workflow state';
  end if;
  if v_row_payload is null or v_row_payload->>'product_internal_code'<>'EXPORT-SAFE'
     or v_row_payload::text like '%PRIVATE RAW CELL%'
     or v_row_payload ?| array[
       'id','row_hash','proposed','product_internal_code_normalized',
       'release_version_normalized','product_id','release_id',
       'expected_product_version','expected_release_version'] then
    raise exception 'product import row export exposed raw planning or resolved target state';
  end if;
end $$;
rollback;

begin;
do $$
declare
  v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_actor uuid; v_job uuid:=gen_random_uuid(); v_blocked boolean:=false;
begin
  select id into v_actor from public.users where email='owner@cra.test';
  perform * from public.create_product_import_job(v_org,v_actor,v_job,gen_random_uuid(),repeat('1',64),
    'not-validated.csv',10,v_org::text||'/'||v_job::text||'/source.csv',gen_random_uuid());
  begin
    perform * from public.commit_product_import_atomic(v_org,v_actor,v_job,repeat('1',64),gen_random_uuid());
  exception when check_violation then v_blocked:=true;
  end;
  if not v_blocked or (select status from public.product_import_jobs where id=v_job)<>'queued' then
    raise exception 'commit bypassed mandatory dry run';
  end if;
  if (select outcome from public.get_product_import_job(gen_random_uuid(),v_actor,v_job))<>'not_found'
     or (select outcome from public.claim_product_import_job_by_id(gen_random_uuid(),v_job,'foreign',60))<>'not_found' then
    raise exception 'cross-tenant import identifier was disclosed';
  end if;
end $$;
rollback;

begin;
do $$
declare
  v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_actor uuid; v_job uuid:=gen_random_uuid(); v_retry_job uuid:=gen_random_uuid();
  v_upload_key uuid:=gen_random_uuid(); v_hash text:=repeat('2',64); v_result record;
begin
  select id into v_actor from public.users where email='owner@cra.test';
  perform * from public.create_product_import_job(v_org,v_actor,v_job,v_upload_key,v_hash,
    'replay.csv',100,v_org::text||'/'||v_job::text||'/source.csv',gen_random_uuid());
  select * into v_result from public.create_product_import_job(v_org,v_actor,v_retry_job,v_upload_key,v_hash,
    'replay.csv',100,v_org::text||'/'||v_retry_job::text||'/source.csv',gen_random_uuid());
  if v_result.outcome<>'replayed' or (v_result.job->>'id')::uuid<>v_job then
    raise exception 'same upload idempotency request did not replay the original job';
  end if;
  select * into v_result from public.create_product_import_job(v_org,v_actor,v_retry_job,v_upload_key,
    repeat('3',64),'replay.csv',100,v_org::text||'/'||v_retry_job::text||'/source.csv',gen_random_uuid());
  if v_result.outcome<>'idempotency_mismatch' or v_result.job is not null then
    raise exception 'changed upload reused an idempotency key';
  end if;
end $$;
rollback;

begin;
do $$
declare
  v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_actor uuid; v_entity uuid; v_job uuid:=gen_random_uuid();
  v_code text:='IMP-'||gen_random_uuid()::text; v_hash text:=repeat('a',64);
  v_claim record; v_save record; v_replay record; v_done record; v_commit record;
  v_page record; v_rows jsonb;
begin
  select id into v_actor from public.users where email='owner@cra.test';
  select id into v_entity from public.organization_legal_entities
    where organization_id=v_org and is_default;

  perform * from public.create_product_import_job(
    v_org,v_actor,v_job,gen_random_uuid(),v_hash,'test.csv',100,
    v_org::text||'/'||v_job::text||'/source.csv',gen_random_uuid());
  select * into v_claim from public.claim_product_import_job_by_id(v_org,v_job,'sql-import',60);
  if v_claim.outcome<>'claimed' then raise exception 'exact claim failed: %',v_claim.outcome; end if;

  v_rows:=jsonb_build_array(
    jsonb_build_object(
      'id',gen_random_uuid(),'sourceRowNumber',2,'rowHash',repeat('b',64),
      'rowType','product','proposedAction','create','result','planned',
      'productInternalCode',v_code,'productInternalCodeNormalized',lower(v_code),
      'proposed',jsonb_build_object('name','Imported SQL product','internalCode',v_code,
        'productType','standalone_software','responsibleOwnerId',v_actor,'legalEntityId',v_entity),
      'issues','[]'::jsonb),
    jsonb_build_object(
      'id',gen_random_uuid(),'sourceRowNumber',3,'rowHash',repeat('c',64),
      'rowType','release','proposedAction','create','result','planned',
      'productInternalCode',v_code,'releaseVersion','1.0',
      'productInternalCodeNormalized',lower(v_code),'releaseVersionNormalized','1.0',
      'proposed',jsonb_build_object('label','Imported release','version','1.0'),
      'issues','[]'::jsonb)
  );
  select * into v_save from public.save_product_import_rows_page(v_org,v_job,'sql-import',v_hash,v_rows);
  if v_save.outcome<>'saved' or v_save.saved_count<>2 then raise exception 'row save failed'; end if;
  select * into v_replay from public.save_product_import_rows_page(v_org,v_job,'sql-import',v_hash,v_rows);
  if v_replay.outcome<>'saved' or (select count(*) from public.product_import_rows where import_id=v_job)<>2
    then raise exception 'row replay was not idempotent'; end if;

  select * into v_page from public.list_product_import_rows(v_org,v_actor,v_job,null,1,10);
  if v_page.outcome<>'found'
     or (v_page.rows->'rows'->0) ?| array['productId','releaseId','proposed','rowHash','storagePath']
     or not ((v_page.rows->'rows'->0) ?& array[
       'sourceRowNumber','rowType','proposedAction','result',
       'productInternalCode','releaseVersion','issues']) then
    raise exception 'row page exposed private state or missed contract fields';
  end if;

  select * into v_done from public.complete_product_import_dry_run(
    v_org,v_job,'sql-import',v_hash,2,2,0,0,0,0,0,
    v_org::text||'/'||v_job::text||'/report.csv',null);
  if v_done.outcome<>'dry_run_completed' then raise exception 'dry run completion failed'; end if;
  select * into v_commit from public.commit_product_import_atomic(
    v_org,v_actor,v_job,v_hash,gen_random_uuid());
  if v_commit.outcome<>'completed' then raise exception 'commit failed: %',v_commit.outcome; end if;
  if not exists(select 1 from public.products where organization_id=v_org and internal_code=v_code)
     or not exists(select 1 from public.product_releases r join public.products p on p.id=r.product_id
       where r.organization_id=v_org and p.internal_code=v_code and r.release_version='1.0') then
    raise exception 'authoritative product/release mutations were not committed';
  end if;
  select * into v_commit from public.commit_product_import_atomic(
    v_org,v_actor,v_job,v_hash,(select commit_idempotency_key from public.product_import_jobs where id=v_job));
  if v_commit.outcome<>'replayed' then raise exception 'commit replay was not idempotent'; end if;
end $$;
rollback;

begin;
do $$
declare
  v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_actor uuid; v_entity uuid; v_job uuid:=gen_random_uuid();
  v_first_code text:='ROLLBACK-A-'||gen_random_uuid()::text;
  v_raced_code text:='ROLLBACK-B-'||gen_random_uuid()::text;
  v_hash text:=repeat('d',64); v_claim record; v_commit record; v_rows jsonb;
begin
  select id into v_actor from public.users where email='owner@cra.test';
  select id into v_entity from public.organization_legal_entities
    where organization_id=v_org and is_default;
  perform * from public.create_product_import_job(v_org,v_actor,v_job,gen_random_uuid(),v_hash,
    'race.csv',100,v_org::text||'/'||v_job::text||'/source.csv',gen_random_uuid());
  select * into v_claim from public.claim_product_import_job_by_id(v_org,v_job,'sql-race',60);
  v_rows:=jsonb_build_array(
    jsonb_build_object('id',gen_random_uuid(),'sourceRowNumber',2,'rowHash',repeat('e',64),
      'rowType','product','proposedAction','create','result','planned',
      'productInternalCode',v_first_code,'productInternalCodeNormalized',lower(v_first_code),
      'proposed',jsonb_build_object('name','Must roll back','internalCode',v_first_code,
        'productType','standalone_software','responsibleOwnerId',v_actor,'legalEntityId',v_entity),'issues','[]'::jsonb),
    jsonb_build_object('id',gen_random_uuid(),'sourceRowNumber',3,'rowHash',repeat('f',64),
      'rowType','product','proposedAction','create','result','planned',
      'productInternalCode',v_raced_code,'productInternalCodeNormalized',lower(v_raced_code),
      'proposed',jsonb_build_object('name','Raced product','internalCode',v_raced_code,
        'productType','standalone_software','responsibleOwnerId',v_actor,'legalEntityId',v_entity),'issues','[]'::jsonb));
  perform * from public.save_product_import_rows_page(v_org,v_job,'sql-race',v_hash,v_rows);
  perform * from public.complete_product_import_dry_run(v_org,v_job,'sql-race',v_hash,2,2,0,0,0,0,0,
    v_org::text||'/'||v_job::text||'/report.csv',null);

  -- Simulate an identity race after the validated snapshot.
  perform * from public.create_product_atomic(v_org,v_actor,gen_random_uuid(),'Concurrent product',
    v_raced_code,'standalone_software',null,v_actor,v_entity);
  select * into v_commit from public.commit_product_import_atomic(v_org,v_actor,v_job,v_hash,gen_random_uuid());
  if v_commit.outcome<>'stale_conflict' then raise exception 'race did not become stale'; end if;
  if exists(select 1 from public.products where organization_id=v_org and internal_code=v_first_code) then
    raise exception 'first row survived failed all-or-nothing commit'; end if;
  if (select count(*) from public.products where organization_id=v_org and internal_code=v_raced_code)<>1 then
    raise exception 'concurrent product was damaged'; end if;
  if exists(select 1 from public.product_import_rows where import_id=v_job and result='committed') then
    raise exception 'row results survived rolled-back subtransaction'; end if;
end $$;
rollback;

begin;
do $$
declare
  v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_actor uuid; v_owner uuid; v_entity uuid; v_product uuid; v_product_version integer;
  v_job uuid:=gen_random_uuid(); v_code text:='REVALIDATE-'||gen_random_uuid()::text;
  v_hash text:=repeat('9',64); v_claim record; v_commit record;
begin
  select id into v_actor from public.users where email='owner@cra.test';
  select id into v_owner from public.users where email='member@cra.test';
  select id into v_entity from public.organization_legal_entities
    where organization_id=v_org and is_default;

  perform * from public.create_product_atomic(v_org,v_actor,gen_random_uuid(),
    'Revalidation product',v_code,'standalone_software',null,v_owner,v_entity);
  select id,version into v_product,v_product_version from public.products
    where organization_id=v_org and internal_code=v_code;
  perform * from public.create_product_import_job(v_org,v_actor,v_job,gen_random_uuid(),v_hash,
    'revalidate-owner.csv',100,v_org::text||'/'||v_job::text||'/source.csv',gen_random_uuid());
  select * into v_claim from public.claim_product_import_job_by_id(v_org,v_job,'sql-revalidate',60);
  perform * from public.save_product_import_rows_page(v_org,v_job,'sql-revalidate',v_hash,
    jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid(),'sourceRowNumber',2,'rowHash',repeat('8',64),
      'rowType','product','proposedAction','unchanged','result','planned',
      'productInternalCode',v_code,'productInternalCodeNormalized',lower(v_code),
      'productId',v_product,'expectedProductVersion',v_product_version,
      'proposed','{}'::jsonb,'issues','[]'::jsonb)));
  perform * from public.complete_product_import_dry_run(v_org,v_job,'sql-revalidate',v_hash,
    1,0,0,1,0,0,0,v_org::text||'/'||v_job::text||'/report.csv',null);

  update public.users set is_active=false where id=v_owner;
  select * into v_commit from public.commit_product_import_atomic(v_org,v_actor,v_job,v_hash,gen_random_uuid());
  if v_commit.outcome<>'stale_conflict'
     or (select error_code from public.product_import_jobs where id=v_job)<>'authorization_changed' then
    raise exception 'inactive responsible owner was not revalidated at commit';
  end if;
  if exists(select 1 from public.product_import_rows where import_id=v_job and result='committed') then
    raise exception 'owner revalidation failure committed a row';
  end if;
end $$;
rollback;

begin;
do $$
declare
  v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_actor uuid; v_entity uuid; v_product uuid; v_product_version integer;
  v_job uuid:=gen_random_uuid(); v_code text:='ENTITY-REVALIDATE-'||gen_random_uuid()::text;
  v_hash text:=repeat('7',64); v_claim record; v_commit record;
begin
  select id into v_actor from public.users where email='owner@cra.test';
  select id into v_entity from public.organization_legal_entities
    where organization_id=v_org and is_default;

  perform * from public.create_product_atomic(v_org,v_actor,gen_random_uuid(),
    'Entity revalidation product',v_code,'standalone_software',null,v_actor,v_entity);
  select id,version into v_product,v_product_version from public.products
    where organization_id=v_org and internal_code=v_code;
  perform * from public.create_product_import_job(v_org,v_actor,v_job,gen_random_uuid(),v_hash,
    'revalidate-entity.csv',100,v_org::text||'/'||v_job::text||'/source.csv',gen_random_uuid());
  select * into v_claim from public.claim_product_import_job_by_id(v_org,v_job,'sql-revalidate',60);
  perform * from public.save_product_import_rows_page(v_org,v_job,'sql-revalidate',v_hash,
    jsonb_build_array(jsonb_build_object(
      'id',gen_random_uuid(),'sourceRowNumber',2,'rowHash',repeat('6',64),
      'rowType','product','proposedAction','unchanged','result','planned',
      'productInternalCode',v_code,'productInternalCodeNormalized',lower(v_code),
      'productId',v_product,'expectedProductVersion',v_product_version,
      'proposed','{}'::jsonb,'issues','[]'::jsonb)));
  perform * from public.complete_product_import_dry_run(v_org,v_job,'sql-revalidate',v_hash,
    1,0,0,1,0,0,0,v_org::text||'/'||v_job::text||'/report.csv',null);

  update public.organization_legal_entities set status='inactive' where id=v_entity;
  select * into v_commit from public.commit_product_import_atomic(v_org,v_actor,v_job,v_hash,gen_random_uuid());
  if v_commit.outcome<>'stale_conflict'
     or (select error_code from public.product_import_jobs where id=v_job)<>'authorization_changed' then
    raise exception 'inactive legal entity was not revalidated at commit';
  end if;
  if exists(select 1 from public.product_import_rows where import_id=v_job and result='committed') then
    raise exception 'legal-entity revalidation failure committed a row';
  end if;
end $$;
rollback;

select pg_temp.check('import query plans remain tenant- and import-index bounded',
  position('product_import_rows_page_idx' in pg_temp.import_page_plan(
    '00000000-0000-4000-8000-0000000000ca'::uuid,gen_random_uuid()))>0
);
