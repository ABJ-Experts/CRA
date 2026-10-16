-- Separate capture attempts from restore drills. All task-owned fixtures roll back.
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(23);
-- The projection requires one approved instance. Existing authority is restored by
-- the final rollback; no fixture is retained and no capture is in progress.
update public.backup_policies set is_approved=false where is_approved;
insert into public.organizations(id,name,slug) values
 ('15000000-0000-4000-8000-000000000201','Backup assurance fixture','backup-assurance-fixture'),
 ('15000000-0000-4000-8000-000000000202','Foreign assurance fixture','foreign-assurance-fixture');
insert into public.users(id,email,email_verified_at) values
 ('15000000-0000-4000-8000-000000000203','m15-backup-assurance-fixture@cra.test',clock_timestamp());
insert into public.organization_members(organization_id,user_id,role) values
 ('15000000-0000-4000-8000-000000000201','15000000-0000-4000-8000-000000000203','owner');
insert into public.backup_policies(instance_id,configuration,configuration_digest,approved_by,mutation_key,mutation_digest)
 values('15000000-0000-4000-8000-000000000204','{"verificationIntervalDays":30}',repeat('a',64),'sql-fixture',gen_random_uuid(),repeat('a',64));
insert into public.backup_runs(id,instance_id,kind,state,stage,configuration_revision,configuration,configuration_digest,idempotency_key,request_digest,actor_id,certificate,created_at,completed_at,covered_organization_ids)
 values('15000000-0000-4000-8000-000000000205','15000000-0000-4000-8000-000000000204','capture','certified','completed',1,'{"verificationIntervalDays":30}',repeat('a',64),gen_random_uuid(),repeat('a',64),'sql-fixture',jsonb_build_object('recoveryPointAt',public.m7_snapshot_timestamp_utc(clock_timestamp()-interval '10 minutes')),clock_timestamp()-interval '11 minutes',clock_timestamp()-interval '10 minutes',array['15000000-0000-4000-8000-000000000201'::uuid]);
insert into public.backup_runs(id,instance_id,kind,parent_capture_id,state,stage,configuration_revision,configuration,configuration_digest,idempotency_key,request_digest,actor_id,verification,created_at,completed_at,covered_organization_ids)
 values('15000000-0000-4000-8000-000000000206','15000000-0000-4000-8000-000000000204','verification','15000000-0000-4000-8000-000000000205','verified','completed',1,'{"verificationIntervalDays":30}',repeat('a',64),gen_random_uuid(),repeat('a',64),'sql-fixture','{"integrity":"passed"}',clock_timestamp()-interval '9 minutes',clock_timestamp()-interval '8 minutes',array['15000000-0000-4000-8000-000000000201'::uuid]);
create function pg_temp.assurance() returns jsonb language sql as $$
 select public.m15_05_backup_assurance('15000000-0000-4000-8000-000000000201','15000000-0000-4000-8000-000000000203')->'assurance'
