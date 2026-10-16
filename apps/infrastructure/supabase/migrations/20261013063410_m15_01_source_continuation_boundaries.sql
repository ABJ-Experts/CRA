-- Additive repair: applied source migrations are immutable. Exact signatures,
-- actor authorization, responses and grants remain source-owned.
create function public.m15_01_assert_reporting_continuation(p_organization_id uuid,p_obligation_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.organization_license_states%rowtype;o public.reporting_obligations%rowtype;cutoff timestamptz;
begin
 perform public.m15_01_lock(p_organization_id);
 select * into s from public.organization_license_states where organization_id=p_organization_id for update;
 select * into o from public.reporting_obligations where organization_id=p_organization_id and id=p_obligation_id for share;
 -- Missing provisioning cannot create new obligations, but retains existing real
 -- statutory duties. Rehearsals never acquire the continuation exception.
 cutoff:=coalesce(s.protected_regulatory_cutoff,(s.verified_claims->>'expiresAt')::timestamptz+interval '30 days',clock_timestamp());
 if o.id is not null and o.status='active' and not o.is_rehearsal and o.created_at<=cutoff then return;end if;
 perform public.m15_01_assert_customer_write(p_organization_id,'reporting');
end $$;
revoke all on function public.m15_01_assert_reporting_continuation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.m15_01_assert_reporting_continuation(uuid,uuid) to service_role;

do $migration$
declare rule record;routine record;body text;guarded text;definition text;matches integer;
begin
 for rule in select * from (values
  ('create_sbom_ci_credential_atomic','perform public.m15_01_assert_customer_write(p_organization_id,''sboms'');'),
  ('reserve_ci_build_sbom_atomic','perform public.m15_01_assert_customer_write(p_organization_id,''connectors'');'),
  ('update_sbom_quality_settings_atomic','perform public.m15_01_assert_customer_write(p_organization_id,''sboms'');'),
  ('update_organization_sbom_quality_settings_atomic','perform public.m15_01_assert_customer_write(p_organization_id,''sboms'');'),
  ('resolve_sbom_composite_conflict_atomic','perform public.m15_01_assert_customer_write(p_organization_id,''sboms'');'),
  ('resolve_sbom_composite_relationship_atomic','perform public.m15_01_assert_customer_write(p_organization_id,''sboms'');'),
  ('record_reporting_stage_rehearsal_filing_atomic','perform public.m15_01_assert_customer_write(p_organization_id,''reporting'');'),
  ('reserve_supplier_evidence_submission_before_m906','perform public.m15_01_assert_customer_write(i.organization_id,''suppliers'') from public.supplier_evidence_invitations i where i.session_token_hash=p_session_token_hash and i.state=''used'' and i.session_expires_at>clock_timestamp();'),
  ('reserve_supplier_sbom_submission_before_m906','perform public.m15_01_assert_customer_write(i.organization_id,''suppliers'') from public.sbom_supplier_invitations i where i.session_token_hash=p_session_token_hash and i.status=''used'' and i.session_expires_at>clock_timestamp();'),
  ('cancel_reporting_obligation_atomic','perform public.m15_01_assert_reporting_continuation(p_organization_id,p_obligation_id);'),
  ('correct_reporting_obligation_anchor_atomic','perform public.m15_01_assert_reporting_continuation(p_organization_id,p_obligation_id);'),
  ('create_reporting_stage_draft_atomic','perform public.m15_01_assert_reporting_continuation(p_organization_id,p_obligation_id);'),
  ('reserve_reporting_stage_package_atomic','perform public.m15_01_assert_reporting_continuation(p_organization_id,p_obligation_id);'),
  ('record_reporting_stage_filing_atomic','perform public.m15_01_assert_reporting_continuation(p_organization_id,p_obligation_id);'),
  ('acquire_reporting_stage_draft_lock_atomic','perform public.m15_01_assert_reporting_continuation(p_organization_id,(select d.obligation_id from public.reporting_stage_drafts d where d.organization_id=p_organization_id and d.id=p_draft_id));'),
  ('save_reporting_stage_draft_atomic','perform public.m15_01_assert_reporting_continuation(p_organization_id,(select d.obligation_id from public.reporting_stage_drafts d where d.organization_id=p_organization_id and d.id=p_draft_id));'),
  ('apply_reporting_family_template_atomic','perform public.m15_01_assert_reporting_continuation(p_organization_id,(select d.obligation_id from public.reporting_stage_drafts d where d.organization_id=p_organization_id and d.id=p_draft_id));'),
  ('approve_reporting_stage_draft_atomic','perform public.m15_01_assert_reporting_continuation(p_organization_id,(select d.obligation_id from public.reporting_stage_drafts d where d.organization_id=p_organization_id and d.id=p_draft_id));'),
  ('create_reporting_stage_approval_proof_atomic','perform public.m15_01_assert_reporting_continuation(p_organization_id,(select d.obligation_id from public.reporting_stage_drafts d where d.organization_id=p_organization_id and d.id=p_draft_id));'),
  ('create_reporting_stage_filing_proof_atomic','perform public.m15_01_assert_reporting_continuation(p_organization_id,(select p.obligation_id from public.reporting_stage_packages p where p.organization_id=p_organization_id and p.id=p_package_id));'),
  ('append_reporting_stage_acknowledgement_atomic','perform public.m15_01_assert_reporting_continuation(p_organization_id,(select s.obligation_id from public.reporting_stage_submissions s where s.organization_id=p_organization_id and s.id=p_submission_id));'),
  ('m13_05_siem_command','if p_operation in (''create'',''update'',''credentials'',''test_prepare'',''enable'',''replay'') then perform public.m15_01_assert_customer_write(p_organization_id,''connectors''); end if;')
 ) as rules(name,gate) loop
  matches:=0;
  for routine in select p.oid,p.prosrc,l.lanname from pg_proc p
   join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
   where n.nspname='public' and p.proname=rule.name loop
   if routine.lanname<>'plpgsql' then raise exception 'M15 boundary language changed: %',rule.name;end if;
   body:=routine.prosrc;
   -- Replace the overly broad already-applied guards for these M6 duties.
   if rule.name in ('cancel_reporting_obligation_atomic','correct_reporting_obligation_anchor_atomic') then
    body:=replace(body,'if true then perform public.m15_01_assert_customer_write(p_organization_id,''reporting''); end if;','');
   end if;
   guarded:=regexp_replace(body,'\mbegin\M',E'begin\n  -- M15 capability or protected M6 continuation; normal source authorization follows.\n  '||rule.gate,'i');
   definition:=pg_get_functiondef(routine.oid);
   if guarded=body or strpos(definition,routine.prosrc)=0 then raise exception 'M15 boundary body changed: %',rule.name;end if;
   execute replace(definition,routine.prosrc,guarded);
   matches:=matches+1;
  end loop;
  if matches=0 then raise exception 'M15 boundary missing: %',rule.name;end if;
 end loop;
end $migration$;
-- Resolve public source tenant exclusively from the live source credential.
create function public.m15_01_supplier_source_organization(p_kind text,p_session_token_hash text)
returns uuid language sql stable security definer set search_path=pg_catalog,public as $$
 select organization_id from public.supplier_evidence_invitations where p_kind='supplier_evidence' and session_token_hash=p_session_token_hash and state='used' and session_expires_at>clock_timestamp()
 union all
 select organization_id from public.sbom_supplier_invitations where p_kind='supplier_sbom' and session_token_hash=p_session_token_hash and status='used' and session_expires_at>clock_timestamp()
 limit 1
$$;
revoke all on function public.m15_01_supplier_source_organization(text,text) from public,anon,authenticated;
grant execute on function public.m15_01_supplier_source_organization(text,text) to service_role;

-- Unknown tenant denial is owned by each original source function. This does not
-- exempt any existing tenant, and preserves legacy forbidden/not_found outcomes.
do $repair$
declare r record;b text;d text;
begin
 for r in select p.oid,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosrc like '%-- M15 source transaction admission;%'
 loop
  b:=regexp_replace(r.prosrc,'if ([^;]+) then perform public.m15_01_assert_customer_write\((p_organization_id|p_org_id),',
   'if exists(select 1 from public.organizations where id=\2) and (\1) then perform public.m15_01_assert_customer_write(\2,','g');
  if b<>r.prosrc then d:=pg_get_functiondef(r.oid);execute replace(d,r.prosrc,b);end if;
 end loop;
end $repair$;
-- Preserve direct import foreign/missing-scope outcome before policy filtering.
do $import_repair$
declare r regprocedure:='public.claim_product_import_job_by_id(uuid,uuid,text,integer)'::regprocedure;b text;d text;gate text:='if not public.m15_01_customer_write_allowed(p_organization_id,''products'') then return query select ''empty''::text,null::jsonb,null::jsonb; return; end if;';
begin
 select prosrc into b from pg_proc where oid=r;
 if strpos(b,gate)=0 then raise exception 'M15 import claim gate drift';end if;
 b:=replace(b,gate,'');
 b:=replace(b,'if not found then return query select ''not_found''::text,null::jsonb,null::jsonb; return; end if;',
   'if not found then return query select ''not_found''::text,null::jsonb,null::jsonb; return; end if; '||gate);
 d:=pg_get_functiondef(r);execute replace(d,(select prosrc from pg_proc where oid=r),b);
end $import_repair$;
notify pgrst,'reload schema';
