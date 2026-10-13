-- Source lease/quota races use privileged rollback fixture claims only.
begin;
set local statement_timeout='30s';
create function pg_temp.check(label text,ok boolean) returns void language plpgsql as $$ begin if not coalesce(ok,false) then raise exception 'M15 connector quota check failed: %',label;end if;end $$;
-- TEST ONLY: synthetic SQL admission inputs, not an authentic issuer artifact.
-- The runner inserts this after BEGIN in pre-M15 rollback regression suites.
-- All state, public trigger catalog entries and definition changes roll back.
-- M15 suites and cryptographic verifier tests never receive these fixtures.
create function pg_temp.m15_legacy_license(p_org uuid) returns void
language plpgsql set search_path=pg_catalog,public as $$
declare caps jsonb := '["administration","products","sboms","vulnerabilities","findings","reporting","technical_files","evidence","suppliers","frameworks","connectors","tasks","notifications","dashboards","scheduled_reports","portfolio","ai"]';
begin
 insert into public.organization_license_states
 (organization_id,artifact,artifact_digest,artifact_object_path,verified_claims,issuance_sequence,version,time_high_water_at,storage_accounting_ready,
 verification_version,verification_artifact_digest,verification_valid,effective_capabilities,policy_revision,configuration_digest,verification_checked_at)
 values (p_org,'M15 legacy rollback SQL fixture',repeat('d',64),p_org::text||'/'||repeat('d',64)||'.jws',
 jsonb_build_object('schemaVersion',1,'licenseId',gen_random_uuid(),'sequence',1,'issuer','rollback-test-fixture','organizationId',p_org,
 'instanceId',gen_random_uuid(),'issuedAt',clock_timestamp()-interval '1 day','startsAt',clock_timestamp()-interval '1 day',
 'expiresAt',clock_timestamp()+interval '1 day','graceDays',30,'entitlements',caps,
 'limits',jsonb_build_object('activeMembers',null,'products',null,'storageBytes',null)),1,1,clock_timestamp(),true,
 1,repeat('d',64),true,caps,1,repeat('e',64),clock_timestamp()) on conflict (organization_id) do update set
 artifact=excluded.artifact,artifact_digest=excluded.artifact_digest,artifact_object_path=excluded.artifact_object_path,
 verified_claims=excluded.verified_claims,issuance_sequence=excluded.issuance_sequence,version=excluded.version,
 time_high_water_at=excluded.time_high_water_at,clock_rollback_detected=false,storage_accounting_ready=true,
 verification_version=excluded.verification_version,verification_artifact_digest=excluded.verification_artifact_digest,
 verification_valid=true,effective_capabilities=excluded.effective_capabilities,policy_revision=excluded.policy_revision,
 configuration_digest=excluded.configuration_digest,verification_checked_at=excluded.verification_checked_at;
end $$;

