begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(9);
-- Synthetic row fixture isolates admission semantics; no capture/restore claim.
insert into public.backup_policies(instance_id,configuration,configuration_digest,approved_by,mutation_key,mutation_digest)
 values('15000000-0000-4000-8000-000000000110','{"retentionDays":30}',repeat('a',64),'sql-fixture',gen_random_uuid(),repeat('a',64));
insert into public.backup_runs(id,instance_id,kind,state,stage,configuration_revision,configuration,configuration_digest,idempotency_key,request_digest,actor_id,lease_owner,lease_expires_at,pause_started_at,pause_deadline_at)
 values('15000000-0000-4000-8000-000000000111','15000000-0000-4000-8000-000000000110','capture','running','fencing',1,'{}',repeat('a',64),gen_random_uuid(),repeat('a',64),'sql-fixture','capture-worker',clock_timestamp()+interval '60 seconds',clock_timestamp(),clock_timestamp()+interval '120 seconds');
select is(public.m15_05_backup_control('15000000-0000-4000-8000-000000000110','backup-worker','alerts/reconcile','{}')->>'outcome','ok','overdue maintenance skips active cut without audit');
select is(public.m15_05_backup_control('15000000-0000-4000-8000-000000000110','backup-worker','run/claim','{"workerId":"other-worker","kind":"verification"}')->>'outcome','empty','worker claim pauses during cut');
select is(public.m15_05_backup_control('15000000-0000-4000-8000-000000000110','backup-worker','schedule/enqueue','{}')->>'outcome','empty','scheduler admission pauses during cut');
select is(public.m15_05_backup_control('15000000-0000-4000-8000-000000000110','backup-worker','policy/validated','{}')->'result','null'::jsonb,'validation receipts wait until cut releases');
select is(public.m15_05_backup_control('15000000-0000-4000-8000-000000000110','backup-worker','policy/update','{}')->>'outcome','conflict','policy cannot change during cut');
select is(public.m15_05_backup_control('15000000-0000-4000-8000-000000000110','backup-worker','run/create','{}')->>'outcome','conflict','new user work cannot enter cut');
select is(public.m15_05_backup_control('15000000-0000-4000-8000-000000000110','backup-worker','run/heartbeat','{"runId":"15000000-0000-4000-8000-000000000111","workerId":"capture-worker","expectedVersion":1,"progress":1}')->'result'->>'version','2','heartbeat remains live during active cut');
select is(public.m15_05_backup_control('15000000-0000-4000-8000-000000000110','backup-worker','run/cancel','{"runId":"15000000-0000-4000-8000-000000000111","expectedVersion":2,"idempotencyKey":"15000000-0000-4000-8000-000000000112"}')->'result'->>'state','cancelled','explicit cancellation remains authorized during cut');
select is((select count(*)::integer from public.audit_logs where entity_id='15000000-0000-4000-8000-000000000111' and action='backup.cancelled'),1,'cancellation critical receipt remains atomic');
select * from finish();
rollback;
