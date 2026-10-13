-- Rollback-only receipt admission: actual M6 approval and reauthentication authorities.
begin;
set local statement_timeout='30s';
create function pg_temp.check(label text,ok boolean) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'receipt check: %',label;end if;end $$;
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
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid; v_release uuid; v_obligation uuid; v_stage uuid; v_draft uuid;
  v_create record; v_lock record; v_save record; v_proof record; v_approval record; v_reserve record;
  v_finalize record; v_filing_proof record; v_filing record; v_evidence record;
  v_hash text; v_package uuid; v_approval_id uuid; v_filing_proof_id uuid; v_submission_id uuid;
  v_package_path text; v_receipt_path text; v_session_id uuid := gen_random_uuid(); v_filing_key uuid := gen_random_uuid();
  v_protected_before bigint; v_mutation_blocked boolean := false; ctx jsonb; admitted jsonb; op uuid:=gen_random_uuid();
begin
  select id into v_actor from public.users where email='owner@cra.test';
  select id into v_release from public.product_releases where organization_id=v_org and archived_at is null order by created_at limit 1;
  perform pg_temp.m15_legacy_license(m.organization_id) from public.organization_members m where m.user_id=v_actor;
  v_protected_before:=(public.m15_01_usage(v_org)->>'protectedStorageBytes')::bigint;
  select * into v_create from public.create_reporting_obligation_atomic(v_org,v_actor,'severe_incident',null,clock_timestamp()-interval '1 hour','M6-05 evidence SQL test',gen_random_uuid(),gen_random_uuid());
  v_obligation := (v_create.result->'obligation'->>'id')::uuid;
  select id into v_stage from public.reporting_obligation_stages where organization_id=v_org and obligation_id=v_obligation and stage_kind='early_warning';
  select * into v_create from public.create_reporting_stage_draft_atomic(v_org,v_actor,v_obligation,v_stage,v_release,gen_random_uuid(),gen_random_uuid());
  v_draft := (v_create.result->'draft'->>'id')::uuid;
  select * into v_lock from public.acquire_reporting_stage_draft_lock_atomic(v_org,v_actor,v_draft,1,gen_random_uuid(),gen_random_uuid());
  select * into v_save from public.save_reporting_stage_draft_atomic(v_org,v_actor,v_draft,1,(v_lock.result->>'lockToken')::uuid,
    '{"summary":"confirmed","impact":"bounded"}'::jsonb,
    '{"summary":{"origin":"human"},"impact":{"origin":"human"}}'::jsonb,
    '[{"countryCode":"DE","provenance":{"origin":"human"}}]'::jsonb,gen_random_uuid(),gen_random_uuid());
  select public.m6_reporting_draft_hash(d) into v_hash from public.reporting_stage_drafts d where d.organization_id=v_org and d.id=v_draft;
  select * into v_proof from public.create_reporting_stage_approval_proof_atomic(v_org,v_actor,gen_random_uuid(),v_draft,2,v_hash,clock_timestamp()+interval '2 minutes',gen_random_uuid());
  select * into v_approval from public.approve_reporting_stage_draft_atomic(v_org,v_actor,
    (select session_id from public.reporting_stage_approval_proofs where id=(v_proof.result->>'reauthenticationProofId')::uuid),v_draft,2,v_hash,
    (v_proof.result->>'reauthenticationProofId')::uuid,null,'Deliberate owner self-approval for SQL test.',gen_random_uuid(),gen_random_uuid());
  select * into v_reserve from public.reserve_reporting_stage_package_atomic(v_org,v_actor,v_obligation,v_stage,
    (v_approval.result->'approval'->>'id')::uuid,2,v_hash,gen_random_uuid(),gen_random_uuid());
  v_package := (v_reserve.result->'package'->>'id')::uuid;
  v_approval_id := (v_approval.result->'approval'->>'id')::uuid;
  v_package_path := v_reserve.result->'package'->>'objectPath';
  begin
    update public.reporting_stage_packages set draft_hash=repeat('a',64) where organization_id=v_org and id=v_package;
  exception when sqlstate '55000' then v_mutation_blocked := true;
  end;
  perform pg_temp.check('M6-05 approval does not create filing or stop deadline',
    v_save.outcome='updated' and v_proof.outcome='created' and v_approval.outcome='updated'
    and not exists(select 1 from public.reporting_stage_submissions where organization_id=v_org and stage_id=v_stage)
    and (select state in ('running','overdue') and submitted_at is null from public.reporting_obligation_stages where organization_id=v_org and id=v_stage)
    and exists(select 1 from public.reporting_obligation_events where organization_id=v_org and obligation_id=v_obligation and event_kind='stage_approved'));
  perform pg_temp.check('M6-05 package is exact approved snapshot and append-only',
    v_reserve.outcome='created'
    and (select state='reserved' and draft_revision=2 and draft_hash=v_hash and storage_object_path like v_org::text||'/'||v_stage::text||'/packages/%' from public.reporting_stage_packages where organization_id=v_org and id=v_package)
    and v_mutation_blocked);

  insert into storage.objects(bucket_id,name) values ('reporting-evidence',v_package_path);
  select * into v_finalize from public.finalize_reporting_stage_package_atomic(
    v_org,v_actor,v_package,repeat('a',64),1024,'test-key',repeat('s',40),repeat('b',64),v_package_path,gen_random_uuid(),gen_random_uuid());
  v_receipt_path := v_org::text||'/'||v_stage::text||'/filings/'||v_filing_key::text||'/receipt.pdf';

  select * into v_filing_proof from public.create_reporting_stage_filing_proof_atomic(
    v_org,v_actor,v_session_id,v_package,v_approval_id,
    encode(extensions.digest('{"idempotencyKey":"'||v_filing_key::text||'","packageId":"'||v_package::text||'"}','sha256'),'hex'),
    clock_timestamp()+interval '2 minutes',gen_random_uuid());
  v_filing_proof_id := (v_filing_proof.result->>'reauthenticationProofId')::uuid;

  ctx:=jsonb_build_object('kind','reporting_receipt','organizationId',v_org,'actorId',v_actor,'sessionId',v_session_id,'obligationId',v_obligation,'stageId',v_stage,'packageId',v_package,'approvalId',v_approval_id,'proofId',v_filing_proof_id,'idempotencyKey',v_filing_key,'isRehearsal',false);
  perform pg_temp.check('source authority validates approved package and proof',public.m15_01_reporting_receipt_allowed(v_org,v_actor,v_receipt_path,512,ctx));
  perform pg_temp.check('foreign org is denied',not public.m15_01_reporting_receipt_allowed(gen_random_uuid(),v_actor,v_receipt_path,512,ctx));
  perform pg_temp.check('tampered session is denied',not public.m15_01_reporting_receipt_allowed(v_org,v_actor,v_receipt_path,512,jsonb_set(ctx,'{sessionId}',to_jsonb(gen_random_uuid()))));
  perform pg_temp.check('tampered path is denied',not public.m15_01_reporting_receipt_allowed(v_org,v_actor,v_receipt_path||'.zip',512,ctx));
  perform pg_temp.check('receipt replay absent before upload',public.m15_01_replay_reporting_receipt(v_org,v_actor,v_receipt_path,512,'application/pdf',repeat('c',64),ctx)->>'outcome'='absent');
  update public.users set is_active=false where id=v_actor;
  perform pg_temp.check('revoked actor denied before admission',not public.m15_01_reporting_receipt_allowed(v_org,v_actor,v_receipt_path,512,ctx));
  update public.users set is_active=true where id=v_actor;
  perform pg_temp.check('oversized receipt denied',not public.m15_01_reporting_receipt_allowed(v_org,v_actor,v_receipt_path,10485761,ctx));
  perform pg_temp.check('rehearsal cannot impersonate real source',not public.m15_01_reporting_receipt_allowed(v_org,v_actor,'rehearsals/'||v_receipt_path,512,jsonb_set(ctx,'{isRehearsal}','true')));
  update storage.objects set metadata=jsonb_build_object('size',1024) where bucket_id='reporting-evidence' and name=v_package_path;
  insert into storage.objects(bucket_id,name,metadata) values('reporting-evidence',v_org::text||'/unknown.zip',jsonb_build_object('size',4096));
  perform pg_temp.check('only source-owned generated archive counted',(public.m15_01_usage(v_org)->>'protectedStorageBytes')::bigint=v_protected_before+1024);
  update public.organization_license_states set protected_regulatory_cutoff=clock_timestamp()-interval '1 day',verified_claims=jsonb_set(verified_claims,'{limits,storageBytes}','0') where organization_id=v_org;
  admitted:=public.m15_01_reserve_storage(v_org,v_actor,op,'reporting-evidence',v_receipt_path,512,repeat('a',64),clock_timestamp()+interval '2 minutes','reporting',ctx,'application/pdf');
  perform pg_temp.check('after-cutoff customer receipt obeys exhausted cap',admitted->>'outcome'='quota_exceeded');
  update public.reporting_obligations set created_at=clock_timestamp()-interval '60 days' where organization_id=v_org and id=v_obligation;
  update public.organization_license_states set verified_claims=jsonb_set(verified_claims,'{expiresAt}',to_jsonb(clock_timestamp()-interval '31 days')) where organization_id=v_org;
  admitted:=public.m15_01_reserve_storage(v_org,v_actor,op,'reporting-evidence',v_receipt_path,512,repeat('a',64),clock_timestamp()+interval '2 minutes','reporting',ctx,'application/pdf');
  perform pg_temp.check('existing real duty admits proof across expiry and exhausted cap',admitted->>'outcome'='reserved' and exists(select 1 from public.organization_storage_admissions where operation_id=op and protected_input));
  perform pg_temp.check('reserved protected receipt displayed separately',(public.m15_01_usage(v_org)->>'protectedStorageBytes')::bigint>=512 and (public.m15_01_usage(v_org)->>'storageReservedBytes')::bigint=0);
  perform public.m15_01_claim_storage_upload(op,repeat('a',64));
  perform public.m15_01_prepare_storage_publication(op,repeat('a',64),repeat('c',64));
  admitted:=public.m15_01_reconcile_storage_upload(op,repeat('a',64));
  perform pg_temp.check('ambiguous publication remains charged',admitted->>'outcome'='uncertain' and exists(select 1 from public.organization_storage_admissions where operation_id=op and state='uncertain' and reserved_bytes=512));
  insert into storage.objects(bucket_id,name,metadata,user_metadata) values('reporting-evidence',v_receipt_path,jsonb_build_object('size',512),jsonb_build_object('sha256',repeat('c',64),'operationId',op));
  admitted:=public.m15_01_reconcile_storage_upload(op,repeat('a',64));
  perform pg_temp.check('published exact object resolves uncertainty',admitted->>'outcome'='completed');
  perform pg_temp.check('filing retry preserves completed upload',public.m15_01_replay_reporting_receipt(v_org,v_actor,v_receipt_path,512,'application/pdf',repeat('c',64),ctx)->>'outcome'='completed');
  perform pg_temp.check('filing retry cannot replace exact receipt',public.m15_01_replay_reporting_receipt(v_org,v_actor,v_receipt_path,512,'application/pdf',repeat('d',64),ctx)->>'outcome'='conflict');
  perform pg_temp.check('filing retry cannot change actor session',public.m15_01_replay_reporting_receipt(v_org,v_actor,v_receipt_path,512,'application/pdf',repeat('c',64),jsonb_set(ctx,'{sessionId}',to_jsonb(gen_random_uuid())))->>'outcome'='forbidden');
  update public.reporting_stage_filing_proofs set consumed_at=clock_timestamp() where id=v_filing_proof_id;
  perform pg_temp.check('consumed proof revokes prepublication authority',not public.m15_01_reporting_receipt_allowed(v_org,v_actor,v_receipt_path,512,ctx));
