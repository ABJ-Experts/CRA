begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;

do $$
declare
  v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_viewer uuid;
  v_obligation uuid;
  v_other_obligation uuid;
  v_pack uuid;
  v_path text;
  v_reserve_key uuid:=gen_random_uuid();
  v_finalize_key uuid:=gen_random_uuid();
  v_correlation uuid:=gen_random_uuid();
  v_reserved record;
  v_replay record;
  v_finalized record;
  v_other record;
  v_mutation_blocked boolean:=false;
begin
  select id into v_actor from public.users where email='owner@cra.test';
  select id into v_viewer from public.users where email='viewer@cra.test';
  perform pg_temp.check('seed owner exists',v_actor is not null);
  perform pg_temp.check('seed viewer exists',v_viewer is not null);
  select (result->'obligation'->>'id')::uuid into v_obligation
    from public.create_reporting_obligation_atomic(v_org,v_actor,'severe_incident',null,
      '2028-02-28 00:00:00+00','M13 pack test',gen_random_uuid(),gen_random_uuid());
  select (result->'obligation'->>'id')::uuid into v_other_obligation
    from public.create_reporting_obligation_atomic(v_org,v_actor,'severe_incident',null,
      '2028-02-28 00:00:00+00','M13 other pack test',gen_random_uuid(),gen_random_uuid());
  perform pg_temp.check('test obligations created',v_obligation is not null and v_other_obligation is not null);

  select * into v_reserved from public.reserve_reporting_obligation_evidence_pack_atomic(
    v_org,v_actor,v_obligation,v_reserve_key,v_correlation);
  v_pack:=(v_reserved.result->'evidencePack'->>'id')::uuid;
  v_path:=v_reserved.result->'evidencePack'->>'objectPath';
  perform pg_temp.check('reservation result remains compatible',
    v_reserved.outcome='created' and v_pack is not null and v_path is not null);
  perform pg_temp.check('reservation emits one authoritative v2 event',
    (select count(*)=1 from public.audit_logs a where a.organization_id=v_org
      and a.schema_version=2 and a.action='reporting.evidence_pack_reserved'
      and a.entity_type='reporting_obligation_evidence_pack' and a.entity_id=v_pack::text
      and a.event_scope='organization' and a.actor_type='user'
      and a.actor_id=v_actor::text and a.outcome='completed'
      and a.correlation_id=v_correlation
      and a.after_redacted->>'state'='reserved'
      and a.after_redacted->>'sourceId'=v_obligation::text
      and a.after_redacted->>'objectPath'='[REDACTED]'
      and a.event_key is not null));

  select * into v_replay from public.reserve_reporting_obligation_evidence_pack_atomic(
    v_org,v_actor,v_obligation,v_reserve_key,gen_random_uuid());
  perform pg_temp.check('reservation replay keeps original pack and one event',
    v_replay.outcome='idempotent' and v_replay.result=v_reserved.result
    and (select count(*)=1 from public.audit_logs where organization_id=v_org
      and action='reporting.evidence_pack_reserved' and entity_id=v_pack::text));
  select * into v_other from public.reserve_reporting_obligation_evidence_pack_atomic(
    v_org,v_actor,v_other_obligation,v_reserve_key,gen_random_uuid());
  perform pg_temp.check('changed reservation payload conflicts without event',
    v_other.outcome='conflict' and (select count(*)=1 from public.audit_logs
      where organization_id=v_org and action='reporting.evidence_pack_reserved'
        and entity_id=v_pack::text));

  select * into v_other from public.reserve_reporting_obligation_evidence_pack_atomic(
    gen_random_uuid(),v_actor,v_obligation,gen_random_uuid(),gen_random_uuid());
  perform pg_temp.check('cross-tenant reservation denied',
    v_other.outcome='forbidden' and v_other.result is null);
  select * into v_other from public.reserve_reporting_obligation_evidence_pack_atomic(
    v_org,v_viewer,v_obligation,gen_random_uuid(),gen_random_uuid());
  perform pg_temp.check('viewer cannot reserve an evidence pack',
    v_other.outcome='forbidden' and v_other.result is null);

  insert into storage.objects(bucket_id,name) values('reporting-evidence',v_path);
  select * into v_finalized from public.finalize_reporting_obligation_evidence_pack_atomic(
    v_org,v_actor,v_pack,repeat('a',64),512,repeat('b',64),v_path,v_finalize_key,v_correlation);
  perform pg_temp.check('finalization result remains compatible',
    v_finalized.outcome='updated' and v_finalized.result->>'state'='available'
    and (select state='available' from public.reporting_obligation_evidence_packs
      where organization_id=v_org and id=v_pack));
  perform pg_temp.check('finalization emits one redacted authoritative v2 event',
    (select count(*)=1 from public.audit_logs a where a.organization_id=v_org
      and a.schema_version=2 and a.action='reporting.evidence_pack_finalized'
      and a.entity_type='reporting_obligation_evidence_pack' and a.entity_id=v_pack::text
      and a.actor_id=v_actor::text and a.outcome='completed'
      and a.correlation_id=v_correlation
      and a.before_redacted->>'state'='reserved'
      and a.after_redacted->>'state'='available'
      and a.after_redacted->>'sha256'='[REDACTED]'
      and a.after_redacted->>'objectPath'='[REDACTED]'
      and position(repeat('a',64) in row_to_json(a)::text)=0
      and position(v_path in row_to_json(a)::text)=0));
  begin
    update public.reporting_obligation_evidence_packs
      set storage_object_path=v_org::text||'/evidence-packs/'||gen_random_uuid()::text||'.zip'
      where organization_id=v_org and id=v_pack;
  exception when object_not_in_prerequisite_state then v_mutation_blocked:=true;
  end;
  perform pg_temp.check('finalized pack identity remains immutable',v_mutation_blocked
    and (select storage_object_path=v_path from public.reporting_obligation_evidence_packs
      where organization_id=v_org and id=v_pack));

  select * into v_replay from public.finalize_reporting_obligation_evidence_pack_atomic(
    v_org,v_actor,v_pack,repeat('a',64),512,repeat('b',64),v_path,v_finalize_key,gen_random_uuid());
  perform pg_temp.check('finalization replay keeps result and one event',
    v_replay.outcome='idempotent' and v_replay.result=v_finalized.result
    and (select count(*)=1 from public.audit_logs where organization_id=v_org
      and action='reporting.evidence_pack_finalized' and entity_id=v_pack::text));
  select * into v_other from public.finalize_reporting_obligation_evidence_pack_atomic(
    v_org,v_actor,v_pack,repeat('c',64),512,repeat('b',64),v_path,v_finalize_key,gen_random_uuid());
  perform pg_temp.check('changed finalization payload conflicts without event',v_other.outcome='conflict');
  select * into v_other from public.finalize_reporting_obligation_evidence_pack_atomic(
    gen_random_uuid(),v_actor,v_pack,repeat('a',64),512,repeat('b',64),v_path,
    gen_random_uuid(),gen_random_uuid());
  perform pg_temp.check('cross-tenant finalization cannot see pack',v_other.outcome='conflict');
  select * into v_other from public.finalize_reporting_obligation_evidence_pack_atomic(
    v_org,v_viewer,v_pack,repeat('a',64),512,repeat('b',64),v_path,
    gen_random_uuid(),gen_random_uuid());
  perform pg_temp.check('viewer cannot finalize another actor pack',v_other.outcome='conflict');
