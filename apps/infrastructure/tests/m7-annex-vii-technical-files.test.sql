begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'check failed: %', p_name; end if;
end;
$$;

select pg_temp.check(
  'M7-01 ships the complete stable Annex VII V1 template',
  (select count(*) = 8 from public.technical_file_templates where template_key = 'annex_vii' and template_version = '2024-01')
  and (select array_agg(section_key order by sort_order) = array['general_description','user_instructions','design_development_production','support_period_basis','vulnerability_handling','test_reports','release_sbom','standards_common_specifications'] from public.technical_file_templates where template_key = 'annex_vii' and template_version = '2024-01')
);

select pg_temp.check(
  'M7-01 file and source invariants are database-enforced',
  (select exists(select 1 from pg_indexes where schemaname='public' and indexname='technical_files_one_active_product_idx' and indexdef like '%WHERE (status = ''active''::text)%'))
  and (select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.technical_files'::regclass)
  and (select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.technical_file_sections'::regclass)
  and (select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.technical_file_section_sources'::regclass)
  and not has_table_privilege('authenticated','public.technical_files','select')
);

select pg_temp.check(
  'M7-01 mutators are service-only and pin a safe search path',
  has_function_privilege('service_role','public.create_technical_file_atomic(uuid,uuid,uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.create_technical_file_atomic(uuid,uuid,uuid,uuid)','execute')
  and (select pg_get_userbyid(proowner) = 'postgres' from pg_proc where oid='public.create_technical_file_atomic(uuid,uuid,uuid,uuid)'::regprocedure)
  and (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.update_technical_file_section_atomic(uuid,uuid,uuid,text,integer,text,text,text,uuid)'::regprocedure)
  and (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.add_technical_file_section_source_atomic(uuid,uuid,uuid,text,integer,text,uuid,text,text,text,text,text,uuid)'::regprocedure)
);

rollback;