end $$;
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid; v_release uuid; v_obligation uuid; v_stage uuid; v_draft uuid;
  v_create record; v_lock record; v_save record; v_proof record; v_approval record; v_reserve record;
  v_finalize record; v_filing_proof record; v_filing record; v_evidence record;
  v_hash text; v_package uuid; v_approval_id uuid; v_filing_proof_id uuid; v_submission_id uuid;
  v_package_path text; v_receipt_path text; v_session_id uuid := gen_random_uuid(); v_filing_key uuid := gen_random_uuid();
  v_protected_before bigint; v_mutation_blocked boolean := false; ctx jsonb; admitted jsonb; op uuid:=gen_random_uuid();
begin
  select id into v_actor from public.users where email='owner@cra.test';
  select id into v_release from public.product_releases where organization_id=v_org and archived_at is null order by created_at limit 1;
  perform pg_temp.m15_legacy_license(m.organization_id) from public.organization_members m where m.user_id=v_actor;
  v_protected_before:=(public.m15_01_usage(v_org)->>'protectedStorageBytes')::bigint;
  select * into v_create from public.create_reporting_rehearsal_atomic(v_org,v_actor,'severe_incident',clock_timestamp()-interval '1 hour','M6-05 evidence SQL test',gen_random_uuid(),gen_random_uuid());
  v_obligation := (v_create.result->'obligation'->>'id')::uuid;
  select id into v_stage from public.reporting_obligation_stages where organization_id=v_org and obligation_id=v_obligation and stage_kind='early_warning';
  select * into v_create from public.create_reporting_stage_draft_atomic(v_org,v_actor,v_obligation,v_stage,v_release,gen_random_uuid(),gen_random_uuid());
  v_draft := (v_create.result->'draft'->>'id')::uuid;
  select * into v_lock from public.acquire_reporting_stage_draft_lock_atomic(v_org,v_actor,v_draft,1,gen_random_uuid(),gen_random_uuid());
  select * into v_save from public.save_reporting_stage_draft_atomic(v_org,v_actor,v_draft,1,(v_lock.result->>'lockToken')::uuid,
    '{"summary":"confirmed","impact":"bounded"}'::jsonb,
    '{"summary":{"origin":"human"},"impact":{"origin":"human"}}'::jsonb,
    '[{"countryCode":"DE","provenance":{"origin":"human"}}]'::jsonb,gen_random_uuid(),gen_random_uuid());
  select public.m6_reporting_draft_hash(d) into v_hash from public.reporting_stage_drafts d where d.organization_id=v_org and d.id=v_draft;
  select * into v_proof from public.create_reporting_stage_approval_proof_atomic(v_org,v_actor,gen_random_uuid(),v_draft,2,v_hash,clock_timestamp()+interval '2 minutes',gen_random_uuid());
  select * into v_approval from public.approve_reporting_stage_draft_atomic(v_org,v_actor,
    (select session_id from public.reporting_stage_approval_proofs where id=(v_proof.result->>'reauthenticationProofId')::uuid),v_draft,2,v_hash,
    (v_proof.result->>'reauthenticationProofId')::uuid,null,'Deliberate owner self-approval for SQL test.',gen_random_uuid(),gen_random_uuid());
  select * into v_reserve from public.reserve_reporting_stage_package_atomic(v_org,v_actor,v_obligation,v_stage,
    (v_approval.result->'approval'->>'id')::uuid,2,v_hash,gen_random_uuid(),gen_random_uuid());
  v_package := (v_reserve.result->'package'->>'id')::uuid;
  v_approval_id := (v_approval.result->'approval'->>'id')::uuid;
  v_package_path := v_reserve.result->'package'->>'objectPath';
  insert into storage.objects(bucket_id,name) values ('reporting-evidence',v_package_path);
  select * into v_finalize from public.finalize_reporting_stage_package_atomic(
    v_org,v_actor,v_package,repeat('a',64),1024,'test-key',repeat('s',40),repeat('b',64),v_package_path,gen_random_uuid(),gen_random_uuid());
  v_receipt_path := 'rehearsals/'||v_org::text||'/'||v_stage::text||'/filings/'||v_filing_key::text||'/receipt.pdf';

  select * into v_filing_proof from public.create_reporting_stage_filing_proof_atomic(
    v_org,v_actor,v_session_id,v_package,v_approval_id,
    encode(extensions.digest('{"idempotencyKey":"'||v_filing_key::text||'","packageId":"'||v_package::text||'"}','sha256'),'hex'),
    clock_timestamp()+interval '2 minutes',gen_random_uuid());
  v_filing_proof_id := (v_filing_proof.result->>'reauthenticationProofId')::uuid;

  ctx:=jsonb_build_object('kind','reporting_receipt','organizationId',v_org,'actorId',v_actor,'sessionId',v_session_id,'obligationId',v_obligation,'stageId',v_stage,'packageId',v_package,'approvalId',v_approval_id,'proofId',v_filing_proof_id,'idempotencyKey',v_filing_key,'isRehearsal',true);
  perform pg_temp.check('actual rehearsal has normal source authority',public.m15_01_reporting_receipt_allowed(v_org,v_actor,v_receipt_path,512,ctx));
  perform pg_temp.check('actual rehearsal never qualifies as protected',not public.m15_01_reporting_receipt_protected(v_org,v_obligation));
  update public.organization_license_states set verified_claims=jsonb_set(verified_claims,'{limits,storageBytes}','0') where organization_id=v_org;
  admitted:=public.m15_01_reserve_storage(v_org,v_actor,op,'reporting-evidence',v_receipt_path,512,repeat('a',64),clock_timestamp()+interval '2 minutes','reporting',ctx,'application/pdf');
  perform pg_temp.check('actual rehearsal receipt obeys cap',admitted->>'outcome'='quota_exceeded');
  perform pg_temp.check('rejected rehearsal creates no protected admission',not exists(select 1 from public.organization_storage_admissions where operation_id=op));
end $$;
rollback;
