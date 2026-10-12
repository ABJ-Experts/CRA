-- Source-domain list projections remain the single owner of filters and policies.
-- Read-only legacy facades become STABLE after explicit no-write inspection.
alter function public.list_supplier_organizations_atomic(uuid,uuid,text,boolean,integer,text) stable;
alter function public.list_finding_triage_queue_raw(uuid,uuid,jsonb,integer,text,text,text) stable;

-- The triage public facade materializes due work before its list projection.
-- Exports reuse that exact read projection without causing regulatory effects.
do $$ declare v_def text; begin
 v_def:=pg_get_functiondef('public.list_finding_triage_queue(uuid,uuid,jsonb,integer,text,text,text)'::regprocedure);
 if position('perform public.m5_triage_materialize_due_work(p_organization_id);' in v_def)=0 then raise exception 'triage_projection_baseline_changed'; end if;
 v_def:=replace(v_def,'FUNCTION public.list_finding_triage_queue(','FUNCTION public.m14_03_triage_read_projection(');
 v_def:=replace(v_def,'perform public.m5_triage_materialize_due_work(p_organization_id);','');
 execute v_def;
end $$;
alter function public.m14_03_triage_read_projection(uuid,uuid,jsonb,integer,text,text,text) stable;
create or replace function public.list_finding_triage_queue(p_organization_id uuid,p_actor_user_id uuid,p_filters jsonb default '{}',p_limit integer default 50,p_cursor text default null,p_sort text default null,p_order text default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform public.m5_triage_materialize_due_work(p_organization_id);
 return query select * from public.m14_03_triage_read_projection(p_organization_id,p_actor_user_id,p_filters,p_limit,p_cursor,p_sort,p_order);
end $$;

create function public.m14_03_readiness_report(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_product public.products; v_file public.technical_files; v_readiness jsonb; v_evidence jsonb; v_degraded boolean; v_report jsonb;
begin
 if not public.m14_03_actor_can(p_organization_id,p_actor_user_id,'can_view_products') or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_view_technical_files') then raise exception 'readiness_export_denied' using errcode='42501'; end if;
 select * into v_product from public.products where organization_id=p_organization_id and id=p_product_id and archived_at is null;
 if not found then raise exception 'readiness_product_unavailable' using errcode='42501'; end if;
 select * into v_file from public.technical_files where organization_id=p_organization_id and product_id=p_product_id and status='active';
 if not found then raise exception 'readiness_technical_file_unavailable' using errcode='42501'; end if;
 -- Canonical score never changes. Suppress the whole canonical projection when
 -- a restricted source would otherwise disclose its names or aggregate counts.
 v_degraded:=not public.m14_03_actor_can(p_organization_id,p_actor_user_id,'can_view_evidence')
 or exists(select 1 from public.technical_file_section_sources x join public.technical_file_sections s on s.organization_id=x.organization_id and s.id=x.section_id
 where x.organization_id=p_organization_id and s.technical_file_id=v_file.id and not public.m14_03_actor_can(p_organization_id,p_actor_user_id,public.m7_dashboard_source_permission(x.source_kind)));
 if not v_degraded then v_readiness:=public.m7_evidence_readiness_json(p_organization_id,p_product_id); end if;
 if public.m14_03_actor_can(p_organization_id,p_actor_user_id,'can_view_evidence') then
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',v.title,'sourceKind','evidence_document','sourceVersion',v.version_number::text,
 'validityStatus',public.m8_evidence_validity_status(v.validity_starts_on,v.validity_ends_on,(select evidence_expiry_alert_intervals from public.organization_settings where organization_id=p_organization_id)),
 'validFrom',case when v.validity_starts_on is null then null else v.validity_starts_on::timestamp at time zone 'UTC' end,
 'validUntil',case when v.validity_ends_on is null then null else v.validity_ends_on::timestamp at time zone 'UTC' end,
 'stale',public.m7_evidence_section_source_state(p_organization_id,p_product_id,x.id)='stale',
 'unavailable',public.m7_evidence_section_source_state(p_organization_id,p_product_id,x.id)='unavailable') order by x.id),'[]') into v_evidence
 from public.technical_file_section_sources x join public.technical_file_sections s on s.organization_id=x.organization_id and s.id=x.section_id
 join public.evidence_documents d on d.organization_id=x.organization_id and d.id=x.record_id
 join public.evidence_document_versions v on v.organization_id=d.organization_id and v.id=d.current_version_id
 where x.organization_id=p_organization_id and s.technical_file_id=v_file.id and x.source_kind='evidence_document';
 else v_evidence:='[]'; end if;
 v_report:=jsonb_build_object('version','m14_03_v1','product',jsonb_build_object('id',v_product.id,'name',v_product.name,'version',v_product.version),
 'snapshotAsOf',statement_timestamp(),'technicalFileVersion',v_file.version,'canonicalReadiness',v_readiness,'evidence',v_evidence,
 'degraded',v_degraded,'notices',case when v_degraded then '["Restricted evidence detail and dependent counts are omitted.","Documentation readiness is not certified conformity."]'::jsonb else '["Documentation readiness is not certified conformity."]'::jsonb end,
 'documentationReadinessOnly',true,'sourceVersions',jsonb_build_array(jsonb_build_object('source','product','version',v_product.version::text,'asOf',statement_timestamp()),jsonb_build_object('source','technical_file','version',v_file.version::text,'asOf',statement_timestamp())));
 if octet_length(v_report::text)>5242880 then raise exception 'readiness_report_limit' using errcode='54000'; end if;
 return v_report;
end $$;

