-- Positive wire parity fixtures; every synthetic effect is rolled back.
begin;
set local statement_timeout='30s';
create function pg_temp.assert_export_parity(p_org uuid,p_actor uuid,p_source text,p_filters jsonb,p_context jsonb,p_native jsonb)
returns void language plpgsql as $$
declare actual jsonb;expected jsonb;
begin
 if jsonb_typeof(p_native)<>'array' or jsonb_array_length(p_native)=0 then raise exception 'positive native fixture missing: %',p_source;end if;
 select jsonb_agg((select jsonb_object_agg(k.value,r.value#>string_to_array(k.value,'.')) from jsonb_array_elements_text(public.m14_03_source_policy(p_source)->'columns') k) order by r.ordinality)
 into expected from jsonb_array_elements(p_native) with ordinality r;
 select jsonb_agg(e.row_values order by e.ordinality) into actual from public.m14_03_source_rows(p_org,p_actor,p_source,p_filters,p_context) with ordinality e;
 if actual is distinct from expected then raise exception 'native row/filter/order/column parity failed: %',p_source;end if;
end $$;
do $$ declare org uuid;actor uuid;finding uuid;operation uuid:=gen_random_uuid();obligation uuid:=gen_random_uuid();stage uuid:=gen_random_uuid();history_finding uuid:=gen_random_uuid();rule record;r record;j jsonb;ctx record;
begin
 select m.organization_id,m.user_id,f.id into strict org,actor,finding from public.organization_members m join public.vulnerability_findings f on f.organization_id=m.organization_id where m.role='owner' order by f.id limit 1;
 insert into public.vulnerability_finding_assessment_bulk_operations(id,organization_id,created_by,operation_kind,selection_mode,submission,snapshot_digest,state,expires_at)
 values(operation,org,actor,'bulk','selected_rows','{}',repeat('b',64),'previewed',statement_timestamp()+interval '1 hour');
 insert into public.vulnerability_finding_assessment_bulk_operation_targets(organization_id,operation_id,finding_id,ordinal,product_name,release_name,component_identity,component_version,state)
 values(org,operation,finding,1,'M14 rollback product','M14 rollback release','=malicious Ω component','0001','pending');
 select * into r from public.get_vulnerability_assessment_bulk_operation(org,actor,operation);
 perform pg_temp.assert_export_parity(org,actor,'findings.bulk_assessment_targets','{}',jsonb_build_object('operationId',operation),r.result->'targets');
 select * into r from public.list_vulnerability_assessment_approval_policy(org,actor);
 perform pg_temp.assert_export_parity(org,actor,'findings.detail.approval_policy','{}',jsonb_build_object('findingId',finding),r.result->'policies');
 -- Native mutation workflows establish durable, source-owned histories.
 insert into public.vulnerability_findings select (jsonb_populate_record(null::public.vulnerability_findings,to_jsonb(f)||jsonb_build_object('id',history_finding,'component_identity','m14-parity-'||history_finding,'status','active','closed_at',null,'human_verdict',null,'reevaluation_state','unchanged'))).* from public.vulnerability_findings f where f.organization_id=org and f.id=finding;
 select * into r from public.submit_vulnerability_finding_vex_assessment_atomic(org,actor,history_finding,'affected',null,'Ω audit fixture','[{"kind":"external","title":"Authorized evidence Ω","url":"https://example.test/evidence"}]','Initial fixture assessment',0,gen_random_uuid(),repeat('e',64));
 if r.outcome<>'submitted' then raise exception 'positive VEX fixture unavailable: %',r.outcome;end if;
 select * into r from public.get_finding_vex_assessment(org,actor,history_finding);
 perform pg_temp.assert_export_parity(org,actor,'findings.detail.assessment_history','{}',jsonb_build_object('findingId',history_finding),r.result->'history');
 perform pg_temp.assert_export_parity(org,actor,'findings.detail.assessment_evidence','{}',jsonb_build_object('findingId',history_finding),r.result#>'{assessment,evidenceLinks}');
 if not exists(select 1 from public.m14_03_source_rows(org,actor,'findings.detail.assessment_evidence','{}',jsonb_build_object('findingId',history_finding)) x where x.row_values->>'title'='Authorized evidence Ω' and x.row_values->>'url'='https://example.test/evidence') then raise exception 'visible assessment evidence omitted';end if;
 select * into r from public.create_finding_triage_note_atomic(org,actor,history_finding,'Unicode Ω note, comma and "quotes"','{}',gen_random_uuid(),gen_random_uuid());
 if r.outcome<>'created' then raise exception 'positive note fixture unavailable: %',r.outcome;end if;
 select * into r from public.list_finding_triage_notes(org,actor,history_finding,null,100);
 perform pg_temp.assert_export_parity(org,actor,'findings.notes','{}',jsonb_build_object('findingId',history_finding),r.result->'notes');
 select * into r from public.record_finding_remediation_anchor_atomic(org,actor,history_finding,'corrective','0002','Explicit corrective fixture',null,null,null,null,0,gen_random_uuid(),gen_random_uuid());
 if r.outcome<>'recorded' then raise exception 'positive remediation fixture unavailable: %',r.outcome;end if;
 select * into r from public.record_finding_remediation_anchor_atomic(org,actor,history_finding,'corrective','0003','Corrected corrective fixture',null,null,null,'Corrected fixture revision',1,gen_random_uuid(),gen_random_uuid());
 if r.outcome<>'corrected' then raise exception 'positive remediation correction unavailable: %',r.outcome;end if;
 select * into r from public.get_finding_remediation_anchors(org,actor,history_finding);
 perform pg_temp.assert_export_parity(org,actor,'findings.remediation_history','{}',jsonb_build_object('findingId',history_finding),r.result->'history');
 select * into r from public.create_finding_saved_view_atomic(org,actor,'M14 parity '||operation,'{}','lastEvaluatedAt','desc',gen_random_uuid(),gen_random_uuid());
 if r.outcome<>'created' then raise exception 'positive saved view unavailable: %',r.outcome;end if;
 select * into r from public.list_finding_saved_views(org,actor);
 perform pg_temp.assert_export_parity(org,actor,'findings.saved_views','{}','{}',r.result->'views');
 -- Timeline order is source-authoritative even when events share a timestamp.
 select * into strict rule from public.reporting_rule_sets order by version desc limit 1;
 insert into public.reporting_obligations(id,organization_id,obligation_type,awareness_at,awareness_basis,rule_set_id,rule_set_version,rule_snapshot,created_by_user_id,created_by_display_name)
 values(obligation,org,'severe_incident',date_trunc('second',clock_timestamp()),'M14 parity fixture',rule.id,rule.version,rule.rules,actor,'M14 rollback owner');
 insert into public.reporting_obligation_stages(id,organization_id,obligation_id,stage_kind,anchor_kind,duration,state,due_at)
 values(stage,org,obligation,'early_warning','awareness','PT24H','running',clock_timestamp()+interval '1 day');
 insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,stage_kind,occurred_at,actor_user_id,new_value)
 values(org,obligation,'stage_approved','early_warning',date_trunc('second',clock_timestamp()),actor,jsonb_build_object('draftHash',repeat('a',64))),
 (org,obligation,'package_available','early_warning',date_trunc('second',clock_timestamp()),actor,'{}');
 select * into r from public.get_reporting_stage_evidence_api(org,actor,stage);
 perform pg_temp.assert_export_parity(org,actor,'reporting.stage_evidence_timeline','{}',jsonb_build_object('obligationId',obligation,'stageId',stage),r.result->'timeline');
 begin perform public.m14_03_source_rows(org,actor,'reporting.stage_evidence_timeline','{}',jsonb_build_object('obligationId',gen_random_uuid(),'stageId',stage));raise exception 'mismatched obligation scope accepted';exception when insufficient_privilege then null;end;
 select * into r from public.list_reporting_obligations(org,actor,null,100,'severe_incident','active',null,'real');
 perform pg_temp.assert_export_parity(org,actor,'reporting.obligations','{"type":"severe_incident","status":"active","scope":"real"}', '{}',r.result->'obligations');
 -- Real existing fixtures supplement synthetic workflow fixtures. Native calls
 -- authorize them before a row is used; no values leave the database session.
 for ctx in select m.organization_id,m.user_id,q.id request_id from public.supplier_evidence_requests q join public.organization_members m on m.organization_id=q.organization_id and m.role='owner'
 where exists(select 1 from public.get_supplier_evidence_request_review_atomic(m.organization_id,m.user_id,q.id) n where n.outcome='found') limit 5 loop
 select * into r from public.get_supplier_evidence_request_review_atomic(ctx.organization_id,ctx.user_id,ctx.request_id);
 if jsonb_array_length(r.result->'reviewItems')>0 then perform pg_temp.assert_export_parity(ctx.organization_id,ctx.user_id,'supplier_evidence.review_items','{}',jsonb_build_object('requestId',ctx.request_id),r.result->'reviewItems');end if;
 for j in select value from jsonb_array_elements(r.result->'reviewItems') loop
 if exists(select 1 from jsonb_array_elements(r.result->'submissions') x where x->>'checklistItemId'=j->>'id') then
 perform pg_temp.assert_export_parity(ctx.organization_id,ctx.user_id,'supplier_evidence.review_submissions','{}',jsonb_build_object('requestId',ctx.request_id,'checklistItemId',j->>'id'),(select jsonb_agg(value order by ordinality) from jsonb_array_elements(r.result->'submissions') with ordinality x where x.value->>'checklistItemId'=j->>'id'));
 end if;end loop;
 for j in select value from jsonb_array_elements(r.result->'submissions') loop
 if exists(select 1 from jsonb_array_elements(r.result->'reviews') x where x->>'submissionId'=j->>'id') then perform pg_temp.assert_export_parity(ctx.organization_id,ctx.user_id,'supplier_evidence.review_history','{}',jsonb_build_object('requestId',ctx.request_id,'submissionId',j->>'id'),(select jsonb_agg(value order by ordinality) from jsonb_array_elements(r.result->'reviews') with ordinality x where x.value->>'submissionId'=j->>'id'));end if;end loop;
 end loop;
end $$;
rollback;
