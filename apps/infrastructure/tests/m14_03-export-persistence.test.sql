-- Rollback-only M14-03 assertions. No existing jobs or user data are changed.
begin;
set local statement_timeout='30s';
create function pg_temp.check(p_name text,p_ok boolean) returns void language plpgsql as $$ begin
 if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;
select pg_temp.check('persistent export jobs exist',to_regclass('public.export_jobs') is not null);
select pg_temp.check('immutable export rows exist',to_regclass('public.export_snapshot_rows') is not null);
select pg_temp.check('private storage bucket exists',exists(select 1 from storage.buckets where id='filtered-exports' and not public));
select pg_temp.check('exports preserve native storage object versioning',to_regclass('storage.objects_bucket_id_name_compat_key') is null);
select pg_temp.check('RLS remains nonforced',not exists(select 1 from pg_class where oid in ('public.export_jobs'::regclass,'public.export_snapshot_rows'::regclass) and (not relrowsecurity or relforcerowsecurity)));
select pg_temp.check('browser roles have no table grants',not has_table_privilege('authenticated','public.export_jobs','select') and not has_table_privilege('anon','public.export_snapshot_rows','select'));
select pg_temp.check('service table grants explicitly exclude destructive frozen evidence',
 has_table_privilege('service_role','public.export_jobs','select,insert,update')
 and not has_table_privilege('service_role','public.export_jobs','delete,truncate,references,trigger')
 and has_table_privilege('service_role','public.export_snapshot_rows','select,insert')
 and not has_table_privilege('service_role','public.export_snapshot_rows','update,delete,truncate,references,trigger'));
select pg_temp.check('registry authorization keeps typed UUID lookup',position('p.id=r.product_id and p.id::text=r.source_id' in pg_get_functiondef('public.m14_03_snapshot_access(public.export_jobs)'::regprocedure))>0);
select pg_temp.check('registry uses one combined product authorization pass before generic domain pass',position($$if p_job.source in ('products','products.registry')$$ in pg_get_functiondef('public.m14_03_snapshot_access(public.export_jobs)'::regprocedure))<position('r.product_id is not null' in pg_get_functiondef('public.m14_03_snapshot_access(public.export_jobs)'::regprocedure)));
select pg_temp.check('mutable export job uses canonical timestamp trigger only',exists(select 1 from pg_trigger where tgrelid='public.export_jobs'::regclass and not tgisinternal and tgfoid='public.set_updated_at'::regproc)
 and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='export_snapshot_rows' and column_name='updated_at')
 and not has_function_privilege('authenticated','public.set_updated_at()','execute'));
select pg_temp.check('create is service-only',not has_function_privilege('authenticated','public.m14_03_create_export(uuid,uuid,uuid,jsonb)','execute') and has_function_privilege('service_role','public.m14_03_create_export(uuid,uuid,uuid,jsonb)','execute'));
rollback;

begin;
set local statement_timeout='30s';
create function pg_temp.check(p_name text,p_ok boolean) returns void language plpgsql as $$ begin
 if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;
do $$
declare v_org uuid:=gen_random_uuid(); v_user uuid; v_session uuid; v_legal uuid:=gen_random_uuid(); v_product uuid:=gen_random_uuid();
 v_input jsonb; v_job jsonb; v_claim jsonb; v_capture jsonb; v_rows jsonb; v_key uuid:=gen_random_uuid(); v_jobid uuid; v_cancel_key uuid:=gen_random_uuid(); v_part jsonb; v_grant jsonb; v_artifact_id uuid:=gen_random_uuid(); v_token_digest text:=repeat('a',64);
