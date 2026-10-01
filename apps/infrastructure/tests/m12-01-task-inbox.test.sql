\set ON_ERROR_STOP on
begin;
create function pg_temp.check(p_label text,p_ok boolean) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'FAIL %',p_label; end if; raise notice 'ok %',p_label; end $$;

select pg_temp.check('Workflow tables have non-forced RLS',not exists(select 1 from pg_class
 where oid in ('public.workflow_task_groups'::regclass,'public.workflow_task_group_members'::regclass,
 'public.workflow_task_routes'::regclass,'public.workflow_out_of_office'::regclass,'public.workflow_task_commands'::regclass)
 and (not relrowsecurity or relforcerowsecurity)));
select pg_temp.check('Browser roles cannot read routing metadata',not has_table_privilege('authenticated','public.workflow_task_routes','select')
 and not has_table_privilege('anon','public.workflow_task_routes','select'));
select pg_temp.check('Service role cannot bypass atomic route writes',not has_table_privilege('service_role','public.workflow_task_routes','insert')
 and not has_table_privilege('service_role','public.workflow_task_groups','insert'));
select pg_temp.check('Workflow functions pin search path',not exists(select 1 from pg_proc
 where proname like 'm1201_%' and proconfig is distinct from array['search_path=public, pg_temp']));

do $$
declare v_org uuid:='00000000-0000-4000-8000-0000000000ca'; v_owner uuid; v_member uuid; v_admin uuid; v_viewer uuid;
 v_group jsonb; v_task jsonb; v_fast jsonb; v_claim_task jsonb; v_finding uuid; v_row record; v_key uuid;
 v_absence_id uuid; v_other_org uuid:=gen_random_uuid(); v_cursor text; v_due_finding uuid:=gen_random_uuid();
 v_source_due timestamptz; v_m5_due timestamptz;
