-- M3-07 schema safety checks. Lifecycle behaviour is covered by API and
-- worker tests; this file protects the database privacy and RPC contracts.
\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not p_ok then raise exception 'FAIL %', p_label; end if;
  raise notice 'ok   %', p_label;
end;
$$;

select pg_temp.check('M3-07 persists supplier and composite provenance facts',
  to_regclass('public.sbom_supplier_requests') is not null
  and to_regclass('public.sbom_supplier_invitations') is not null
  and to_regclass('public.sbom_supplier_submissions') is not null
  and to_regclass('public.sbom_composite_reviews') is not null
  and to_regclass('public.sbom_composite_review_inputs') is not null
  and to_regclass('public.sbom_composite_conflicts') is not null
  and to_regclass('public.sbom_composite_unresolved_relationships') is not null
  and to_regclass('public.sbom_composite_component_provenance') is not null
  and to_regclass('public.sbom_composite_dependency_provenance') is not null
);

select pg_temp.check('M3-07 tables are RLS protected and browser-private',
  not exists (
    select 1 from (values
      ('sbom_supplier_requests'),('sbom_supplier_invitations'),('sbom_supplier_submissions'),
      ('sbom_composite_reviews'),('sbom_composite_review_inputs'),('sbom_composite_conflicts'),
      ('sbom_composite_unresolved_relationships'),('sbom_composite_component_provenance'),
      ('sbom_composite_dependency_provenance')
    ) expected(name)
    join pg_class c on c.relname=expected.name join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and (not c.relrowsecurity
      or has_table_privilege('anon',c.oid,'select')
      or has_table_privilege('authenticated',c.oid,'select'))
  )
);

select pg_temp.check('M3-07 security-definer coordination is service-role only',
  has_function_privilege('service_role','public.reserve_supplier_sbom_submission_atomic(text,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text)','execute')
  and not has_function_privilege('authenticated','public.reserve_supplier_sbom_submission_atomic(text,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text)','execute')
  and has_function_privilege('service_role','public.create_sbom_composite_review_atomic(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid)','execute')
  and not has_function_privilege('authenticated','public.create_sbom_composite_review_atomic(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,uuid)','execute')
);

select pg_temp.check('M3-07 composite worker and scope RPCs retain their exact private signatures',
  has_function_privilege('service_role', 'public.validate_sbom_composite_scope(uuid,uuid,uuid,uuid,jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.claim_sbom_composite_generation(uuid,uuid,integer)', 'execute')
  and has_function_privilege('service_role', 'public.reconcile_sbom_composite_generation_atomic(uuid,uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.refresh_sbom_composite_review_projection_atomic(uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_sbom_composite_generation(uuid,uuid,integer)', 'execute')
);

select pg_temp.check('M3-07 composite repairs are service-role-only and retain dependency provenance',
  has_function_privilege('service_role', 'public.sbom_composite_identity_key(text,text,jsonb,uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.generate_sbom_composite_atomic(uuid,uuid,uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.sbom_composite_identity_key(text,text,jsonb,uuid,text)', 'execute')
  and exists (select 1 from pg_constraint where conrelid='public.sbom_composite_dependency_provenance'::regclass and contype='u')
);

select pg_temp.check('M3-07 provenance uses the dependency contract field names',
  pg_get_functiondef('public.sbom_composite_review_json(uuid,uuid)'::regprocedure) like '%compositeFromRef%'
  and pg_get_functiondef('public.sbom_composite_review_json(uuid,uuid)'::regprocedure) like '%sourceFromComponentRef%'
  and pg_get_functiondef('public.claim_sbom_composite_generation(uuid,uuid,integer)'::regprocedure) like '%field_conflict%'
);
