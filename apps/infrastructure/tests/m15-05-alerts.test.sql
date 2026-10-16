begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(15);
select has_function('public','m15_05_feed_rows',array['uuid','uuid'],'scoped backup feed projection');
insert into public.backup_policies(instance_id,configuration,configuration_digest,approved_by,mutation_key,mutation_digest,approved_at)
 values('15000000-0000-4000-8000-000000000100','{"retentionDays":30,"verificationIntervalDays":30}',repeat('a',64),'sql-fixture',gen_random_uuid(),repeat('a',64),clock_timestamp()-interval '2 hours');
select is(public.m15_05_backup_control('15000000-0000-4000-8000-000000000100','backup-worker','alerts/reconcile','{}')->>'outcome','ok','overdue reconciliation durable');
select is((select jsonb_array_length(alert_state->'events') from public.backup_policies where instance_id='15000000-0000-4000-8000-000000000100'),1,'one capture overdue occurrence');
select public.m15_05_backup_control('15000000-0000-4000-8000-000000000100','backup-worker','alerts/reconcile','{}');
select is((select jsonb_array_length(alert_state->'events') from public.backup_policies where instance_id='15000000-0000-4000-8000-000000000100'),1,'repeated reconciliation deduplicates');
select is((select alert_state->'events'->0->>'code' from public.backup_policies where instance_id='15000000-0000-4000-8000-000000000100'),'capture_overdue','closed overdue code only');
select ok(not has_function_privilege('service_role','public.m15_05_feed_rows(uuid,uuid)','EXECUTE'),'feed source is internal only');
select ok(position('m15_05_feed_rows' in pg_get_functiondef('public.m12_06_feed_rows(uuid,uuid)'::regprocedure))>0,'common feed includes backup exactly once');
select is((select count(*)::integer from public.m15_05_feed_rows('15000000-0000-4000-8000-000000000101','15000000-0000-4000-8000-000000000102')),0,'forged tenant cannot read deployment events');
-- A verified task-only administrator exercises the real M12 feed, acknowledgement and destination gates.
insert into public.organizations(id,name,slug) values('15000000-0000-4000-8000-000000000103','Backup feed fixture','backup-feed-fixture');
insert into public.users(id,email,email_verified_at) values('15000000-0000-4000-8000-000000000104','m15-backup-feed-fixture@cra.test',clock_timestamp());
insert into public.organization_members(organization_id,user_id,role) values('15000000-0000-4000-8000-000000000103','15000000-0000-4000-8000-000000000104','owner');
update public.organization_settings set notification_feed_started_at=clock_timestamp()-interval '1 day' where organization_id='15000000-0000-4000-8000-000000000103';
insert into public.backup_runs(id,instance_id,kind,state,stage,configuration_revision,configuration,configuration_digest,idempotency_key,request_digest,actor_id,failure_code,completed_at,covered_organization_ids)
 values('15000000-0000-4000-8000-000000000105','15000000-0000-4000-8000-000000000100','capture','failed','failed',1,'{}',repeat('a',64),gen_random_uuid(),repeat('a',64),'sql-fixture','key_unavailable',clock_timestamp(),array['15000000-0000-4000-8000-000000000103'::uuid]);
select is((select count(*)::integer from public.m15_05_feed_rows('15000000-0000-4000-8000-000000000103','15000000-0000-4000-8000-000000000104')),1,'creator-independent tenant assurance has one fixed failure notice');
select is((select outcome from public.m14_04_list_notification_feed_atomic('15000000-0000-4000-8000-000000000103','15000000-0000-4000-8000-000000000104','backup_health')), 'found','M14 final feed accepts backup category');
select is((select outcome from public.list_notification_feed_grouped_atomic('15000000-0000-4000-8000-000000000103','15000000-0000-4000-8000-000000000104','backup_health')), 'found','grouped feed accepts backup category');
select is((select result->>'url' from public.resolve_notification_feed_destination_atomic('15000000-0000-4000-8000-000000000103','15000000-0000-4000-8000-000000000104','m15_15000000-0000-4000-8000-000000000105_failure')), '/organization/health','destination is fixed trusted local health route');
select is((select outcome from public.mark_notification_feed_read_atomic('15000000-0000-4000-8000-000000000103','15000000-0000-4000-8000-000000000104',(select jsonb_agg(jsonb_build_object('ref',ref,'expectedFingerprint',fingerprint)) from public.m15_05_feed_rows('15000000-0000-4000-8000-000000000103','15000000-0000-4000-8000-000000000104')),'15000000-0000-4000-8000-000000000106')), 'updated','backup notice supports durable read receipt');
update public.organization_members set role='viewer' where organization_id='15000000-0000-4000-8000-000000000103';
select is((select count(*)::integer from public.m15_05_feed_rows('15000000-0000-4000-8000-000000000103','15000000-0000-4000-8000-000000000104')),0,'health permission loss removes backup disclosure');
select is((select outcome from public.resolve_notification_feed_destination_atomic('15000000-0000-4000-8000-000000000103','15000000-0000-4000-8000-000000000104','m15_15000000-0000-4000-8000-000000000105_failure')), 'not_found','revoked scope cannot resolve prior notice');
select * from finish();
rollback;
