-- Reviewed read-only native list functions share the outer export capture snapshot.
-- Their bodies and public signatures remain unchanged.
alter function public.get_sbom_composite_review(uuid,uuid,uuid) stable;
alter function public.get_sbom_diff_findings(uuid,uuid,uuid) stable;
alter function public.get_sbom_diff_findings(uuid,uuid,uuid,integer,text) stable;
alter function public.get_sbom_validation_report(uuid,uuid,uuid) stable;
alter function public.list_sbom_dependency_tree(uuid,uuid,uuid,uuid,text,integer,text) stable;
alter function public.list_sbom_diff_component_changes(uuid,uuid,uuid,integer,text,text,text,text) stable;
alter function public.list_sbom_documents_for_release(uuid,uuid,uuid,uuid,integer,text) stable;
alter function public.list_sbom_quality_findings(uuid,uuid,uuid,integer,text,text,text) stable;
alter function public.list_sbom_sources_for_release(uuid,uuid,uuid,uuid,integer,text) stable;
alter function public.list_supplier_sbom_requests(uuid,uuid,uuid,uuid,text,integer,text) stable;
alter function public.list_vulnerability_enriched_findings_for_document_page(uuid,uuid,uuid,boolean,integer,integer,text) stable;
alter function public.list_vulnerability_enriched_findings_for_document_page_baseline(uuid,uuid,uuid,boolean,integer,integer,text) stable;
alter function public.list_vulnerability_finding_reevaluation_history(uuid,uuid,uuid,uuid,integer,integer) stable;
alter function public.list_vulnerability_match_results_for_document_page(uuid,uuid,uuid,boolean,boolean,integer,integer,text) stable;
alter function public.search_sbom_components(uuid,uuid,uuid,text,integer,text) stable;

-- Shared, service-only CI source predicates; existing screens preserve their bounds.
create function public.m14_03_sbom_ci_binding_rows(p_organization_id uuid,p_limit integer,p_cursor text)
returns setof jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select to_jsonb(b) from public.ci_provider_release_bindings b where b.organization_id=p_organization_id
 and(p_cursor is null or (b.updated_at,b.id)<(split_part(p_cursor,'|',1)::timestamptz,split_part(p_cursor,'|',2)::uuid))
 order by b.updated_at desc,b.id desc limit least(greatest(p_limit,1),100);
$$;
create function public.m14_03_sbom_ci_credential_rows(p_organization_id uuid,p_limit integer,p_cursor text)
returns setof jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',c.id,'organization_id',c.organization_id,'label',c.label,'token_prefix',c.token_prefix,'created_at',c.created_at,'created_by',c.created_by,'revoked_at',c.revoked_at,'revoked_by',c.revoked_by,'last_used_at',c.last_used_at)
 from public.sbom_ci_credentials c where c.organization_id=p_organization_id
 and(p_cursor is null or (c.created_at,c.id)<(split_part(p_cursor,'|',1)::timestamptz,split_part(p_cursor,'|',2)::uuid))
 order by c.created_at desc,c.id desc limit least(greatest(p_limit,1),100);
$$;
create function public.m14_03_sbom_ci_build_run_rows(p_organization_id uuid,p_binding_id uuid,p_limit integer,p_cursor text)
returns setof jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',r.id,'binding_id',r.binding_id,'run_id',r.run_id,'run_attempt',r.run_attempt,'commit_sha',r.commit_sha,'ref',r.ref,'source_id',r.source_id,'ingest_job_id',r.ingest_job_id,'created_at',r.created_at)
 from public.ci_build_runs r where r.organization_id=p_organization_id and r.binding_id=p_binding_id
 and exists(select 1 from public.ci_provider_release_bindings b where b.organization_id=r.organization_id and b.id=r.binding_id)
 and(p_cursor is null or(r.created_at,r.id)<(split_part(p_cursor,'|',1)::timestamptz,split_part(p_cursor,'|',2)::uuid))
 order by r.created_at desc,r.id desc limit least(greatest(p_limit,1),100);
$$;

