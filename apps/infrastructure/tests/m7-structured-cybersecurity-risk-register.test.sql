begin;

create or replace function pg_temp.check(p_name text,p_ok boolean)
returns void language plpgsql as $$ begin if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if; end $$;

select pg_temp.check('M7-02 owns a single register per technical file',
  (select exists(select 1 from pg_constraint where conrelid='public.technical_file_risk_registers'::regclass and contype='u' and pg_get_constraintdef(oid) like '%organization_id, technical_file_id%'))
);

select pg_temp.check('M7-02 risk revisions are append-only identities with tenant foreign keys',
  (select exists(select 1 from pg_constraint where conrelid='public.technical_file_risk_revisions'::regclass and pg_get_constraintdef(oid) like '%risk_id, revision%'))
  and (select exists(select 1 from pg_constraint where conrelid='public.technical_file_risk_revision_assets'::regclass and pg_get_constraintdef(oid) like '%sbom_components%'))
);

select pg_temp.check('M7-02 pins its non-compliance risk matrix',
  public.m7_risk_level(1::smallint,4::smallint)='low' and public.m7_risk_level(3::smallint,3::smallint)='medium' and public.m7_risk_level(4::smallint,4::smallint)='high' and public.m7_risk_level(5::smallint,5::smallint)='critical'
);

select pg_temp.check('M7-02 uses enabled non-forced RLS and service-only tables',
  (select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.technical_file_risks'::regclass)
  and not has_table_privilege('authenticated','public.technical_file_risks','select')
  and has_table_privilege('service_role','public.technical_file_risks','insert')
);

select pg_temp.check('M7-02 mutators pin a safe search path and are service-only',
  (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.create_technical_file_risk_atomic(uuid,uuid,uuid,jsonb,uuid)'::regprocedure)
  and has_function_privilege('service_role','public.create_technical_file_risk_atomic(uuid,uuid,uuid,jsonb,uuid)','execute')
  and not has_function_privilege('authenticated','public.create_technical_file_risk_atomic(uuid,uuid,uuid,jsonb,uuid)','execute')
);

select pg_temp.check('M7-02 exposes only the archive RPC that records a rationale',
  not exists(
    select 1
    from pg_proc
    where oid=to_regprocedure('public.archive_technical_file_risk_atomic(uuid,uuid,uuid,uuid,integer,uuid)')
  )
  and has_function_privilege('service_role','public.archive_technical_file_risk_atomic(uuid,uuid,uuid,uuid,integer,text,uuid)','execute')
);

rollback;
