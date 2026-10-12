begin;
set local statement_timeout='30s';
do $$
begin
 if to_regprocedure('public.m14_03_create_portal_export(text,text,jsonb)') is null then raise exception 'Portal export creation RPC is missing'; end if;
 if has_function_privilege('authenticated','public.m14_03_create_portal_export(text,text,jsonb)','execute') then raise exception 'Browser role can call private portal export RPC directly'; end if;
 begin perform public.m14_03_create_portal_export('supplier_session',repeat('0',64),'{}'::jsonb); raise exception 'Forged portal subject was accepted'; exception when insufficient_privilege then null; end;
end $$;
rollback;

begin;
set local statement_timeout='30s';
create function pg_temp.check(p_name text,p_ok boolean) returns void language plpgsql as $$begin if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name;end if;end$$;
do $$
declare v_org uuid:=gen_random_uuid();v_user uuid;v_legal uuid:=gen_random_uuid();v_product uuid:=gen_random_uuid();v_supplier uuid:=gen_random_uuid();v_contact uuid:=gen_random_uuid();v_request uuid:=gen_random_uuid();v_revision uuid:=gen_random_uuid();v_item uuid:=gen_random_uuid();v_invitation uuid:=gen_random_uuid();v_digest text:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');
 v_input jsonb;v_job jsonb;v_capture jsonb;v_claim jsonb;v_rows jsonb;v_id uuid;v_key uuid:=gen_random_uuid();v_grant jsonb;v_part jsonb;v_artifact uuid:=gen_random_uuid();v_cancel_key uuid:=gen_random_uuid();v_file uuid:=gen_random_uuid();v_snapshot uuid:=gen_random_uuid();v_export uuid:=gen_random_uuid();v_auditor_grant uuid:=gen_random_uuid();v_auditor_session uuid:=gen_random_uuid();v_auditor_digest text:=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex');v_auditor_job jsonb;v_failure text;
