\set ON_ERROR_STOP on
begin;
create function pg_temp.check(p_label text,p_ok boolean) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'FAIL %',p_label; end if; raise notice 'ok %',p_label; end $$;
do $$
declare v_org uuid:='00000000-0000-4000-8000-0000000000ca'; v_owner uuid; v_admin uuid;
 v_finding uuid; v_group_id uuid:=gen_random_uuid(); v_row record; v_source_revision text; v_route_version bigint;
begin
 select id into v_owner from public.users where email='owner@cra.test';
 select id into v_admin from public.users where email='admin@cra.test';
 select id into v_finding from public.vulnerability_findings
  where organization_id=v_org and canonical_advisory_id='CVE-2026-99001' limit 1;
 select * into v_row from public.m1201_get_task(v_org,v_owner,'finding_triage',v_finding);
 v_source_revision:=v_row.task->>'sourceRevision'; v_route_version:=(v_row.task->>'routeVersion')::bigint;
 perform pg_temp.check('Active user fixture available',v_row.outcome='found');
 update public.users set is_active=false where id=v_owner;
 select * into v_row from public.m1201_manage_group(v_org,v_owner,'create',null,'M12 fence test',null,null,v_group_id);
 perform pg_temp.check('Inactive group actor denied',v_row.outcome='forbidden');
 select * into v_row from public.m1201_manage_absence(v_org,v_owner,'create',null,clock_timestamp()+interval '1 day',
  clock_timestamp()+interval '2 days',v_admin,null,gen_random_uuid());
 perform pg_temp.check('Inactive absence actor denied',v_row.outcome='forbidden');
 select * into v_row from public.m1201_route_task(v_org,v_owner,'finding_triage',v_finding,'assign',v_admin,null,
  v_route_version,v_source_revision,gen_random_uuid(),null);
 perform pg_temp.check('Inactive route actor denied',v_row.outcome='not_found');
 update public.users set is_active=true where id=v_owner;
 select * into v_row from public.m1201_manage_group(v_org,v_owner,'create',null,'M12 fence test',null,null,v_group_id);
 perform pg_temp.check('Active owner may prepare group fixture',v_row.outcome='updated');
 update public.users set is_active=false where id=v_admin;
 select * into v_row from public.m1201_manage_group(v_org,v_owner,'add_member',v_group_id,null,v_admin,1,gen_random_uuid());
 perform pg_temp.check('Inactive group target denied',v_row.outcome='invalid_request');
 select * into v_row from public.m1201_manage_absence(v_org,v_owner,'create',null,clock_timestamp()+interval '1 day',
  clock_timestamp()+interval '2 days',v_admin,null,gen_random_uuid());
 perform pg_temp.check('Inactive substitute denied',v_row.outcome='invalid_request');
 select * into v_row from public.m1201_route_task(v_org,v_owner,'finding_triage',v_finding,'assign',v_admin,null,
  v_route_version,v_source_revision,gen_random_uuid(),null);
 perform pg_temp.check('Inactive route target denied',v_row.outcome='invalid_request');
 update public.users set is_active=true where id=v_admin;
 delete from public.organization_members where organization_id=v_org and user_id=v_admin;
 select * into v_row from public.m1201_manage_group(v_org,v_admin,'create',null,'Removed member group',null,null,gen_random_uuid());
 perform pg_temp.check('Removed group admin denied',v_row.outcome='forbidden');
 select * into v_row from public.m1201_manage_absence(v_org,v_admin,'create',null,clock_timestamp()+interval '1 day',
  clock_timestamp()+interval '2 days',v_owner,null,gen_random_uuid());
 perform pg_temp.check('Removed absence actor denied',v_row.outcome='forbidden');
 select * into v_row from public.m1201_manage_group(v_org,v_owner,'add_member',v_group_id,null,v_admin,1,gen_random_uuid());
 perform pg_temp.check('Removed group target denied',v_row.outcome='invalid_request');
 select * into v_row from public.m1201_manage_absence(v_org,v_owner,'create',null,clock_timestamp()+interval '1 day',
  clock_timestamp()+interval '2 days',v_admin,null,gen_random_uuid());
 perform pg_temp.check('Removed substitute denied',v_row.outcome='invalid_request');
 perform pg_temp.check('Rejected route did not persist',not exists(select 1 from public.workflow_task_routes
  where organization_id=v_org and task_type='finding_triage' and source_id=v_finding));
end $$;
rollback;