create function pg_temp.field_diff(field text,value jsonb) returns jsonb language sql immutable as $$ select jsonb_build_object('field',field,'craValue',null,'externalValue',value,'authorityPolicyId',null,'permittedActions',jsonb_build_array('accept_external','keep_cra','enter_manual_value')) $$;
do $$ declare o uuid;u uuid;epoch bigint;e uuid:=gen_random_uuid();c uuid;c2 uuid;r uuid;r2 uuid;g integer;res record;cl record;audit_before bigint;key uuid:=gen_random_uuid();begin
 select id into strict u from public.users where is_active and email_verified_at is not null limit 1;
 insert into public.organizations(name,slug)values('M15 connector quota fixture','m15-connector-'||gen_random_uuid()) returning id into o;
 insert into public.organization_members(organization_id,user_id,role)values(o,u,'owner');
 perform pg_temp.m15_legacy_license(o);
 insert into public.organization_legal_entities(id,organization_id,identifier,display_name,completion_status,status,created_by,updated_by,legal_name,registered_address_line_1,registered_address_locality,registered_address_postal_code,registered_address_country,main_establishment_country,manufacturer_contact_name,manufacturer_contact_email)
 values(e,o,'fixture','Quota entity','complete','active',u,u,'Quota entity','1 Main','Local','12345','DE','DE','Fixture','fixture@cra.test');
 select version into epoch from public.organization_permissions_version where organization_id=o;
 select * into res from public.m11_create_connector_atomic(o,u,epoch,gen_random_uuid(),'reference_conformance','Quota fixture','1.0.0','v1','{}','manual'); c:=(res.connector->>'id')::uuid;
 select * into res from public.m11_begin_sync_run_atomic(o,c,u,epoch,'incremental',gen_random_uuid(),gen_random_uuid());r:=(res.run->>'id')::uuid;
 select * into cl from public.m1102_claim_sync_run(o,'quota-worker',60);g:=(cl.run->>'leaseGeneration')::integer;
 select * into res from public.m1102_save_sync_run_plan_atomic(o,r,'quota-worker',g,'quota-cursor',repeat('a',64),
 jsonb_build_array(jsonb_build_object('externalId','create','entityType','product','proposedAction','create','fieldDiffs',jsonb_build_object('name',pg_temp.field_diff('name',to_jsonb('Quota product'::text)),'internalCode',pg_temp.field_diff('internalCode',to_jsonb('QUOTA'::text)),'productType',pg_temp.field_diff('productType',to_jsonb('standalone_software'::text)),'responsibleOwnerId',pg_temp.field_diff('responsibleOwnerId',to_jsonb(u)),'legalEntityId',pg_temp.field_diff('legalEntityId',to_jsonb(e))),'issues','[]'::jsonb,'sourceSnapshot','{}'::jsonb)),'[]','{}');
 perform public.m11_request_sync_run_commit_atomic(o,r,u,epoch,1);
 update public.organization_license_states set verified_claims=jsonb_set(verified_claims,'{limits,products}','0'),verification_checked_at=clock_timestamp() where organization_id=o;
 select * into cl from public.m1102_claim_sync_run(o,'quota-worker',60);
 perform pg_temp.check('capacity filters connector before source lease',cl.outcome='not_found' and exists(select 1 from public.sync_runs where id=r and status='queued' and retry_count=0 and lease_owner is null));
 -- A later dry run in the same tenant must bypass the older blocked commit.
 select * into res from public.m11_create_connector_atomic(o,u,epoch,gen_random_uuid(),'reference_conformance','Dry run fixture','1.0.0','v1','{}','manual');c2:=(res.connector->>'id')::uuid;
 select * into res from public.m11_begin_sync_run_atomic(o,c2,u,epoch,'incremental',gen_random_uuid(),gen_random_uuid());r2:=(res.run->>'id')::uuid;
 select * into cl from public.m1102_claim_sync_run(o,'quota-worker',60);
 perform pg_temp.check('blocked older commit does not starve later dry run',cl.outcome='claimed' and cl.run->>'id'=r2::text);
 perform public.m1102_save_sync_run_plan_atomic(o,r2,'quota-worker',(cl.run->>'leaseGeneration')::integer,'dry-cursor',repeat('b',64),'[]','[]','{}');
 update public.organization_license_states set verified_claims=jsonb_set(verified_claims,'{limits,products}','1'),verification_checked_at=clock_timestamp() where organization_id=o;
 select * into cl from public.m1102_claim_sync_run(o,'quota-worker',60);g:=(cl.run->>'leaseGeneration')::integer;
 perform pg_temp.check('fresh capacity resumes connector commit',cl.outcome='claimed' and cl.run->>'id'=r::text);
 select count(*) into audit_before from public.audit_logs where organization_id=o;
 update public.organization_license_states set verification_valid=false where organization_id=o;
 select * into res from public.m1102_commit_sync_run_atomic(o,r,u,'other-worker',g,repeat('a',64),key,gen_random_uuid());
 perform pg_temp.check('wrong source lease cannot release connector during expiry',res.outcome='lease_lost' and exists(select 1 from public.sync_runs where id=r and status='running' and lease_owner='quota-worker'));
 select * into res from public.m1102_commit_sync_run_atomic(o,r,u,'quota-worker',g,repeat('a',64),key,gen_random_uuid());
 perform pg_temp.check('expiry after connector claim pauses without retry failure',res.outcome='retrying' and exists(select 1 from public.sync_runs where id=r and status='retrying' and retry_count=0 and lease_owner is null and error_code is null));
 perform pg_temp.check('pause closes bounded attempt as interrupted',exists(select 1 from public.sync_run_attempts where sync_run_id=r and lease_generation=g and outcome='interrupted' and error_code='licensing_customer_write_denied'));
 perform pg_temp.check('pause retains source plan and cursor without audit',exists(select 1 from public.sync_run_plan_items where sync_run_id=r and applied_at is null and dead_lettered_at is null) and (select cursor is null from public.sync_connector_cursors where connector_id=c) and (select count(*)=audit_before from public.audit_logs where organization_id=o));
 update public.organization_license_states set verification_valid=true,verification_checked_at=clock_timestamp() where organization_id=o;
 select * into cl from public.m1102_claim_sync_run(o,'quota-worker-fresh',60);
 perform pg_temp.check('fresh verification resumes paused connector',cl.outcome='claimed' and (cl.run->>'leaseGeneration')::integer>g);
 g:=(cl.run->>'leaseGeneration')::integer;
 -- Downgrade between claim and materialization: inner product writer's real
 -- quota trigger must preserve its exact reason through the connector wrapper.
 update public.organization_license_states set verified_claims=jsonb_set(verified_claims,'{limits,products}','0'),verification_checked_at=clock_timestamp() where organization_id=o;
 select * into res from public.m1102_commit_sync_run_atomic(o,r,u,'quota-worker-fresh',g,repeat('a',64),key,gen_random_uuid());
 perform pg_temp.check('inner product quota denial remains a resumable connector pause',res.outcome='retrying' and exists(select 1 from public.sync_run_attempts where sync_run_id=r and lease_generation=g and outcome='interrupted' and error_code='licensing_product_limit'));
 perform pg_temp.check('quota race rolls back all materialization and failed markers',not exists(select 1 from public.products where organization_id=o) and not exists(select 1 from public.sync_run_plan_items where sync_run_id=r and (applied_at is not null or dead_lettered_at is not null)) and (select retry_count=0 from public.sync_runs where id=r));
 update public.organization_license_states set verified_claims=jsonb_set(verified_claims,'{limits,products}','1'),verification_checked_at=clock_timestamp() where organization_id=o;
 select * into cl from public.m1102_claim_sync_run(o,'quota-worker-complete',60);g:=(cl.run->>'leaseGeneration')::integer;
 select * into res from public.m1102_commit_sync_run_atomic(o,r,u,'quota-worker-complete',g,repeat('a',64),key,gen_random_uuid());
 perform pg_temp.check('fresh source lease completes preserved plan after capacity restored',res.outcome='completed' and (select count(*)=1 from public.products where organization_id=o) and (select cursor='quota-cursor' from public.sync_connector_cursors where connector_id=c) and (select retry_count=0 from public.sync_runs where id=r));
end $$;
rollback;