alter function public.m14_03_source_policy(text) rename to m14_03_operational_source_policy;
create function public.m14_03_source_policy(p_source text) returns jsonb language sql immutable set search_path=public,pg_temp as $$ select case p_source
when 'vulnerabilities.document_findings' then '{"permissions":["can_view_sboms","can_export_sboms","can_export_findings"],"columns":["id","advisoryId","releaseId","componentId","canonicalPurl","evaluatedVersion","outcome","confidence","firstDetectedAt","lastEvaluatedAt"],"page":false}'::jsonb
when 'vulnerabilities.enriched_findings' then '{"permissions":["can_view_sboms","can_export_sboms","can_export_findings"],"columns":["id","advisoryId","releaseId","cvssBaseScore","epss","kevStatus","priority"],"page":false}'::jsonb
when 'vulnerabilities.reevaluation_history' then '{"permissions":["can_view_findings","can_export_findings"],"columns":["id","transition","occurredAt","reason","sourceRecordId","sourceRecordVersionId"],"page":false}'::jsonb
when 'vulnerabilities.reachability_evidence' then '{"permissions":["can_view_findings","can_export_findings"],"columns":["id","verdict","freshness","createdAt"],"page":false}'::jsonb
when 'vulnerabilities.sync_runs' then '{"permissions":["can_export_vulnerabilities"],"columns":["id","feedKey","status","attempt","recordsFetched","recordsPromoted","failureCode","startedAt","completedAt"],"page":false,"requiredRole":"admin"}'::jsonb
when 'vulnerabilities.feed_health' then '{"permissions":["can_export_vulnerabilities"],"columns":["feedKey","enabled","status","freshness","lastAttemptedAt","lastSuccessfulCompleteAt","nextScheduledAt","currentRecordCount","queueDepth","failureCount"],"page":false,"requiredRole":"admin"}'::jsonb
when 'sboms.source_history' then '{"permissions":["can_view_sboms","can_export_sboms"],"columns":["id","fileName","source","status","createdAt"],"page":false}'::jsonb
when 'sboms.documents_for_release' then '{"permissions":["can_view_sboms","can_export_sboms"],"columns":["id","sourceId","format","specificationVersion","state","validationStatus","componentCount","dependencyCount","createdAt"],"page":false}'::jsonb
when 'sboms.components' then '{"permissions":["can_view_sboms","can_export_sboms"],"columns":["id","normalizedName","normalizedVersion","canonicalPurl","cpe","ecosystem","scope","licenseExpression","depth"],"page":false}'::jsonb
when 'sboms.dependency_tree' then '{"permissions":["can_view_sboms","can_export_sboms"],"columns":["id","parentComponentId","normalizedName","normalizedVersion","depth"],"page":false}'::jsonb
when 'sboms.quality_findings' then '{"permissions":["can_view_sboms","can_export_sboms"],"columns":["id","kind","severity","code","ruleId","dimension","sourcePath","expected","actual","remediation","componentId","createdAt"],"page":false}'::jsonb
when 'sboms.validation_diagnostics' then '{"permissions":["can_view_sboms","can_export_sboms"],"columns":["severity","code","path","message"],"page":false}'::jsonb
when 'sboms.diff_components' then '{"permissions":["can_view_sboms","can_export_sboms"],"columns":["id","change","identity","currentVersion","baselineVersion","ecosystem","explanation","createdAt"],"page":false}'::jsonb
when 'sboms.diff_findings' then '{"permissions":["can_view_sboms","can_export_sboms","can_view_findings","can_export_findings"],"columns":["findingId","change","origin","explanation"],"page":false}'::jsonb
when 'sboms.composite_conflicts' then '{"permissions":["can_view_sboms","can_export_sboms"],"columns":["id","identity","kind","field","state","selectedComponentId","resolutionReason","resolvedAt"],"page":false}'::jsonb
when 'sboms.composite_relationships' then '{"permissions":["can_view_sboms","can_export_sboms"],"columns":["id","kind","state","parentComponentId","childComponentId","sourceId","documentId","reason","resolvedAt"],"page":false}'::jsonb
when 'sboms.supplier_requests' then '{"permissions":["can_view_sboms","can_export_sboms"],"columns":["id","status","createdAt","updatedAt"],"page":false}'::jsonb
when 'sboms.ci_credentials' then '{"permissions":["can_view_sboms","can_export_sboms"],"columns":["id","label","createdAt","revokedAt","lastUsedAt"],"page":false,"requiredRole":"owner"}'::jsonb
when 'sboms.ci_bindings' then '{"permissions":["can_view_sboms","can_export_sboms"],"columns":["id","connectorId","productId","releaseId","provider","repositoryOwner","repositoryName","status","version","createdAt","updatedAt"],"page":false,"requiredRole":"owner"}'::jsonb
when 'sboms.ci_binding_runs' then '{"permissions":["can_view_sboms","can_export_sboms"],"columns":["id","bindingId","runId","runAttempt","commitSha","ref","sourceId","jobId","state","createdAt"],"page":false,"requiredRole":"owner"}'::jsonb
else public.m14_03_operational_source_policy(p_source) end $$;

