\set ON_ERROR_STOP on
begin;
create function pg_temp.check(p_label text,p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAIL %',p_label; end if;
  raise notice 'ok %',p_label;
end $$;

select pg_temp.check('CI tables are non-forced RLS and browser-private',not exists(
  select 1 from pg_class c where c.oid in (
    'public.ci_provider_release_bindings'::regclass,'public.ci_build_runs'::regclass,
    'public.ci_provider_release_binding_commands'::regclass)
    and (not c.relrowsecurity or c.relforcerowsecurity or
      has_table_privilege('authenticated',c.oid,'select'))));
select pg_temp.check('CI writes use RPCs, not service-role table mutations',
  not has_table_privilege('service_role','public.ci_provider_release_bindings','insert')
  and not has_table_privilege('service_role','public.ci_build_runs','insert')
  and not has_function_privilege('authenticated',
    'public.reserve_ci_build_sbom_atomic(uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,uuid,uuid,text,text,text,text,bigint,text,text,timestamptz,uuid,text,text,uuid)','execute'));
select pg_temp.check('CI functions pin search_path',not exists(select 1 from pg_proc
  where proname in ('reserve_ci_build_sbom_atomic','finalize_ci_build_sbom_atomic',
    'upsert_ci_provider_release_binding_atomic','revoke_ci_provider_release_binding_atomic')
    and not ('search_path=public, pg_temp'=any(proconfig))));
select pg_temp.check('Unguarded binding RPC overload is unavailable',
  to_regprocedure('public.upsert_ci_provider_release_binding_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,uuid,bigint,uuid,text)') is null);

do $$
declare v_org uuid:='00000000-0000-4000-8000-0000000000ca'; v_actor uuid;
  v_product uuid; v_release uuid; v_connector uuid; v_credential uuid:=gen_random_uuid();
  v_secret uuid:=gen_random_uuid();
  v_binding uuid; v_source uuid:=gen_random_uuid(); v_key uuid:=gen_random_uuid();
  v_delivery text:=gen_random_uuid()::text; v_event uuid;
  v_connector_key uuid:=gen_random_uuid(); v_binding_key uuid:=gen_random_uuid();
  v_connection_revision integer; v_credential_revision integer;
  v_epoch bigint; v record; v_job record; v_replay record; v_hash text:=repeat('a',64);
  v_prefix text:='cra_sbom_'||substr(replace(gen_random_uuid()::text,'-',''),1,8);
begin
  select id into v_actor from public.users where email='owner@cra.test';
  select p.id,r.id into v_product,v_release from public.products p join public.product_releases r
    on r.organization_id=p.organization_id and r.product_id=p.id
    where p.organization_id=v_org order by r.created_at limit 1;
  select version into v_epoch from public.organization_permissions_version where organization_id=v_org;
  perform pg_temp.check('Seeded owner and release available',v_actor is not null and v_release is not null and v_epoch is not null);
  insert into public.sbom_ci_credentials(id,organization_id,label,token_prefix,token_salt,token_hash,created_by)
    values(v_credential,v_org,'M11-04 rollback fixture',v_prefix,repeat('s',32),repeat('h',64),v_actor);
  select * into v from public.m11_create_connector_atomic(v_org,v_actor,v_epoch,v_connector_key,
    'github_actions','M11-04 rollback fixture','1.0.0','ci-v1',
    '{"providerHost":"github.com","appId":"1","installationId":"100"}'::jsonb,'manual');
  v_connector:=(v.connector->>'id')::uuid;
  perform pg_temp.check('GitHub App connector created',v.outcome='created' and v_connector is not null);
  select * into v from public.m11_create_connector_atomic(v_org,v_actor,v_epoch,v_connector_key,
    'github_actions','M11-04 rollback fixture','1.0.0','ci-v1',
    '{"providerHost":"github.com","appId":"1","installationId":"100"}'::jsonb,'manual');
  perform pg_temp.check('Connector create retry retains M2 idempotency',v.outcome='replayed'
    and (v.connector->>'id')::uuid=v_connector);
  insert into public.connector_secrets(id,organization_id,connector_id,ciphertext,encryption_scheme,
    key_id,nonce,auth_tag,credential_revision,rotated_by)
    values(v_secret,v_org,v_connector,decode('abcd','hex'),'aes_256_gcm_v1','test-key',
      decode(repeat('11',12),'hex'),decode(repeat('22',16),'hex'),1,v_actor);
  update public.connectors set secret_ref=v_secret where organization_id=v_org and id=v_connector;
  select connection_revision,credential_revision into v_connection_revision,v_credential_revision
    from public.connectors where organization_id=v_org and id=v_connector;
  select * into v from public.upsert_ci_provider_release_binding_atomic(v_org,v_actor,v_connector,
    v_connection_revision-1,v_credential_revision,v_product,v_release,v_credential,'github_actions',
    'github.com','fixture','repo','200','100',null,null,'refs/heads/main',null,null,
    v_binding_key,repeat('a',64));
  perform pg_temp.check('Stale verified connector revision cannot bind release',v.outcome='conflict'
    and not exists(select 1 from public.ci_provider_release_bindings where organization_id=v_org and connector_id=v_connector));
  select * into v from public.upsert_ci_provider_release_binding_atomic(v_org,v_actor,v_connector,
    v_connection_revision,v_credential_revision,
    v_product,v_release,v_credential,'github_actions','github.com','fixture','repo','200','100',
    null,null,'refs/heads/main',null,null,v_binding_key,repeat('a',64));
  v_binding:=(v.binding->>'id')::uuid;
  perform pg_temp.check('Owner binding pins connector and release',v.outcome='upserted'
    and (v.binding->>'connectorId')::uuid=v_connector and (v.binding->>'releaseId')::uuid=v_release);
  select * into v from public.upsert_ci_provider_release_binding_atomic(v_org,v_actor,v_connector,
    v_connection_revision,v_credential_revision,
    v_product,v_release,v_credential,'github_actions','github.com','fixture','repo','200','100',
    null,null,'refs/heads/main',null,null,v_binding_key,repeat('a',64));
  perform pg_temp.check('Binding command retry preserves original result',v.outcome='replayed'
    and (v.binding->>'id')::uuid=v_binding);
  select * into v from public.upsert_ci_provider_release_binding_atomic(v_org,v_actor,v_connector,
    v_connection_revision,v_credential_revision,
    v_product,v_release,v_credential,'github_actions','github.com','fixture','repo','200','100',
    null,null,'refs/heads/main',null,null,v_binding_key,repeat('b',64));
  perform pg_temp.check('Changed binding digest conflicts',v.outcome='idempotency_mismatch');
  select * into v from public.record_ci_provider_webhook_event_atomic(v_org,v_binding,'github_actions',
    v_delivery,repeat('f',64),'101','1');
  v_event:=v.event_id;
  perform pg_temp.check('Signed inbound delivery identity recorded without payload',v.outcome='recorded'
    and v_event is not null and (select count(*)=1 from public.ci_provider_webhook_events where id=v_event));
  select * into v from public.record_ci_provider_webhook_event_atomic(v_org,v_binding,'github_actions',
    v_delivery,repeat('f',64),'101','1');
  perform pg_temp.check('Inbound retry replays',v.outcome='replayed' and v.event_id=v_event);
  select * into v from public.record_ci_provider_webhook_event_atomic(v_org,v_binding,'github_actions',
    v_delivery,repeat('e',64),'101','1');
  perform pg_temp.check('Inbound delivery ID cannot change body',v.outcome='conflict');
  select * into v from public.m11_execute_connector_command_atomic(v_org,v_connector,v_actor,'configure',1,
    gen_random_uuid(),repeat('c',64),'test-key',v_epoch,
    '{"displayName":"Fixture","mappingVersion":"ci-v1","commitPolicy":"manual","connectionConfig":{"providerHost":"github.com","appId":"1","installationId":"101"}}');
  perform pg_temp.check('Owner sees conflict before active installation change',v.outcome='conflict');
  select * into v from public.m11_begin_connector_test_atomic(v_org,v_connector,v_actor,1,
    gen_random_uuid(),repeat('c',64),'test-key',v_epoch);
  perform pg_temp.check('CI connector cannot invoke reference test',v.outcome='invalid_state');
  select * into v from public.m11_begin_sync_run_atomic(v_org,v_connector,v_actor,v_epoch,'incremental',
    gen_random_uuid(),gen_random_uuid());
  perform pg_temp.check('CI connector cannot invoke product sync',v.outcome='not_found');
  select * into v from public.reserve_ci_build_sbom_atomic(v_org,v_credential,v_binding,
    '100','1',null,'refs/heads/other',repeat('a',40),'push','fixture','repo','200','100',null,null,
    gen_random_uuid(),gen_random_uuid(),repeat('c',64),repeat('d',64),'bom.json','application/json',15,v_hash,
    v_org::text||'/'||v_source::text||'/'||v_hash,now()+interval '10 minutes',gen_random_uuid(),
    'cyclonedx',null,null);
  perform pg_temp.check('Verified run on a different ref cannot target release',v.outcome='not_found'
    and not exists(select 1 from public.ci_build_runs where organization_id=v_org and run_id='100'));
  begin
    update public.connectors set connection_config='{"providerHost":"github.com","appId":"1","installationId":"101"}'::jsonb
      where organization_id=v_org and id=v_connector;
    raise exception 'Active binding identity changed';
  exception when check_violation then null;
  end;
  perform pg_temp.check('Active binding fences installation reassignment',
    (select connection_config->>'installationId'='100' from public.connectors where id=v_connector));
  select * into v from public.reserve_ci_build_sbom_atomic(v_org,v_credential,v_binding,
    '101','1',null,'refs/heads/main',repeat('a',40),'push','fixture','repo','200','100',null,null,
    v_source,v_key,repeat('c',64),repeat('d',64),'bom.json','application/json',15,v_hash,
    v_org::text||'/'||v_source::text||'/'||v_hash,now()+interval '10 minutes',gen_random_uuid(),
    'cyclonedx',null,null);
  perform pg_temp.check('M3 reservation and build run correlate atomically',v.outcome='created'
    and (v.source->>'id')::uuid=v_source and v.build_run_id is not null
    and (select count(*)=1 from public.ci_build_runs where organization_id=v_org and source_id=v_source));
  select * into v_replay from public.reserve_ci_build_sbom_atomic(v_org,v_credential,v_binding,
    '101','1',null,'refs/heads/main',repeat('a',40),'push','fixture','repo','200','100',null,null,
    v_source,v_key,repeat('c',64),repeat('d',64),'bom.json','application/json',15,v_hash,
    v_org::text||'/'||v_source::text||'/'||v_hash,now()+interval '10 minutes',gen_random_uuid(),
    'cyclonedx',null,null);
  perform pg_temp.check('Exact retry reuses the same build and source',v_replay.outcome='replayed'
    and v_replay.build_run_id=v.build_run_id);
  select * into v_replay from public.reserve_ci_build_sbom_atomic(v_org,v_credential,v_binding,
    '101','1',null,'refs/heads/main',repeat('a',40),'push','fixture','repo','200','100',null,null,
    gen_random_uuid(),gen_random_uuid(),repeat('c',64),repeat('d',64),'bom.json','application/json',15,v_hash,
    v_org::text||'/'||v_source::text||'/'||v_hash,now()+interval '10 minutes',gen_random_uuid(),
    'cyclonedx',null,null);
  perform pg_temp.check('Duplicate provider run cannot start another baseline',v_replay.outcome='conflict'
    and (select count(*)=1 from public.ci_build_runs where organization_id=v_org and run_id='101'));
  select * into v_replay from public.reserve_ci_build_sbom_atomic(gen_random_uuid(),v_credential,v_binding,
    '101','1',null,'refs/heads/main',repeat('a',40),'push','fixture','repo','200','100',null,null,
    gen_random_uuid(),gen_random_uuid(),repeat('c',64),repeat('d',64),'bom.json','application/json',15,v_hash,
    v_org::text||'/'||v_source::text||'/'||v_hash,now()+interval '10 minutes',gen_random_uuid(),
    'cyclonedx',null,null);
  perform pg_temp.check('Tenant substitution cannot resolve binding',v_replay.outcome='not_found');
  select * into v_job from public.finalize_ci_build_sbom_atomic(v_org,v_credential,v_binding,'101','1',
    v_source,v_hash,15,'application/json',v_key,gen_random_uuid());
  perform pg_temp.check('M3 completion and build job correlate atomically',v_job.outcome in ('queued','deduplicated')
    and (v_job.job->>'id')::uuid=(select ingest_job_id from public.ci_build_runs where id=v.build_run_id));
  select * into v_job from public.revoke_ci_provider_release_binding_atomic(v_org,v_actor,v_binding,1,
    gen_random_uuid(),repeat('e',64),'Fixture revoked');
  perform pg_temp.check('Revocation records optimistic version',v_job.outcome='revoked' and (v_job.binding->>'version')::bigint=2);
  select * into v_job from public.finalize_ci_build_sbom_atomic(v_org,v_credential,v_binding,'101','1',
    v_source,v_hash,15,'application/json',v_key,gen_random_uuid());
  perform pg_temp.check('Revoked binding blocks subsequent work',v_job.outcome='not_found');
  declare
    v_kind text; v_config jsonb; v_vendor_connector uuid; v_vendor_secret uuid;
    v_project_id text; v_repo_id text;
  begin
    for v_kind in select unnest(array['gitlab_ci','azure_devops']) loop
      v_project_id:=case when v_kind='gitlab_ci' then '501' else gen_random_uuid()::text end;
      v_repo_id:=case when v_kind='gitlab_ci' then '501' else gen_random_uuid()::text end;
      v_config:=case when v_kind='gitlab_ci'
        then jsonb_build_object('providerHost','gitlab.example.com','projectId',v_project_id)
        else jsonb_build_object('providerHost','dev.azure.com','organization','fixture',
          'projectId',v_project_id,'serviceConnectionId',gen_random_uuid()::text) end;
      select * into v from public.m11_create_connector_atomic(v_org,v_actor,v_epoch,gen_random_uuid(),
        v_kind,'M11-04 rollback fixture','1.0.0','ci-v1',v_config,'manual');
      v_vendor_connector:=(v.connector->>'id')::uuid;
      perform pg_temp.check(v_kind||' connector accepts scoped metadata',v.outcome='created');
      v_vendor_secret:=gen_random_uuid();
      insert into public.connector_secrets(id,organization_id,connector_id,ciphertext,encryption_scheme,
        key_id,nonce,auth_tag,credential_revision,rotated_by)
        values(v_vendor_secret,v_org,v_vendor_connector,decode('abcd','hex'),'aes_256_gcm_v1','test-key',
          decode(repeat('11',12),'hex'),decode(repeat('22',16),'hex'),1,v_actor);
      update public.connectors set secret_ref=v_vendor_secret where organization_id=v_org and id=v_vendor_connector;
      select connection_revision,credential_revision into v_connection_revision,v_credential_revision
        from public.connectors where organization_id=v_org and id=v_vendor_connector;
      select * into v from public.upsert_ci_provider_release_binding_atomic(v_org,v_actor,v_vendor_connector,
        v_connection_revision,v_credential_revision,
        v_product,v_release,v_credential,v_kind,v_config->>'providerHost','fixture','repo',v_repo_id,null,
        case when v_kind='azure_devops' then v_project_id else null end,
        case when v_kind='azure_devops' then '42' else null end,
        'refs/heads/main',null,null,gen_random_uuid(),repeat('a',64));
      perform pg_temp.check(v_kind||' binding scopes provider project',v.outcome='upserted'
        and (v.binding->>'repositoryId')=v_repo_id);
    end loop;
  end;
end $$;
rollback;
