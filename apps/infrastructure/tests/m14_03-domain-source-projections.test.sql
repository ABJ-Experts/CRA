-- Rollback-only projection and legacy compatibility characterization.
begin;
set local statement_timeout='30s';
do $$ declare o uuid;u uuid;p uuid;s text;n integer;r record;ctx record;report jsonb;native_events jsonb:='[]';expected_events jsonb;actual_events jsonb;cursor_value text;seen uuid[]:='{}';batch_key uuid:=gen_random_uuid();begin
 select m.organization_id,m.user_id,x.id into o,u,p from public.organization_members m join public.products x on x.organization_id=m.organization_id where m.role='owner' and x.archived_at is null limit 1;
 if o is null then raise exception 'M14 domain fixture product unavailable';end if;
 foreach s in array array['products.registry','products.releases','products.imports','products.support_period_history','products.support_alerts','products.relationship.component_links','products.relationship.baseline_memberships','products.relationship.variants','products.relationship.graph_links','products.relationship.propagation_events','products.compliance.mod_assessments','products.compliance.security_artifacts','evidence.documents','suppliers.registry','tasks.inbox','tasks.routing_groups','tasks.absences','findings.triage_queue','findings.saved_views','reporting.obligations','supplier_evidence.requests','supplier_evidence.overdue'] loop
 select count(*) into n from public.m14_03_source_rows(o,u,s,'{}',jsonb_build_object('productId',p));
 end loop;
 if exists(select 1 from public.m14_03_source_rows(o,u,'suppliers.registry','{}','{}') rows_alias where rows_alias.row_values ? 'sessionToken') then raise exception 'restricted fields exported';end if;
 -- Native list and export share a pagination boundary without losing the extra row.
 insert into public.product_regulatory_outbox_events(id,organization_id,product_id,event_type,event_key,payload,correlation_id,delivery_state,graph_version)
 select ('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,o,p,'product_relationship.graph_changed',batch_key||':'||g,'{}',batch_key,'delivered',g from generate_series(1,101) g;
 loop
 select * into r from public.get_product_relationship_propagation_events(o,u,p,cursor_value,100,null);
 select seen||coalesce(array_agg((x->>'id')::uuid),'{}'::uuid[]) into seen from jsonb_array_elements(r.events->'events') x;
 native_events:=native_events||(r.events->'events');
 cursor_value:=r.events->>'nextCursor';exit when cursor_value is null;
 end loop;
 if (select count(*) from public.product_regulatory_outbox_events where organization_id=o and correlation_id=batch_key and id=any(seen))<>101 then raise exception 'native pagination skipped a boundary event';end if;
 select count(*) into n from public.m14_03_source_rows(o,u,'products.relationship.propagation_events','{}',jsonb_build_object('productId',p));
 if n<>cardinality(seen) then raise exception 'export/native propagation parity changed';end if;
 select jsonb_agg((select jsonb_object_agg(k.value,x.value#>string_to_array(k.value,'.'))from jsonb_array_elements_text(public.m14_03_source_policy('products.relationship.propagation_events')->'columns')k)order by x.ordinality)into expected_events from jsonb_array_elements(native_events)with ordinality x;
 select jsonb_agg(x.row_values order by x.ordinality)into actual_events from public.m14_03_source_rows(o,u,'products.relationship.propagation_events','{}',jsonb_build_object('productId',p))with ordinality x;
 if actual_events is distinct from expected_events then raise exception 'propagation approved values/order differ from native complete pages';end if;
 -- Existing scoped fixtures exercise actual nested source data without exposing it.
 for ctx in select m.organization_id,m.user_id,f.product_id from public.technical_files f join public.organization_members m on m.organization_id=f.organization_id and m.role='owner' where f.status='active' loop
 foreach s in array array['technical_file.sections','technical_file.readiness_gaps','technical_file.snapshots','technical_file.declarations','risk_register.risks'] loop
 select count(*) into n from public.m14_03_source_rows(ctx.organization_id,ctx.user_id,s,'{}',jsonb_build_object('productId',ctx.product_id));
 end loop;
 report:=public.m14_03_readiness_report(ctx.organization_id,ctx.user_id,ctx.product_id);
 if report->'canonicalReadiness' is distinct from public.m7_evidence_readiness_json(ctx.organization_id,ctx.product_id) or report->>'documentationReadinessOnly'<>'true' then raise exception 'canonical M7 completeness altered';end if;
 begin
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(ctx.organization_id,'owner','{"can_view_evidence":false}') on conflict(organization_id,base_role) do update set permissions=base_role_permission_overrides.permissions||'{"can_view_evidence":false}';
 report:=public.m14_03_readiness_report(ctx.organization_id,ctx.user_id,ctx.product_id);
 if report->'canonicalReadiness'<>'null'::jsonb or report->'evidence'<>'[]'::jsonb or report->>'degraded'<>'true' then raise exception 'restricted readiness counts/names leaked';end if;
 raise no_data_found;exception when no_data_found then null;end;
 end loop;
 for ctx in select m.organization_id,m.user_id,e.id export_id,e.snapshot_id,sn.product_id from public.technical_file_snapshot_exports e join public.technical_file_snapshots sn on sn.organization_id=e.organization_id and sn.id=e.snapshot_id join public.organization_members m on m.organization_id=e.organization_id and m.role='owner' limit 3 loop
 select count(*) into n from public.m14_03_source_rows(ctx.organization_id,ctx.user_id,'technical_file.snapshot_exports','{}',jsonb_build_object('productId',ctx.product_id,'snapshotId',ctx.snapshot_id,'exportId',ctx.export_id));
 if n<>1 then raise exception 'selected snapshot export scope mismatch';end if;
 end loop;
 for ctx in select m.organization_id,m.user_id,q.id request_id from public.supplier_evidence_requests q join public.organization_members m on m.organization_id=q.organization_id and m.role='owner' limit 3 loop
 select count(*) into n from public.m14_03_source_rows(ctx.organization_id,ctx.user_id,'supplier_evidence.review_items','{}',jsonb_build_object('requestId',ctx.request_id));
 end loop;
 -- A PostgreSQL headline projection must also work when an indexed item matches.
 if position('StartSel=, StopSel=' in pg_get_functiondef('public.search_evidence_documents_atomic(uuid,uuid,uuid,text,text,boolean,integer,integer,timestamptz,uuid)'::regprocedure))>0 then raise exception 'invalid legacy headline options';end if;
 select count(*) into n from public.m14_03_source_rows(o,u,'evidence.search_results','{"q":"test","includeHistorical":false}',jsonb_build_object('productId',p));
 if public.m8_evidence_validity_status(current_date-1,current_date+1,array[30])<>'expiring_soon' then raise exception 'canonical evidence validity changed';end if;
end $$;
rollback;
