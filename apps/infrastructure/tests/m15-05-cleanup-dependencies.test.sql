begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select plan(5);
-- Deliberately synthetic metadata fixtures test dependency policy, not restoration.
insert into public.backup_policies(instance_id,configuration,configuration_digest,approved_by,mutation_key,mutation_digest)
 values('15000000-0000-4000-8000-000000000080','{"retentionDays":30}',repeat('a',64),'sql-fixture',gen_random_uuid(),repeat('a',64));
insert into public.backup_runs(id,instance_id,kind,state,stage,progress,configuration_revision,configuration,configuration_digest,idempotency_key,request_digest,actor_id,certificate,created_at,completed_at,covered_organization_ids)
 select ('15000000-0000-4000-8000-00000000008'||n)::uuid,'15000000-0000-4000-8000-000000000080','capture','certified','completed',100,1,'{}',repeat('a',64),gen_random_uuid(),repeat('a',64),'sql-fixture',jsonb_build_object('baseRunId','15000000-0000-4000-8000-00000000008'||n),clock_timestamp()-interval '50 days',clock_timestamp()-interval '40 days',array(select id from public.organizations) from generate_series(1,3)n;
insert into public.backup_runs(id,instance_id,kind,parent_capture_id,state,stage,progress,configuration_revision,configuration,configuration_digest,idempotency_key,request_digest,actor_id,verification,created_at,completed_at)
 select ('15000000-0000-4000-8000-00000000009'||n)::uuid,'15000000-0000-4000-8000-000000000080','verification',('15000000-0000-4000-8000-00000000008'||n)::uuid,'verified','completed',100,1,'{}',repeat('a',64),gen_random_uuid(),repeat('a',64),'sql-fixture','{"fixture":true}',clock_timestamp()-interval '40 days',clock_timestamp()-interval '39 days' from generate_series(1,3)n;
select ok((public.m15_05_cleanup_review(r)->'blockers') ? 'required_dependency','retained verified child blocks parent capture deletion') from public.backup_runs r where id='15000000-0000-4000-8000-000000000081';
select ok(not (public.m15_05_cleanup_review(r)->'blockers') ? 'last_recoverable_chain','two other independently verified base chains remain') from public.backup_runs r where id='15000000-0000-4000-8000-000000000081';
update public.backup_runs set cleanup_state='deleted',deleted_at=clock_timestamp() where id='15000000-0000-4000-8000-000000000091';
select ok(not (public.m15_05_cleanup_review(r)->'blockers') ? 'required_dependency','explicitly tombstoned verification releases dependency only') from public.backup_runs r where id='15000000-0000-4000-8000-000000000081';
update public.backup_runs set cleanup_state='deleted',deleted_at=clock_timestamp() where id='15000000-0000-4000-8000-000000000092';
select ok((public.m15_05_cleanup_review(r)->'blockers') ? 'last_recoverable_chain','insufficient remaining verified base chains blocks deletion') from public.backup_runs r where id='15000000-0000-4000-8000-000000000081';
select throws_ok($$set local role authenticated;select * from public.backup_runs$$,'42501','permission denied for table backup_runs','real browser role cannot read backup rows');
select * from finish();
rollback;