create function public.m14_03_domain_source_rows(p_organization_id uuid,p_actor_user_id uuid,p_source text,p_filters jsonb,p_context jsonb)
returns table(source_id text,source_version text,product_id uuid,row_values jsonb)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_cursor text; v_page jsonb; v_row jsonb; v_count integer:=0; v_result record; v_product uuid; v_created timestamptz; v_cursor_id uuid;
begin
 if p_context->>'_exportScope'='current_page' then v_cursor:=p_filters->>'cursor'; end if;
 if p_source='technical_files.readiness_report' then
 return query select p_context->>'productId',p.version::text,p.id,jsonb_build_object('report',public.m14_03_readiness_report(p_organization_id,p_actor_user_id,p.id)::text)
 from public.products p where p.organization_id=p_organization_id and p.id=(p_context->>'productId')::uuid;
 elsif p_source='suppliers.registry' then
 loop
 select x.result into v_page from public.list_supplier_organizations_atomic(p_organization_id,p_actor_user_id,p_filters->>'search',coalesce((p_filters->>'includeArchived')::boolean,false),100,v_cursor) x;
 if v_page is null then raise exception 'supplier_export_denied' using errcode='42501'; end if;
 for v_row in select value from jsonb_array_elements(v_page->'items') loop
 return query select v_row->>'id',coalesce(v_row->>'version',''),null::uuid,jsonb_build_object('id',v_row->'id','name',v_row->'name','criticality',v_row->'criticality','state',v_row->'state','createdAt',v_row->'createdAt');
 v_count:=v_count+1; if v_count>100000 then raise exception 'export_capture_limit' using errcode='54000'; end if; end loop;
 v_cursor:=v_page->>'nextCursor'; exit when v_cursor is null; end loop;
 elsif p_source='tasks.inbox' then
 loop
 select * into v_result from public.m1201_list_tasks(p_organization_id,p_actor_user_id,coalesce(p_filters->>'scope','mine'),p_filters->>'type',p_filters->>'state',(p_filters->>'ownerUserId')::uuid,(p_filters->>'dueFrom')::timestamptz,(p_filters->>'dueTo')::timestamptz,v_cursor,100);
 if v_result.outcome<>'found' then raise exception 'task_export_denied' using errcode='42501'; end if;
 for v_row in select value from jsonb_array_elements(v_result.tasks) loop
 return query select v_row->>'sourceId',coalesce(v_row->>'sourceRevision',''),null::uuid,jsonb_build_object('sourceId',v_row->'sourceId','taskType',v_row->'taskType','state',v_row->'state','title',v_row->'title','accountableOwnerUserId',v_row->'accountableOwnerUserId','dueAt',v_row->'dueAt');
 v_count:=v_count+1; if v_count>100000 then raise exception 'export_capture_limit' using errcode='54000'; end if; end loop;
 v_cursor:=v_result.next_cursor; exit when v_cursor is null; end loop;
 elsif p_source='evidence.documents' then
 if v_cursor is not null then
 v_cursor:=convert_from(decode(translate(v_cursor,'-_','+/')||repeat('=',(4-length(v_cursor)%4)%4),'base64'),'utf8');
 v_created:=split_part(v_cursor,'|',1)::timestamptz; v_cursor_id:=split_part(v_cursor,'|',2)::uuid;
 end if;
 v_product:=coalesce((p_filters->>'productId')::uuid,(p_context->>'productId')::uuid);
 loop
 v_page:=public.list_evidence_documents(p_organization_id,p_actor_user_id,v_product,p_filters->>'status',p_filters->>'documentClass',v_created,v_cursor_id,100,p_filters->>'validity');
 if v_page is null then raise exception 'evidence_export_denied' using errcode='42501'; end if;
 for v_row in select value from jsonb_array_elements(v_page->'items') loop
 return query select v_row#>>'{document,id}',coalesce(v_row#>>'{document,currentVersion,versionNumber}',''),v_product,
 jsonb_build_object('id',v_row#>'{document,id}','title',v_row#>'{document,currentVersion,title}','documentClass',v_row#>'{document,currentVersion,documentClass}','status',v_row#>'{document,currentVersion,status}',
 'validityStatus',v_row->'validityStatus','validFrom',v_row#>'{document,currentVersion,validFrom}','validUntil',v_row#>'{document,currentVersion,validUntil}','createdAt',v_row#>'{document,createdAt}');
 v_count:=v_count+1; if v_count>100000 then raise exception 'export_capture_limit' using errcode='54000'; end if;
 v_created:=(v_row#>>'{document,currentVersion,createdAt}')::timestamptz; v_cursor_id:=(v_row#>>'{document,currentVersion,id}')::uuid;
 end loop;
 exit when v_page->>'nextCursor' is null;
 -- Native opaque cursor retains microseconds. Do not reconstruct from the
 -- public timestamp, whose display precision is lower than pagination.
 v_cursor:=convert_from(decode(translate(v_page->>'nextCursor','-_','+/')||repeat('=',(4-length(v_page->>'nextCursor')%4)%4),'base64'),'utf8');
 v_created:=split_part(v_cursor,'|',1)::timestamptz; v_cursor_id:=split_part(v_cursor,'|',2)::uuid;
 end loop;
 elsif p_source='findings.triage_queue' then
 loop
 select x.result into v_page from public.m14_03_triage_read_projection(p_organization_id,p_actor_user_id,p_filters-'cursor'-'limit',100,v_cursor,p_filters->>'sort',p_filters->>'order') x;
 if v_page is null then raise exception 'triage_export_denied' using errcode='42501'; end if;
 for v_row in select value from jsonb_array_elements(v_page->'rows') loop
 return query select v_row#>>'{finding,id}',coalesce(v_row#>>'{finding,updatedAt}',''),(v_row#>>'{product,id}')::uuid,
 jsonb_build_object('id',v_row#>'{finding,id}','productId',v_row#>'{product,id}','releaseId',v_row#>'{release,id}','advisoryId',v_row#>'{finding,advisoryId}','severity',v_row->'severity','vexStatus',v_row->'vexStatus','lastEvaluatedAt',v_row#>'{finding,lastEvaluatedAt}');
 v_count:=v_count+1; if v_count>100000 then raise exception 'export_capture_limit' using errcode='54000'; end if; end loop;
 v_cursor:=v_page->>'nextCursor'; exit when v_cursor is null; end loop;
 elsif p_source='evidence.search_results' then return query select * from public.m14_03_evidence_search_rows(p_organization_id,p_actor_user_id,p_filters,p_context);
 elsif p_source='dashboard.trends' then return query select * from public.m14_03_dashboard_trend_rows(p_organization_id,p_actor_user_id,p_filters,p_context);
 else return query select * from public.m14_03_nested_domain_source_rows(p_organization_id,p_actor_user_id,p_source,p_filters,p_context);
 end if;
end $$;

create function public.m14_03_domain_snapshot_access(p_job public.export_jobs) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if p_job.source='products.releases' then return not exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id and not exists(select 1 from public.product_releases p where p.organization_id=p_job.organization_id and p.id::text=r.source_id)); end if;
 if p_job.source='technical_files.readiness_report' then
 -- A report captured before a source-permission change must never be delivered,
 -- since it can contain names and aggregate completeness values.
 return exists(select 1 from public.organization_permissions_version v where v.organization_id=p_job.organization_id and v.version=p_job.permission_version)
 and exists(select 1 from public.technical_files f where f.organization_id=p_job.organization_id and f.product_id=(p_job.context->>'productId')::uuid and f.status='active');
 end if;
 if p_job.source='suppliers.registry' then return not exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id and not exists(select 1 from public.supplier_organizations s where s.organization_id=p_job.organization_id and s.id::text=r.source_id)); end if;
 if p_job.source='evidence.documents' then return not exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id and not exists(select 1 from public.evidence_documents d where d.organization_id=p_job.organization_id and d.id::text=r.source_id and d.lifecycle_state='active')); end if;
 if p_job.source='findings.triage_queue' then return not exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id and not exists(select 1 from public.vulnerability_findings f where f.organization_id=p_job.organization_id and f.id::text=r.source_id and public.m5_triage_actor_has_permission(p_job.organization_id,p_job.requester_id,'can_view_findings'))); end if;
 if p_job.source='evidence.search_results' then return not exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id and not exists(select 1 from public.evidence_document_versions v join public.evidence_documents d on d.organization_id=v.organization_id and d.id=v.document_id join public.evidence_document_version_products vp on vp.organization_id=v.organization_id and vp.version_id=v.id where v.organization_id=p_job.organization_id and v.id::text=r.source_id and vp.product_id=(p_job.context->>'productId')::uuid and d.lifecycle_state='active'));end if;
 if p_job.source='dashboard.trends' then return exists(select 1 from public.organization_permissions_version v where v.organization_id=p_job.organization_id and v.version=p_job.permission_version);end if;
 if p_job.source='tasks.inbox' then return not exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id
 and not exists(select 1 from public.m14_03_domain_source_rows(p_job.organization_id,p_job.requester_id,'tasks.inbox',jsonb_build_object('scope','all'),p_job.context) t where t.source_id=r.source_id)); end if;
 return public.m14_03_nested_snapshot_access(p_job);
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'm14_03_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

