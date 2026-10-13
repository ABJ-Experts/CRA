-- Source-owned quota admissions and downgrade preservation, rollback only.
begin;
set local statement_timeout='30s';
create function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$ begin if not coalesce(ok,false) then raise exception 'M15 growth check failed: %',label;end if;end $$;
do $$ declare o uuid:=gen_random_uuid();u uuid;v uuid;email text;le uuid:=gen_random_uuid();p uuid;i uuid;a jsonb;j uuid:=gen_random_uuid();claim record;begin
 select id into strict u from public.users where is_active and email_verified_at is not null limit 1;
 select id,users.email into strict v,email from public.users where is_active and email_verified_at is not null and id<>u limit 1;
 insert into public.organizations(id,name,slug)values(o,'M15 growth rollback fixture','m15-growth-'||o);
 insert into public.organization_members(organization_id,user_id,role)values(o,u,'owner');
 a:=jsonb_build_object('schemaVersion',1,'licenseId',gen_random_uuid(),'sequence',1,'issuer','fixture','organizationId',o,'instanceId',gen_random_uuid(),'issuedAt',clock_timestamp()-interval '1 day','startsAt',clock_timestamp()-interval '1 day','expiresAt',clock_timestamp()+interval '1 day','graceDays',30,'entitlements',jsonb_build_array('administration','products'),'limits',jsonb_build_object('activeMembers',2,'products',1,'storageBytes',null));
 -- Direct privileged fixture state exercises SQL authority only. API signature
 -- validation has separate dynamically signed tests and no production bypass.
 insert into public.organization_license_states(organization_id,artifact,artifact_digest,artifact_object_path,verified_claims,issuance_sequence,version,time_high_water_at,verification_version,verification_artifact_digest,verification_valid,effective_capabilities,policy_revision,configuration_digest,verification_checked_at)
 values(o,'fixture',repeat('a',64),o::text||'/'||repeat('a',64)||'.jws',a,1,1,clock_timestamp(),1,repeat('a',64),true,a->'entitlements',1,repeat('b',64),clock_timestamp());

 insert into public.product_import_jobs(id,organization_id,actor_user_id,commit_actor_user_id,schema_version,status,work_kind,upload_idempotency_key,upload_request_digest,commit_idempotency_key,commit_request_digest,content_hash,original_filename,source_object_path,byte_size,row_count,processed_row_count,create_count,dry_run_completed_at,correlation_id,expires_at,retention_until)
 values(j,o,u,u,'m2-product-release-import-v1','queued','commit',gen_random_uuid(),repeat('c',64),gen_random_uuid(),repeat('d',64),repeat('e',64),'fixture.csv',o::text||'/'||j::text||'/source.csv',100,2,2,2,clock_timestamp(),gen_random_uuid(),clock_timestamp()+interval '1 day',clock_timestamp()+interval '7 days');
 insert into public.product_import_rows(organization_id,import_id,source_row_number,row_hash,row_type,proposed_action,result,proposed)
 values(o,j,2,repeat('f',64),'product','create','planned','{}'),(o,j,3,repeat('a',64),'product','create','planned','{}');
 select * into claim from public.claim_product_import_job(o,'quota-fixture',60);
 perform pg_temp.check('capacity denies before global source claim',claim.outcome='empty');
 select * into claim from public.claim_product_import_job_by_id(o,j,'quota-fixture',60);
 perform pg_temp.check('capacity denies before direct source claim',claim.outcome='empty');
 perform pg_temp.check('no attempt, lease, or planned-row loss on quota pause',exists(select 1 from public.product_import_jobs where id=j and status='queued' and retry_count=0 and lease_owner is null) and (select count(*) from public.product_import_rows where import_id=j and result='planned')=2);
 update public.organization_license_states set verified_claims=jsonb_set(verified_claims,'{limits,products}','2') where organization_id=o;
 select * into claim from public.claim_product_import_job_by_id(o,j,'quota-fixture',60);
 perform pg_temp.check('fresh capacity resumes source work',claim.outcome='claimed');
 perform pg_temp.check('resume preserves retry count',exists(select 1 from public.product_import_jobs where id=j and status='committing' and retry_count=0));
 update public.product_import_jobs set commit_request_digest=encode(extensions.digest(jsonb_build_object('importId',j,'contentHash',repeat('e',64))::text,'sha256'),'hex') where id=j;
 update public.organization_license_states set verification_valid=false where organization_id=o;
 select * into claim from public.commit_product_import_atomic(o,u,gen_random_uuid(),repeat('e',64),gen_random_uuid());
 perform pg_temp.check('unknown import retains source not_found during expiry',claim.outcome='not_found');
 select * into claim from public.commit_product_import_atomic(o,v,j,repeat('e',64),gen_random_uuid());
 perform pg_temp.check('nonmember cannot release claimed import during expiry',claim.outcome='invalid_request' and exists(select 1 from public.product_import_jobs where id=j and status='committing' and lease_owner='quota-fixture'));
 select * into claim from public.commit_product_import_atomic(o,u,j,repeat('e',64),(select commit_idempotency_key from public.product_import_jobs where id=j));
 perform pg_temp.check('expiry after claim releases outer import lease without retry loss',claim.outcome='retrying' and exists(select 1 from public.product_import_jobs where id=j and status='retrying' and retry_count=0 and lease_owner is null and error_code is null));
 perform pg_temp.check('paused import leaves no failure audit',not exists(select 1 from public.audit_logs where organization_id=o and action='product_import.commit_stale'));
 update public.organization_license_states set verification_valid=true,verification_checked_at=clock_timestamp() where organization_id=o;
 select * into claim from public.claim_product_import_job_by_id(o,j,'quota-fixture-resumed',60);
 perform pg_temp.check('fresh verification resumes paused outer import',claim.outcome='claimed');
 perform pg_temp.check('exact source SQL denial release branch installed',strpos((select prosrc from pg_proc where oid='public.commit_product_import_rows_atomic(uuid,uuid,uuid,text,uuid)'::regprocedure),'sqlstate=''42501''')>0);
end $$;
rollback;