begin
 select u.id,s.id into strict v_user,v_session from public.users u join public.organization_members m on m.user_id=u.id and m.role='owner'
 join auth.sessions s on s.user_id=u.auth_user_id where u.is_active and (s.not_after is null or s.not_after>clock_timestamp()) order by s.created_at desc limit 1;
 insert into public.organizations(id,name,slug) values(v_org,'M14 export rollback fixture','m14-export-'||v_org::text);
 insert into public.organization_members(organization_id,user_id,role) values(v_org,v_user,'owner');
 insert into public.organization_session_bindings(organization_id,session_id,user_id,issued_at,last_seen_at) values(v_org,v_session,v_user,clock_timestamp(),clock_timestamp());
 insert into public.organization_legal_entities(id,organization_id,identifier,display_name,legal_name,registered_address_line_1,registered_address_locality,registered_address_postal_code,registered_address_country,main_establishment_country,manufacturer_contact_name,manufacturer_contact_email,created_by,updated_by) values(v_legal,v_org,'m14-fixture','M14 fixture','M14 fixture','1 Test','Test','12345','DE','DE','Test','m14@example.test',v_user,v_user);
 insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
 values(v_product,v_org,v_legal,0,'{}','Original Ω fixture','=SUM(A1:A2)','standalone_software',v_user,v_user,v_user);
 perform public.m14_03_registry_capture_preflight(v_org,v_user,'{}');
 begin perform public.m14_03_registry_capture_preflight(gen_random_uuid(),v_user,'{}');raise exception 'forged tenant learned registry size';exception when insufficient_privilege then null;end;
 perform pg_temp.check('bounded preflight remains service-only',not has_function_privilege('authenticated','public.m14_03_registry_capture_preflight(uuid,uuid,jsonb)','execute'));
 v_input:=jsonb_build_object('source','products.registry','format','csv','scope','all_filtered','filters',jsonb_build_object('q','Original','page',1,'pageSize',25),'context','{}'::jsonb,'idempotencyKey',v_key);
 v_job:=public.m14_03_create_export(v_org,v_user,v_session,v_input); v_jobid:=(v_job->>'id')::uuid;
 update public.export_jobs set updated_at='2000-01-01'::timestamptz where organization_id=v_org and id=v_jobid;
 perform pg_temp.check('canonical trigger changes timestamp without state/version changes',exists(select 1 from public.export_jobs where organization_id=v_org and id=v_jobid and updated_at=now() and state='queued' and version=(v_job->>'version')::integer));
 perform pg_temp.check('queue response contains no private row data',v_job->>'state'='queued' and not v_job ? 'filters' and not v_job ? 'requestDigest' and v_job->'rowCount'='null');
 perform pg_temp.check('same request is durable idempotent',public.m14_03_create_export(v_org,v_user,v_session,v_input)->>'id'=v_jobid::text);
 begin perform public.m14_03_create_export(v_org,v_user,v_session,v_input||'{"format":"xlsx"}'); raise exception 'idempotency mismatch accepted'; exception when serialization_failure then null; end;
 begin perform public.m14_03_create_export(v_org,v_user,v_session,v_input||jsonb_build_object('columns',jsonb_build_array('password'),'idempotencyKey',gen_random_uuid())); raise exception 'hidden column accepted'; exception when invalid_parameter_value then null; end;
 -- Only this newly created tenant's jobs are prioritized. No unrelated job is
 -- modified, claimed or reprioritized by these fixtures.
 update public.export_jobs set requested_at='1970-01-01',updated_at='-infinity' where organization_id=v_org;
 v_claim:=public.m14_03_claim_export('m14-fixture-original');
 perform pg_temp.check('fixture was claimed',v_claim->'publicJob'->>'id'=v_jobid::text);
 v_capture:=public.m14_03_capture_export(v_org,v_jobid,'m14-fixture-original',(v_claim->>'version')::integer);
 perform pg_temp.check('capture is unpublished with one frozen row',v_capture->'publicJob'->>'state'='audit_pending' and (v_capture->>'totalRows')::integer=1);
 begin perform public.m14_03_read_export_rows(v_org,v_jobid,'m14-fixture-original',(v_capture->>'version')::integer,0,250); raise exception 'unpublished evidence rendered'; exception when serialization_failure then null; end;
 update public.products set name='Concurrent changed value',version=version+1 where organization_id=v_org and id=v_product;
 v_capture:=public.m14_03_publish_capture(v_org,v_jobid,'m14-fixture-original',(v_capture->>'version')::integer);
 v_rows:=public.m14_03_read_export_rows(v_org,v_jobid,'m14-fixture-original',(v_capture->>'version')::integer,0,250);
 perform pg_temp.check('mutated source preserves captured Unicode value',v_rows->0->'values'->>'name'='Original Ω fixture');
 begin update public.export_snapshot_rows set row_values='{}' where organization_id=v_org and job_id=v_jobid; raise exception 'snapshot updated'; exception when object_not_in_prerequisite_state then null; end;
 -- Restart resumes immutable values and invalidates the previous worker.
 update public.export_jobs set lease_expires_at=clock_timestamp()-interval '1 second',updated_at='-infinity' where organization_id=v_org and id=v_jobid;
 v_claim:=public.m14_03_claim_export('m14-fixture-restarted');
 perform pg_temp.check('restart retains capture and increments attempt',(v_claim->'publicJob'->>'id')::uuid=v_jobid and (select attempts=2 from public.export_jobs where id=v_jobid) and v_claim->>'snapshotAsOf'=v_capture->>'snapshotAsOf');
 begin perform public.m14_03_heartbeat_export(v_org,v_jobid,'m14-fixture-original',(v_capture->>'version')::integer); raise exception 'old worker accepted'; exception when serialization_failure then null; end;
 begin perform public.m14_03_get_export(gen_random_uuid(),v_user,v_session,v_jobid); raise exception 'forged tenant accepted'; exception when insufficient_privilege then null; end;
 -- Roll back only this fixture's temporary permission revocation.
 begin
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(v_org,'owner','{"can_export_products":false}');
 begin perform public.m14_03_get_export(v_org,v_user,v_session,v_jobid); raise exception 'revoked subject learned job count'; exception when insufficient_privilege then null; end;
 raise exception using errcode='P0002',message='fixture revocation rollback'; exception when no_data_found then null; end;
 v_part:=jsonb_build_object('id',v_artifact_id,'name','fixture.csv','mediaType','text/csv','byteLength',8,'sha256',repeat('b',64),'rowCount',1,'objectPath',v_org||'/'||v_jobid||'/fixture.csv','startOrdinal',1,'endOrdinal',1);
 begin perform public.m14_03_checkpoint_export(v_org,v_jobid,'m14-fixture-restarted',(v_claim->>'version')::integer,jsonb_build_array(v_part-'objectPath'),1); raise exception 'missing private object path accepted'; exception when invalid_parameter_value then null; end;
 v_claim:=public.m14_03_checkpoint_export(v_org,v_jobid,'m14-fixture-restarted',(v_claim->>'version')::integer,jsonb_build_array(v_part),1);
 v_claim:=public.m14_03_complete_export(v_org,v_jobid,'m14-fixture-restarted',(v_claim->>'version')::integer,jsonb_build_object('version','m14_03_v1','jobId',v_jobid,'source','products.registry','requestedAt',v_claim->>'requestedAt','snapshotAsOf',v_claim->>'snapshotAsOf','scope','all_filtered','requestDigest',v_claim->>'requestDigest','rowCount',1,'columns',v_claim->'columns','artifacts',v_claim->'publicJob'->'artifacts','sourceVersionsDigest',v_claim->>'sourceVersionsDigest','documentationReadinessOnly',false));
 perform pg_temp.check('ready metadata delivers frozen public manifest',public.m14_03_get_export(v_org,v_user,v_session,v_jobid)->'manifest'->>'jobId'=v_jobid::text
 and not ((public.m14_03_get_export(v_org,v_user,v_session,v_jobid)#>'{manifest,artifacts,0}') ? 'objectPath'));
 v_job:=public.m14_03_get_export_manifest(v_org,v_user,v_session,v_jobid);
 perform pg_temp.check('manifest delivery is durably audited',v_job->>'jobId'=v_jobid::text and exists(select 1 from public.audit_logs where organization_id=v_org and action='exports.manifest_downloaded'));
 perform pg_temp.check('public artifact projection excludes private storage path',not ((v_claim->'publicJob'->'artifacts'->0) ? 'objectPath'));
 begin
 delete from public.products where organization_id=v_org and id=v_product;
 begin perform public.m14_03_get_export(v_org,v_user,v_session,v_jobid);raise exception 'deleted product metadata delivered';exception when insufficient_privilege then null;end;
 raise exception using errcode='P0002',message='deleted product fixture rollback';exception when no_data_found then null;end;
 begin
 insert into public.export_snapshot_rows(organization_id,job_id,ordinal,source_id,source_version,product_id,row_values,row_digest)
 values(v_org,v_jobid,2,'invalid_uuid_identity','1',v_product,'{}',repeat('f',64));
 begin perform public.m14_03_get_export(v_org,v_user,v_session,v_jobid);raise exception 'forged frozen identity delivered';exception when insufficient_privilege then null;end;
 raise exception using errcode='P0002',message='forged snapshot fixture rollback';exception when no_data_found then null;end;
 begin
 insert into public.export_snapshot_rows(organization_id,job_id,ordinal,source_id,source_version,product_id,row_values,row_digest)
 values(v_org,v_jobid,2,v_product::text,'1',null,'{}',repeat('f',64));
 begin perform public.m14_03_get_export(v_org,v_user,v_session,v_jobid);raise exception 'null registry product scope delivered';exception when insufficient_privilege then null;end;
 raise exception using errcode='P0002',message='null snapshot scope rollback';exception when no_data_found then null;end;
 begin
 insert into public.export_snapshot_rows(organization_id,job_id,ordinal,source_id,source_version,product_id,row_values,row_digest)
 select v_org,v_jobid,2,p.id::text,'1',p.id,'{}',repeat('f',64) from public.products p where p.organization_id<>v_org limit 1;
 if not found then raise exception 'foreign product authorization fixture missing';end if;
 begin perform public.m14_03_get_export(v_org,v_user,v_session,v_jobid);raise exception 'cross-tenant frozen product delivered';exception when insufficient_privilege then null;end;
 raise exception using errcode='P0002',message='foreign snapshot scope rollback';exception when no_data_found then null;end;
 v_grant:=public.m14_03_issue_export_download_grant(v_org,v_user,v_session,v_jobid,v_artifact_id,v_token_digest);
 perform pg_temp.check('grant lifetime is at most five minutes',(v_grant->>'expiresAt')::timestamptz<=clock_timestamp()+interval '5 minutes');
 begin
 insert into public.organization_session_revocations(organization_id,session_id,user_id,reason,lifecycle_version,revoked_at) values(v_org,v_session,v_user,'membership_revoked',1,clock_timestamp());
 begin perform public.m14_03_redeem_export_download_grant(v_org,v_user,v_session,v_jobid,(v_grant->>'grantId')::uuid,v_token_digest); raise exception 'revoked identity downloaded'; exception when insufficient_privilege then null; end;
 raise exception using errcode='P0002',message='fixture session revoke rollback'; exception when no_data_found then null; end;
 perform pg_temp.check('large integer remains exact text',public.m14_03_export_scalar('9007199254740993'::jsonb)='"9007199254740993"'::jsonb);
 perform pg_temp.check('decimal remains exact text',public.m14_03_export_scalar('0.123456789012345678901'::jsonb)='"0.123456789012345678901"'::jsonb);
 perform pg_temp.check('safe row count remains typed number',public.m14_03_export_scalar('100000'::jsonb)='100000'::jsonb);
 -- Withdrawal of previously approved columns revokes metadata and minted grants.
 begin
 execute $policy$create or replace function public.m14_03_source_policy(p_source text) returns jsonb language sql immutable set search_path=pg_catalog,public as $body$
 select '{"permissions":["can_view_products","can_export_products"],"columns":["id"],"subjectKind":"member"}'::jsonb
 $body$ $policy$;
 begin perform public.m14_03_get_export(v_org,v_user,v_session,v_jobid);raise exception 'removed fields disclosed metadata';exception when insufficient_privilege then null;end;
 begin perform public.m14_03_redeem_export_download_grant(v_org,v_user,v_session,v_jobid,(v_grant->>'grantId')::uuid,v_token_digest);raise exception 'removed fields delivered';exception when insufficient_privilege then null;end;
 begin perform public.m14_03_get_export_manifest(v_org,v_user,v_session,v_jobid);raise exception 'removed fields manifest delivered';exception when insufficient_privilege then null;end;
 raise exception using errcode='P0002',message='fixture field policy rollback';exception when no_data_found then null;end;
 -- An existing member artifact cannot survive a source identity-kind change.
 begin
 execute format('create or replace function public.m14_03_source_policy(p_source text) returns jsonb language sql immutable set search_path=pg_catalog,public as %L',
 'select '||quote_literal((public.m14_03_source_policy('products.registry')||'{"subjectKind":"supplier_session"}')::text)||'::jsonb');
 begin perform public.m14_03_get_export(v_org,v_user,v_session,v_jobid);raise exception 'changed subject disclosed metadata';exception when insufficient_privilege then null;end;
 begin perform public.m14_03_redeem_export_download_grant(v_org,v_user,v_session,v_jobid,(v_grant->>'grantId')::uuid,v_token_digest);raise exception 'changed subject delivered';exception when insufficient_privilege then null;end;
 raise exception using errcode='P0002',message='fixture subject policy rollback';exception when no_data_found then null;end;
 -- Availability expires even while the worker is idle; no rows are deleted.
 begin
 update public.export_jobs set expires_at=clock_timestamp()-interval '1 second' where organization_id=v_org and id=v_jobid;
 perform pg_temp.check('idle ready job is expired',public.m14_03_get_export(v_org,v_user,v_session,v_jobid)->>'state'='expired');
 begin perform public.m14_03_redeem_export_download_grant(v_org,v_user,v_session,v_jobid,(v_grant->>'grantId')::uuid,v_token_digest);raise exception 'expired artifact delivered';exception when insufficient_privilege then null;end;
 update public.export_jobs set state='failed',failure_code='storage_unavailable' where organization_id=v_org and id=v_jobid;
 perform pg_temp.check('expired failure is not retryable',(public.m14_03_get_export(v_org,v_user,v_session,v_jobid)#>>'{failure,retryable}')='false');
 perform pg_temp.check('expiry retains protected capture',exists(select 1 from public.export_snapshot_rows where organization_id=v_org and job_id=v_jobid));
 raise exception using errcode='P0002',message='fixture availability rollback';exception when no_data_found then null;end;
 perform pg_temp.check('authorized grant returns private locator only to service',public.m14_03_redeem_export_download_grant(v_org,v_user,v_session,v_jobid,(v_grant->>'grantId')::uuid,v_token_digest)->'artifact'->>'objectPath'=v_part->>'objectPath');
 begin perform public.m14_03_redeem_export_download_grant(v_org,v_user,v_session,v_jobid,(v_grant->>'grantId')::uuid,v_token_digest); raise exception 'grant replay accepted'; exception when insufficient_privilege then null; end;
 -- Actual worker transient codes remain retryable, integrity mismatches do not.
 update public.export_jobs set state='failed',failure_code='provider_unavailable',worker_id=null,lease_expires_at=null,version=version+1 where organization_id=v_org and id=v_jobid returning public.m14_03_private_job_json(export_jobs) into v_claim;
 if v_claim#>>'{publicJob,failure,retryable}'<>'true' then raise exception 'provider unavailable not retryable';end if;
 v_job:=public.m14_03_retry_export(v_org,v_user,v_session,v_jobid,(v_claim->>'version')::integer,gen_random_uuid());
 update public.export_jobs set state='failed',failure_code='storage_unavailable',version=version+1 where organization_id=v_org and id=v_jobid returning public.m14_03_private_job_json(export_jobs) into v_claim;
 if v_claim#>>'{publicJob,failure,retryable}'<>'true' then raise exception 'storage unavailable not retryable';end if;
 v_job:=public.m14_03_retry_export(v_org,v_user,v_session,v_jobid,(v_claim->>'version')::integer,gen_random_uuid());
 update public.export_jobs set state='failed',failure_code='storage_integrity_failed',version=version+1 where organization_id=v_org and id=v_jobid returning public.m14_03_private_job_json(export_jobs) into v_claim;
 if v_claim#>>'{publicJob,failure,retryable}'<>'false' then raise exception 'integrity failure retryable';end if;
 begin perform public.m14_03_retry_export(v_org,v_user,v_session,v_jobid,(v_claim->>'version')::integer,gen_random_uuid());raise exception 'integrity retry accepted';exception when serialization_failure then null;end;
 -- Explicit user retry starts another bounded run and preserves frozen values.
 update public.export_jobs set state='failed',failure_code='attempts_exhausted',attempts=3,version=version+1,updated_at='-infinity' where organization_id=v_org and id=v_jobid returning public.m14_03_private_job_json(export_jobs) into v_claim;
 v_job:=public.m14_03_retry_export(v_org,v_user,v_session,v_jobid,(v_claim->>'version')::integer,gen_random_uuid());
 perform pg_temp.check('explicit retry resets bounded run attempts',(select attempts=0 and row_count=1 from public.export_jobs where organization_id=v_org and id=v_jobid));
 v_claim:=public.m14_03_claim_export('m14-fixture-retry');
 perform pg_temp.check('exhausted restart is claimable and retains frozen data',v_claim->'publicJob'->>'id'=v_jobid::text and v_claim->'publicJob'->>'state'='rendering' and (v_claim->>'totalRows')::integer=1);
 v_job:=public.m14_03_cancel_export(v_org,v_user,v_session,v_jobid,(v_claim->>'version')::integer,v_cancel_key);
 perform pg_temp.check('cancel is durable idempotent',public.m14_03_cancel_export(v_org,v_user,v_session,v_jobid,(v_claim->>'version')::integer,v_cancel_key)->>'state'='cancelled');
 -- Raw PostgreSQL precision survives capture hashing and the actual rows RPC.
 begin
 v_job:=public.m14_03_create_export(v_org,v_user,v_session,v_input||jsonb_build_object('idempotencyKey',gen_random_uuid(),'filters','{}'::jsonb));
 v_jobid:=(v_job->>'id')::uuid;
 update public.export_jobs set requested_at='1970-01-01',updated_at='-infinity' where organization_id=v_org and id=v_jobid;
 v_claim:=public.m14_03_claim_export('m14-precision-fixture');
 execute $source$create or replace function public.m14_03_source_rows(p_organization_id uuid,p_actor_user_id uuid,p_source text,p_filters jsonb,p_context jsonb)
 returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=pg_catalog,public as $body$
 select p.id::text,'9007199254740993',p.id,jsonb_build_object('id',p.id,'name',9007199254740993::numeric,'internalCode',0.123456789012345678901::numeric) from public.products p where p.organization_id=p_organization_id
 $body$ $source$;
 v_capture:=public.m14_03_capture_export(v_org,v_jobid,'m14-precision-fixture',(v_claim->>'version')::integer);
 v_capture:=public.m14_03_publish_capture(v_org,v_jobid,'m14-precision-fixture',(v_capture->>'version')::integer);
 v_rows:=public.m14_03_read_export_rows(v_org,v_jobid,'m14-precision-fixture',(v_capture->>'version')::integer,0,250);
 perform pg_temp.check('precision protected before rows RPC',v_rows#>'{0,values,name}'='"9007199254740993"'::jsonb and v_rows#>'{0,values,internalCode}'='"0.123456789012345678901"'::jsonb);
 perform pg_temp.check('precision frozen digest matches returned values',v_rows#>>'{0,sha256}'=encode(extensions.digest(convert_to(public.m13_02_canonical_json(v_rows#>'{0,values}'),'UTF8'),'sha256'),'hex'));
 raise exception using errcode='P0002',message='precision fixture rollback';exception when no_data_found then null;end;
 -- A bounded synthetic source isolates overflow semantics without creating
 -- 100,001 business records or exposing unrelated tenant data.
 v_job:=public.m14_03_create_export(v_org,v_user,v_session,v_input||jsonb_build_object('idempotencyKey',gen_random_uuid(),'filters','{}'::jsonb));
 v_jobid:=(v_job->>'id')::uuid;
 update public.export_jobs set requested_at='1970-01-01',updated_at='-infinity' where organization_id=v_org and id=v_jobid;
 v_claim:=public.m14_03_claim_export('m14-overflow-fixture');
 execute $source$create or replace function public.m14_03_source_rows(p_organization_id uuid,p_actor_user_id uuid,p_source text,p_filters jsonb,p_context jsonb)
 returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=pg_catalog,public as $body$
 select g::text,'1',null::uuid,jsonb_build_object('id',g::text,'name','Bounded overflow fixture') from generate_series(1,100001) g
 $body$ $source$;
 begin perform public.m14_03_capture_export(v_org,v_jobid,'m14-overflow-fixture',(v_claim->>'version')::integer);raise exception 'oversized result accepted';exception when program_limit_exceeded then null;end;
 if exists(select 1 from public.export_snapshot_rows where organization_id=v_org and job_id=v_jobid) or exists(select 1 from public.export_jobs where organization_id=v_org and id=v_jobid and snapshot_as_of is not null) then raise exception 'failed overflow capture committed partial rows';end if;
 perform pg_temp.check('durable lifecycle audit exists',exists(select 1 from public.audit_logs where organization_id=v_org and action='exports.captured'));
end $$;
rollback;
