-- An explicitly configured target may be unreachable before any source snapshot.
-- Preserve absence as NULL; a failed attempt never creates success provenance.
alter table public.operator_registry_observations alter column source_observed_at drop not null;
alter table public.operator_registry_observations alter column received_at drop not null;
alter table public.operator_registry_observations alter column succeeded_at drop not null;
alter table public.operator_registry_observations add constraint m15_03_registry_success_provenance check(
 (succeeded_at is not null and received_at is not null and source_observed_at is not null)
 or (succeeded_at is null and received_at is null and source_observed_at is null and entity_observed_at is null
 and entity_kind='instance' and revision=0 and status='unreachable' and poll_reason is not null
 and version is null and commit is null and expected_version is null and version_source_at is null
 and licence_state is null and licence_expires_at is null and grace_ends_at is null and licence_source_at is null)
);
create or replace function public.m15_03_record_poll_outcome(p_instance_id uuid,p_attempted_at timestamptz,p_reason text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='200ms' as $$
begin
 if p_instance_id is null or p_attempted_at is null or not isfinite(p_attempted_at) or p_attempted_at>statement_timestamp()+interval '5 seconds' or p_reason not in ('collection_unreachable','source_timeout','source_unavailable') or p_reason is null then raise exception 'invalid poll outcome' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('m15_03_registry:'||p_instance_id::text,0));
 -- The service-only caller owns the configured instance binding. There is no
 -- reader/browser authority to enumerate targets or introduce registry rows.
 insert into public.operator_registry_observations(instance_id,entity_kind,entity_id,label,revision,digest,status,source_observed_at,entity_observed_at,received_at,attempted_at,succeeded_at,poll_reason,sources)
 values(p_instance_id,'instance',p_instance_id,'Unobserved instance',0,encode(extensions.digest('m15_03_unobserved:'||p_instance_id::text,'sha256'),'hex'),'unreachable',null,null,null,p_attempted_at,null,p_reason,
 array[row('local','unreachable',null,p_attempted_at,p_attempted_at,null,null,array[p_reason])::public.m15_03_source_observation])
 on conflict(instance_id,entity_kind,entity_id) do nothing;
 update public.operator_registry_observations set attempted_at=p_attempted_at,status='unreachable',poll_reason=p_reason,
 sources=case when succeeded_at is null then array[row('local','unreachable',null,p_attempted_at,p_attempted_at,null,null,array[p_reason])::public.m15_03_source_observation] else sources end
 where instance_id=p_instance_id and attempted_at<p_attempted_at;
 return jsonb_build_object('outcome','recorded');end $$;