-- Project approved primitive wire fields from native domain JSON. A dotted
-- column is a field path, never a provider/table identifier or arbitrary SQL.
create function public.m14_03_project_native_row(p_source text,p_row jsonb) returns jsonb
language sql stable set search_path=pg_catalog,public as $$
 select coalesce(jsonb_object_agg(c.key,case when jsonb_typeof(p_row#>string_to_array(c.key,'.')) in ('string','number','boolean','null')
 then p_row#>string_to_array(c.key,'.') else 'null'::jsonb end),'{}')
 from jsonb_array_elements_text(public.m14_03_source_policy(p_source)->'columns') c(key)
$$;

-- Additional nested production lists consume their native read-only projections.
-- Parent context remains bound by the existing domain RPC before any rows exist.
create function public.m14_03_nested_domain_source_rows(p_organization_id uuid,p_actor_user_id uuid,p_source text,p_filters jsonb,p_context jsonb)
returns table(source_id text,source_version text,product_id uuid,row_values jsonb)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_result record; v_data jsonb; v_array jsonb; v_row jsonb; v_rows integer:=0; v_page integer:=1; v_cursor text; v_path text[]; v_source_id text;
 v_page_size integer:=100; v_product uuid:=(p_context->>'productId')::uuid; v_finding uuid:=(p_context->>'findingId')::uuid;
begin
 if p_context->>'_exportScope'='current_page' then v_cursor:=p_filters->>'cursor'; v_page:=coalesce((p_filters->>'page')::integer,1); v_page_size:=coalesce((p_filters->>'pageSize')::integer,(p_filters->>'limit')::integer,25); end if;
 if p_source='audit.events' then
 return query select * from public.m14_03_audit_source_rows(p_organization_id,p_actor_user_id,p_filters,p_context);return;
 end if;
 loop
 v_path:='{}';
 case p_source
 when 'reporting.obligations' then select * into v_result from public.list_reporting_obligations(p_organization_id,p_actor_user_id,v_cursor,100,p_filters->>'type',p_filters->>'status',(p_filters->>'findingId')::uuid,coalesce(p_filters->>'scope','real')); v_data:=v_result.result; v_path:=array['obligations'];
 when 'reporting.stage_evidence_timeline' then select * into v_result from public.get_reporting_stage_evidence_api(p_organization_id,p_actor_user_id,(p_context->>'stageId')::uuid); v_data:=v_result.result; if v_data->>'obligationId' is distinct from p_context->>'obligationId' then raise exception 'export_source_unavailable' using errcode='42501'; end if; v_path:=array['timeline'];
 when 'findings.bulk_assessment_targets' then select * into v_result from public.get_vulnerability_assessment_bulk_operation(p_organization_id,p_actor_user_id,(p_context->>'operationId')::uuid); v_data:=v_result.result; v_path:=array['targets'];
 when 'findings.responsible_suppliers' then select * into v_result from public.get_finding_responsible_suppliers_atomic(p_organization_id,p_actor_user_id,v_finding); v_data:=v_result.result; select coalesce(jsonb_agg(x->'supplier' order by n),'[]') into v_array from jsonb_array_elements(v_data->'suppliers') with ordinality a(x,n); v_data:=v_array;
 when 'technical_file.snapshot_exports' then select * into v_result from public.get_technical_file_snapshot_export(p_organization_id,p_actor_user_id,v_product,(p_context->>'snapshotId')::uuid,(p_context->>'exportId')::uuid); v_data:=jsonb_build_array(v_result.result->'export');
 when 'products.relationship.component_links' then select * into v_result from public.get_product_component_links(p_organization_id,v_product,p_actor_user_id,(p_filters->>'asOf')::timestamptz); v_data:=v_result.links;
 when 'evidence.versions' then v_data:=public.list_evidence_document_versions(p_organization_id,p_actor_user_id,v_product,(p_context->>'documentId')::uuid); select 'found'::text outcome,v_data result into v_result; v_path:=array['items'];
 when 'evidence.legal_holds' then select * into v_result from public.list_evidence_document_legal_holds_atomic(p_organization_id,p_actor_user_id,(p_context->>'documentId')::uuid); v_data:=v_result.result; v_path:=array['legalHolds'];
 when 'evidence.retention_review' then select * into v_result from public.get_evidence_document_retention_review_atomic(p_organization_id,p_actor_user_id,(p_context->>'documentId')::uuid); v_data:=v_result.result; v_path:=array['blockers'];
 when 'evidence.bulk_intake_batch' then select * into v_result from public.get_evidence_bulk_intake_batch_atomic(p_organization_id,p_actor_user_id,v_product,(p_context->>'batchId')::uuid); v_data:=v_result.result; v_path:=array['batch','items'];
 when 'findings.saved_views' then select * into v_result from public.list_finding_saved_views(p_organization_id,p_actor_user_id); v_data:=v_result.result; v_path:=array['views'];
 when 'findings.detail.approval_policy' then
 if not exists(select 1 from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=v_finding) then raise exception 'export_finding_unavailable' using errcode='42501'; end if;
 select * into v_result from public.list_vulnerability_assessment_approval_policy(p_organization_id,p_actor_user_id); v_data:=v_result.result; v_path:=array['policies'];
 when 'suppliers.contacts' then select * into v_result from public.get_supplier_organization_atomic(p_organization_id,p_actor_user_id,(p_context->>'supplierId')::uuid); v_data:=v_result.result; v_path:=array['contacts'];
 when 'suppliers.responsibilities' then select * into v_result from public.get_supplier_organization_atomic(p_organization_id,p_actor_user_id,(p_context->>'supplierId')::uuid); v_data:=v_result.result; v_path:=array['responsibilities'];
 when 'tasks.routing_groups' then select * into v_result from public.m1201_list_groups(p_organization_id,p_actor_user_id); v_data:=v_result.groups;
 when 'tasks.absences' then select * into v_result from public.m1201_list_absences(p_organization_id,p_actor_user_id); v_data:=v_result.absences;
 when 'supplier_evidence.extraction_fields' then
 select * into v_result from public.get_supplier_document_extraction_atomic(p_organization_id,p_actor_user_id,v_product,(p_context->>'submissionId')::uuid,v_cursor,100); v_data:=v_result.result; v_path:=array['suggestions'];
 when 'supplier_evidence.requests' then
 select * into v_result from public.list_supplier_evidence_requests_filtered_atomic(p_organization_id,p_actor_user_id,(p_filters->>'supplierId')::uuid,(p_filters->>'productId')::uuid,p_filters->>'state',100,v_cursor::uuid); v_data:=v_result.result; v_path:=array['requests'];
 when 'supplier_evidence.overdue' then
 select * into v_result from public.list_supplier_evidence_overdue_atomic(p_organization_id,p_actor_user_id,(p_filters->>'productId')::uuid,(p_filters->>'supplierId')::uuid,100,v_cursor::uuid); v_data:=v_result.result; v_path:=array['overdue'];
 when 'products.imports' then select * into v_result from public.list_product_import_jobs(p_organization_id,p_actor_user_id,p_filters->>'status',v_page,v_page_size); v_data:=v_result.imports; v_path:=array['rows'];
 when 'products.import_rows' then select * into v_result from public.list_product_import_rows(p_organization_id,p_actor_user_id,(p_context->>'importId')::uuid,p_filters->>'result',v_page,v_page_size); v_data:=v_result.rows; v_path:=array['rows'];
 when 'products.support_period_history' then select * into v_result from public.get_product_support_periods(p_organization_id,v_product,p_actor_user_id); v_data:=v_result.support_periods;
 when 'products.support_alerts' then select * into v_result from public.get_product_support_alert_history(p_organization_id,v_product,p_actor_user_id); v_data:=v_result.alerts;
 when 'products.relationship.baseline_memberships' then select * into v_result from public.get_product_software_baseline_memberships(p_organization_id,v_product,p_actor_user_id,(p_filters->>'asOf')::timestamptz); v_data:=v_result.memberships;
 when 'products.relationship.baseline_revisions' then select * into v_result from public.get_software_baseline_history(p_organization_id,(p_context->>'baselineId')::uuid,p_actor_user_id); v_data:=v_result.baselines;
 when 'products.relationship.variants' then select * into v_result from public.get_product_variant_relationships(p_organization_id,v_product,p_actor_user_id,(p_filters->>'asOf')::timestamptz); v_data:=v_result.relationships;
 when 'products.relationship.graph_links' then select * into v_result from public.get_product_relationship_graph(p_organization_id,v_product,p_actor_user_id,(p_filters->>'asOf')::timestamptz,(p_filters->>'releaseId')::uuid,coalesce((p_filters->>'maxDepth')::integer,8),coalesce((p_filters->>'includeEnded')::boolean,false)); v_data:=v_result.graph; v_path:=array['links'];
 when 'products.relationship.propagation_events' then select * into v_result from public.get_product_relationship_propagation_events(p_organization_id,p_actor_user_id,v_product,v_cursor,100,p_filters->>'deliveryState'); v_data:=v_result.events; v_path:=array['events'];
 when 'products.compliance.mod_assessments' then select * into v_result from public.list_product_substantial_modification_assessments(p_organization_id,v_product,p_actor_user_id,(p_filters->>'releaseId')::uuid,p_filters->>'status',v_page,v_page_size); v_data:=v_result.assessments; v_path:=array['rows'];
 when 'products.compliance.mod_assessment_history' then select * into v_result from public.get_product_substantial_modification_assessment(p_organization_id,v_product,(p_context->>'assessmentId')::uuid,p_actor_user_id); v_data:=v_result.assessment; v_path:=array['history'];
 when 'products.compliance.security_artifacts' then select * into v_result from public.list_product_security_update_artifacts(p_organization_id,v_product,(p_filters->>'releaseId')::uuid,p_actor_user_id,p_filters->>'publicationStatus',v_page,v_page_size); v_data:=v_result.artifacts; v_path:=array['rows'];
 when 'technical_file.sections' then select * into v_result from public.get_technical_file(p_organization_id,p_actor_user_id,v_product); v_data:=v_result.result; v_path:=array['technicalFile','sections'];
 when 'technical_file.section_sources' then select * into v_result from public.get_technical_file_section(p_organization_id,p_actor_user_id,v_product,p_context->>'sectionKey'); v_data:=v_result.result; v_path:=array['section','sources'];
 when 'technical_file.source_review_history' then select * into v_result from public.get_technical_file_section(p_organization_id,p_actor_user_id,v_product,p_context->>'sectionKey'); v_data:=v_result.result;
 select x->'reviews' into v_array from jsonb_array_elements(v_data#>'{section,sources}') x where x->>'id'=p_context->>'sourceId'; v_data:=coalesce(v_array,'[]');
 when 'technical_file.readiness_gaps' then select * into v_result from public.get_technical_file_readiness(p_organization_id,p_actor_user_id,v_product); v_data:=v_result.result; v_path:=array['readiness','gaps'];
 when 'technical_file.snapshots' then select * into v_result from public.get_technical_file_snapshots(p_organization_id,p_actor_user_id,v_product); v_data:=v_result.result; v_path:=array['snapshots'];
 when 'technical_file.declarations' then select * into v_result from public.get_technical_file_declarations(p_organization_id,p_actor_user_id,v_product); v_data:=v_result.result; v_path:=array['declarations'];
 when 'technical_file.auditor_grants' then select * into v_result from public.list_technical_file_auditor_snapshot_grants(p_organization_id,p_actor_user_id,v_product,(p_context->>'snapshotId')::uuid); v_data:=v_result.result; v_path:=array['grants'];
 when 'risk_register.risks' then select * into v_result from public.get_technical_file_risk_register(p_organization_id,p_actor_user_id,v_product); if v_result.outcome='not_found' and public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_view_technical_files') and exists(select 1 from public.technical_files tf where tf.organization_id=p_organization_id and tf.product_id=v_product and tf.status='active') then select 'found'::text outcome,'{"riskRegister":{"risks":[]}}'::jsonb result into v_result;end if;v_data:=v_result.result; v_path:=array['riskRegister','risks'];
 when 'supplier_evidence.review_items' then select * into v_result from public.get_supplier_evidence_request_review_atomic(p_organization_id,p_actor_user_id,(p_context->>'requestId')::uuid); v_data:=v_result.result; v_path:=array['reviewItems'];
 when 'supplier_evidence.review_submissions' then select * into v_result from public.get_supplier_evidence_request_review_atomic(p_organization_id,p_actor_user_id,(p_context->>'requestId')::uuid); v_data:=v_result.result;
 select coalesce(jsonb_agg(x order by n),'[]') into v_array from jsonb_array_elements(v_data->'submissions') with ordinality a(x,n) where x->>'checklistItemId'=p_context->>'checklistItemId'; v_data:=v_array;
 when 'supplier_evidence.review_history' then select * into v_result from public.get_supplier_evidence_request_review_atomic(p_organization_id,p_actor_user_id,(p_context->>'requestId')::uuid); v_data:=v_result.result;
 select coalesce(jsonb_agg(x order by n),'[]') into v_array from jsonb_array_elements(v_data->'reviews') with ordinality a(x,n) where x->>'submissionId'=p_context->>'submissionId'; v_data:=v_array;
 when 'findings.detail.assessment_history' then select * into v_result from public.get_finding_vex_assessment(p_organization_id,p_actor_user_id,v_finding); v_data:=v_result.result; v_path:=array['history'];
 when 'findings.detail.assessment_evidence' then select * into v_result from public.get_finding_vex_assessment(p_organization_id,p_actor_user_id,v_finding); v_data:=v_result.result; v_path:=array['assessment','evidenceReferences'];
 when 'findings.remediation_history' then select * into v_result from public.get_finding_remediation_anchors(p_organization_id,p_actor_user_id,v_finding); v_data:=v_result.result; v_path:=array['history'];
 when 'findings.remediation_tickets' then select * into v_result from public.list_finding_remediation_tickets(p_organization_id,p_actor_user_id,v_finding); v_data:=v_result.result; v_path:=array['tickets'];
 when 'findings.notes' then select * into v_result from public.list_finding_triage_notes(p_organization_id,p_actor_user_id,v_finding,v_cursor,100); v_data:=v_result.result; v_path:=array['notes'];
 when 'findings.vex_exports' then select * into v_result from public.list_vulnerability_vex_export_snapshots(p_organization_id,p_actor_user_id,v_product,(p_context->>'releaseId')::uuid); v_data:=v_result.result; v_path:=array['snapshots'];
 when 'findings.vex_publications' then select * into v_result from public.list_vulnerability_vex_publication_jobs(p_organization_id,p_actor_user_id,(p_context->>'exportId')::uuid); v_data:=v_result.result; v_path:=array['jobs'];
 when 'findings.vex_publication_targets' then select * into v_result from public.list_vulnerability_vex_publication_targets(p_organization_id,p_actor_user_id); v_data:=v_result.result; v_path:=array['targets'];
 else return query select * from public.m14_03_operational_source_rows(p_organization_id,p_actor_user_id,p_source,p_filters,p_context); return;
 end case;
 if v_result.outcome<>'found' or v_data is null then raise exception 'export_source_unavailable' using errcode='42501'; end if;
 if cardinality(v_path)>0 then v_array:=coalesce(v_data#>v_path,'[]'); else v_array:=v_data; end if;
 if jsonb_typeof(v_array)<>'array' then raise exception 'export_source_projection_mismatch' using errcode='22023'; end if;
 for v_row in select value from jsonb_array_elements(v_array) loop
 if p_source in ('products.support_period_history','products.support_alerts') and p_context ? 'releaseId' and v_row->>'releaseId' is not null and v_row->>'releaseId' is distinct from coalesce(p_filters->>'releaseId',p_context->>'releaseId') then continue;end if;
 if p_source='products.support_period_history' then v_row:=v_row||jsonb_build_object('revision',v_row->'scopeRevision','startsAt',v_row->'supportStartsAt','endsAt',v_row->'supportEndsAt','rationale',v_row->'expectedLifetimeJustification');end if;
 v_rows:=v_rows+1; if v_rows>100000 then raise exception 'export_capture_limit' using errcode='54000'; end if;
 v_source_id:=coalesce(v_row->>'id',v_row->>'sourceId',v_row->>'findingId',v_row->>'sourceRowNumber',v_row->>'severity',v_row->>'requestId',v_row->>'key',(v_row->>'code')||':'||coalesce(v_row->>'productId','none'),(v_row->>'sectionKey')||':'||(v_row->>'code'));
 if v_source_id is null then raise exception 'export_source_identity_missing' using errcode='22023'; end if;
 return query select v_source_id,coalesce(v_row->>'version',v_row->>'revision',v_row->>'updatedAt',''),v_product,public.m14_03_project_native_row(p_source,v_row);
 end loop;
 if p_source in ('products.imports','products.import_rows','products.compliance.mod_assessments','products.compliance.security_artifacts') then
 exit when p_context->>'_exportScope'='current_page' or jsonb_array_length(v_array)<v_page_size; v_page:=v_page+1;
 elsif p_source in ('products.relationship.propagation_events','findings.notes','supplier_evidence.extraction_fields','supplier_evidence.requests','supplier_evidence.overdue','reporting.obligations') then
 v_cursor:=v_data->>'nextCursor'; exit when v_cursor is null;
 else exit; end if;
 end loop;
end $$;

-- Read-only transitive domain projections inspected before normalization.
alter function public.list_finding_remediation_tickets(uuid,uuid,uuid) stable;
alter function public.list_product_import_jobs(uuid,uuid,text,integer,integer) stable;
alter function public.list_technical_file_auditor_snapshot_grants(uuid,uuid,uuid,uuid) stable;
alter function public.get_product_substantial_modification_assessment(uuid,uuid,uuid,uuid) stable;
alter function public.get_product_relationship_graph(uuid,uuid,uuid,timestamp with time zone,uuid,integer,boolean) stable;
alter function public.get_product_relationship_propagation_events(uuid,uuid,uuid,text,integer,text) stable;
alter function public.get_product_software_baseline_memberships(uuid,uuid,uuid,timestamp with time zone) stable;
alter function public.get_product_support_alert_history(uuid,uuid,uuid) stable;
alter function public.get_product_support_periods(uuid,uuid,uuid) stable;
alter function public.get_product_variant_relationships(uuid,uuid,uuid,timestamp with time zone) stable;
alter function public.get_software_baseline_history(uuid,uuid,uuid) stable;
alter function public.get_technical_file_declarations(uuid,uuid,uuid) stable;
alter function public.get_technical_file_readiness(uuid,uuid,uuid) stable;
alter function public.get_technical_file_snapshots(uuid,uuid,uuid) stable;
alter function public.list_product_import_rows(uuid,uuid,uuid,text,integer,integer) stable;
alter function public.list_product_security_update_artifacts(uuid,uuid,uuid,uuid,text,integer,integer) stable;
alter function public.list_product_substantial_modification_assessments(uuid,uuid,uuid,uuid,text,integer,integer) stable;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'm14_03_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

create function public.m14_03_nested_snapshot_access(p_job public.export_jobs) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if p_job.source='audit.events' then
 return not exists(select 1 from public.export_snapshot_rows r left join public.audit_logs a on a.organization_id=r.organization_id and a.id::text=r.source_id
 where r.organization_id=p_job.organization_id and r.job_id=p_job.id and (a.id is null or not public.m13_03_event_visible(p_job.organization_id,p_job.requester_id,a)));
 end if;
 if p_job.source=any(array['products.imports','products.import_rows','products.support_period_history','products.support_alerts',
 'products.relationship.component_links','products.relationship.baseline_memberships','products.relationship.baseline_revisions','products.relationship.variants','products.relationship.graph_links','products.relationship.propagation_events',
 'products.compliance.mod_assessments','products.compliance.mod_assessment_history','products.compliance.security_artifacts',
 'technical_file.sections','technical_file.section_sources','technical_file.source_review_history','technical_file.readiness_gaps','technical_file.snapshots','technical_file.declarations','technical_file.auditor_grants',
 'evidence.versions','evidence.legal_holds','evidence.retention_review','evidence.bulk_intake_batch','findings.saved_views','findings.detail.approval_policy','suppliers.contacts','suppliers.responsibilities','tasks.routing_groups','tasks.absences','supplier_evidence.extraction_fields','supplier_evidence.requests','supplier_evidence.overdue','risk_register.risks','supplier_evidence.review_items','supplier_evidence.review_submissions','supplier_evidence.review_history',
 'findings.detail.assessment_history','findings.detail.assessment_evidence','findings.remediation_history','findings.remediation_tickets','reporting.obligations','reporting.stage_evidence_timeline','technical_file.snapshot_exports','findings.bulk_assessment_targets','findings.responsible_suppliers','findings.notes','findings.vex_exports','findings.vex_publications','findings.vex_publication_targets']) then
 return (with visible as materialized (select source_id from public.m14_03_nested_domain_source_rows(p_job.organization_id,p_job.requester_id,p_job.source,'{}',p_job.context))
 select not exists(select 1 from public.export_snapshot_rows r left join visible v on v.source_id=r.source_id where r.organization_id=p_job.organization_id and r.job_id=p_job.id and v.source_id is null));
 end if;
 return public.m14_03_operational_snapshot_access(p_job);
end $$;
revoke all on function public.m14_03_nested_snapshot_access(public.export_jobs) from public,anon,authenticated;
grant execute on function public.m14_03_nested_snapshot_access(public.export_jobs) to service_role;

alter function public.get_reporting_stage_evidence_api(uuid,uuid,uuid) stable;
alter function public.get_technical_file_snapshot_export(uuid,uuid,uuid,uuid,uuid) stable;
alter function public.list_supplier_evidence_overdue_atomic(uuid,uuid,uuid,uuid,integer,uuid) stable;
alter function public.get_product_component_links(uuid,uuid,uuid,timestamp with time zone) stable;
alter function public.get_supplier_organization_atomic(uuid,uuid,uuid) stable;

-- Search paging reuses the exact canonical full-text predicate, rank ordering and
-- authorized evidence projection. Version IDs distinguish historical results.
create function public.m14_03_evidence_search_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb)
returns table(source_id text,source_version text,product_id uuid,row_values jsonb)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_result record;v_row jsonb;v_rank integer;v_created timestamptz;v_id uuid;v_count integer:=0;v_product uuid:=(p_context->>'productId')::uuid;
begin
 loop
 select * into v_result from public.search_evidence_documents_atomic(p_org,p_actor,v_product,p_filters->>'q',p_filters->>'documentClass',coalesce((p_filters->>'includeHistorical')::boolean,false),50,v_rank,v_created,v_id);
 if v_result.outcome<>'found' then raise exception 'export_source_unavailable' using errcode='42501';end if;
 for v_row in select value from jsonb_array_elements(v_result.result->'items') loop
 v_count:=v_count+1;if v_count>100000 then raise exception 'export_capture_limit' using errcode='54000';end if;
 return query select v_row->>'versionId',v_row->>'versionNumber',v_product,public.m14_03_project_native_row('evidence.search_results',v_row||jsonb_build_object('snippet',coalesce(nullif(left(btrim(regexp_replace(coalesce(v_row->>'snippetText',''),'[[:cntrl:][:space:]]+',' ','g')),1000),''),'Extraction unavailable')));
 v_rank:=(v_row#>>'{cursor,rank}')::integer;v_id:=(v_row->>'versionId')::uuid;
 -- The public search cursor formats seconds; using the immutable version's exact
 -- timestamp prevents skipping siblings created in the same second at scale.
 select created_at into strict v_created from public.evidence_document_versions where organization_id=p_org and id=v_id;
 end loop;
 exit when jsonb_array_length(v_result.result->'items')<50;
 end loop;
end $$;

create function public.m14_03_dashboard_trend_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb)
returns table(source_id text,source_version text,product_id uuid,row_values jsonb)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_result jsonb;v_metric record;v_bucket jsonb;v_filters jsonb;v_access jsonb;
begin
 if p_filters ? 'datasetToken' and not p_context ? '_datasetSnapshot' then raise exception 'export_dataset_pin_required' using errcode='40001';end if;
 v_access:=jsonb_build_object('products',public.m14_03_actor_can(p_org,p_actor,'can_view_products'),'findings',public.m14_03_actor_can(p_org,p_actor,'can_view_findings'),'sbomCoverage',public.m14_03_actor_can(p_org,p_actor,'can_view_sboms'),'readiness',public.m14_03_actor_can(p_org,p_actor,'can_view_technical_files'));
 v_access:=v_access||coalesce(p_context->'_sourceAccess','{}'::jsonb);
 v_filters:=(p_filters-'datasetToken')||jsonb_build_object('sourceAccess',v_access);
 v_result:=public.get_dashboard_trends(p_org,p_actor,v_filters,p_context->'_datasetSnapshot');
 if v_result->>'outcome'<>'found' then raise exception 'export_source_unavailable' using errcode='42501';end if;
 if p_context ? '_datasetRevision' and p_context->>'_datasetRevision' is distinct from v_result#>>'{result,datasetRevision}' then raise exception 'export_dataset_changed' using errcode='40001';end if;
 for v_metric in select key,value from jsonb_each(v_result#>'{result,series}') order by key loop
 -- Restricted/degraded native metrics have no buckets and disclose no counts.
 for v_bucket in select value from jsonb_array_elements(v_metric.value->'buckets') loop
 return query select v_metric.key||':'||(v_bucket->>'start'),v_result#>>'{result,datasetRevision}',(p_filters->>'productId')::uuid,
 jsonb_build_object('bucket',v_bucket->'start','metric',v_metric.key,'value',v_bucket->'value','sourceVersion',v_result#>'{result,datasetRevision}','asOf',v_result#>'{snapshot,cutoffAt}');
 end loop;end loop;
end $$;
revoke all on function public.m14_03_evidence_search_rows(uuid,uuid,jsonb,jsonb),public.m14_03_dashboard_trend_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_evidence_search_rows(uuid,uuid,jsonb,jsonb),public.m14_03_dashboard_trend_rows(uuid,uuid,jsonb,jsonb) to service_role;

-- M13 receipt validation without its interactive FOR SHARE lock. Capture is
-- already atomic and source-policy version is rechecked before publication.
create function public.m14_03_audit_source_rows(p_org uuid,p_actor uuid,p_filters jsonb,p_context jsonb)
returns table(source_id text,source_version text,product_id uuid,row_values jsonb)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_pin jsonb:=p_context->'_auditSnapshot';v_receipt public.audit_logs;v_permissions jsonb;v_allowed text[];
begin
 if v_pin is null or not public.m13_03_actor_can(p_org,p_actor,'can_view_audit') then raise exception 'audit_access_denied' using errcode='42501';end if;
 select * into v_receipt from public.audit_logs where organization_id=p_org and id=(v_pin->>'receiptId')::uuid and actor_id=p_actor::text and action='audit.search.created';
 if not found or (v_receipt.after_redacted->>'expiresAt')::timestamptz<=clock_timestamp()
 or v_receipt.after_redacted->>'filterDigest' is distinct from v_pin->>'filterDigest'
 or v_receipt.after_redacted->>'scopeDigest' is distinct from v_pin->>'scopeDigest'
 or encode(extensions.digest(convert_to(public.m13_02_canonical_json(p_filters),'UTF8'),'sha256'),'hex') is distinct from v_pin->>'filterDigest'
 or not exists(select 1 from public.organization_permissions_version where organization_id=p_org and version=(v_receipt.after_redacted->>'scopeVersion')::bigint)
 then raise exception 'audit_snapshot_unavailable' using errcode='42501';end if;
 select array_agg(value) into v_allowed from jsonb_array_elements_text(v_pin->'allowedEntityTypes');
 v_permissions:=public.m13_03_permission_snapshot(p_org,p_actor);
 return query select a.id::text,coalesce(a.chain_sequence::text,''),null::uuid,jsonb_build_object('id',a.id,'sequence',a.chain_sequence::text,'createdAt',a.created_at,'action',a.action,'resourceType',a.entity_type,'resourceId',a.entity_id)
 from public.audit_logs a where a.organization_id=p_org
 and ((a.chain_version is not null and a.chain_sequence<=(v_receipt.after_redacted->>'highWaterSequence')::bigint) or (a.chain_version is null and a.created_at<=v_receipt.created_at))
 and a.entity_type=any(v_allowed) and public.m13_03_matches_filters(a,p_filters)
 and public.m13_03_event_visible_cached(p_org,p_actor,a,v_permissions)
 order by a.chain_sequence desc nulls last,a.created_at desc,a.id desc limit 100001;
end $$;
revoke all on function public.m14_03_audit_source_rows(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_audit_source_rows(uuid,uuid,jsonb,jsonb) to service_role;

-- Characterized compatibility repairs in source-owned read projections.
-- The previous propagation cursor named the first undisplayed row while the
-- predicate used >; resuming it skipped that row on every full page.
do $cursor$ declare v_def text;begin
 v_def:=pg_get_functiondef('public.get_product_relationship_propagation_events(uuid,uuid,uuid,text,integer,text)'::regprocedure);
 if position('''nextCursor'', (select id::text from next_row)' in v_def)=0 then raise exception 'propagation_cursor_baseline_changed';end if;
 v_def:=replace(v_def,'''nextCursor'', (select id::text from next_row)','''nextCursor'', case when exists(select 1 from next_row) then (select id::text from selected order by id desc limit 1) else null end');execute v_def;
end $cursor$;

do $search$ declare v_def text;begin
 v_def:=pg_get_functiondef('public.search_evidence_documents_atomic(uuid,uuid,uuid,text,text,boolean,integer,integer,timestamptz,uuid)'::regprocedure);
 if position('StartSel=, StopSel=' in v_def)=0 then raise exception 'evidence_search_headline_baseline_changed';end if;
 v_def:=replace(v_def,'StartSel=, StopSel=','StartSel="", StopSel=""');execute v_def;
end $search$;