end $$;

select pg_temp.check('reporting pack RPCs remain service only',
  has_function_privilege('service_role',
    'public.reserve_reporting_obligation_evidence_pack_atomic(uuid,uuid,uuid,uuid,uuid)','execute')
  and has_function_privilege('service_role',
    'public.finalize_reporting_obligation_evidence_pack_atomic(uuid,uuid,uuid,text,bigint,text,text,uuid,uuid)','execute')
  and not has_function_privilege('authenticated',
    'public.reserve_reporting_obligation_evidence_pack_atomic(uuid,uuid,uuid,uuid,uuid)','execute')
  and not has_function_privilege('authenticated',
    'public.finalize_reporting_obligation_evidence_pack_atomic(uuid,uuid,uuid,text,bigint,text,text,uuid,uuid)','execute'));

create or replace function pg_temp.fail_pack_audit()
returns trigger language plpgsql as $$
begin
  raise exception 'simulated audit store failure';
end $$;
create trigger m13_fail_reporting_pack_audit before insert on public.audit_logs
  for each row when (new.action in ('reporting.evidence_pack_reserved',
    'reporting.evidence_pack_finalized')) execute function pg_temp.fail_pack_audit();

do $$
declare
  v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_obligation uuid;
  v_key uuid:=gen_random_uuid();
  v_pack uuid;
  v_path text;
  v_failed boolean:=false;
  v_forbidden_transition boolean:=false;