begin
 select id into strict v_user from public.users where email='owner@cra.test';
 insert into public.organizations(id,name,slug) values(v_org,'Portal export rollback fixture','m14-portal-'||v_org);
 insert into public.organization_legal_entities(id,organization_id,identifier,display_name,legal_name,registered_address_line_1,registered_address_locality,registered_address_postal_code,registered_address_country,main_establishment_country,manufacturer_contact_name,manufacturer_contact_email,created_by,updated_by) values(v_legal,v_org,'m14-portal-fixture','M14 fixture','M14 fixture','1 Test','Test','12345','DE','DE','Test','m14@example.test',v_user,v_user);
 insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by) values(v_product,v_org,v_legal,0,'{}','Portal product','M14-'||v_product,'standalone_software',v_user,v_user,v_user);
 insert into public.supplier_organizations(id,organization_id,name,created_by,updated_by) values(v_supplier,v_org,'Portal fixture supplier',v_user,v_user);
 insert into public.supplier_contacts(id,organization_id,supplier_id,name,email,created_by,updated_by) values(v_contact,v_org,v_supplier,'Fixture recipient','recipient@example.test',v_user,v_user);
 insert into public.supplier_evidence_requests(id,organization_id,supplier_id,recipient_contact_id,recipient_name,recipient_email,product_id,internal_owner_user_id,state,created_by_user_id) values(v_request,v_org,v_supplier,v_contact,'Fixture recipient','recipient@example.test',v_product,v_user,'open',v_user);
 insert into public.supplier_evidence_request_revisions(id,organization_id,request_id,revision_number,portal_title,instructions,due_at,disclosure_payload,disclosure_digest,created_by_user_id) values(v_revision,v_org,v_request,1,'Portal checklist','Submit requested evidence',clock_timestamp()+interval '1 day','{}',repeat('a',64),v_user);
 update public.supplier_evidence_requests set current_revision_id=v_revision where organization_id=v_org and id=v_request;
 insert into public.supplier_evidence_request_items(id,organization_id,revision_id,ordinal,title,document_class) values(v_item,v_org,v_revision,1,'Original Ω checklist','test_report');
 insert into public.supplier_evidence_invitations(id,organization_id,request_id,revision_id,token_prefix,token_hash,state,expires_at,session_token_hash,session_expires_at,used_at,created_by_user_id) values(v_invitation,v_org,v_request,v_revision,'cra_sev_01234567',encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),'used',clock_timestamp()+interval '1 day',v_digest,clock_timestamp()+interval '20 minutes',clock_timestamp(),v_user);
 v_input:=jsonb_build_object('source','supplier_evidence.portal_items','format','csv','scope','all_filtered','filters','{}'::jsonb,'context','{}'::jsonb,'idempotencyKey',v_key);
 v_job:=public.m14_03_create_portal_export('supplier_session',v_digest,v_input);v_id:=(v_job->>'id')::uuid;
 perform pg_temp.check('portal queue does not need an organization member',v_job->>'state'='queued' and not exists(select 1 from public.organization_members where organization_id=v_org));
 perform pg_temp.check('portal expiry never exceeds original session',(v_job->>'expiresAt')::timestamptz<=clock_timestamp()+interval '20 minutes');
 perform pg_temp.check('portal create is durable idempotent',public.m14_03_create_portal_export('supplier_session',v_digest,v_input)->>'id'=v_id::text);
 begin perform public.m14_03_create_portal_export('supplier_session',v_digest,v_input||jsonb_build_object('format','xlsx'));raise exception 'idempotency conflict accepted';exception when serialization_failure then null;end;
 begin perform public.m14_03_create_portal_export('supplier_session',v_digest,v_input||jsonb_build_object('source','products.registry','idempotencyKey',gen_random_uuid()));raise exception 'workspace source accepted';exception when invalid_parameter_value then null;end;
 begin perform public.m14_03_create_portal_export('supplier_session',v_digest,v_input||jsonb_build_object('columns',jsonb_build_array('token_hash'),'idempotencyKey',gen_random_uuid()));raise exception 'secret column accepted';exception when invalid_parameter_value then null;end;
 update public.export_jobs set requested_at='1970-01-01',updated_at='-infinity' where organization_id=v_org;
 v_claim:=public.m14_03_claim_export('m14-portal-fixture');perform pg_temp.check('only own fixture job claimed',v_claim->'publicJob'->>'id'=v_id::text);
 v_capture:=public.m14_03_capture_export(v_org,v_id,'m14-portal-fixture',(v_claim->>'version')::integer);
 perform pg_temp.check('portal capture freezes its visible checklist',v_capture->'publicJob'->>'rowCount'='1');
 v_capture:=public.m14_03_publish_capture(v_org,v_id,'m14-portal-fixture',(v_capture->>'version')::integer);
 update public.supplier_evidence_request_items set title='Changed checklist' where organization_id=v_org and id=v_item;
 v_rows:=public.m14_03_read_export_rows(v_org,v_id,'m14-portal-fixture',(v_capture->>'version')::integer,0,250);
 perform pg_temp.check('later source changes preserve frozen values',v_rows->0->'values'->>'title'='Original Ω checklist');
 -- Explicit retry is an authorized new bounded attempt cycle. Frozen capture
 -- survives exhaustion; a reset must not leave queued work permanently stranded.
 update public.export_jobs set state='failed',failure_code='worker_failure',attempts=3,worker_id=null,lease_expires_at=null,version=version+1 where organization_id=v_org and id=v_id returning public.m14_03_job_json(export_jobs) into v_job;
 v_job:=public.m14_03_mutate_portal_export('supplier_session',v_digest,v_id,(v_job->>'version')::integer,v_cancel_key,'retry');
 perform pg_temp.check('explicit retry resets exhausted attempts',(select attempts=0 and row_count=1 and snapshot_as_of is not null from public.export_jobs where organization_id=v_org and id=v_id));
 v_capture:=public.m14_03_claim_export('m14-portal-fixture');
 perform pg_temp.check('retried capture can be reclaimed',v_capture->'publicJob'->>'id'=v_id::text and v_capture->'publicJob'->>'state'='rendering');
 for v_failure in select unnest(array['provider_unavailable','storage_unavailable','generation_failed']) loop
  update public.export_jobs set state='failed',failure_code=v_failure,attempts=3,worker_id=null,lease_expires_at=null,version=version+1 where organization_id=v_org and id=v_id returning public.m14_03_job_json(export_jobs) into v_job;
  v_job:=public.m14_03_mutate_portal_export('supplier_session',v_digest,v_id,(v_job->>'version')::integer,gen_random_uuid(),'retry');
  perform pg_temp.check('retry resets transient '||v_failure,(select attempts=0 and row_count=1 and snapshot_as_of is not null from public.export_jobs where organization_id=v_org and id=v_id));
  v_capture:=public.m14_03_claim_export('m14-portal-fixture');
  perform pg_temp.check('transient retry preserves completed capture '||v_failure,v_capture->'publicJob'->>'id'=v_id::text and v_capture->'publicJob'->>'state'='rendering');
 end loop;
 for v_failure in select unnest(array['checkpoint_integrity_failed','snapshot_integrity_failed','storage_integrity_failed']) loop
  update public.export_jobs set state='failed',failure_code=v_failure,worker_id=null,lease_expires_at=null,version=version+1 where organization_id=v_org and id=v_id returning public.m14_03_job_json(export_jobs) into v_job;
  begin perform public.m14_03_mutate_portal_export('supplier_session',v_digest,v_id,(v_job->>'version')::integer,gen_random_uuid(),'retry');raise exception 'corrupt snapshot/artifact retry accepted';exception when serialization_failure then null;end;
 end loop;
 -- Restore the already-verified fixture lease after terminal-policy assertions.
 update public.export_jobs set state='rendering',failure_code=null,worker_id='m14-portal-fixture',lease_expires_at=clock_timestamp()+interval '2 minutes',version=version+1 where organization_id=v_org and id=v_id returning public.m14_03_private_job_json(export_jobs) into v_capture;
 v_part:=jsonb_build_object('id',v_artifact,'name','part-0001.csv','mediaType','text/csv','byteLength',12,'sha256',repeat('a',64),'rowCount',1,'objectPath',v_org||'/'||v_id||'/part-0001.csv-'||repeat('a',64),'startOrdinal',1,'endOrdinal',1);
 v_capture:=public.m14_03_checkpoint_export(v_org,v_id,'m14-portal-fixture',(v_capture->>'version')::integer,jsonb_build_array(v_part),1);
 perform public.m14_03_complete_export(v_org,v_id,'m14-portal-fixture',(v_capture->>'version')::integer,jsonb_build_object('version','m14_03_v1','jobId',v_id,'source','supplier_evidence.portal_items','scope','all_filtered','requestedAt',v_capture->'requestedAt','snapshotAsOf',v_capture->'snapshotAsOf','requestDigest',v_capture->'requestDigest','rowCount',1,'columns','[]'::jsonb,'artifacts',jsonb_build_array(v_part-'objectPath'-'startOrdinal'-'endOrdinal'),'sourceVersionsDigest',v_capture->'sourceVersionsDigest','documentationReadinessOnly',false));
 v_grant:=public.m14_03_issue_portal_export_download_grant('supplier_session',v_digest,v_id,v_artifact,repeat('b',64));
 perform pg_temp.check('grant uses only supplier export path',v_grant->>'downloadPath'='/api/v1/supplier-evidence-portal/exports/'||v_id||'/download/'||(v_grant->>'grantId'));
 perform pg_temp.check('redeem returns scoped private metadata',public.m14_03_redeem_portal_export_download_grant('supplier_session',v_digest,v_id,(v_grant->>'grantId')::uuid,repeat('b',64))->>'organizationId'=v_org::text);
 begin perform public.m14_03_redeem_portal_export_download_grant('supplier_session',v_digest,v_id,(v_grant->>'grantId')::uuid,repeat('b',64));raise exception 'grant replay accepted';exception when insufficient_privilege then null;end;
 v_grant:=public.m14_03_issue_portal_export_download_grant('supplier_session',v_digest,v_id,v_artifact,repeat('b',64));
 update public.supplier_evidence_invitations set state='revoked',revoked_at=clock_timestamp(),revoked_by_user_id=v_user where organization_id=v_org and id=v_invitation;
 begin perform public.m14_03_get_portal_export('supplier_session',v_digest,v_id);raise exception 'revoked subject saw metadata';exception when insufficient_privilege then null;end;
 begin perform public.m14_03_redeem_portal_export_download_grant('supplier_session',v_digest,v_id,(v_grant->>'grantId')::uuid,repeat('b',64));raise exception 'revoked subject downloaded';exception when insufficient_privilege then null;end;

 -- Auditor exports use only the three artifact metadata entries of the frozen
 -- M7 export, never snapshot evidence payloads, storage paths or grant tokens.
 insert into public.technical_files(id,organization_id,product_id,template_version,create_idempotency_key,created_by,updated_by) values(v_file,v_org,v_product,'1',gen_random_uuid(),v_user,v_user);
 insert into public.technical_file_snapshots(id,organization_id,technical_file_id,product_id,purpose,audit_rationale,technical_file_version,template_key,template_version,readiness_status,payload,payload_sha256,created_by) values(v_snapshot,v_org,v_file,v_product,'audit','Rollback-only authorization test',1,'annex_vii','1','partial','{"restrictedEvidence":"must not leave snapshot"}',repeat('a',64),v_user);
 insert into public.technical_file_snapshot_exports(id,organization_id,snapshot_id,requested_by,idempotency_key,payload_digest,status,pdf_object_path,pdf_sha256,pdf_bytes,archive_object_path,archive_sha256,archive_bytes,manifest_object_path,manifest_sha256,manifest_bytes,completed_at) values(v_export,v_org,v_snapshot,v_user,gen_random_uuid(),repeat('a',64),'ready','private/pdf',repeat('a',64),12,'private/archive',repeat('b',64),24,'private/manifest',repeat('c',64),36,clock_timestamp());
 insert into public.technical_file_auditor_snapshot_grants(id,organization_id,product_id,snapshot_id,export_id,purpose,token_hash,request_digest,idempotency_key,expires_at,created_by,recipient_email) values(v_auditor_grant,v_org,v_product,v_snapshot,v_export,'Readiness audit test',repeat('d',64),repeat('e',64),gen_random_uuid(),clock_timestamp()+interval '1 day',v_user,'auditor@example.test');
 insert into public.technical_file_auditor_sessions(id,grant_id,session_token_hash,expires_at) values(v_auditor_session,v_auditor_grant,v_auditor_digest,clock_timestamp()+interval '20 minutes');
 v_input:=jsonb_build_object('source','technical_file.auditor_manifest_artifacts','format','xlsx','scope','all_filtered','filters','{}'::jsonb,'context','{}'::jsonb,'idempotencyKey',gen_random_uuid());
 v_auditor_job:=public.m14_03_create_portal_export('auditor_session',v_auditor_digest,v_input);
 perform pg_temp.check('auditor cannot inspect supplier jobs',not exists(select 1 from jsonb_array_elements(public.m14_03_list_portal_exports('auditor_session',v_auditor_digest,'{}')->'data') x where x->>'id'=v_id::text));
 begin perform public.m14_03_get_portal_export('auditor_session',v_auditor_digest,v_id);raise exception 'auditor read supplier metadata';exception when insufficient_privilege then null;end;
 select coalesce(jsonb_agg(row_values),'[]') into v_rows from public.m14_03_source_rows(v_org,null,'technical_file.auditor_manifest_artifacts','{}',jsonb_build_object('_exportJobId',v_auditor_job->>'id'));
 perform pg_temp.check('auditor exports exactly canonical M7 artifact metadata',jsonb_array_length(v_rows)=3 and not v_rows::text like '%restrictedEvidence%' and not v_rows::text like '%private/pdf%');
 update public.technical_file_auditor_sessions set created_at=clock_timestamp()-interval '1 day',expires_at=clock_timestamp()-interval '1 second' where id=v_auditor_session;
 begin perform public.m14_03_get_portal_export('auditor_session',v_auditor_digest,(v_auditor_job->>'id')::uuid);raise exception 'expired auditor read metadata';exception when insufficient_privilege then null;end;
 perform pg_temp.check('critical portal effects have durable system audit',exists(select 1 from public.audit_logs where organization_id=v_org and actor_type='system' and entity_id=v_id::text and action='exports.download_started'));
end $$;
rollback;
