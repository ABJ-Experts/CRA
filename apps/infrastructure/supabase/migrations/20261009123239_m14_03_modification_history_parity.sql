-- The rendered history is a modification chain from the native list predicate,
-- not a nonexistent nested property of the single-assessment getter. Reuse the
-- exact source-owned native authorization, projection and page constraints.
do $history$ declare v_def text;begin
 v_def:=pg_get_functiondef('public.list_product_substantial_modification_assessments(uuid,uuid,uuid,uuid,text,integer,integer)'::regprocedure);
 if position('(p_status is null or assessment.status = p_status)' in v_def)=0 or position('page_row.created_at desc, page_row.id desc' in v_def)=0 then raise exception 'modification_list_baseline_changed';end if;
 v_def:=replace(v_def,'FUNCTION public.list_product_substantial_modification_assessments(','FUNCTION public.m14_03_modification_history_page(');
 v_def:=replace(v_def,'p_status text','p_modification_id uuid');
 v_def:=regexp_replace(v_def,'if p_status is not null and p_status not in \([^;]+\) then','if p_modification_id is null then');
 v_def:=replace(v_def,'(p_status is null or assessment.status = p_status)','assessment.modification_id = p_modification_id');
 v_def:=replace(v_def,'created_at desc','created_at asc');
 execute v_def;
end $history$;
alter function public.m14_03_modification_history_page(uuid,uuid,uuid,uuid,uuid,integer,integer) stable;
revoke all on function public.m14_03_modification_history_page(uuid,uuid,uuid,uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.m14_03_modification_history_page(uuid,uuid,uuid,uuid,uuid,integer,integer) to service_role;
do $adapter$ declare v_def text;v_old text;begin
 v_def:=pg_get_functiondef('public.m14_03_nested_domain_source_rows(uuid,uuid,text,jsonb,jsonb)'::regprocedure);
 v_old:=$old$when 'products.compliance.mod_assessment_history' then select * into v_result from public.get_product_substantial_modification_assessment(p_organization_id,v_product,(p_context->>'assessmentId')::uuid,p_actor_user_id); v_data:=v_result.assessment; v_path:=array['history'];$old$;
 if position(v_old in v_def)=0 then raise exception 'modification_history_adapter_baseline_changed';end if;
 v_def:=replace(v_def,v_old,$new$when 'products.compliance.mod_assessment_history' then select * into v_result from public.m14_03_modification_history_page(p_organization_id,v_product,p_actor_user_id,null,coalesce(p_context->>'modificationId',p_context->>'assessmentId')::uuid,v_page,v_page_size); v_data:=v_result.assessments; v_path:=array['rows'];$new$);
 v_def:=replace(v_def,$old$'products.compliance.mod_assessments','products.compliance.security_artifacts') then$old$,$new$'products.compliance.mod_assessments','products.compliance.security_artifacts','products.compliance.mod_assessment_history') then$new$);
 execute v_def;
end $adapter$;
