-- Point source actions at existing finding selection and immutable snapshot anchors.
-- Preserve all authorization, visibility and pagination logic of the final facade.
do $$
declare v_definition text;v_changed text;
begin
 v_definition:=pg_get_functiondef('public.get_dashboard_trend_sources(uuid,uuid,jsonb,jsonb)'::regprocedure);
 v_changed:=replace(v_definition,
   '''/findings?productId=''||f.product_id href',
   '''/findings?productId=''||f.product_id||''&findingId=''||f.finding_id href');
 v_changed:=replace(v_changed,
   '''/products/''||s.product_id||''/technical-file''from',
   '''/products/''||s.product_id||''/technical-file#snapshot-''||s.id from');
 if v_changed not like '%&findingId=%'or v_changed not like '%/technical-file#snapshot-%'then
   raise exception 'M14-02 expected source link anchors are missing';
 end if;
 if v_changed<>v_definition then execute v_changed;end if;
end$$;
