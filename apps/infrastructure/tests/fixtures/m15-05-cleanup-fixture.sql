\set ON_ERROR_STOP on
begin;
create temporary table backup_cleanup_fixture(v jsonb);
insert into backup_cleanup_fixture values (:'fixture'::jsonb);
do $$declare f jsonb;c jsonb;cfg jsonb;org uuid;inst uuid;begin
 if exists(select 1 from public.organizations) or exists(select 1 from public.backup_policies) then raise exception 'fixture_target_not_empty';end if;
 select v into f from backup_cleanup_fixture;cfg:=f->'configuration';org:=(f->>'organizationId')::uuid;inst:=(f->>'instanceId')::uuid;
 if not public.m15_05_configuration_valid(cfg) or jsonb_array_length(f->'captures')<>3 then raise exception 'fixture_invalid';end if;
 insert into public.organizations(id,name,slug) values(org,'Task-owned cleanup policy fixture','m15-cleanup-'||org::text);
 insert into public.retention_evidence_classes(identifier,enabled,default_requested_retention_days) values('m15_cleanup_fixture',true,30) on conflict(identifier) do nothing;
 insert into public.organization_retention_policies(organization_id,evidence_class,requested_retention_days,effective_retention_days) select org,identifier,greatest(30,default_requested_retention_days),greatest(30,default_requested_retention_days) from public.retention_evidence_classes where enabled;
 insert into public.retention_authority_states(organization_id,authority_kind,available,last_reconciled_at) select org,k,true,clock_timestamp() from unnest(array['product','evidence_class','obligation','legal_hold'])k on conflict(organization_id,authority_kind) do update set available=true,last_reconciled_at=excluded.last_reconciled_at;
 insert into public.backup_policies(instance_id,configuration,configuration_digest,approved_by,mutation_key,mutation_digest) values(inst,cfg,encode(extensions.digest(public.m15_03_canonical_json(cfg),'sha256'),'hex'),'cleanup-fixture',gen_random_uuid(),repeat('a',64));
 for c in select value from jsonb_array_elements(f->'captures') loop
  insert into public.backup_runs(id,instance_id,kind,state,stage,progress,configuration_revision,configuration,configuration_digest,idempotency_key,request_digest,actor_id,certificate,created_at,started_at,completed_at,covered_organization_ids) values((c->>'id')::uuid,inst,'capture','certified','completed',100,1,cfg,repeat('a',64),gen_random_uuid(),repeat('a',64),'cleanup-fixture',c->'certificate','1900-01-01','1900-01-01','1900-01-01',array[org]);
  insert into public.backup_runs(id,instance_id,kind,parent_capture_id,state,stage,progress,configuration_revision,configuration,configuration_digest,idempotency_key,request_digest,actor_id,verification,created_at,started_at,completed_at,covered_organization_ids) values((c->>'verificationId')::uuid,inst,'verification',(c->>'id')::uuid,'verified','completed',100,1,cfg,repeat('a',64),gen_random_uuid(),repeat('a',64),'cleanup-fixture','{"fixture":true}','1900-01-01','1900-01-01','1900-01-01',array[org]);
 end loop;
end $$;
commit;