-- A first real source revision zero replaces an unobserved attempt marker.
create or replace function public.m15_03_store_entity(p_instance_id uuid,p_kind text,p_entity jsonb,p_revision bigint,p_source_at timestamptz) returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare eid uuid;d text;old public.operator_registry_observations;s public.m15_03_source_observation[];begin
 if p_kind='instance' then
 if exists(select 1 from jsonb_object_keys(p_entity) k where k not in ('instanceId','label','status','version','commit','expectedVersion','versionDrift','versionSourceAt','lastObservedAt','licenceSummary','tenantCount','countScope','sources')) or p_entity->>'instanceId' is distinct from p_instance_id::text then raise exception 'invalid instance metadata' using errcode='22023';end if;eid:=p_instance_id;
 else
 if exists(select 1 from jsonb_object_keys(p_entity) k where k not in ('tenantId','label','status','licenceState','licenceExpiresAt','graceEndsAt','licenceSourceAt','lastObservedAt','sources')) then raise exception 'invalid tenant metadata' using errcode='22023';end if;eid:=(p_entity->>'tenantId')::uuid;end if;
 if eid is null or jsonb_typeof(p_entity)<>'object' or p_entity->>'status' is null or p_entity->>'label' is null or jsonb_typeof(p_entity->'sources')<>'array' then raise exception 'invalid entity metadata' using errcode='22023';end if;
 if jsonb_typeof(p_entity->'label')<>'string' or jsonb_typeof(p_entity->'status')<>'string' or exists(select 1 from jsonb_each(p_entity) e where e.key in ('version','commit','expectedVersion','licenceState') and jsonb_typeof(e.value) not in ('string','null'))
 or exists(select 1 from jsonb_each(p_entity) e where e.key in ('lastObservedAt','versionSourceAt','licenceSourceAt','licenceExpiresAt','graceEndsAt') and e.value<>'null'::jsonb and (jsonb_typeof(e.value)<>'string' or not isfinite((e.value#>>'{}')::timestamptz)))
 or exists(select 1 from jsonb_each(p_entity) e where e.key in ('lastObservedAt','versionSourceAt','licenceSourceAt') and e.value<>'null'::jsonb and (e.value#>>'{}')::timestamptz>statement_timestamp()+interval '5 seconds')
 or (p_kind='instance' and (p_entity->>'versionDrift' not in ('unknown','matched','different') or p_entity->>'countScope'<>'authorized_tenants'))
 or (p_kind='instance' and p_entity ? 'licenceSummary' and (jsonb_typeof(p_entity->'licenceSummary')<>'object' or exists(select 1 from jsonb_each(p_entity->'licenceSummary') e where e.key not in ('active','grace','expiredReadOnly','invalid','missing','unknown') or (e.value<>'null'::jsonb and (jsonb_typeof(e.value)<>'number' or (e.value#>>'{}')::numeric<0 or (e.value#>>'{}')::numeric>9007199254740991 or (e.value#>>'{}')::numeric<>trunc((e.value#>>'{}')::numeric)))))) then raise exception 'invalid entity provenance' using errcode='23514';end if;
 s:=public.m15_03_sources(p_entity->'sources');d:=encode(extensions.digest(public.m15_03_canonical_json(p_entity),'sha256'),'hex');
 select * into old from public.operator_registry_observations where instance_id=p_instance_id and entity_kind=p_kind and entity_id=eid for update;
 if found and old.succeeded_at is not null then
 if p_revision<old.revision or p_source_at<old.source_observed_at then return 'out_of_order';end if;
 if p_revision=old.revision then return case when d=old.digest and p_source_at=old.source_observed_at then 'replayed' else 'conflict' end;end if;
 -- Each independently observed source must also be monotonic.
 if exists(select 1 from unnest(old.sources) o left join unnest(s) n on o.source=n.source where (o.source_at is not null and (n.source is null or n.source_at is null or n.source_at<o.source_at)) or (o.succeeded_at is not null and (n.succeeded_at is null or n.succeeded_at<o.succeeded_at))) then return 'out_of_order';end if;
 end if;
 insert into public.operator_registry_observations(instance_id,entity_kind,entity_id,label,revision,digest,status,source_observed_at,entity_observed_at,received_at,attempted_at,succeeded_at,version,commit,expected_version,version_source_at,licence_state,licence_expires_at,grace_ends_at,licence_source_at,sources)
 values(p_instance_id,p_kind,eid,p_entity->>'label',p_revision,d,p_entity->>'status',p_source_at,(p_entity->>'lastObservedAt')::timestamptz,statement_timestamp(),statement_timestamp(),statement_timestamp(),p_entity->>'version',p_entity->>'commit',p_entity->>'expectedVersion',(p_entity->>'versionSourceAt')::timestamptz,p_entity->>'licenceState',(p_entity->>'licenceExpiresAt')::timestamptz,(p_entity->>'graceEndsAt')::timestamptz,(p_entity->>'licenceSourceAt')::timestamptz,s)
 on conflict(instance_id,entity_kind,entity_id) do update set label=excluded.label,revision=excluded.revision,digest=excluded.digest,status=excluded.status,source_observed_at=excluded.source_observed_at,entity_observed_at=excluded.entity_observed_at,received_at=excluded.received_at,attempted_at=excluded.attempted_at,succeeded_at=excluded.succeeded_at,poll_reason=null,version=excluded.version,commit=excluded.commit,expected_version=excluded.expected_version,version_source_at=excluded.version_source_at,licence_state=excluded.licence_state,licence_expires_at=excluded.licence_expires_at,grace_ends_at=excluded.grace_ends_at,licence_source_at=excluded.licence_source_at,sources=excluded.sources;
 return 'published';end $$;
notify pgrst,'reload schema';