$$;
select is(pg_temp.assurance()->'lastAttempt'->>'id','15000000-0000-4000-8000-000000000205','last attempt is capture even after successful restore');
select is(pg_temp.assurance()->'lastCapture'->>'id','15000000-0000-4000-8000-000000000205','last successful capture is independent');
select is(pg_temp.assurance()->'lastVerification'->>'id','15000000-0000-4000-8000-000000000206','last restore attempt remains separate');
select is(pg_temp.assurance()->>'status','verified','successful compatible capture and restore remain verified');
create temporary table assurance_prior as select pg_temp.assurance()->>'lastVerifiedRestoreAt' as completed_at;
insert into public.backup_runs(id,instance_id,kind,parent_capture_id,state,stage,configuration_revision,configuration,configuration_digest,idempotency_key,request_digest,actor_id,failure_code,verification,created_at,completed_at,covered_organization_ids)
 values('15000000-0000-4000-8000-000000000207','15000000-0000-4000-8000-000000000204','verification','15000000-0000-4000-8000-000000000205','failed','failed',1,'{"verificationIntervalDays":30}',repeat('a',64),gen_random_uuid(),repeat('a',64),'sql-fixture','restore_failed','{"integrity":"failed"}',clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute',array['15000000-0000-4000-8000-000000000201'::uuid]);
select is(pg_temp.assurance()->'lastAttempt'->>'id','15000000-0000-4000-8000-000000000205','failed drill never replaces last capture attempt');
select is(pg_temp.assurance()->'lastVerification'->>'id','15000000-0000-4000-8000-000000000207','failed drill is latest verification');
select is(pg_temp.assurance()->'reasons','["verification_failed"]'::jsonb,'failed drill is not misreported as capture failure');
select is(pg_temp.assurance()->>'status','failed','recent capture never hides failed restore');
select is(pg_temp.assurance()->>'lastVerifiedRestoreAt',(select completed_at from assurance_prior),'failed drill preserves previous successful restore time');
update public.backup_runs set state='queued',stage='queued',completed_at=null,failure_code=null,verification=null where id='15000000-0000-4000-8000-000000000207';
select is(pg_temp.assurance()->'reasons','["verification_running"]'::jsonb,'queued drill is explicitly verification running');
select is(pg_temp.assurance()->'lastAttempt'->>'id','15000000-0000-4000-8000-000000000205','queued drill leaves capture attempt unchanged');
select is(pg_temp.assurance()->>'sourceAt',(select public.m7_snapshot_timestamp_utc(created_at) from public.backup_runs where id='15000000-0000-4000-8000-000000000207'),'source time advances on queued restore before completion');
update public.backup_runs set state='running',stage='restoring' where id='15000000-0000-4000-8000-000000000207';
select is(pg_temp.assurance()->'reasons','["verification_running"]'::jsonb,'running drill is explicitly verification running');
select is(pg_temp.assurance()->>'lastVerifiedRestoreAt',(select completed_at from assurance_prior),'running drill retains last successful restore');
update public.backup_runs set state='incomplete',stage='failed',failure_code='restore_failed',verification='{"integrity":"incomplete"}',completed_at=clock_timestamp() where id='15000000-0000-4000-8000-000000000207';
select is(pg_temp.assurance()->'reasons','["verification_incomplete"]'::jsonb,'incomplete drill is not misreported as incomplete capture');
select is(pg_temp.assurance()->'lastAttempt'->>'id','15000000-0000-4000-8000-000000000205','incomplete drill leaves capture attempt unchanged');
select is(pg_temp.assurance()->>'lastVerifiedRestoreAt',(select completed_at from assurance_prior),'incomplete drill preserves previous successful restore');
insert into public.backup_runs(id,instance_id,kind,state,stage,configuration_revision,configuration,configuration_digest,idempotency_key,request_digest,actor_id,failure_code,created_at,completed_at,covered_organization_ids)
 values('15000000-0000-4000-8000-000000000208','15000000-0000-4000-8000-000000000204','capture','failed','failed',1,'{"verificationIntervalDays":30}',repeat('a',64),gen_random_uuid(),repeat('a',64),'sql-fixture','capture_failed',clock_timestamp(),clock_timestamp(),array['15000000-0000-4000-8000-000000000201'::uuid]);
select is(pg_temp.assurance()->'lastAttempt'->>'id','15000000-0000-4000-8000-000000000208','genuine failed capture becomes latest capture attempt');
select is(pg_temp.assurance()->'reasons','["capture_failed"]'::jsonb,'genuine capture failure keeps capture reason');
select is(pg_temp.assurance()->'lastCapture'->>'id','15000000-0000-4000-8000-000000000205','failed capture cannot hide last certified recovery point');
insert into public.backup_runs(id,instance_id,kind,state,stage,configuration_revision,configuration,configuration_digest,idempotency_key,request_digest,actor_id,failure_code,created_at,completed_at,covered_organization_ids)
 values('15000000-0000-4000-8000-000000000209','15000000-0000-4000-8000-000000000204','capture','failed','failed',1,'{"verificationIntervalDays":30}',repeat('a',64),gen_random_uuid(),repeat('a',64),'sql-fixture','capture_failed',clock_timestamp()+interval '1 second',clock_timestamp(),array['15000000-0000-4000-8000-000000000202'::uuid]);
select is(pg_temp.assurance()->'lastAttempt'->>'id','15000000-0000-4000-8000-000000000208','foreign tenant capture does not replace scoped capture attempt');
select is(public.m15_05_backup_assurance('15000000-0000-4000-8000-000000000202','15000000-0000-4000-8000-000000000203')->>'outcome','forbidden','foreign organization does not reveal whole deployment assurance');
update public.organization_members set role='viewer' where organization_id='15000000-0000-4000-8000-000000000201';
select is(public.m15_05_backup_assurance('15000000-0000-4000-8000-000000000201','15000000-0000-4000-8000-000000000203')->>'outcome','forbidden','live permission loss removes assurance disclosure');
select * from finish();
rollback;
