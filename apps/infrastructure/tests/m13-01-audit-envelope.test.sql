begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;

select pg_temp.check('v2 audit envelope columns exist',
  (select count(*)=11 from information_schema.columns
   where table_schema='public' and table_name='audit_logs'
     and column_name in ('schema_version','event_scope','event_key','actor_type',
       'actor_id','outcome','correlation_id','before_redacted','after_redacted',
       'reason','redaction_version')));
select pg_temp.check('atomic append function exists',
  to_regprocedure('public.m13_01_append_audit_event(uuid,text,text,text,text,text,text,text,text,uuid,jsonb,jsonb,text,inet,text,uuid)') is not null);

do $$
declare
  v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_key text:='m13-test:'||gen_random_uuid()::text;
  v_correlation uuid:=gen_random_uuid();
  v_first record;
  v_replay record;
  v_conflict record;
begin
  select id into v_actor from public.users where email='owner@cra.test';
  perform pg_temp.check('seed owner exists',v_actor is not null);
  select * into v_first from public.m13_01_append_audit_event(
    v_org,'organization',v_key,'user',v_actor::text,'test.audit_event',
    'test_resource',gen_random_uuid()::text,'completed',v_correlation,
    jsonb_build_object('status','before','apiKey','plain-secret'),
    jsonb_build_object('status','after','nested',jsonb_build_object('password','canary')),
    'approved',null,null,v_actor);
  perform pg_temp.check('first append inserted',v_first.outcome='inserted' and v_first.audit_id is not null);
  select * into v_replay from public.m13_01_append_audit_event(
    v_org,'organization',v_key,'user',v_actor::text,'test.audit_event',
    'test_resource',(select entity_id from public.audit_logs where id=v_first.audit_id),
    'completed',gen_random_uuid(),
    jsonb_build_object('status','before','apiKey','plain-secret'),
    jsonb_build_object('status','after','nested',jsonb_build_object('password','canary')),
    'approved','127.0.0.2'::inet,'retry-agent',v_actor);
  perform pg_temp.check('same event replays with new observation metadata',
    v_replay.outcome='replayed' and v_replay.audit_id=v_first.audit_id
    and (select correlation_id=v_correlation and ip_address is null and user_agent is null
      from public.audit_logs where id=v_first.audit_id));
  select * into v_conflict from public.m13_01_append_audit_event(
    v_org,'organization',v_key,'user',v_actor::text,'test.audit_event',
    'test_resource',(select entity_id from public.audit_logs where id=v_first.audit_id),
    'completed',v_correlation,
    jsonb_build_object('status','changed'),jsonb_build_object('status','after'),
    'approved',null,null,v_actor);
  perform pg_temp.check('changed event conflicts',v_conflict.outcome='conflict');
  perform pg_temp.check('v2 secrets redacted before storage',
    (select before_redacted->>'apiKey'='[REDACTED]'
       and after_redacted->>'nested'='[REDACTED]'
       and position('plain-secret' in row_to_json(a)::text)=0
       and position('canary' in row_to_json(a)::text)=0
     from public.audit_logs a where a.id=v_first.audit_id));
  perform pg_temp.check('single persisted event',
    (select count(*)=1 from public.audit_logs where organization_id=v_org and event_key=v_key));
end $$;

do $$
declare v_result record;
begin
  select * into v_result from public.m13_01_append_audit_event(
    null,'security','m13-test:'||gen_random_uuid()::text,'system','anonymous',
    'auth.sign_in_failed','authentication',null,'failed',gen_random_uuid(),
    null,jsonb_build_object('password','not-for-storage','notes','123456',
      'status','failed','count',2),
    'OTP 123456',null,null,null);
  perform pg_temp.check('pre-tenant security event inserted',v_result.outcome='inserted');
  perform pg_temp.check('security event has protected scope',
    (select organization_id is null and event_scope='security'
      and after_redacted->>'notes'='[REDACTED]'
      and after_redacted->>'password'='[REDACTED]'
      and after_redacted->>'status'='failed'
      and after_redacted->>'count'='2'
      and reason='[REDACTED]'
    from public.audit_logs where id=v_result.audit_id));
