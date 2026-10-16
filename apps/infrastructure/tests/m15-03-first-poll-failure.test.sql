-- Only rollback-owned registry rows/audit receipts are involved.
begin;
set local statement_timeout='30s';
create function pg_temp.check(label text,ok boolean) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'M15-03 first poll check: %',label;end if;end $$;
do $$ declare instance uuid:=gen_random_uuid();principal uuid:=gen_random_uuid();request uuid:=gen_random_uuid();attempt timestamptz:=statement_timestamp()-interval '2 minutes';source_at timestamptz:=statement_timestamp()-interval '1 minute';result jsonb;metadata jsonb;payload jsonb;begin
 perform pg_temp.check('reader cannot create configured placeholders',not has_function_privilege('cra_operator_registry_reader','public.m15_03_record_poll_outcome(uuid,timestamptz,text)','execute'));
 result:=public.m15_03_record_poll_outcome(instance,attempt,'collection_unreachable');
 perform pg_temp.check('first failed configured poll creates neutral instance',exists(select 1 from public.operator_registry_observations where instance_id=instance and entity_kind='instance' and entity_id=instance));
 perform pg_temp.check('no successful observation invented',exists(select 1 from public.operator_registry_observations where instance_id=instance and source_observed_at is null and entity_observed_at is null and received_at is null and succeeded_at is null and version is null and commit is null and licence_state is null and attempted_at=attempt));
 result:=public.m15_03_operator_read(principal,request,array[instance],array[]::uuid[],'instances',null,null,50);
 perform pg_temp.check('scoped reader sees first unreachable target',jsonb_array_length(result->'instances')=1 and result#>>'{instances,0,status}'='unreachable' and result#>'{instances,0,lastObservedAt}'='null'::jsonb and result#>'{instances,0,version}'='null'::jsonb);
 perform pg_temp.check('neutral disclosure audited',exists(select 1 from public.audit_logs where event_scope='security' and correlation_id=request and actor_id=principal::text));
 result:=public.m15_03_operator_read(principal,gen_random_uuid(),array[]::uuid[],array[]::uuid[],'instances',null,null,50);
 perform pg_temp.check('ungranted target excluded',result->'instances'='[]'::jsonb);
 -- The minimum legitimate source revision (zero) must replace a placeholder;
 -- a local failed-attempt marker is not a previously successful source revision.
 metadata:=jsonb_build_object('schemaVersion',1,'instanceId',instance,'revision',0,'sourceAt',public.m7_snapshot_timestamp_utc(source_at),'observedAt',public.m7_snapshot_timestamp_utc(source_at),'instance',jsonb_build_object('instanceId',instance,'label','Observed fixture instance','status','healthy','version',null,'commit',null,'lastObservedAt',public.m7_snapshot_timestamp_utc(source_at),'sources',jsonb_build_array(jsonb_build_object('source','local','status','healthy','sourceAt',public.m7_snapshot_timestamp_utc(source_at),'observedAt',public.m7_snapshot_timestamp_utc(source_at),'attemptedAt',public.m7_snapshot_timestamp_utc(source_at),'succeededAt',public.m7_snapshot_timestamp_utc(source_at),'receivedAt',public.m7_snapshot_timestamp_utc(source_at),'reasons','[]'::jsonb))),'tenants','[]'::jsonb,'nextCursor',null);
 payload:=jsonb_build_object('metadata',metadata,'digest',encode(extensions.digest(public.m15_03_canonical_json(metadata),'sha256'),'hex'));
 perform pg_temp.check('first real revision zero replaces neutral placeholder',public.m15_03_publish_observation(instance,payload)->>'outcome'='published');
 perform pg_temp.check('successful source metadata now retained',exists(select 1 from public.operator_registry_observations where instance_id=instance and source_observed_at=public.m7_snapshot_timestamp_utc(source_at)::timestamptz and succeeded_at is not null and poll_reason is null));
 perform public.m15_03_record_poll_outcome(instance,statement_timestamp()+interval '1 second','source_timeout');
 perform pg_temp.check('later failure retains first successful source provenance',exists(select 1 from public.operator_registry_observations where instance_id=instance and source_observed_at=public.m7_snapshot_timestamp_utc(source_at)::timestamptz and succeeded_at is not null and status='unreachable'));
end $$;
do $$ declare cycle timestamptz:=statement_timestamp()-interval '1 minute';page jsonb;source jsonb;begin
 page:=public.m15_03_observe_instance(gen_random_uuid(),cycle,null,1);
 select value into strict source from jsonb_array_elements(page#>'{instance,sources}') where value->>'source'='database';
 perform pg_temp.check('source measurement does not inherit an earlier cycle timestamp',(source->>'sourceAt')::timestamptz>=statement_timestamp()-interval '1 second' and (source->>'observedAt')::timestamptz>=statement_timestamp()-interval '1 second');
 perform pg_temp.check('source page reports actual measurement provenance',(page->>'sourceAt')::timestamptz>=statement_timestamp()-interval '1 second' and (page->>'observedAt')::timestamptz>=statement_timestamp()-interval '1 second');
 perform pg_temp.check('cycle revision remains stable',(page->>'revision')::bigint=floor(extract(epoch from cycle)*1000)::bigint);
end $$;
rollback;
