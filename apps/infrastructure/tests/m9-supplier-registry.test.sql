-- M9-01 schema and service-role boundary checks. Behavioural API tests create
-- tenant fixtures; this live-safe test intentionally does not mutate data.
\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not p_ok then raise exception 'FAIL %', p_label; end if;
  raise notice 'ok   %', p_label;
end;
$$;

select pg_temp.check('M9-01 creates tenant-private supplier registry tables',
  to_regclass('public.supplier_organizations') is not null
  and to_regclass('public.supplier_contacts') is not null
  and to_regclass('public.supplier_component_responsibilities') is not null
  and to_regclass('public.supplier_registry_commands') is not null
  and exists(select 1 from information_schema.columns where table_schema='public' and table_name='sbom_supplier_requests' and column_name='supplier_id')
);

select pg_temp.check('M9-01 registry tables use RLS and do not expose browser privileges',
  not exists (
    select 1
    from (values ('supplier_organizations'),('supplier_contacts'),('supplier_component_responsibilities'),('supplier_registry_commands')) expected(name)
    join pg_class relation on relation.relname=expected.name
    join pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='public'
      and (not relation.relrowsecurity
        or has_table_privilege('anon',relation.oid,'select')
        or has_table_privilege('authenticated',relation.oid,'select')
        or has_table_privilege('authenticated',relation.oid,'insert')
        or has_table_privilege('authenticated',relation.oid,'update')
        or has_table_privilege('authenticated',relation.oid,'delete'))
  )
);

select pg_temp.check('M9-01 archive-only records do not grant service-role DELETE',
  not has_table_privilege('service_role','public.supplier_organizations','delete')
  and not has_table_privilege('service_role','public.supplier_contacts','delete')
  and not has_table_privilege('service_role','public.supplier_component_responsibilities','delete')
);

select pg_temp.check('M9-01 responsibility identity is exact and restrictive',
  exists(select 1 from pg_constraint where conrelid='public.supplier_component_responsibilities'::regclass and contype='f' and confdeltype='r')
  and exists(select 1 from pg_indexes where schemaname='public' and indexname='supplier_responsibilities_active_once_idx')
  and pg_get_constraintdef((select oid from pg_constraint where conrelid='public.supplier_component_responsibilities'::regclass and conname like '%identity_kind%' limit 1)) like '%purl%'
);

select pg_temp.check('M9-01 supplier-request link is composite tenant-scoped and restrictive',
  exists(select 1 from pg_constraint where conrelid='public.sbom_supplier_requests'::regclass and conname='sbom_supplier_requests_supplier_organization_fk' and confdeltype='r')
  and exists(select 1 from pg_indexes where schemaname='public' and indexname='sbom_supplier_requests_supplier_idx')
);

select pg_temp.check('M9-01 authoritative RPCs are security-definer and service-role-only',
  has_function_privilege('service_role','public.list_supplier_organizations_atomic(uuid,uuid,text,boolean,integer,text)','execute')
  and has_function_privilege('service_role','public.create_supplier_component_responsibility_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid)','execute')
  and has_function_privilege('service_role','public.get_finding_responsible_suppliers_atomic(uuid,uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.list_supplier_organizations_atomic(uuid,uuid,text,boolean,integer,text)','execute')
  and not has_function_privilege('authenticated','public.create_supplier_component_responsibility_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid)','execute')
  and not exists (
    select 1 from (values
      ('public.create_supplier_organization_atomic(uuid,uuid,text,text,text,text,uuid[],uuid)'::regprocedure),
      ('public.update_supplier_organization_atomic(uuid,uuid,uuid,jsonb,integer,uuid)'::regprocedure),
      ('public.archive_supplier_organization_atomic(uuid,uuid,uuid,integer,text,uuid)'::regprocedure),
      ('public.create_supplier_contact_atomic(uuid,uuid,uuid,text,text,text,text,uuid)'::regprocedure),
      ('public.update_supplier_contact_atomic(uuid,uuid,uuid,uuid,jsonb,integer,uuid)'::regprocedure),
      ('public.archive_supplier_contact_atomic(uuid,uuid,uuid,uuid,integer,text,uuid)'::regprocedure),
      ('public.create_supplier_component_responsibility_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid)'::regprocedure),
      ('public.end_supplier_component_responsibility_atomic(uuid,uuid,uuid,uuid,integer,text,uuid,uuid)'::regprocedure),
      ('public.associate_supplier_sbom_request_atomic(uuid,uuid,uuid,uuid,uuid)'::regprocedure)
    ) expected(signature)
    where pg_get_functiondef(expected.signature) not like '%audit_logs%'
  )
  and pg_get_functiondef('public.create_supplier_component_responsibility_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid)'::regprocedure) like '%SET search_path TO%'
);

select pg_temp.check('M9-01 response projections retain no contact audit metadata and use occurrenceId',
  pg_get_functiondef('public.m9_supplier_contact_json(uuid,uuid)'::regprocedure) not like '%organizationId%'
  and pg_get_functiondef('public.m9_supplier_responsibility_json(uuid,uuid)'::regprocedure) like '%occurrenceId%'
  and pg_get_functiondef('public.m9_supplier_responsibility_json(uuid,uuid)'::regprocedure) not like '%componentOccurrenceId%'
  and pg_get_functiondef('public.m9_supplier_detail_json(uuid,uuid)'::regprocedure) like '%supplierDisplayName%'
);

select pg_temp.check('M9-01 serializes same-name review and protects product visibility',
  pg_get_functiondef('public.create_supplier_organization_atomic(uuid,uuid,text,text,text,text,uuid[],uuid)'::regprocedure) like '%pg_advisory_xact_lock%'
  and pg_get_functiondef('public.list_supplier_organizations_atomic(uuid,uuid,text,boolean,integer,text)'::regprocedure) like '%can_view_products%'
  and pg_get_functiondef('public.get_finding_responsible_suppliers_atomic(uuid,uuid,uuid)'::regprocedure) like '%can_view_products%'
);

select pg_temp.check('M9-01 supersession advances only the same canonical component',
  pg_get_functiondef('public.end_supplier_component_responsibility_atomic(uuid,uuid,uuid,uuid,integer,text,uuid,uuid)'::regprocedure) like '%v_successor.product_id<>v_responsibility.product_id%'
  and pg_get_functiondef('public.end_supplier_component_responsibility_atomic(uuid,uuid,uuid,uuid,integer,text,uuid,uuid)'::regprocedure) like '%v_successor.component_identity<>v_responsibility.component_identity%'
  and pg_get_functiondef('public.end_supplier_component_responsibility_atomic(uuid,uuid,uuid,uuid,integer,text,uuid,uuid)'::regprocedure) like '%v_successor.identity_kind<>v_responsibility.identity_kind%'
);
