-- Portal source adapters expose approved export columns before capture. Keep
-- source identities, native version digests and fresh portal authorization intact.
do $portal_projection$ declare v_definition text;begin
 v_definition:=pg_get_functiondef('public.m14_03_source_rows(uuid,uuid,text,jsonb,jsonb)'::regprocedure);
 if position('v_product,v_row;' in v_definition)=0
 or position('v_grant.product_id,v_row;' in v_definition)=0 then
  raise exception 'portal_export_projection_baseline_changed';
 end if;
 v_definition:=replace(v_definition,'v_product,v_row;','v_product,public.m14_03_project_native_row(p_source,v_row);');
 v_definition:=replace(v_definition,'v_grant.product_id,v_row;','v_grant.product_id,public.m14_03_project_native_row(p_source,v_row);');
 execute v_definition;
end $portal_projection$;
