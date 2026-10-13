-- The legacy supplier SBOM core inserts sources directly; both the supplier
-- portal and SBOM capability must be admitted in its own transaction.
do $migration$
declare r regprocedure:='public.reserve_supplier_sbom_submission_before_m906(text,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text)'::regprocedure;b text;d text;
begin
 select prosrc into b from pg_proc where oid=r;
 d:=pg_get_functiondef(r);
 b:=regexp_replace(b,'\mbegin\M',E'begin\n perform public.m15_01_assert_customer_write(m15_source_invitation.organization_id,''sboms'') from public.sbom_supplier_invitations m15_source_invitation where m15_source_invitation.session_token_hash=p_session_token_hash and m15_source_invitation.status=''used'' and m15_source_invitation.session_expires_at>clock_timestamp();','i');
 execute replace(d,(select prosrc from pg_proc where oid=r),b);
end $migration$;
notify pgrst,'reload schema';

-- Original source scope failures precede licensing for nonexistent tenants.
do $scope_repair$
declare r record;b text;d text;
begin
 for r in select p.oid,p.proname,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosrc like '%-- M15 capability or protected M6 continuation;%'
 loop
  b:=regexp_replace(r.prosrc,'perform public.m15_01_assert_customer_write\(p_organization_id,([^;]+);',
   'if exists(select 1 from public.organizations where id=p_organization_id) then perform public.m15_01_assert_customer_write(p_organization_id,\1; end if;','g');
  b:=regexp_replace(b,'perform public.m15_01_assert_reporting_continuation\(([^;]+);',
   'if exists(select 1 from public.organizations where id=p_organization_id) then perform public.m15_01_assert_reporting_continuation(\1; end if;','g');
  if r.proname='reserve_ci_build_sbom_atomic' then
   b:=replace(b,'if exists(select 1 from public.organizations where id=p_organization_id) then perform public.m15_01_assert_customer_write(p_organization_id,''connectors''); end if;',
   'if exists(select 1 from public.ci_provider_release_bindings m15_source_binding where m15_source_binding.organization_id=p_organization_id and m15_source_binding.id=p_binding_id and m15_source_binding.credential_id=p_credential_id and m15_source_binding.status=''active'') then perform public.m15_01_assert_customer_write(p_organization_id,''connectors''); end if;');
  end if;
  if b<>r.prosrc then d:=pg_get_functiondef(r.oid);execute replace(d,r.prosrc,b);end if;
 end loop;
end $scope_repair$;
notify pgrst,'reload schema';
