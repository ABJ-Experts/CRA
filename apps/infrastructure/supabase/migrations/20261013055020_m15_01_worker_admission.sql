-- Licensing admission is before lease recovery, claim/attempt increments and
-- LIMIT selection. Denied work remains queued and cannot starve licensed tenants.
-- Already admitted bounded steps retain their original completion/reconciliation
-- authorities; audit, protective timers and manual export claimers are untouched.
do $migration$
declare
  rule record;
  definition text;
  replacement text;
  signature regprocedure;
begin
  for rule in select * from (values
    ('claim_sbom_ingest_job(uuid,text,integer)', 'sboms', 'return query select ''empty''::text,null::jsonb,null::jsonb; return;'),
    ('claim_sbom_quality_report(uuid,text,integer)', 'sboms', 'return query select ''empty''::text,null::jsonb; return;'),
    ('claim_sbom_diff_report(uuid,text,integer)', 'sboms', 'return query select ''empty''::text,null::jsonb; return;'),
    ('claim_product_import_job(uuid,text,integer)', 'products', 'return query select ''empty''::text,null::jsonb,null::jsonb; return;'),
    ('claim_product_import_job_by_id(uuid,uuid,text,integer)', 'products', 'return query select ''empty''::text,null::jsonb,null::jsonb; return;'),
    ('m1102_claim_sync_run(uuid,text,integer)', 'connectors', 'return query select ''not_found''::text,null::jsonb; return;'),
    ('m1103_claim_webhook_delivery(uuid,text,integer)', 'connectors', 'return query select ''empty''::text,null::jsonb; return;'),
    ('claim_evidence_text_extraction_job_atomic(uuid,uuid,integer)', 'evidence', 'return null;')
  ) as rules(routine, capability, empty_result)
  loop
    signature := to_regprocedure('public.' || rule.routine);
    if signature is null then raise exception 'licence worker source missing: %',rule.routine; end if;
    definition := pg_get_functiondef(signature);
    if definition !~* 'begin' or definition !~ 'p_organization_id' then
      raise exception 'licence worker source changed: %',rule.routine;
    end if;
    replacement := format(E'begin\n  if not public.m15_01_customer_write_allowed(p_organization_id,%L) then %s end if;',rule.capability,rule.empty_result);
    -- Only the first executable block; nested blocks are left intact.
    definition := regexp_replace(definition,'\mbegin\M',replacement,'i');
    execute definition;
  end loop;
end $migration$;

-- Global claimers must filter candidates before ordering/locking/limit. These
-- exact-source replacements fail deployment if predecessor semantics drift.
do $migration$
declare rule record; definition text; signature regprocedure;
begin
  for rule in select * from (values
    ('claim_vulnerability_remediation_ticket_operation_atomic(uuid,uuid,integer)',
      'and o.state = ''reserved''',
      'and o.state = ''reserved'' and (o.operation in (''reserve_outbound'',''finalize_outbound'') or public.m15_01_customer_write_allowed(p_organization_id,''findings''))'),
    ('claim_sbom_composite_generation(uuid,uuid,integer)',
      'and (r.generated_source_id is not null or r.attempt_count<5)',
      'and (r.generated_source_id is not null or (public.m15_01_customer_write_allowed(p_organization_id,''sboms'') and r.attempt_count<5))'),
    ('claim_supplier_document_extraction_atomic(uuid,integer)',
      'where status=''leased'' and lease_expires_at<clock_timestamp()',
      'where public.m15_01_customer_write_allowed(organization_id,''ai'') and status=''leased'' and lease_expires_at<clock_timestamp()'),
    ('claim_supplier_document_extraction_atomic(uuid,integer)',
      'where status=''queued'' order by created_at,id',
      'where public.m15_01_customer_write_allowed(organization_id,''ai'') and status=''queued'' order by created_at,id'),
    ('m10_claim_coverage_scope(uuid)',
      'where ((s.status in',
      'where public.m15_01_customer_write_allowed(s.organization_id,''frameworks'') and ((s.status in'),
    ('claim_technical_file_declaration(uuid,integer)',
      'where status=''prepared'' or (status=''generating'' and lease_expires_at<=clock_timestamp())',
      'where public.m15_01_customer_write_allowed(organization_id,''technical_files'') and (status=''prepared'' or (status=''generating'' and lease_expires_at<=clock_timestamp()))'),
    ('m14_04_schedule_due(text,integer)',
      'where state=''active'' and next_due_at<=clock_timestamp()',
      'where public.m15_01_customer_write_allowed(organization_id,''scheduled_reports'') and state=''active'' and next_due_at<=clock_timestamp()'),
    ('m14_04_claim_recipient(text)',
      'where parent_run.state in (''scheduled'',''running'')',
      'where public.m15_01_customer_write_allowed(x.organization_id,''scheduled_reports'') and parent_run.state in (''scheduled'',''running'')'),
    ('m14_04_claim_export(text)',
      'where subject_kind=''scheduled'' and state in',
      'where public.m15_01_customer_write_allowed(organization_id,''scheduled_reports'') and subject_kind=''scheduled'' and state in'),
    ('m14_04_claim_export(text)',
      'where x.subject_kind=''scheduled'' and x.attempts<3',
      'where public.m15_01_customer_write_allowed(x.organization_id,''scheduled_reports'') and x.subject_kind=''scheduled'' and x.attempts<3')
  ) as rules(routine,old_clause,new_clause)
  loop
    signature:=to_regprocedure('public.' || rule.routine);
    if signature is null then raise exception 'licence global worker source missing: %',rule.routine;end if;
    definition:=pg_get_functiondef(signature);
    if strpos(definition,rule.old_clause)=0 then raise exception 'licence global worker source changed: %',rule.routine;end if;
    execute replace(definition,rule.old_clause,rule.new_clause);
  end loop;
end $migration$;

notify pgrst,'reload schema';

-- A policy transition after claim releases the fenced lease, preserving queued
-- recipient/export work without retry consumption or a false failure event.
create function public.m15_01_pause_report_recipient(
  p_organization_id uuid,p_recipient_id uuid,p_worker_id text,p_expected_version integer
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare recipient public.report_run_recipients;
begin
  recipient:=public.m14_04_worker_recipient(p_organization_id,p_recipient_id,p_worker_id,p_expected_version);
  update public.report_run_recipients set generation_state='waiting',worker_id=null,
    lease_expires_at=null,version=version+1
  where organization_id=p_organization_id and id=recipient.id;
end $$;
revoke all on function public.m15_01_pause_report_recipient(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.m15_01_pause_report_recipient(uuid,uuid,text,integer) to service_role;
notify pgrst,'reload schema';
