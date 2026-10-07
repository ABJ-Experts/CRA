-- M13-02 retention consumes source-owned projections; no regulatory recomputation.
-- Apply after the chain migration. No purge or historical row rewrite is performed.

grant create on schema public to cra_audit_chain_writer;

create or replace function public.m13_02_store_audit_retention(
 p_organization_id uuid,p_protected_through timestamptz,p_required_days integer,
 p_legal_hold boolean,p_status text
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if p_required_days<0 or p_status not in ('unknown','protected','complete') then
  raise exception 'invalid audit retention projection' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(public.m13_02_audit_lock_key(p_organization_id));
 update public.audit_chain_heads h set
  protected_through=greatest(h.protected_through,p_protected_through),
  required_retention_days=greatest(h.required_retention_days,p_required_days),
  legal_hold=case when p_status='unknown' then h.legal_hold or p_legal_hold else p_legal_hold end,
  retention_status=case when p_status='unknown' then 'unknown'
   when p_legal_hold or greatest(h.protected_through,p_protected_through)>clock_timestamp() then 'protected'
   else 'complete' end,retention_checked_at=clock_timestamp()
 where h.organization_id=p_organization_id;
end;
$$;
alter function public.m13_02_store_audit_retention(uuid,timestamptz,integer,boolean,text) owner to cra_audit_chain_writer;
set role cra_audit_chain_writer;
revoke all on function public.m13_02_store_audit_retention(uuid,timestamptz,integer,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.m13_02_store_audit_retention(uuid,timestamptz,integer,boolean,text) to postgres;
reset role;
revoke create on schema public from cra_audit_chain_writer;

create or replace function public.m13_02_refresh_audit_retention_atomic(p_organization_id uuid)
 returns table(outcome text) language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_days integer; v_protected timestamptz; v_latest_event timestamptz;
 v_hold boolean; v_incomplete boolean; v_status text; v_nonfinite boolean:=false;
begin
 if not exists(select 1 from public.organizations where id=p_organization_id) then
  return query select 'not_found'::text; return;
 end if;
 -- These source scans finish BEFORE acquiring any audit-chain lock. Call this
 -- RPC in its own transaction, never from an audit/source trigger or append.
 select coalesce(max(effective_retention_days),0) into v_days
 from public.organization_retention_policies where organization_id=p_organization_id;
 select greatest(v_days,coalesce(max(required_retention_days),0)),max(protect_through)
 into v_days,v_protected from public.retention_authoritative_facts
 where organization_id=p_organization_id;
 select greatest(v_protected,max(protected_through)) into v_protected
 from public.evidence_protection_watermarks where organization_id=p_organization_id;
 select greatest(v_protected,max(retention_protection_until)) into v_protected
 from public.products where organization_id=p_organization_id;
 select greatest(v_protected,max(strongest_protection_until),max(strongest_retention_until)) into v_protected
 from public.evidence_document_version_retention_protections where organization_id=p_organization_id;
 select max(created_at) into v_latest_event from public.audit_logs where organization_id=p_organization_id;
 if v_latest_event is not null then
  v_protected:=greatest(v_protected,v_latest_event+make_interval(days=>v_days));
 end if;
 v_hold:=exists(select 1 from public.retention_authoritative_facts
  where organization_id=p_organization_id and active and reason_kind='legal_hold')
  or exists(select 1 from public.product_lifecycle_dependency_facts
   where organization_id=p_organization_id and active and authority_kind='legal_hold')
  or exists(select 1 from public.evidence_document_legal_holds
   where organization_id=p_organization_id and released_at is null)
  or exists(select 1 from public.evidence_document_version_retention_protections
   where organization_id=p_organization_id and product_legal_hold_active);
 v_incomplete:=(select count(*)<>4 or coalesce(bool_or(not available or last_reconciled_at is null
   or last_reconciled_at<clock_timestamp()-interval '24 hours'),true)
   from public.retention_authority_states where organization_id=p_organization_id)
  or not exists(select 1 from public.organization_retention_policies where organization_id=p_organization_id)
  or exists(select 1 from public.products where organization_id=p_organization_id
   and (retention_status<>'current' or retention_recalculated_at is null))
  or exists(select 1 from public.evidence_document_version_retention_protections
   where organization_id=p_organization_id and (source_incomplete or source_status<>'current'))
  or exists(select 1 from public.evidence_document_versions v where v.organization_id=p_organization_id
   and not exists(select 1 from public.evidence_document_version_retention_protections r
    where r.organization_id=p_organization_id and r.version_id=v.id));
 -- M1 uses -infinity for an empty watermark. It is not a wire timestamp.
 if v_protected='-infinity'::timestamptz then v_protected:=null; end if;
 if v_protected is not null and not isfinite(v_protected) then
  v_protected:=null; v_nonfinite:=true; v_hold:=true;
 end if;
 v_incomplete:=v_incomplete or v_nonfinite;
 v_status:=case when v_incomplete then 'unknown' when v_hold or v_protected>clock_timestamp()
  then 'protected' else 'complete' end;
 perform public.m13_02_store_audit_retention(p_organization_id,v_protected,v_days,v_hold,v_status);
 return query select coalesce((select h.retention_status from public.audit_chain_heads h where h.organization_id=p_organization_id),'unknown');
end;
$$;
alter function public.m13_02_refresh_audit_retention_atomic(uuid) owner to postgres;
revoke all on function public.m13_02_refresh_audit_retention_atomic(uuid) from public,anon,authenticated;
grant execute on function public.m13_02_refresh_audit_retention_atomic(uuid) to service_role;

-- Normalize the lifecycle projection for the strict Task 1 contract.
-- This applies the converged base definitions to previously migrated databases.

create or replace function public.m1_normalize_lifecycle_blockers(p_reasons jsonb)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  with raw as (
    select value
    from jsonb_array_elements(coalesce(p_reasons, '[]'::jsonb))
  ), normalized as (
    select jsonb_build_object(
      'kind', 'unavailable', 'code', 'dependency_unavailable'
    ) as blocker
    where exists (
      select 1
      from raw
      where value->>'code' = 'unavailable'
         or (
           value->>'kind' = 'unavailable'
           and value->>'code' = 'dependency_unavailable'
         )
    )

    union all

    select jsonb_build_object(
      'kind', 'worker_failure', 'code', 'worker_failure'
    ) as blocker
    where exists (select 1 from raw where value->>'kind' = 'worker_failure')

    union all

    select jsonb_build_object('kind','audit_archival','code','audit_archival_required')
    where exists(select 1 from raw where value->>'kind'='audit_archival'
      and value->>'code'='audit_archival_required')

    union all

    select jsonb_build_object(
      'kind', value->>'kind',
      'recordId', value->>'recordId',
      'requiredRetentionDays', (value->>'requiredRetentionDays')::integer
    ) as blocker
    from raw
    where value->>'kind' in ('product', 'evidence_class', 'obligation', 'legal_hold')
      and value->>'recordId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and value->>'requiredRetentionDays' ~ '^[0-9]+$'
  )
  select coalesce(jsonb_agg(distinct blocker order by blocker), '[]'::jsonb)
  from normalized;
$$;

create or replace function public.claim_organization_purge_atomic(
  p_organization_id uuid,
  p_lease_owner uuid,
  p_lease_seconds integer
)
  returns table (
    outcome text, purge_job_id uuid, lease_owner uuid,
    checkpoint_version integer, blocked_reasons jsonb
  )
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_job public.organization_purge_jobs%rowtype; v_lifecycle public.organization_lifecycles%rowtype; v_reasons jsonb;
begin
  if p_lease_seconds not between 1 and 3600 then
    return query select 'invalid_request'::text, null::uuid, null::uuid, null::integer, null::jsonb; return;
  end if;
  select * into v_lifecycle from public.organization_lifecycles
    where organization_id = p_organization_id for update;
  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::integer, null::jsonb; return;
  end if;
  select * into v_job from public.organization_purge_jobs
   where organization_id = p_organization_id
     and status in ('scheduled','retry','running')
     and purge_after <= now() and available_at <= now()
     and (status <> 'running' or lease_expires_at <= now())
   for update skip locked;
  if not found then
    return query select 'none_available'::text, null::uuid, null::uuid, null::integer, null::jsonb; return;
  end if;
  select coalesce(jsonb_agg(reason order by reason->>'kind', reason->>'recordId'), '[]'::jsonb)
    into v_reasons from (
      select jsonb_build_object('kind', s.authority_kind, 'code', 'unavailable') reason
      from public.retention_authority_states s
      where s.organization_id = p_organization_id and not s.available
      union all
      select jsonb_build_object('kind', f.reason_kind, 'recordId', f.source_record_id,
        'requiredRetentionDays', f.required_retention_days,
        'protectThrough', f.protect_through)
      from public.retention_authoritative_facts f
      where f.organization_id = p_organization_id and f.active
        and (f.reason_kind = 'legal_hold' or f.protect_through > now())
    ) controlling;
  -- Ledger evidence has no approved application-role archival/deletion path.
  -- This check also applies when all regulatory projections report complete.
  v_reasons := v_reasons || '[{"kind":"audit_archival","code":"audit_archival_required"}]'::jsonb;
  if jsonb_array_length(v_reasons) > 0 then
    update public.organization_purge_jobs set status = 'blocked',
      safe_error_code = 'retention_protected', blocked_reasons = v_reasons,
      updated_at = now() where id = v_job.id;
    update public.organization_lifecycles set status = 'purge_blocked',
      version = version + 1, changed_at = now(),
      purge_block_reasons = public.m1_normalize_lifecycle_blockers(v_reasons),
      safe_error_code = case when public.m1_normalize_lifecycle_blockers(v_reasons)
        @> jsonb_build_array(jsonb_build_object(
          'kind', 'unavailable', 'code', 'dependency_unavailable'
        )) then 'unavailable' else 'invalid_state' end,
      updated_at = now()
    where organization_id = p_organization_id;
    insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'organization.purge_blocked', 'organization_purge_job',
      v_job.id::text, jsonb_build_object('reasonCount', jsonb_array_length(v_reasons)));
    return query select 'blocked'::text, v_job.id, null::uuid,
      v_job.checkpoint_version, v_reasons; return;
  end if;
  return;
end;
$$;

create or replace function public.complete_organization_purge_atomic(
  p_organization_id uuid,
  p_purge_job_id uuid,
  p_lease_owner uuid,
  p_expected_checkpoint_version integer
)
  returns table (outcome text, deletion_proof_id uuid)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_job public.organization_purge_jobs%rowtype;
  v_lifecycle public.organization_lifecycles%rowtype;
  v_reasons jsonb;
begin
  select * into v_job from public.organization_purge_jobs
   where id = p_purge_job_id and organization_id = p_organization_id for update;
  if not found then return query select 'not_found'::text, null::uuid; return; end if;
  select * into v_lifecycle from public.organization_lifecycles
   where organization_id = p_organization_id for update;
  if v_job.status <> 'running' or v_job.lease_owner <> p_lease_owner
     or v_job.lease_expires_at <= now()
     or v_job.checkpoint_version <> p_expected_checkpoint_version
     or v_lifecycle.status <> 'purging' then
    return query select 'conflict'::text, null::uuid; return;
  end if;
  -- Final, same-transaction authority check. Any missing authority or newly
  -- observed hold aborts deletion and retains every controlling reason.
  select coalesce(jsonb_agg(reason order by reason->>'kind', reason->>'recordId'), '[]'::jsonb)
    into v_reasons from (
      select jsonb_build_object('kind', s.authority_kind, 'code', 'unavailable') reason
      from public.retention_authority_states s
      where s.organization_id = p_organization_id and not s.available
      union all
      select jsonb_build_object('kind', f.reason_kind, 'recordId', f.source_record_id,
        'requiredRetentionDays', f.required_retention_days,
        'protectThrough', f.protect_through)
      from public.retention_authoritative_facts f
      where f.organization_id = p_organization_id and f.active
        and (f.reason_kind = 'legal_hold' or f.protect_through > now())
    ) controlling;
  -- Ledger evidence has no approved application-role archival/deletion path.
  -- This check also applies when all regulatory projections report complete.
  v_reasons := v_reasons || '[{"kind":"audit_archival","code":"audit_archival_required"}]'::jsonb;
  if jsonb_array_length(v_reasons) > 0 then
    update public.organization_purge_jobs set status = 'blocked',
      safe_error_code = 'retention_protected', blocked_reasons = v_reasons,
      lease_owner = null, lease_expires_at = null, updated_at = now()
    where id = p_purge_job_id and organization_id = p_organization_id;
    update public.organization_lifecycles set status = 'purge_blocked',
      version = version + 1, changed_at = now(),
      purge_block_reasons = public.m1_normalize_lifecycle_blockers(v_reasons),
      safe_error_code = case when public.m1_normalize_lifecycle_blockers(v_reasons)
        @> jsonb_build_array(jsonb_build_object(
          'kind', 'unavailable', 'code', 'dependency_unavailable'
        )) then 'unavailable' else 'invalid_state' end,
      updated_at = now()
    where organization_id = p_organization_id and status = 'purging';
    insert into public.audit_logs (organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'organization.purge_blocked', 'organization_purge_job',
      p_purge_job_id::text, jsonb_build_object(
        'phase', 'final_completion_recheck',
        'reasonCount', jsonb_array_length(v_reasons)));
    return query select 'blocked'::text, null::uuid; return;
  end if;
  return;
end;
$$;

-- Existing durable export source: include the one head per tenant alongside
-- event rows; preserve canonical bytes rather than re-redacting their string.
insert into public.organization_export_source_tables(source_id,table_name,tenant_key_column,record_order_column,table_sort)
 values('audit_logs','audit_chain_heads','organization_id','organization_id',2);

do $$
declare v_definition text; v_anchor text:=E'\n  in share mode;';
begin
 select pg_get_functiondef('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure) into v_definition;
 if position(v_anchor in v_definition)=0 then raise exception 'M13-02 export snapshot lock anchor missing'; end if;
 execute replace(v_definition,v_anchor,', public.audit_chain_heads'||v_anchor);
 select pg_get_functiondef('public.m1_export_business_record_jsonb(text,jsonb)'::regprocedure) into v_definition;
 if position(E'begin\n' in v_definition)=0 then raise exception 'M13-02 export projection anchor missing'; end if;
 execute replace(v_definition,E'begin\n',E'begin\n  if p_table_name = ''audit_chain_heads'' then\n    return v_record || jsonb_build_object(''last_sequence'',p_record->>''last_sequence'',''legacy_count'',p_record->>''legacy_count'');\n  end if;\n  if p_table_name = ''audit_logs'' then\n    return v_record || jsonb_build_object(''chain_version'',p_record->''chain_version'',''chain_sequence'',p_record->>''chain_sequence'',''previous_hash'',p_record->''previous_hash'',''content_hash'',p_record->''content_hash'',''canonical_content'',p_record->''canonical_content'');\n  end if;\n');
end;
$$;
