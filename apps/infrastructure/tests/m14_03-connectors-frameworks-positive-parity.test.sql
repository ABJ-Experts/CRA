-- Nonempty native projections, ordered scope/filter exclusions. Every fixture rolls back.
\set ON_ERROR_STOP on
begin;
set local statement_timeout='30s';
create function pg_temp.normalized(j jsonb) returns jsonb language plpgsql immutable as $$declare r jsonb:='{}';k text;v jsonb;begin
 if jsonb_typeof(j)='array' then select coalesce(jsonb_agg(pg_temp.normalized(x)),'[]') into r from jsonb_array_elements(j)x;return r;end if;
 if jsonb_typeof(j)<>'object' then return j;end if;
 for k,v in select * from jsonb_each(j) loop
 if k~'At$' and jsonb_typeof(v)='string' then v:=to_jsonb(public.m2_utc_z((v#>>'{}')::timestamptz));end if;
 r:=r||jsonb_build_object(k,v);end loop;return r;end$$;
create function pg_temp.parity(o uuid,a uuid,s text,f jsonb,c jsonb,expected jsonb) returns void language plpgsql as $$declare actual jsonb;begin
 select coalesce(jsonb_agg(row_values),'[]') into actual from public.m14_03_operational_source_rows(o,a,s,f,c) where s<>'frameworks.catalog' or row_values->>'packKey'=c->>'packKey';
 if expected is null or jsonb_array_length(expected)=0 or pg_temp.normalized(actual)<>pg_temp.normalized(expected) then raise exception 'FAIL % native projection: actual %, expected %',s,actual,expected;end if;
 raise notice 'PASS % ordered approved native projection (% rows)',s,jsonb_array_length(actual);
 begin
 select coalesce(jsonb_agg(row_values),'[]') into actual from public.m14_03_operational_source_rows(gen_random_uuid(),a,s,f,c);
 if actual<>'[]' then raise exception 'FAIL % forged tenant',s;end if;
 exception when insufficient_privilege or no_data_found then null;end;
end$$;
do $$declare o uuid:=gen_random_uuid();a uuid:=gen_random_uuid();c uuid:=gen_random_uuid();run uuid:=gen_random_uuid();other_run uuid:=gen_random_uuid();ep uuid:=gen_random_uuid();dd uuid;agent uuid:=gen_random_uuid();le uuid:=gen_random_uuid();p uuid:=gen_random_uuid();epoch bigint;kid uuid:=gen_random_uuid();dest uuid:=gen_random_uuid();pack text:='m14-native-'||gen_random_uuid();ctrl uuid:=gen_random_uuid();mapping uuid:=gen_random_uuid();draft uuid;document jsonb;worker uuid:=gen_random_uuid();source text;expected jsonb;approved jsonb;ctx jsonb;v record;
begin
 insert into public.users(id,email) values(a,'m14-parity-'||a||'@cra.test');
 insert into public.organizations(id,name,slug) values(o,'M14 native parity','m14-parity-'||o);
 insert into public.organization_members(organization_id,user_id,role) values(o,a,'owner');
 select version into epoch from public.organization_permissions_version where organization_id=o;
 insert into public.organization_legal_entities(id,organization_id,identifier,display_name,completion_status,status,created_by,updated_by) values(le,o,'fixture','M14','needs_completion','inactive',a,a);
 insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by) values(p,o,le,0,'{}','Fixture','M14','standalone_software',a,a,a);
 insert into public.connectors(id,organization_id,connector_type,display_name,adapter_version,mapping_version,created_by,updated_by) values(c,o,'reference_conformance','Fixture','1.0.0','v1',a,a);

 source:='connectors.overview';
 expected:=jsonb_build_array(jsonb_build_object('id',c,'displayName','Fixture','connectorType','reference_conformance','enabled',true,'version',1,'createdAt',now(),'updatedAt',now(),'status','not_connected','lastSyncAt',null));
 perform pg_temp.parity(o,a,source,'{}','{}',expected);
 insert into public.connectors(organization_id,connector_type,display_name,adapter_version,mapping_version,created_by,updated_by,archived_at,archived_by,archived_reason) values(o,'reference_conformance','Archived exclusion','1.0.0','v1',a,a,now(),a,'Fixture archived');
 perform pg_temp.parity(o,a,source,'{}','{}',expected);
 insert into public.sync_runs(id,organization_id,connector_id,reconciliation_kind,actor_kind,actor_user_id,trigger_idempotency_key,trigger_request_digest,adapter_version,mapping_version,correlation_id,status,next_attempt_at)
 select x,o,c,'incremental','user',a,gen_random_uuid(),repeat('a',64),'1.0.0','v1',gen_random_uuid(),'failed','2025-01-01T00:00:00Z'::timestamptz from unnest(array[run,other_run])x;

 source:='connectors.sync_runs';approved:=public.m14_03_source_policy(source)->'columns';ctx:=jsonb_build_object('connectorId',c);
 select jsonb_agg(public.m14_03_operational_projection(public.m2_v2_sync_run_json(r),approved) order by r.created_at desc,r.id) into expected from public.sync_runs r where r.organization_id=o and r.connector_id=c and r.status='failed';
 perform pg_temp.parity(o,a,source,'{"status":"failed"}',ctx,expected);
 source:='connectors.sync_history';approved:=public.m14_03_source_policy(source)->'columns';
 -- Canonical mutation JSON supplies the nested run. Fixed fixture history values
 -- independently assert the DTO flattening performed by the production repository.
 select jsonb_agg(public.m14_03_operational_projection(public.m2_v2_sync_run_json(r)||'{"startedAt":null,"finishedAt":null,"version":1,"fieldMappingRevision":0,"replayOfRunId":null,"succeededCount":0,"skippedCount":0,"failedCount":0,"pendingCount":0,"retryAt":"2025-01-01T00:00:00.000Z"}'::jsonb,approved) order by r.created_at desc,r.id desc) into expected from public.sync_runs r where r.organization_id=o and r.connector_id=c;
 perform pg_temp.parity(o,a,source,'{}',ctx,expected);
 insert into public.sync_run_plan_items(organization_id,sync_run_id,external_id,entity_type,proposed_action,record_outcome,dead_lettered_at,dead_letter_resolved_at)
 select o,x,'record-'||n,'product','rejected','failed',statement_timestamp()-n*interval '1 second',case when n=3 then statement_timestamp() end from unnest(array[run,other_run])x cross join generate_series(1,3)n;
 -- Independent approved row mapping mirrors the source repository's narrow plan/record DTO.
 foreach source in array array['connectors.sync_records','connectors.sync_plan_items','connectors.dead_letter_records'] loop
 approved:=public.m14_03_source_policy(source)->'columns';ctx:=jsonb_build_object('connectorId',c,'syncRunId',run);
 select jsonb_agg(public.m14_03_operational_projection(jsonb_build_object('id',r.id,'runId',r.sync_run_id,'externalId',r.external_id,'entityType',r.entity_type,'proposedAction',r.proposed_action,'outcome',r.record_outcome,'errorCategory',r.error_category,'errorCode',r.error_code,'deadLetteredAt',r.dead_lettered_at,'appliedAt',r.applied_at,'craProductId',r.cra_product_id,'craReleaseId',r.cra_release_id,'expectedVersion',r.expected_version,'createdAt',r.created_at),approved)
 order by case when source='connectors.dead_letter_records' then r.dead_lettered_at end desc,case when source='connectors.sync_plan_items' then r.created_at end,case when source='connectors.dead_letter_records' then r.id end desc,r.id)
 into expected from public.sync_run_plan_items r where r.organization_id=o and (source='connectors.dead_letter_records' or r.sync_run_id=run) and (source<>'connectors.dead_letter_records' or r.dead_letter_resolved_at is null);
 perform pg_temp.parity(o,a,source,'{}',ctx,expected);end loop;
 insert into public.sync_run_attempts(organization_id,sync_run_id,lease_generation,worker_id,phase) select o,x,n,'fixture','dry_run' from unnest(array[run,other_run])x cross join generate_series(1,2)n;
 source:='connectors.sync_run_attempts';approved:=public.m14_03_source_policy(source)->'columns';
 select jsonb_agg(jsonb_build_object('id',r.id,'runId',r.sync_run_id,'generation',r.lease_generation,'phase',r.phase,'startedAt',r.started_at,'finishedAt',r.finished_at,'outcome',coalesce(r.outcome,'running'),'errorCategory',r.error_category,'errorCode',r.error_code,'nextAttemptAt',r.next_attempt_at) order by r.lease_generation desc,r.id) into expected from public.sync_run_attempts r where r.sync_run_id=run and r.organization_id=o;
 perform pg_temp.parity(o,a,source,'{}',ctx,expected);
 insert into public.sync_conflicts(organization_id,connector_id,sync_run_id,plan_item_id,entity_type,field_path,cra_value,cra_value_source,cra_value_observed_at,external_value,external_value_hash,external_value_observed_at,correlation_id,authority_policy_snapshot)
 select o,c,x.sync_run_id,x.id,'product','title','"CRA"','cra_manual_entry',now(),'"Provider"',repeat('a',64),now(),gen_random_uuid(),'{}' from public.sync_run_plan_items x where x.organization_id=o and external_id='record-1';
 source:='connectors.run_conflicts';approved:=public.m14_03_source_policy(source)->'columns';
 select jsonb_agg(public.m14_03_operational_projection(public.m2_v2_sync_conflict_json(r),approved) order by r.detected_at desc,r.id) into expected from public.sync_conflicts r where r.organization_id=o and r.sync_run_id=run;
 perform pg_temp.parity(o,a,source,'{}',ctx,expected);
 insert into public.connector_agents(id,organization_id,connector_id,enrollment_token_hash,enrollment_token_envelope,enrollment_idempotency_key,enrollment_expires_at,enrollment_issued_by)
 values(agent,o,c,repeat('a',64),'{"format":"aes-256-gcm-v1","keyId":"fixture","ciphertext":"YWJj","nonce":"AAAAAAAAAAAAAAAA","authTag":"AAAAAAAAAAAAAAAAAAAAAA=="}',gen_random_uuid(),now()+interval '1 hour',a);
 insert into public.connector_agent_batches(organization_id,connector_id,agent_id,batch_id,sequence,source_id,cursor_to,content_hash,records,record_count,payload_bytes) select o,c,agent,gen_random_uuid(),n,'fixture','cursor-'||n,repeat('a',64),'[]',0,2 from generate_series(1,2)n;
 source:='connectors.agent_batches';
 select jsonb_agg(jsonb_build_object('id',r.id,'sequence',r.sequence,'recordCount',r.record_count,'receivedAt',r.received_at,'status',r.status) order by r.received_at desc,r.id) into expected from public.connector_agent_batches r where r.organization_id=o and r.connector_id=c;
 perform pg_temp.parity(o,a,source,'{}',jsonb_build_object('connectorId',c),expected);
 select * into v from public.m1103_execute_webhook_endpoint_command_atomic(o,ep,a,'create',null,gen_random_uuid(),repeat('a',64),'test-master',epoch,jsonb_build_object('displayName','Fixture','url','https://receiver.example.test/events','eventTypes',array['product.release.lifecycle_changed'],'productIds',array[p], 'secret',jsonb_build_object('keyId',kid,'secretId',kid,'revision',1,'envelope',jsonb_build_object('format','aes-256-gcm-v1','keyId','test-master','ciphertext','YWJj','nonce','AAAAAAAAAAAAAAAA','authTag','AAAAAAAAAAAAAAAAAAAAAA=='))));
 if v.outcome<>'created' then raise exception 'webhook fixture %',v;end if;
 source:='connectors.webhook_endpoints';approved:=public.m14_03_source_policy(source)->'columns';
 select jsonb_agg(public.m14_03_operational_projection(public.m1103_webhook_endpoint_json(r),approved) order by r.updated_at desc,r.id desc) into expected from public.webhook_endpoints r where r.organization_id=o;
 perform pg_temp.parity(o,a,source,'{}','{}',expected);
 insert into public.webhook_deliveries(organization_id,endpoint_id,event_id,delivery_id,event_type,resource_type,resource_id,product_ids,source_kind,source_id,authorization_actor_user_id,permission_version,endpoint_version,destination_revision,scope_revision,max_attempts,base_delay_seconds,max_delay_seconds,deadline_at,resource_url,occurred_at,endpoint_url,status)
 select o,ep,gen_random_uuid()::text,gen_random_uuid()::text,'product.release.lifecycle_changed','product',p,array[p],'product_regulatory_outbox',gen_random_uuid(),a,epoch,1,1,1,6,5,300,now()+interval '1 day','/products/'||p,now(),'https://receiver.example.test/events',x from unnest(array['pending','failed'])x;
 source:='connectors.webhook_deliveries';approved:=public.m14_03_source_policy(source)->'columns';
 select jsonb_agg(public.m14_03_operational_projection(public.m1103_webhook_delivery_json(r),approved) order by r.created_at desc,r.id desc) into expected from public.webhook_deliveries r where r.organization_id=o and r.endpoint_id=ep;
 perform pg_temp.parity(o,a,source,'{}',jsonb_build_object('endpointId',ep),expected);
 select id into dd from public.webhook_deliveries where organization_id=o and status='pending';
 insert into public.webhook_delivery_attempts(organization_id,delivery_row_id,lease_generation,attempt_number,worker_id) values(o,dd,1,1,'fixture');
 source:='connectors.webhook_attempts';approved:=public.m14_03_source_policy(source)->'columns';
 select jsonb_agg(public.m14_03_operational_projection(public.m1103_webhook_attempt_json(r),approved) order by r.started_at desc,r.id desc) into expected from public.webhook_delivery_attempts r where r.organization_id=o and r.delivery_row_id=dd;
 perform pg_temp.parity(o,a,source,'{}',jsonb_build_object('endpointId',ep,'deliveryId',dd),expected);

 insert into public.siem_destinations(id,organization_id,display_name,transport,format,endpoint,event_classes,product_ids,authority_user_id,dataset_epoch,database_identity)
 values(dest,o,'M14 native parity','https','json','https://example.test/fixture',array['products'],array[p],a,gen_random_uuid(),'m14-rollback');
 source:='connectors.siem_destinations';approved:=public.m14_03_source_policy(source)->'columns';
 select jsonb_agg(public.m14_03_operational_projection(public.m13_05_public_destination(r,a),approved) order by r.created_at,r.id) into expected from public.siem_destinations r where r.organization_id=o;
 perform pg_temp.parity(o,a,source,'{}','{}',expected);
 for source in select unnest(array['v1','v2']) loop
 document:=jsonb_build_object('schemaVersion',1,'packKey',pack,'versionKey',source,'title','M14 native framework','editionDate','2024-01-01','language','en','sourceUrl','https://example.org/fixture','sourcePublicationDate','2024-01-01','attribution','Approved fixture','reviewEvidence','Test review','sourceKind','approved_fixture','requirements',jsonb_build_array(jsonb_build_object('requirementKey',case when source='v1' then 'old' else 'new' end,'identifier','R1','parentKey',null,'position',1,'heading','Fixture','text','Exact Ω text','sourceReference','Fixture')));
 if public.m10_import_framework_pack(document)<>'imported' then raise exception 'pack import fixture';end if;end loop;
 perform public.m10_select_framework_version(o,a,pack,'v1',true,null,gen_random_uuid());

 source:='frameworks.catalog';
 select jsonb_agg(jsonb_build_object('packKey',pack,'versionKey',r.version_key,'title','M14 native framework','editionDate','2024-01-01','language','en','sourceUrl','https://example.org/fixture','sourceReference','https://example.org/fixture','attribution','Approved fixture','contentHash',r.content_hash,'sourceKind','approved_fixture','editionLabel',null,'distributionRights',null,'reviewOwner',null,'selected',r.version_key='v1','enabled',true,'selectionRevision',1) order by r.version_key) into expected from public.framework_pack_versions r where r.pack_key=pack;
 perform pg_temp.parity(o,a,source,'{}',jsonb_build_object('packKey',pack),expected);
 insert into public.framework_controls(id,organization_id,title,description,owner_user_id,created_by,updated_by,created_at,updated_at) values(ctrl,o,'M14 native control','Fixture',a,a,a,now(),now());

 source:='frameworks.controls';
 expected:=jsonb_build_array(jsonb_build_object('id',ctrl,'title','M14 native control','description','Fixture','ownerUserId',a,'ownerActive',true,'status','not_started','revision',1,'archivedAt',null,'createdAt',now(),'updatedAt',now()));
 perform pg_temp.parity(o,a,source,'{}','{}',expected);
 insert into public.framework_controls(organization_id,title,description,owner_user_id,created_by,updated_by,archived_at) values(o,'Archived exclusion','Fixture',a,a,a,now());
 perform pg_temp.parity(o,a,source,'{"includeArchived":false}','{}',expected);
 insert into public.framework_control_revisions(organization_id,control_id,revision,title,description,owner_user_id,implementation_status,actor_user_id) values(o,ctrl,1,'M14 native control','Fixture',a,'not_started',a);
 insert into public.framework_control_requirement_mappings(id,organization_id,control_id,pack_key,version_key,requirement_key,rationale,source_control_revision,created_by) values(mapping,o,ctrl,pack,'v1','old','Reviewed fixture',1,a);
 insert into public.framework_control_mapping_products(organization_id,mapping_id,product_id) values(o,mapping,p);
 insert into public.framework_curated_crosswalks(source_pack_key,source_version_key,source_requirement_key,target_pack_key,target_version_key,target_requirement_key,strength,direction,rationale,provenance,reviewer,reviewed_at) values(pack,'v1','old',pack,'v2','new','partial','one_way','Reviewed fixture','Fixture','Reviewer',now());
 source:='frameworks.crosswalks';approved:=public.m14_03_source_policy(source)->'columns';
 select result->'relations' into expected from public.m10_crosswalk_page(o,a,pack,'v1',100,0);
 select jsonb_agg(public.m14_03_operational_projection(x,approved)) into expected from jsonb_array_elements(expected)x;
 perform pg_temp.parity(o,a,source,'{}',jsonb_build_object('packKey',pack,'versionKey','v1'),expected);
 source:='frameworks.upgrade_preview';approved:=public.m14_03_source_policy(source)->'columns';
 select result->'impacts' into expected from public.m10_upgrade_preview(o,a,pack,'v2',100,null);
 select jsonb_agg(public.m14_03_operational_projection(x,approved)) into expected from jsonb_array_elements(expected)x;
 perform pg_temp.parity(o,a,source,'{}',jsonb_build_object('packKey',pack,'targetVersionKey','v2'),expected);
 document:=jsonb_build_object('title','Custom M14','editionDate','2025-01-01','language','en','attribution','Tenant fixture','requirements',jsonb_build_array(jsonb_build_object('requirementKey','r1','identifier','R1','parentKey',null,'position',1,'heading','Fixture','text','Exact Ω text','sourceReference','Fixture')));
 select (result->>'draftId')::uuid into draft from public.m10_custom_pack_command(o,a,'create_draft',jsonb_build_object('document',document),null,gen_random_uuid());

 source:='frameworks.custom';approved:=public.m14_03_source_policy(source)->'columns';
 -- Native source-owned page owns summaries and ordering. Export must consume it exactly.
 select result->'items' into expected from public.m10_custom_pack_page(o,a,100,0);
 select jsonb_agg(public.m14_03_operational_projection(x,approved)) into expected from jsonb_array_elements(expected)x;
 perform pg_temp.parity(o,a,source,'{}','{}',expected);
 source:='frameworks.custom_requirements_preview';approved:=public.m14_03_source_policy(source)->'columns';
 select result#>'{content,requirements}' into expected from public.m10_custom_pack_detail(o,a,draft);
 select jsonb_agg(public.m14_03_operational_projection(x,approved)) into expected from jsonb_array_elements(expected)x;
 perform pg_temp.parity(o,a,source,'{}',jsonb_build_object('draftId',draft),expected);
 perform public.m10_request_coverage(o,p,pack,'v1');
 update public.framework_coverage_scopes set status='leased',lease_owner=worker,lease_expires_at=now()+interval '1 minute' where organization_id=o and product_id=p and pack_key=pack and version_key='v1';
 perform public.m10_recalculate_coverage_scope(worker,o,p,pack,'v1');
 source:='frameworks.coverage_requirements';ctx:=jsonb_build_object('packKey',pack,'versionKey','v1','productId',p);
 select jsonb_agg(jsonb_build_object('requirementKey',r.requirement_key,'identifier',r.identifier,'heading',r.heading,'text',r.text,'parentKey',r.parent_requirement_key,'coverageState',cov.status,'calculationStatus','current','sourceRevision',scope.source_revision,'computedRevision',scope.computed_revision) order by r.tree_order) into expected
 from public.framework_requirements r join public.framework_coverage_scopes scope on scope.organization_id=o and scope.product_id=p and scope.pack_key=r.pack_key and scope.version_key=r.version_key join public.framework_coverage_rows cov on cov.organization_id=scope.organization_id and cov.product_id=scope.product_id and cov.pack_key=scope.pack_key and cov.version_key=scope.version_key and cov.requirement_key=r.requirement_key where r.pack_key=pack and r.version_key='v1';
 perform pg_temp.parity(o,a,source,'{}',ctx,expected);
 if exists(select 1 from public.m14_03_operational_source_rows(o,a,source,'{"filter":"excluded"}',ctx)) then raise exception 'coverage filter must exclude fixture';end if;
 update public.framework_coverage_scopes set status='pending',source_revision=source_revision+1 where organization_id=o and product_id=p and pack_key=pack and version_key='v1';
 if exists(select 1 from public.m14_03_operational_source_rows(o,a,source,'{}',ctx) where row_values->>'coverageState'<>'stale' or row_values->>'calculationStatus'<>'stale') then raise exception 'FAIL stale coverage must preserve native stale state';end if;
 update public.framework_coverage_scopes set status='error' where organization_id=o and product_id=p and pack_key=pack and version_key='v1';
 if exists(select 1 from public.m14_03_operational_source_rows(o,a,source,'{}',ctx) where row_values->>'coverageState'<>'stale' or row_values->>'calculationStatus'<>'unavailable') then raise exception 'FAIL error coverage must preserve native unavailable calculation';end if;
end$$;
rollback;
