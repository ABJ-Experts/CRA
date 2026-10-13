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
create function pg_temp.m15_legacy_org_license() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin perform pg_temp.m15_legacy_license(new.id); return new; end $$;
create trigger m15_legacy_rollback_fixture after insert on public.organizations
 for each row execute function pg_temp.m15_legacy_org_license();
-- Existing seeded states are replaced only inside this rollback transaction,
-- so a browser demo licence capacity never changes unrelated legacy test input.
select pg_temp.m15_legacy_license(id) from public.organizations;
-- Synthetic admission input is not retained customer history. Remove only that
-- fixture when a legacy suite tests its preexisting authorized purge behavior.
create function pg_temp.m15_legacy_remove_license() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 delete from public.organization_license_states where organization_id=old.id
 and artifact='M15 legacy rollback SQL fixture';
 return old;
end $$;
create trigger m15_legacy_rollback_cleanup before delete on public.organizations
 for each row execute function pg_temp.m15_legacy_remove_license();

-- Refresh only this transaction's synthetic fixture before admission. This
-- preserves the real 60-second proof window even in slow regression suites;
-- production authority checks and all original source policies still execute.
do $$ declare definition text; begin
 definition := pg_get_functiondef('public.m15_01_assert_customer_write(uuid,text)'::regprocedure);
 definition := regexp_replace(definition,'\mbegin\M',E'begin\n update public.organization_license_states set verification_checked_at=clock_timestamp() where organization_id=p_organization_id and artifact=''M15 legacy rollback SQL fixture'';','i');
 execute definition;
end $$;

-- Existing live export requests must not become this suite's selected fixture.
-- Defer only requests that predate fixture insertion. Source claim and snapshot
-- functions run unchanged, and ROLLBACK restores every original timestamp.
update public.organization_export_jobs set available_at='infinity'
 where status='queued';
