begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(4);
-- Synthetic history tests scheduling selection only, not physical capture proof.
insert into public.backup_policies(instance_id,configuration,configuration_digest,approved_by,mutation_key,mutation_digest)
 values('15000000-0000-4000-8000-000000000120','{"retentionDays":30}',repeat('a',64),'sql-fixture',gen_random_uuid(),repeat('a',64));
insert into public.backup_runs(id,instance_id,kind,state,stage,configuration_revision,configuration,configuration_digest,idempotency_key,request_digest,actor_id,certificate,created_at,completed_at,cleanup_state)
 select ('15000000-0000-4000-8000-00000000012'||n)::uuid,'15000000-0000-4000-8000-000000000120','capture',case when n=1 or n=4 then 'certified' when n=2 then 'failed' else 'cancelled' end,'completed',1,'{}',repeat('a',64),gen_random_uuid(),repeat('a',64),'sql-fixture',case when n=1 or n=4 then '{"fixture":true}'::jsonb end,clock_timestamp()+n*interval '1 second',clock_timestamp(),case when n=4 then 'deleted' else 'retained' end from generate_series(1,4)n;
select is(public.m15_05_backup_control('15000000-0000-4000-8000-000000000120','backup-worker','run/list','{"kind":"capture","limit":1,"certifiedOnly":true}')->'result'->'items'->0->>'id','15000000-0000-4000-8000-000000000121','newer failed/cancelled captures never hide retained certified parent');
select is(public.m15_05_backup_control('15000000-0000-4000-8000-000000000120','backup-worker','run/list','{"kind":"capture","limit":1}')->'result'->'items'->0->>'id','15000000-0000-4000-8000-000000000124','ordinary public history still includes latest tombstone');
select is(public.m15_05_backup_control('15000000-0000-4000-8000-000000000120','backup-worker','run/list','{"kind":"capture","limit":1,"certifiedOnly":"true"}')->'result'->'items'->0->>'id','15000000-0000-4000-8000-000000000124','only literal true enables private selection');
update public.backup_runs set cleanup_state='deleted' where id='15000000-0000-4000-8000-000000000121';
select is(public.m15_05_backup_control('15000000-0000-4000-8000-000000000120','backup-worker','run/list','{"kind":"capture","limit":1,"certifiedOnly":true}')->'result'->'items','[]'::jsonb,'deleted chains cannot authorize automatic verification');
select * from finish();
rollback;