begin
  select id into v_actor from public.users where email='owner@cra.test';
  select (result->'obligation'->>'id')::uuid into v_obligation
    from public.create_reporting_obligation_atomic(v_org,v_actor,'severe_incident',null,
      '2028-02-28 00:00:00+00','M13 failure test',gen_random_uuid(),gen_random_uuid());
  begin
    perform * from public.reserve_reporting_obligation_evidence_pack_atomic(
      v_org,v_actor,v_obligation,v_key,gen_random_uuid());
  exception when raise_exception then v_failed:=true;
  end;
  perform pg_temp.check('reservation and command rollback on audit outage',
    v_failed and not exists(select 1 from public.reporting_obligation_evidence_packs
      where organization_id=v_org and obligation_id=v_obligation)
    and not exists(select 1 from public.reporting_stage_draft_commands
      where organization_id=v_org and actor_user_id=v_actor and idempotency_key=v_key));

  execute 'drop trigger m13_fail_reporting_pack_audit on public.audit_logs';
  select (result->'evidencePack'->>'id')::uuid,
    result->'evidencePack'->>'objectPath' into v_pack,v_path
    from public.reserve_reporting_obligation_evidence_pack_atomic(
      v_org,v_actor,v_obligation,v_key,gen_random_uuid());
  begin
    update public.reporting_obligation_evidence_packs set state='failed'
      where organization_id=v_org and id=v_pack;
  exception when object_not_in_prerequisite_state then v_forbidden_transition:=true;
  end;
  perform pg_temp.check('unowned failed transition stays forbidden',
    v_forbidden_transition and (select state='reserved'
      from public.reporting_obligation_evidence_packs
      where organization_id=v_org and id=v_pack));
  insert into storage.objects(bucket_id,name) values('reporting-evidence',v_path);
  execute 'create trigger m13_fail_reporting_pack_audit before insert on public.audit_logs
    for each row when (new.action in (''reporting.evidence_pack_reserved'',
      ''reporting.evidence_pack_finalized'')) execute function pg_temp.fail_pack_audit()';
  v_key:=gen_random_uuid();
  v_failed:=false;
  begin
    perform * from public.finalize_reporting_obligation_evidence_pack_atomic(
      v_org,v_actor,v_pack,repeat('d',64),123,repeat('e',64),v_path,v_key,gen_random_uuid());
  exception when raise_exception then v_failed:=true;
  end;
  perform pg_temp.check('finalization and command rollback on audit outage',
    v_failed and (select state='reserved' from public.reporting_obligation_evidence_packs
      where organization_id=v_org and id=v_pack)
    and not exists(select 1 from public.reporting_stage_draft_commands
      where organization_id=v_org and actor_user_id=v_actor and idempotency_key=v_key));
end $$;

drop trigger m13_fail_reporting_pack_audit on public.audit_logs;
rollback;
