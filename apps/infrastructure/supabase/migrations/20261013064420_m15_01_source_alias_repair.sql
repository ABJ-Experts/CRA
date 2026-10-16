-- Applied M6 boundary migration remains immutable. Unique aliases cannot collide
-- with source-owned PL/pgSQL record variables d, p or s.
do $repair$
declare r record;b text;d text;
begin
 for r in select p.oid,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prosrc like '%-- M15 capability or protected M6 continuation;%'
 loop
  b:=replace(r.prosrc,'select d.obligation_id from public.reporting_stage_drafts d where d.organization_id=p_organization_id and d.id=p_draft_id',
   'select m15_source_draft.obligation_id from public.reporting_stage_drafts m15_source_draft where m15_source_draft.organization_id=p_organization_id and m15_source_draft.id=p_draft_id');
  b:=replace(b,'select p.obligation_id from public.reporting_stage_packages p where p.organization_id=p_organization_id and p.id=p_package_id',
   'select m15_source_package.obligation_id from public.reporting_stage_packages m15_source_package where m15_source_package.organization_id=p_organization_id and m15_source_package.id=p_package_id');
  b:=replace(b,'select s.obligation_id from public.reporting_stage_submissions s where s.organization_id=p_organization_id and s.id=p_submission_id',
   'select m15_source_submission.obligation_id from public.reporting_stage_submissions m15_source_submission where m15_source_submission.organization_id=p_organization_id and m15_source_submission.id=p_submission_id');
  b:=replace(b,'perform public.m15_01_assert_customer_write(i.organization_id,''suppliers'') from public.supplier_evidence_invitations i where i.session_token_hash=p_session_token_hash and i.state=''used'' and i.session_expires_at>clock_timestamp();',
   'perform public.m15_01_assert_customer_write(m15_source_invitation.organization_id,''suppliers'') from public.supplier_evidence_invitations m15_source_invitation where m15_source_invitation.session_token_hash=p_session_token_hash and m15_source_invitation.state=''used'' and m15_source_invitation.session_expires_at>clock_timestamp();');
  if b<>r.prosrc then d:=pg_get_functiondef(r.oid);execute replace(d,r.prosrc,b);end if;
 end loop;
end $repair$;
notify pgrst,'reload schema';