begin
 select id into v_owner from public.users where email='owner@cra.test';
 select id into v_member from public.users where email='member@cra.test';
 select id into v_admin from public.users where email='admin@cra.test';
 select id into v_viewer from public.users where email='viewer@cra.test';
 perform pg_temp.check('Seeded owner and member available',v_owner is not null and v_member is not null);
 select * into v_row from public.m1201_manage_group(v_org,v_member,'create',null,'Rejected',null,null,gen_random_uuid());
 perform pg_temp.check('Member cannot manage groups',v_row.outcome='forbidden');
 select * into v_row from public.m1201_manage_group(v_org,v_owner,'create',null,'Inbox reviewers',null,null,gen_random_uuid());
 v_group:=v_row."group";
 perform pg_temp.check('Owner creates group',v_row.outcome='updated' and (v_group->>'name')='Inbox reviewers');
 select * into v_row from public.m1201_manage_group(v_org,v_owner,null,(v_group->>'id')::uuid,null,v_member,
  (v_group->>'version')::bigint,gen_random_uuid());
 perform pg_temp.check('Null group action is rejected',v_row.outcome='invalid_request'
  and (public.m1201_group_json(v_org,(v_group->>'id')::uuid)->>'version')::bigint=(v_group->>'version')::bigint);
 select * into v_row from public.m1201_manage_group(v_org,v_owner,'add_member',(v_group->>'id')::uuid,null,v_member,(v_group->>'version')::bigint,gen_random_uuid());
 perform pg_temp.check('Owner adds member with version fence',v_row.outcome='updated');
 v_group:=v_row."group";
 select * into v_row from public.m1201_manage_group(v_org,v_owner,'add_member',(v_group->>'id')::uuid,null,v_admin,(v_group->>'version')::bigint,gen_random_uuid());
 perform pg_temp.check('Eligible admin joins group',v_row.outcome='updated');
 v_group:=v_row."group";
 select * into v_row from public.m1201_manage_group(v_org,v_owner,'add_member',(v_group->>'id')::uuid,null,v_member,(v_group->>'version')::bigint-1,gen_random_uuid());
 perform pg_temp.check('Concurrent stale membership edit conflicts',v_row.outcome='conflict');
 select * into v_row from public.m1201_manage_absence(v_org,v_owner,'create',null,clock_timestamp()+interval '1 day',clock_timestamp()+interval '3 days',v_member,null,gen_random_uuid());
 perform pg_temp.check('Eligible substitute creates absence',v_row.outcome='updated');
 select * into v_row from public.m1201_manage_absence(v_org,v_owner,null,(v_row.absence->>'id')::uuid,
  null,null,null,1,gen_random_uuid());
 perform pg_temp.check('Null absence action is rejected',v_row.outcome='invalid_request');
 select * into v_row from public.m1201_manage_absence(v_org,v_owner,'create',null,clock_timestamp()+interval '2 days',clock_timestamp()+interval '4 days',v_member,null,gen_random_uuid());
 perform pg_temp.check('Overlapping interval is rejected',v_row.outcome='conflict');
 select * into v_row from public.m1201_list_tasks(v_org,v_owner,'mine',null,null,null,null,null,null,50);
 perform pg_temp.check('Live task list has safe counts',v_row.outcome='found' and jsonb_typeof(v_row.counts)='object');
 select * into v_row from public.m1201_list_tasks(v_org,v_owner,'all',null,null,null,null,null,null,1);
 v_cursor:=v_row.next_cursor;
 perform pg_temp.check('Task cursor is URL-safe',v_cursor ~ '^[A-Za-z0-9_-]+$' and char_length(v_cursor)<=2048);
 select * into v_row from public.m1201_list_tasks(v_org,v_owner,'all',null,null,null,null,null,v_cursor,1);
 perform pg_temp.check('Task cursor round-trips',v_row.outcome='found' and jsonb_array_length(v_row.tasks)=1);
 select * into v_row from public.m1201_list_tasks(v_org,v_owner,null,null,null,null,null,null,null,50);
 perform pg_temp.check('Null scope is rejected',v_row.outcome='invalid_request');
 select * into v_row from public.m1201_list_tasks(v_org,v_owner,'mine',null,null,null,null,null,null,null);
 perform pg_temp.check('Null limit is rejected',v_row.outcome='invalid_request');
 select id into v_finding from public.vulnerability_findings where organization_id=v_org and canonical_advisory_id='CVE-2026-99001' limit 1;
 insert into public.vulnerability_findings
 select (jsonb_populate_record(null::public.vulnerability_findings,to_jsonb(f)||jsonb_build_object(
  'id',v_due_finding,'component_identity','m12-due-'||v_due_finding::text,'canonical_advisory_id','M12-DUE-PARITY'))).*
 from public.vulnerability_findings f where f.organization_id=v_org and f.id=v_finding;
 insert into public.vulnerability_finding_triage_states(organization_id,finding_id,last_observed_severity,sla_severity,
  sla_policy_version,sla_target_minutes,sla_started_at,sla_elapsed_seconds,sla_paused_at,version,updated_by)
 values(v_org,v_due_finding,'high','high',1,60,clock_timestamp()-interval '20 minutes',600,clock_timestamp()-interval '5 minutes',1,v_owner);
 perform pg_temp.check('Narrow paused SLA due matches M5 projection',
  public.m1201_finding_triage_due_at(v_org,v_due_finding)=(public.m5_triage_operational_json_m5_04(v_org,v_due_finding)->'internalSla'->>'dueAt')::timestamptz);
 update public.vulnerability_finding_triage_states set sla_paused_at=null,sla_breached_at=clock_timestamp()-interval '1 minute'
 where organization_id=v_org and finding_id=v_due_finding;
 perform pg_temp.check('Narrow breached SLA due matches M5 projection',
  public.m1201_finding_triage_due_at(v_org,v_due_finding)=(public.m5_triage_operational_json_m5_04(v_org,v_due_finding)->'internalSla'->>'dueAt')::timestamptz);
 select * into v_row from public.m1201_list_tasks(v_org,v_owner,'all','finding_triage',null,null,null,null,null,100);
 select value into v_fast from jsonb_array_elements(v_row.tasks) where value->>'sourceId'=v_due_finding::text;
 perform pg_temp.check('Unrouted list row matches source-policy row',v_fast is not null
  and v_fast=public.m1201_task_row(v_org,v_owner,'finding_triage',v_due_finding));
 select * into v_row from public.m1201_manage_absence(v_org,v_owner,'create',null,
  clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour',v_admin,null,gen_random_uuid());
 v_absence_id:=(v_row.absence->>'id')::uuid;
 perform pg_temp.check('Active substitute fixture is accepted',v_row.outcome='updated');
 select * into v_row from public.m1201_list_tasks(v_org,v_owner,'all','finding_triage',null,null,null,null,null,100);
 select value into v_fast from jsonb_array_elements(v_row.tasks) where value->>'sourceId'=v_due_finding::text;
 perform pg_temp.check('Unrouted absence keeps source-policy parity',v_fast->>'actingUserId'=v_admin::text
  and v_fast=public.m1201_task_row(v_org,v_owner,'finding_triage',v_due_finding));
 select * into v_row from public.m1201_manage_absence(v_org,v_owner,'delete',v_absence_id,
  null,null,null,1,gen_random_uuid());
 perform pg_temp.check('Active substitute fixture is removed',v_row.outcome='updated');
 update public.vulnerability_finding_triage_states set assignee_user_id=v_viewer,version=version+1
 where organization_id=v_org and finding_id=v_due_finding;
 select * into v_row from public.m1201_list_tasks(v_org,v_owner,'all','finding_triage',null,null,null,null,null,100);
 select value into v_fast from jsonb_array_elements(v_row.tasks) where value->>'sourceId'=v_due_finding::text;
 perform pg_temp.check('Ineligible source owner stays unresolved with boolean actions',v_fast is not null
  and v_fast->>'unresolvedAssignment'='true' and v_fast->'effectiveAssigneeUserId'='null'::jsonb
  and v_fast->>'canDelegate'='false'
  and v_fast=public.m1201_task_row(v_org,v_owner,'finding_triage',v_due_finding));
 select * into v_row from public.m1201_get_task(v_org,v_owner,'finding_triage',v_finding);
 v_task:=v_row.task;
 perform pg_temp.check('Live finding source is actionable',v_row.outcome='found' and v_task->>'state'='open');
 select * into v_row from public.m1201_get_task(v_other_org,v_owner,'finding_triage',v_finding);
 perform pg_temp.check('Tenant substitution cannot read source',v_row.outcome='not_found');
 select * into v_row from public.m1201_route_task(v_other_org,v_owner,'finding_triage',v_finding,'assign',v_admin,null,
  0,v_task->>'sourceRevision',gen_random_uuid(),null);
 perform pg_temp.check('Tenant substitution cannot mutate source',v_row.outcome='not_found');
 select * into v_row from public.m1201_route_task(v_org,v_owner,'finding_triage',gen_random_uuid(),'assign',v_admin,null,
  0,v_task->>'sourceRevision',gen_random_uuid(),null);
 perform pg_temp.check('Missing source is a safe not_found',v_row.outcome='not_found');
 select * into v_row from public.m1201_route_task(v_org,v_owner,'finding_triage',v_finding,'assign',null,(v_group->>'id')::uuid,
  (v_task->>'routeVersion')::bigint,v_task->>'sourceRevision',gen_random_uuid(),null);
 perform pg_temp.check('Group assignment is atomic',v_row.outcome='updated' and v_row.task->>'groupId'=v_group->>'id');
 v_task:=v_row.task;
 perform pg_temp.check('Unclaimed group task is available',v_task->>'effectiveAssigneeUserId' is null);
 select * into v_row from public.m1201_route_task(v_org,v_owner,'finding_triage',v_finding,null,null,null,
  (v_task->>'routeVersion')::bigint,v_task->>'sourceRevision',gen_random_uuid(),null);
 perform pg_temp.check('Null route action is rejected',v_row.outcome='invalid_request');
 select * into v_row from public.m1201_route_task(v_org,v_admin,'finding_triage',v_finding,'claim',null,null,
  (v_task->>'routeVersion')::bigint,v_task->>'sourceRevision',gen_random_uuid(),null);
 perform pg_temp.check('Eligible group member claims once',v_row.outcome='updated' and v_row.task->>'effectiveAssigneeUserId'=v_admin::text);
 v_claim_task:=v_row.task;
 select * into v_row from public.m1201_manage_group(v_org,v_owner,'remove_member',(v_group->>'id')::uuid,null,v_admin,
  (v_group->>'version')::bigint,gen_random_uuid());
 perform pg_temp.check('Owner can remove claimant from group',v_row.outcome='updated');
 select * into v_row from public.m1201_get_task(v_org,v_owner,'finding_triage',v_finding);
 perform pg_temp.check('Removed claimant becomes unresolved with accountable fallback',v_row.task->>'unresolvedAssignment'='true'
  and v_row.task->>'effectiveAssigneeUserId'=v_owner::text);
 v_key:=gen_random_uuid();
 select * into v_row from public.m1201_route_task(v_org,v_owner,'finding_triage',v_finding,'assign',v_admin,null,
  (v_claim_task->>'routeVersion')::bigint,v_claim_task->>'sourceRevision',v_key,null);
 perform pg_temp.check('Individual triage assignment advances source and route together',v_row.outcome='updated'
  and v_row.task->>'sourceRevision'='2' and v_row.task->>'accountableOwnerUserId'=v_admin::text
  and v_row.task->>'unresolvedAssignment'='false');
 v_task:=v_row.task;
 select * into v_row from public.m1201_route_task(v_org,v_owner,'finding_triage',v_finding,'assign',v_admin,null,
  2,'1',v_key,null);
 perform pg_temp.check('Same request replays its committed result',v_row.outcome='replayed'
  and v_row.task->>'routeVersion'=v_task->>'routeVersion');
 select * into v_row from public.m1201_route_task(v_org,v_owner,'finding_triage',v_finding,'assign',v_owner,null,
  (v_task->>'routeVersion')::bigint,'1',gen_random_uuid(),null);
 perform pg_temp.check('Stale source revision conflicts',v_row.outcome='conflict');
 select * into v_row from public.m1201_route_task(v_org,v_owner,'finding_triage',v_finding,'release',null,null,
  (v_task->>'routeVersion')::bigint,v_task->>'sourceRevision',gen_random_uuid(),null);
 perform pg_temp.check('Unclaimed route cannot be released',v_row.outcome='forbidden');
 select * into v_row from public.m1201_route_task(v_org,v_owner,'finding_triage',v_finding,'claim',null,null,
  1,'1',gen_random_uuid(),null);
 perform pg_temp.check('Stale concurrent claim conflicts',v_row.outcome='conflict');
 select * into v_row from public.m1201_manage_absence(v_org,v_admin,'create',null,clock_timestamp()-interval '1 hour',
  clock_timestamp()+interval '1 hour',v_owner,null,gen_random_uuid());
 v_absence_id:=(v_row.absence->>'id')::uuid;
 perform pg_temp.check('Owner substitute accepts active absence',v_row.outcome='updated');
 select * into v_row from public.m1201_get_task(v_org,v_admin,'finding_triage',v_finding);
 perform pg_temp.check('Active OOO changes acting user without changing accountable owner',v_row.task->>'actingUserId'=v_owner::text
  and v_row.task->>'accountableOwnerUserId'=v_admin::text and v_row.task->>'canDelegate'='false');
 update public.workflow_out_of_office set ends_at=now()-interval '1 second' where id=v_absence_id;
 select * into v_row from public.m1201_get_task(v_org,v_admin,'finding_triage',v_finding);
 perform pg_temp.check('Expired OOO restores acting owner',v_row.task->>'actingUserId'=v_admin::text);
 update public.vulnerability_findings set status='superseded',superseded_at=clock_timestamp() where organization_id=v_org and id=v_finding;
 select * into v_row from public.m1201_get_task(v_org,v_admin,'finding_triage',v_finding);
 perform pg_temp.check('Source completion disappears immediately',v_row.outcome='not_found');
 update public.vulnerability_findings set status='active',superseded_at=null where organization_id=v_org and id=v_finding;
 select * into v_row from public.m1201_get_task(v_org,v_admin,'finding_triage',v_finding);
 perform pg_temp.check('Source reopen projects immediately',v_row.outcome='found');
 perform pg_temp.check('M5 no-policy SLA has no inbox due date',
  public.m1201_source(v_org,v_admin,'finding_triage',v_finding)->>'dueAt' is null);
 update public.vulnerability_finding_triage_states set sla_severity='high',sla_policy_version=1,
  sla_target_minutes=60,sla_started_at=clock_timestamp()-interval '30 minutes',sla_elapsed_seconds=0,
  sla_paused_at=null,sla_breached_at=null where organization_id=v_org and finding_id=v_finding;
 v_source_due:=(public.m1201_source(v_org,v_admin,'finding_triage',v_finding)->>'dueAt')::timestamptz;
 v_m5_due:=(public.m5_triage_operational_json_m5_04(v_org,v_finding)->'internalSla'->>'dueAt')::timestamptz;
 perform pg_temp.check('Tracking SLA due matches M5',abs(extract(epoch from v_source_due-v_m5_due))<=1);
 update public.vulnerability_finding_triage_states set sla_paused_at=clock_timestamp(),
  sla_elapsed_seconds=600 where organization_id=v_org and finding_id=v_finding;
 v_source_due:=(public.m1201_source(v_org,v_admin,'finding_triage',v_finding)->>'dueAt')::timestamptz;
 v_m5_due:=(public.m5_triage_operational_json_m5_04(v_org,v_finding)->'internalSla'->>'dueAt')::timestamptz;
 perform pg_temp.check('Paused SLA due matches M5',abs(extract(epoch from v_source_due-v_m5_due))<=1);
 update public.vulnerability_finding_triage_states set sla_breached_at=clock_timestamp()-interval '1 hour'
  where organization_id=v_org and finding_id=v_finding;
 v_source_due:=(public.m1201_source(v_org,v_admin,'finding_triage',v_finding)->>'dueAt')::timestamptz;
 v_m5_due:=(public.m5_triage_operational_json_m5_04(v_org,v_finding)->'internalSla'->>'dueAt')::timestamptz;
 perform pg_temp.check('Breached SLA due matches M5',abs(extract(epoch from v_source_due-v_m5_due))<=1);
 update public.vulnerability_finding_triage_states set sla_paused_at=null,sla_breached_at=null,
  sla_elapsed_seconds=7200 where organization_id=v_org and finding_id=v_finding;
 v_source_due:=(public.m1201_source(v_org,v_admin,'finding_triage',v_finding)->>'dueAt')::timestamptz;
 v_m5_due:=(public.m5_triage_operational_json_m5_04(v_org,v_finding)->'internalSla'->>'dueAt')::timestamptz;
 perform pg_temp.check('Overdue tracking due matches M5 clamp',abs(extract(epoch from v_source_due-v_m5_due))<=1);
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions)
  values(v_org,'owner','{"can_view_findings":false}'::jsonb);
 select * into v_row from public.m1201_get_task(v_org,v_owner,'finding_triage',v_finding);
 perform pg_temp.check('Permission revocation removes source title and detail',v_row.outcome='not_found' and v_row.task is null);
 select * into v_row from public.m1201_route_task(v_org,v_owner,'finding_triage',v_finding,'assign',v_admin,null,
  2,'1',v_key,null);
 perform pg_temp.check('Idempotency replay after revocation does not leak title',v_row.outcome='not_found');
end $$;
rollback;
