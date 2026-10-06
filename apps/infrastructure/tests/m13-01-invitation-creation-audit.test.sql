begin;

create or replace function pg_temp.check(p_name text,p_ok boolean)
returns void language plpgsql as $$
begin if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if; end $$;

select pg_temp.check('invitation create RPC is service role only',
  to_regprocedure('public.m13_01_create_invitation_atomic(uuid,uuid,text,text,text,text,text,timestamptz,uuid,inet)') is not null
  and has_function_privilege('service_role',
    'public.m13_01_create_invitation_atomic(uuid,uuid,text,text,text,text,text,timestamptz,uuid,inet)','execute')
  and not has_function_privilege('authenticated',
    'public.m13_01_create_invitation_atomic(uuid,uuid,text,text,text,text,text,timestamptz,uuid,inet)','execute'));
select pg_temp.check('failed delivery compensation RPC is service role only',
  to_regprocedure('public.m13_01_cancel_failed_invitation_delivery_atomic(uuid,uuid,uuid,text)') is not null
  and has_function_privilege('service_role',
    'public.m13_01_cancel_failed_invitation_delivery_atomic(uuid,uuid,uuid,text)','execute')
  and not has_function_privilege('authenticated',
    'public.m13_01_cancel_failed_invitation_delivery_atomic(uuid,uuid,uuid,text)','execute'));

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_viewer uuid;
  v_email text := 'm13-invite-'||gen_random_uuid()::text||'@cra.test';
  v_result record;
  v_duplicate record;
  v_forbidden record;
  v_wrong_org record;
  v_retry record;
  v_cancel text;
begin
  select id into strict v_owner from public.users where email='owner@cra.test';
  select id into strict v_viewer from public.users where email='viewer@cra.test';

  select * into v_result from public.m13_01_create_invitation_atomic(
    v_org,v_owner,v_email,'member','M13','Fixture',repeat('a',64),
    now()+interval '7 days',gen_random_uuid(),'127.0.0.1'::inet);
  perform pg_temp.check('created invitation has one same-transaction v2 fact',
    v_result.outcome='created' and v_result.invitation_id is not null
    and exists(select 1 from public.invitations i where i.id=v_result.invitation_id
      and i.organization_id=v_org and i.email=v_email)
    and (select count(*)=1 from public.audit_logs a
      where a.organization_id=v_org and a.entity_id=v_result.invitation_id::text
        and a.action='invitation.created' and a.schema_version=2
        and a.event_key='invitation.create:'||v_result.invitation_id::text
        and a.after_redacted->>'role'='member'
        and a.after_redacted->>'status'='pending'));
  perform pg_temp.check('audit does not retain email, names, or token hash',
    not exists(select 1 from public.audit_logs a
      where a.entity_id=v_result.invitation_id::text
        and (row_to_json(a)::text like '%'||v_email||'%'
          or row_to_json(a)::text like '%Fixture%'
          or row_to_json(a)::text like '%'||repeat('a',64)||'%')));

  select * into v_duplicate from public.m13_01_create_invitation_atomic(
    v_org,v_owner,v_email,'member',null,null,repeat('b',64),
    now()+interval '7 days',gen_random_uuid(),null);
  perform pg_temp.check('concurrent-style duplicate does not create another event',
    v_duplicate.outcome='invitation_pending' and v_duplicate.invitation_id is null
    and (select count(*)=1 from public.audit_logs a
      where a.organization_id=v_org and a.action='invitation.created'
        and a.entity_id=v_result.invitation_id::text));

  v_cancel := public.m13_01_cancel_failed_invitation_delivery_atomic(
    v_org,v_result.invitation_id,v_owner,repeat('a',64));
  perform pg_temp.check('failed mail token is cancelled with separate audit',
    v_cancel='cancelled'
    and exists(select 1 from public.invitations i where i.id=v_result.invitation_id
      and i.status='revoked' and i.revoked_at is not null)
    and exists(select 1 from public.audit_logs a
      where a.organization_id=v_org and a.entity_id=v_result.invitation_id::text
        and a.action='invitation.delivery_cancelled' and a.schema_version=2
        and a.reason='notification_failed'));
  perform pg_temp.check('old token cannot cancel a changed invitation',
    public.m13_01_cancel_failed_invitation_delivery_atomic(
      v_org,v_result.invitation_id,v_owner,repeat('a',64))='changed');
  select * into v_retry from public.m13_01_create_invitation_atomic(
    v_org,v_owner,v_email,'member',null,null,repeat('f',64),
    now()+interval '7 days',gen_random_uuid(),null);
  perform pg_temp.check('retry after failed mail creates a fresh link',
    v_retry.outcome='created' and v_retry.invitation_id<>v_result.invitation_id);
  update public.invitations set token_hash=repeat('9',64)
    where id=v_retry.invitation_id and organization_id=v_org;
  perform pg_temp.check('old failed attempt cannot revoke a rotated resend token',
    public.m13_01_cancel_failed_invitation_delivery_atomic(
      v_org,v_retry.invitation_id,v_owner,repeat('f',64))='changed'
    and exists(select 1 from public.invitations i where i.id=v_retry.invitation_id
      and i.status='pending' and i.token_hash=repeat('9',64)));

  select * into v_forbidden from public.m13_01_create_invitation_atomic(
    v_org,v_viewer,'m13-denied-'||gen_random_uuid()::text||'@cra.test',
    'member',null,null,repeat('c',64),now()+interval '7 days',gen_random_uuid(),null);
  perform pg_temp.check('viewer permission denied',v_forbidden.outcome='forbidden');

  select * into v_wrong_org from public.m13_01_create_invitation_atomic(
    '00000000-0000-4000-8000-0000000000ff',v_owner,
    'm13-cross-'||gen_random_uuid()::text||'@cra.test',
    'member',null,null,repeat('d',64),now()+interval '7 days',gen_random_uuid(),null);
  perform pg_temp.check('forged organization is hidden',v_wrong_org.outcome='organization_not_found');
end $$;

create or replace function pg_temp.fail_invitation_audit()
returns trigger language plpgsql as $$
begin
  if new.action='invitation.created' then
    raise exception 'injected audit outage';
  end if;
  return new;
end $$;
create trigger m13_test_fail_invitation_audit before insert on public.audit_logs
  for each row execute function pg_temp.fail_invitation_audit();

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_email text := 'm13-rollback-'||gen_random_uuid()::text||'@cra.test';
  v_failed boolean := false;
begin
  select id into strict v_owner from public.users where email='owner@cra.test';
  begin
    perform * from public.m13_01_create_invitation_atomic(
      v_org,v_owner,v_email,'member',null,null,repeat('e',64),
      now()+interval '7 days',gen_random_uuid(),null);
  exception when others then v_failed := true;
  end;
  perform pg_temp.check('audit outage aborts invitation creation',v_failed
    and not exists(select 1 from public.invitations where organization_id=v_org and email=v_email));
end $$;

rollback;