end $$;

do $$
begin
  begin
    perform * from public.m13_01_append_audit_event(
      '00000000-0000-4000-8000-0000000000ca','security',
      'm13-test:'||gen_random_uuid()::text,'system','anonymous','auth.test',
      'authentication',null,'completed',gen_random_uuid(),null,null,null,null,null,null);
    raise exception 'security scope accepted caller organization';
  exception when check_violation or invalid_parameter_value then null;
  end;
  begin
    perform * from public.m13_01_append_audit_event(
      null,'security','m13-test:'||gen_random_uuid()::text,'system','anonymous',
      'auth.test','authentication',null,'completed',null,null,null,null,null,null,null);
    raise exception 'null correlation accepted';
  exception when check_violation or invalid_parameter_value then null;
  end;
  begin
    perform * from public.m13_01_append_audit_event(
      null,'security','m13-test:'||gen_random_uuid()::text,'system','Bearer actor-secret',
      'auth.test','authentication',null,'completed',gen_random_uuid(),null,null,null,null,null,null);
    raise exception 'unsafe actor accepted';
  exception when check_violation or invalid_parameter_value then null;
  end;
  begin
    perform * from public.m13_01_append_audit_event(
      null,'security','m13-test:'||gen_random_uuid()::text,'system','anonymous',
      'auth.test','authentication',null,'completed',gen_random_uuid(),
      jsonb_build_object('notes',repeat('x',20000)),null,null,null,null,null);
    raise exception 'oversized audit payload accepted';
  exception when check_violation or invalid_parameter_value then null;
  end;
end $$;

do $$
declare v_id uuid:=gen_random_uuid();
begin
  insert into public.audit_logs(id,organization_id,action,entity_type,entity_id,changes)
  values(v_id,'00000000-0000-4000-8000-0000000000ca','test.legacy',
    'test_resource',v_id::text,
    jsonb_build_object('status','queued','token','secret-canary',
      'nested',jsonb_build_object('signedUrl','https://signed.example/canary'),
      'items',jsonb_build_array(jsonb_build_object('apiKey','array-canary')),
      'originalValue','sensitive-supplier-value',
      'correctedValue','different-supplier-value',
      'sourceSpan',jsonb_build_object('text','document-canary'),
      'unsafeText','Bearer long-sensitive-token-value'));
  perform pg_temp.check('prospective legacy secret keys redacted',
    (select changes->>'status'='queued' and changes->>'token'='[REDACTED]'
       and changes #>> '{nested,signedUrl}'='[REDACTED]'
       and changes #>> '{items,0,apiKey}'='[REDACTED]'
       and changes->>'originalValue'='[REDACTED]'
       and changes->>'correctedValue'='[REDACTED]'
       and changes->>'sourceSpan'='[REDACTED]'
       and changes->>'unsafeText'='[REDACTED]'
     from public.audit_logs where id=v_id));
end $$;

do $$
declare v_id uuid:=gen_random_uuid(); v_actor uuid;
begin
  select id into v_actor from public.users where email='owner@cra.test';
  insert into public.audit_logs(
    id,organization_id,action,entity_type,entity_id,schema_version,
    event_scope,event_key,actor_type,actor_id,outcome,correlation_id,
    before_redacted,after_redacted,reason,redaction_version,user_agent
  ) values (
    v_id,'00000000-0000-4000-8000-0000000000ca','test.direct_v2',
    'test_resource',v_id::text,2,'organization','m13-test:'||v_id::text,
    'user',v_actor::text,'completed',gen_random_uuid(),
    jsonb_build_object('notes','123456','role','admin'),
    jsonb_build_object('payload',jsonb_build_object('token','canary')),
    'otp:123456',1,'private-canary'
  );
  perform pg_temp.check('direct v2 insert cannot bypass projection',
    (select before_redacted->>'notes'='[REDACTED]'
      and before_redacted->>'role'='admin'
      and after_redacted->>'payload'='[REDACTED]'
      and reason='[REDACTED]' and user_agent is null
      and position('private-canary' in row_to_json(a)::text)=0
      from public.audit_logs a where id=v_id));