create function public.m14_03_additional_source_rows(p_org uuid,p_actor uuid,p_source text,p_filters jsonb,p_context jsonb)
returns table(source_id text,source_version text,product_id uuid,row_values jsonb)
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare
 v_policy jsonb;v_permission text;v_record record;v_items jsonb;v_item jsonb;v_flat jsonb;
 v_cursor text:=null;v_next text;v_page integer:=1;v_count integer:=0;v_product uuid;
 v_doc uuid:=nullif(p_context->>'documentId','')::uuid;v_source uuid:=nullif(p_context->>'sourceId','')::uuid;
 v_release uuid:=nullif(p_context->>'releaseId','')::uuid;v_product_context uuid:=nullif(p_context->>'productId','')::uuid;
 v_diff uuid:=nullif(p_context->>'diffId','')::uuid;v_review uuid:=nullif(p_context->>'reviewId','')::uuid;
 v_binding uuid:=nullif(p_context->>'bindingId','')::uuid;v_finding uuid:=nullif(p_context->>'findingId','')::uuid;
 v_single boolean:=false;v_outcome text;v_ingest text;v_match text;v_source_status text;v_document uuid;
begin
 v_policy:=public.m14_03_source_policy(p_source);
 if v_policy is null or p_source not like 'sboms.%' and p_source not like 'vulnerabilities.%' then raise exception 'unknown_export_source' using errcode='22023';end if;
 for v_permission in select jsonb_array_elements_text(v_policy->'permissions') loop
  if not public.m14_03_actor_can(p_org,p_actor,v_permission) then raise exception 'export_access_denied' using errcode='42501';end if;
 end loop;
 if p_source in ('sboms.ci_credentials','sboms.ci_bindings','sboms.ci_binding_runs') and not exists(select 1 from public.organization_members where organization_id=p_org and user_id=p_actor and role='owner') then raise exception 'export_access_denied' using errcode='42501';end if;
 if p_source in ('vulnerabilities.sync_runs','vulnerabilities.feed_health') and not exists(select 1 from public.organization_members where organization_id=p_org and user_id=p_actor and role in ('owner','admin')) then raise exception 'export_access_denied' using errcode='42501';end if;
 v_product:=v_product_context;
 if v_doc is not null then select s.product_id into v_product from public.sbom_documents d join public.sbom_sources s on s.organization_id=d.organization_id and s.id=d.source_id where d.organization_id=p_org and d.id=v_doc; if not found then raise exception 'export_access_denied' using errcode='42501';end if;end if;
 if v_source is not null then select s.product_id into v_product from public.sbom_sources s where s.organization_id=p_org and s.id=v_source; if not found then raise exception 'export_access_denied' using errcode='42501';end if;end if;
 if v_diff is not null then select s.product_id into v_product from public.sbom_diff_reports d join public.sbom_sources s on s.organization_id=d.organization_id and s.id=d.source_id where d.organization_id=p_org and d.id=v_diff;if not found then raise exception 'export_access_denied' using errcode='42501';end if;end if;
 if v_review is not null then select r.product_id into v_product from public.sbom_composite_reviews r where r.organization_id=p_org and r.id=v_review;if not found then raise exception 'export_access_denied' using errcode='42501';end if;end if;
 if v_binding is not null then select b.product_id into v_product from public.ci_provider_release_bindings b where b.organization_id=p_org and b.id=v_binding;if not found then raise exception 'export_access_denied' using errcode='42501';end if;end if;
 loop
  v_items:='[]';v_next:=null;v_outcome:='found';v_single:=false;
  case p_source
  when 'sboms.source_history' then
   select * into v_record from public.list_sbom_sources_for_release(p_org,p_actor,v_product_context,v_release,100,v_cursor);
   v_outcome:=v_record.outcome;v_items:=v_record.sources;v_next:=v_record.next_cursor;
  when 'sboms.documents_for_release' then
   select * into v_record from public.list_sbom_documents_for_release(p_org,p_actor,v_product_context,v_release,100,v_cursor);
   v_outcome:=v_record.outcome;v_items:=v_record.result->'documents';v_next:=v_record.result->>'nextCursor';
  when 'sboms.components' then
   select * into v_record from public.search_sbom_components(p_org,p_actor,v_doc,p_filters->>'q',100,v_cursor);
   v_outcome:=v_record.outcome;v_items:=v_record.result->'components';v_next:=v_record.result->>'nextCursor';
  when 'sboms.dependency_tree' then
   select * into v_record from public.list_sbom_dependency_tree(p_org,p_actor,v_doc,nullif(p_filters->>'parentComponentId','')::uuid,p_filters->>'q',100,v_cursor);
   v_outcome:=v_record.outcome;v_items:=v_record.result->'items';v_next:=v_record.result->>'nextCursor';
  when 'sboms.quality_findings' then
   select * into v_record from public.list_sbom_quality_findings(p_org,p_actor,v_source,100,v_cursor,p_filters->>'severity',p_filters->>'kind');
   v_outcome:=v_record.outcome;v_items:=v_record.result->'findings';v_next:=v_record.result->>'nextCursor';
  when 'sboms.validation_diagnostics' then
   select * into v_record from public.get_sbom_validation_report(p_org,p_actor,v_source);
   v_outcome:=v_record.outcome;v_items:=v_record.report->'diagnostics';v_single:=true;
  when 'sboms.diff_components' then
   select * into v_record from public.list_sbom_diff_component_changes(p_org,p_actor,v_diff,100,v_cursor,p_filters->>'change',p_filters->>'ecosystem',p_filters->>'q');
   v_outcome:=v_record.outcome;v_items:=v_record.result->'changes';v_next:=v_record.result->>'nextCursor';
  when 'sboms.diff_findings' then
   select * into v_record from public.get_sbom_diff_findings(p_org,p_actor,v_diff,100,v_cursor);
   v_outcome:=v_record.outcome;if v_record.result->>'state'<>'ready' then raise exception 'source_degraded' using errcode='22023';end if;
   v_items:=v_record.result->'items';v_next:=v_record.result->>'nextCursor';
  when 'sboms.composite_conflicts','sboms.composite_relationships' then
   if (select count(*) from public.sbom_composite_conflicts x where x.organization_id=p_org and x.review_id=v_review)>100000 or (select count(*) from public.sbom_composite_unresolved_relationships x where x.organization_id=p_org and x.review_id=v_review)>100000 then raise exception 'export_limit' using errcode='22023';end if;
   select * into v_record from public.get_sbom_composite_review(p_org,p_actor,v_review);
   v_outcome:=v_record.outcome;v_items:=v_record.review->case p_source when 'sboms.composite_conflicts' then 'conflicts' else 'relationships' end;v_single:=true;
  when 'sboms.supplier_requests' then
   if p_filters ? 'productId' and (p_filters->>'productId')::uuid<>v_product_context or p_filters ? 'releaseId' and (p_filters->>'releaseId')::uuid<>v_release then raise exception 'invalid_export_context' using errcode='22023';end if;
   select * into v_record from public.list_supplier_sbom_requests(p_org,p_actor,coalesce(nullif(p_filters->>'productId','')::uuid,v_product_context),coalesce(nullif(p_filters->>'releaseId','')::uuid,v_release),p_filters->>'state',100,v_cursor);
   v_outcome:=v_record.outcome;v_items:=v_record.requests;v_next:=v_record.next_cursor;
  when 'sboms.ci_credentials' then
   select coalesce(jsonb_agg(x),'[]') into v_items from public.m14_03_sbom_ci_credential_rows(p_org,100,v_cursor) x;
   if jsonb_array_length(v_items)=100 then v_next:=(v_items->99->>'created_at')||'|'||(v_items->99->>'id');end if;
  when 'sboms.ci_bindings' then
   select coalesce(jsonb_agg(x),'[]') into v_items from public.m14_03_sbom_ci_binding_rows(p_org,100,v_cursor) x;
   if jsonb_array_length(v_items)=100 then v_next:=(v_items->99->>'updated_at')||'|'||(v_items->99->>'id');end if;
  when 'sboms.ci_binding_runs' then
   select coalesce(jsonb_agg(x),'[]') into v_items from public.m14_03_sbom_ci_build_run_rows(p_org,v_binding,100,v_cursor) x;
   if jsonb_array_length(v_items)=100 then v_next:=(v_items->99->>'created_at')||'|'||(v_items->99->>'id');end if;
  when 'vulnerabilities.document_findings' then
   select * into v_record from public.list_vulnerability_match_results_for_document_page(p_org,p_actor,v_doc,coalesce((p_filters->>'includeLowConfidence')::boolean,false),coalesce((p_filters->>'includeReviewable')::boolean,true),v_page,100,p_filters->>'q');
   v_outcome:=v_record.outcome;v_items:=v_record.result->'results';if jsonb_array_length(v_items)=100 then v_next:=v_page::text;end if;
  when 'vulnerabilities.enriched_findings' then
   select * into v_record from public.list_vulnerability_enriched_findings_for_document_page(p_org,p_actor,v_doc,coalesce((p_filters->>'includeLowConfidence')::boolean,false),v_page,100,p_filters->>'q');
   v_outcome:=v_record.outcome;v_items:=v_record.result->'rows';if jsonb_array_length(v_items)=100 then v_next:=v_page::text;end if;
  when 'vulnerabilities.reevaluation_history' then
   select * into v_record from public.list_vulnerability_finding_reevaluation_history(p_org,p_actor,v_doc,v_finding,v_page,100);
   v_outcome:=v_record.outcome;v_items:=v_record.result->'rows';if jsonb_array_length(v_items)=100 then v_next:=v_page::text;end if;
  when 'vulnerabilities.reachability_evidence' then
   select * into v_record from public.get_vulnerability_finding_reachability_evidence(p_org,p_actor,v_doc,v_finding,coalesce((p_filters->>'includeStale')::boolean,false));
   v_outcome:=v_record.outcome;v_items:=case when v_record.result->'reachability'='null'::jsonb then '[]'::jsonb else jsonb_build_array(v_record.result->'reachability') end;v_single:=true;
  when 'vulnerabilities.sync_runs' then
   select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'feedKey',x.feed_key,'status',x.status,'attempt',x.attempt_count,'recordsFetched',x.records_received,'recordsPromoted',x.records_promoted,'failureCode',x.failure_code,'startedAt',x.started_at,'completedAt',coalesce(x.completed_at,x.dead_lettered_at))),'[]') into v_items from public.list_vulnerability_feed_sync_runs(p_filters->>'feedKey',100,(v_page-1)*100)x;
   if jsonb_array_length(v_items)=100 then v_next:=v_page::text;end if;
  when 'vulnerabilities.feed_health' then v_items:=public.vulnerability_feed_health_json(p_filters->>'feedKey');v_single:=true;
  else raise exception 'unknown_export_source' using errcode='22023';
  end case;
  if v_outcome<>'found' then raise exception 'export_access_denied' using errcode='42501';end if;
  for v_item in select value from jsonb_array_elements(coalesce(v_items,'[]')) loop
   v_count:=v_count+1;if v_count>100000 then raise exception 'export_limit' using errcode='22023';end if;
   v_flat:=v_item;
   if p_source='sboms.source_history' then v_flat:=v_item->'source';end if;
   if p_source='sboms.dependency_tree' then v_flat:=v_item->'component';end if;
   if p_source='sboms.supplier_requests' then v_flat:=v_item->'request';end if;
   if p_source='sboms.validation_diagnostics' then v_flat:=v_item||jsonb_build_object('path',v_item->'location');end if;
   if p_source='sboms.ci_credentials' then v_flat:=jsonb_build_object('id',v_item->'id','label',v_item->'label','createdAt',v_item->'created_at','revokedAt',v_item->'revoked_at','lastUsedAt',v_item->'last_used_at');end if;
   if p_source='sboms.ci_bindings' then v_flat:=jsonb_build_object('id',v_item->'id','connectorId',v_item->'connector_id','productId',v_item->'product_id','releaseId',v_item->'release_id','provider',v_item->'provider','repositoryOwner',v_item->'repository_owner','repositoryName',v_item->'repository_name','status',v_item->'status','version',v_item->'version','createdAt',v_item->'created_at','updatedAt',v_item->'updated_at');end if;
   if p_source='sboms.ci_binding_runs' then
    select j.status into v_ingest from public.sbom_ingest_jobs j where j.organization_id=p_org and j.id=(v_item->>'ingest_job_id')::uuid;
    select s.status into v_source_status from public.sbom_sources s where s.organization_id=p_org and s.id=(v_item->>'source_id')::uuid;
    select d.document_id into v_document from public.sbom_document_sources d where d.organization_id=p_org and d.source_id=(v_item->>'source_id')::uuid order by d.created_at desc limit 1;
    select j.status into v_match from public.vulnerability_match_jobs j where j.organization_id=p_org and j.document_id=v_document order by j.created_at desc limit 1;
    v_flat:=jsonb_build_object('id',v_item->'id','bindingId',v_item->'binding_id','runId',v_item->'run_id','runAttempt',v_item->'run_attempt','commitSha',v_item->'commit_sha','ref',v_item->'ref','sourceId',v_item->'source_id','jobId',v_item->'ingest_job_id','createdAt',v_item->'created_at','state',case when v_source_status in ('rejected','expired') or v_ingest in ('failed','dead_letter') or v_match in ('failed','dead_letter') then 'error' when v_ingest='completed' and v_match='completed' then 'policy_not_configured' else 'pending' end);
   end if;
   if p_source='vulnerabilities.document_findings' then v_flat:=v_item||jsonb_build_object('canonicalPurl',v_item->'componentPurl','evaluatedVersion',v_item->'componentVersion');end if;
   if p_source='vulnerabilities.enriched_findings' then
    v_flat:=(v_item->'finding')||jsonb_build_object('cvssBaseScore',v_item#>'{intelligence,cvss,preferred,baseScore}','epss',v_item#>'{intelligence,epss,value}','kevStatus',v_item#>'{intelligence,kev,status}',
      'priority',jsonb_build_object('kind','m14_priority_inputs_v1','inputs',jsonb_build_object('cvssBaseScore',v_item#>'{intelligence,cvss,preferred,baseScore}','epss',v_item#>'{intelligence,epss,value}','kevStatus',case when v_item#>>'{intelligence,kev,status}' in ('listed','not_listed','removed','disputed') then v_item#>>'{intelligence,kev,status}' else 'unavailable' end,'confidenceScore',coalesce(v_item#>'{finding,confidence,score}','0'::jsonb),'humanVerdict',case when v_item#>>'{finding,humanAssessment,verdict}' in ('affected','not_affected') then v_item#>'{finding,humanAssessment,verdict}' else 'null'::jsonb end)));
   end if;
   source_id:=coalesce(v_flat->>'id',v_flat->>'findingId',v_flat->>'feedKey',v_source::text||':diagnostic:'||v_count::text);
   if source_id is null then raise exception 'source_identity_missing' using errcode='22023';end if;
   source_version:=coalesce(v_flat->>'version',v_flat->>'updatedAt',v_flat->>'lastEvaluatedAt',v_flat->>'createdAt',encode(extensions.digest(v_flat::text,'sha256'),'hex'));
   product_id:=coalesce(nullif(v_flat->>'productId','')::uuid,v_product);
   row_values:=public.m14_03_operational_projection(v_flat,v_policy->'columns');
   -- Repeat private source inputs under each selectable field, because capture
   -- retains only requested keys. The worker maps these before serialization.
   if p_source='vulnerabilities.feed_health' then select jsonb_object_agg(k,jsonb_build_object('kind','m14_feed_health_v1','value',v_item)::text) into row_values from jsonb_object_keys(row_values) k;end if;
   return next;
  end loop;
  exit when v_single or nullif(v_next,'') is null;
  if v_next=v_cursor then raise exception 'export_cursor_stalled' using errcode='22023';end if;
  v_cursor:=v_next;v_page:=v_page+1;
 end loop;
end $$;

alter function public.m14_03_operational_source_rows(uuid,uuid,text,jsonb,jsonb) rename to m14_03_operational_source_rows_base;
create function public.m14_03_operational_source_rows(p_org uuid,p_actor uuid,p_source text,p_filters jsonb,p_context jsonb)
returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if p_source like 'sboms.%' or p_source like 'vulnerabilities.%' then return query select * from public.m14_03_additional_source_rows(p_org,p_actor,p_source,p_filters,p_context);
 else return query select * from public.m14_03_operational_source_rows_base(p_org,p_actor,p_source,p_filters,p_context);end if;
end $$;

create function public.m14_03_additional_snapshot_access(p_job public.export_jobs) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.m14_03_job_access(p_job) then return false;end if;
 if p_job.source not like 'sboms.%' and p_job.source not like 'vulnerabilities.%' then return false;end if;
 if p_job.source in ('sboms.ci_credentials','sboms.ci_bindings','sboms.ci_binding_runs') and not exists(select 1 from public.organization_members where organization_id=p_job.organization_id and user_id=p_job.requester_id and role='owner') then return false;end if;
 if p_job.source in ('vulnerabilities.sync_runs','vulnerabilities.feed_health') and not exists(select 1 from public.organization_members where organization_id=p_job.organization_id and user_id=p_job.requester_id and role in ('owner','admin')) then return false;end if;
 if exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id and r.product_id is not null and not exists(select 1 from public.products p where p.organization_id=p_job.organization_id and p.id=r.product_id)) then return false;end if;
 if p_job.context ? 'documentId' and not exists(select 1 from public.sbom_documents d where d.organization_id=p_job.organization_id and d.id=(p_job.context->>'documentId')::uuid) then return false;end if;
 if p_job.context ? 'sourceId' and not exists(select 1 from public.sbom_sources d where d.organization_id=p_job.organization_id and d.id=(p_job.context->>'sourceId')::uuid) then return false;end if;
 if p_job.context ? 'diffId' and not exists(select 1 from public.sbom_diff_reports d where d.organization_id=p_job.organization_id and d.id=(p_job.context->>'diffId')::uuid) then return false;end if;
 if p_job.context ? 'reviewId' and not exists(select 1 from public.sbom_composite_reviews d where d.organization_id=p_job.organization_id and d.id=(p_job.context->>'reviewId')::uuid) then return false;end if;
 if p_job.context ? 'bindingId' and not exists(select 1 from public.ci_provider_release_bindings d where d.organization_id=p_job.organization_id and d.id=(p_job.context->>'bindingId')::uuid) then return false;end if;
 if p_job.context ? 'findingId' and not exists(select 1 from public.vulnerability_findings d where d.organization_id=p_job.organization_id and d.id=(p_job.context->>'findingId')::uuid) then return false;end if;
 return true;
end $$;

do $$ declare p record;begin
 for p in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('m14_03_additional_source_rows','m14_03_additional_snapshot_access','m14_03_sbom_ci_binding_rows','m14_03_sbom_ci_credential_rows','m14_03_sbom_ci_build_run_rows','m14_03_operational_source_rows','m14_03_operational_source_rows_base','m14_03_operational_source_policy','m14_03_source_policy') loop
 execute format('revoke all on function %s from public, anon, authenticated',p.signature);
 execute format('grant execute on function %s to service_role',p.signature);
 end loop;
end $$;

create function public.m14_03_source_vulnerabilities_document_findings_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'vulnerabilities.document_findings',p_filters,p_context) $$;
revoke all on function public.m14_03_source_vulnerabilities_document_findings_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_vulnerabilities_document_findings_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_vulnerabilities_enriched_findings_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'vulnerabilities.enriched_findings',p_filters,p_context) $$;
revoke all on function public.m14_03_source_vulnerabilities_enriched_findings_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_vulnerabilities_enriched_findings_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_vulnerabilities_reevaluation_history_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'vulnerabilities.reevaluation_history',p_filters,p_context) $$;
revoke all on function public.m14_03_source_vulnerabilities_reevaluation_history_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_vulnerabilities_reevaluation_history_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_vulnerabilities_reachability_evidence_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'vulnerabilities.reachability_evidence',p_filters,p_context) $$;
revoke all on function public.m14_03_source_vulnerabilities_reachability_evidence_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_vulnerabilities_reachability_evidence_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_vulnerabilities_sync_runs_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'vulnerabilities.sync_runs',p_filters,p_context) $$;
revoke all on function public.m14_03_source_vulnerabilities_sync_runs_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_vulnerabilities_sync_runs_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_vulnerabilities_feed_health_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'vulnerabilities.feed_health',p_filters,p_context) $$;
revoke all on function public.m14_03_source_vulnerabilities_feed_health_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_vulnerabilities_feed_health_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_sboms_source_history_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'sboms.source_history',p_filters,p_context) $$;
revoke all on function public.m14_03_source_sboms_source_history_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_sboms_source_history_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_sboms_documents_for_release_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'sboms.documents_for_release',p_filters,p_context) $$;
revoke all on function public.m14_03_source_sboms_documents_for_release_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_sboms_documents_for_release_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_sboms_components_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'sboms.components',p_filters,p_context) $$;
revoke all on function public.m14_03_source_sboms_components_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_sboms_components_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_sboms_dependency_tree_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'sboms.dependency_tree',p_filters,p_context) $$;
revoke all on function public.m14_03_source_sboms_dependency_tree_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_sboms_dependency_tree_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_sboms_quality_findings_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'sboms.quality_findings',p_filters,p_context) $$;
revoke all on function public.m14_03_source_sboms_quality_findings_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_sboms_quality_findings_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_sboms_validation_diagnostics_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'sboms.validation_diagnostics',p_filters,p_context) $$;
revoke all on function public.m14_03_source_sboms_validation_diagnostics_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_sboms_validation_diagnostics_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_sboms_diff_components_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'sboms.diff_components',p_filters,p_context) $$;
revoke all on function public.m14_03_source_sboms_diff_components_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_sboms_diff_components_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_sboms_diff_findings_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'sboms.diff_findings',p_filters,p_context) $$;
revoke all on function public.m14_03_source_sboms_diff_findings_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_sboms_diff_findings_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_sboms_composite_conflicts_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'sboms.composite_conflicts',p_filters,p_context) $$;
revoke all on function public.m14_03_source_sboms_composite_conflicts_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_sboms_composite_conflicts_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_sboms_composite_relationships_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'sboms.composite_relationships',p_filters,p_context) $$;
revoke all on function public.m14_03_source_sboms_composite_relationships_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_sboms_composite_relationships_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_sboms_supplier_requests_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'sboms.supplier_requests',p_filters,p_context) $$;
revoke all on function public.m14_03_source_sboms_supplier_requests_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_sboms_supplier_requests_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_sboms_ci_credentials_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'sboms.ci_credentials',p_filters,p_context) $$;
revoke all on function public.m14_03_source_sboms_ci_credentials_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_sboms_ci_credentials_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_sboms_ci_bindings_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'sboms.ci_bindings',p_filters,p_context) $$;
revoke all on function public.m14_03_source_sboms_ci_bindings_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_sboms_ci_bindings_rows(uuid,uuid,jsonb,jsonb) to service_role;
create function public.m14_03_source_sboms_ci_binding_runs_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb) returns table(source_id text,source_version text,product_id uuid,row_values jsonb) language sql stable security definer set search_path=public,pg_temp as $$ select * from public.m14_03_additional_source_rows(p_org,p_actor,'sboms.ci_binding_runs',p_filters,p_context) $$;
revoke all on function public.m14_03_source_sboms_ci_binding_runs_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_source_sboms_ci_binding_runs_rows(uuid,uuid,jsonb,jsonb) to service_role;