end $$;

do $$
declare
  v_actor uuid:=gen_random_uuid();
  v_event record;
begin
  insert into public.users(id,email)
    values(v_actor,'m13-deleted-actor-'||v_actor::text||'@cra.test');
  select * into v_event from public.m13_01_append_audit_event(
    null,'security','m13-deleted-actor:'||gen_random_uuid()::text,
    'user',v_actor::text,'auth.actor_deleted_probe','authentication',v_actor::text,
    'completed',gen_random_uuid(),null,null,null,null,null,v_actor);
  delete from public.users where id=v_actor;
  perform pg_temp.check('deleted actor keeps stable pseudonymous identity',
    (select user_id=v_actor and actor_id=v_actor::text and actor_type='user'
       from public.audit_logs where id=v_event.audit_id));
end $$;

set local role service_role;
select * from public.m13_01_append_audit_event(
  null,'security','m13-test:11111111-1111-4111-8111-111111111111',
  'system','anonymous','auth.service_role_probe','authentication','anonymous',
  'completed','22222222-2222-4222-8222-222222222222',null,
  jsonb_build_object('status','completed'),null,null,null,null);
reset role;
select pg_temp.check('service role append executes under trigger grants',
  exists(select 1 from public.audit_logs where event_scope='security'
    and event_key='m13-test:11111111-1111-4111-8111-111111111111'));

select pg_temp.check('append-only service grants preserved',
  has_table_privilege('service_role','public.audit_logs','select')
  and has_table_privilege('service_role','public.audit_logs','insert')
  and not has_table_privilege('service_role','public.audit_logs','update')
  and not has_table_privilege('service_role','public.audit_logs','delete'));
select pg_temp.check('audit append RPC restricted to service role',
  has_function_privilege('service_role',
    'public.m13_01_append_audit_event(uuid,text,text,text,text,text,text,text,text,uuid,jsonb,jsonb,text,inet,text,uuid)',
    'execute')
  and not has_function_privilege('anon',
    'public.m13_01_append_audit_event(uuid,text,text,text,text,text,text,text,text,uuid,jsonb,jsonb,text,inet,text,uuid)',
    'execute')
  and not has_function_privilege('authenticated',
    'public.m13_01_append_audit_event(uuid,text,text,text,text,text,text,text,text,uuid,jsonb,jsonb,text,inet,text,uuid)',
    'execute'));

create temp table m13_test_domain_write(id uuid primary key);
create or replace function pg_temp.m13_fail_audit()
returns trigger language plpgsql as $$
begin
  raise exception 'simulated audit-store outage';
end $$;
create trigger m13_test_fail_audit before insert on public.audit_logs
  for each row when (new.action='test.atomic_failure')
  execute function pg_temp.m13_fail_audit();
do $$
declare v_id uuid:=gen_random_uuid(); v_failed boolean:=false;
begin
  begin
    insert into pg_temp.m13_test_domain_write(id) values(v_id);
    perform * from public.m13_01_append_audit_event(
      '00000000-0000-4000-8000-0000000000ca','organization',
      'm13-test:'||v_id::text,'system','test-worker','test.atomic_failure',
      'test_resource',v_id::text,'completed',gen_random_uuid(),null,null,null,null,null,null);
  exception when raise_exception then
    v_failed:=true;
  end;
  perform pg_temp.check('audit outage fails the transaction',v_failed
    and not exists(select 1 from pg_temp.m13_test_domain_write where id=v_id));
end $$;
drop trigger m13_test_fail_audit on public.audit_logs;

rollback;
