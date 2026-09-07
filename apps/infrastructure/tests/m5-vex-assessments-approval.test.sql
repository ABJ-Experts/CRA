-- CRA-M5-02 VEX metadata boundary.  This deliberately inspects only schema
-- metadata, so it is safe to run against the shared local fixture set.
create or replace function pg_temp.check(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice 'ok   %', p_label;
  else raise exception 'FAIL %', p_label;
  end if;
end;
$$;

select pg_temp.check(
  'M5 VEX state, evidence, policy, history, and command records are private',
  not exists (
    select 1 from (values
      ('vulnerability_finding_assessments'),
      ('vulnerability_finding_assessment_evidence_links'),
      ('vulnerability_finding_assessment_history_events'),
      ('vulnerability_assessment_approval_policies'),
      ('vulnerability_finding_assessment_commands')
    ) expected(table_name)
    join pg_class tables on tables.relname = expected.table_name
    join pg_namespace namespaces on namespaces.oid = tables.relnamespace
    where namespaces.nspname = 'public' and (
      not tables.relrowsecurity or tables.relforcerowsecurity
      or has_table_privilege('anon', tables.oid, 'select,insert,update,delete')
      or has_table_privilege('authenticated', tables.oid, 'select,insert,update,delete')
      or not has_table_privilege('service_role', tables.oid, 'select,insert,update,delete')
    )
  )
);

select pg_temp.check(
  'M5 VEX revisions retain tenant current/history and idempotency invariants',
  exists (select 1 from pg_index where indexrelid =
    'public.vulnerability_finding_assessments_one_current_idx'::regclass)
  and exists (select 1 from pg_index where indexrelid =
    'public.vulnerability_finding_assessments_history_idx'::regclass)
  and exists (select 1 from pg_constraint where conrelid =
    'public.vulnerability_finding_assessment_commands'::regclass and contype = 'u'
    and pg_get_constraintdef(oid) like '%organization_id, actor_user_id, idempotency_key%')
  and exists (select 1 from pg_trigger where tgrelid =
    'public.vulnerability_finding_assessments'::regclass
    and tgname = 'm5_vex_guard_assessment_update' and not tgisinternal)
);

select pg_temp.check(
  'M5 VEX RPCs are service-only security definers with pinned search paths',
  not exists (
    select 1 from pg_proc procedures
    join pg_namespace namespaces on namespaces.oid = procedures.pronamespace
    where namespaces.nspname = 'public' and procedures.proname = any (array[
      'get_finding_vex_assessment', 'list_vulnerability_assessment_approval_policy',
      'submit_vulnerability_finding_vex_assessment_atomic',
      'approve_vulnerability_finding_vex_assessment_atomic',
      'reject_vulnerability_finding_vex_assessment_atomic',
      'set_vulnerability_assessment_approval_policy_atomic'
    ]) and (
      not procedures.prosecdef or procedures.proconfig is null
      or not ('search_path=public, pg_temp' = any(procedures.proconfig))
      or exists (
        select 1 from information_schema.routine_privileges privileges
        where privileges.routine_schema = 'public' and privileges.routine_name = procedures.proname
          and privileges.grantee in ('public', 'anon', 'authenticated')
      )
    )
  )
  and has_function_privilege('service_role',
    'public.submit_vulnerability_finding_vex_assessment_atomic(uuid,uuid,uuid,text,text,text,jsonb,text,integer,uuid,text)', 'execute')
  and has_function_privilege('service_role',
    'public.approve_vulnerability_finding_vex_assessment_atomic(uuid,uuid,uuid,uuid,integer,text,uuid,text)', 'execute')
);

select pg_temp.check(
  'M5 queue uses the parsed reEvaluation key and VEX approval filters',
  pg_get_functiondef('public.list_finding_triage_queue(uuid,uuid,jsonb,integer,text,text,text)'::regprocedure)
    ~ '''reEvaluationStates'''
  and pg_get_functiondef('public.list_finding_triage_queue(uuid,uuid,jsonb,integer,text,text,text)'::regprocedure)
    ~ '''vexStatuses'''
  and pg_get_functiondef('public.list_finding_triage_queue(uuid,uuid,jsonb,integer,text,text,text)'::regprocedure)
    ~ '''approvalStates'''
);

begin;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_admin uuid;
  v_product uuid;
  v_release uuid;
  v_vulnerability uuid;
  v_source_record uuid;
  v_source_version uuid;
  v_range uuid;
  v_finding uuid := 'eb78e721-6c8c-43c5-9f7a-0aabf2220502';
  v_assessment uuid;
  v_revised uuid;
  v_row record;
begin
  select id into v_owner from public.users where email = 'owner@cra.test';
  select id into v_admin from public.users where email = 'admin@cra.test';
  select id into v_product from public.products where organization_id = v_org order by id limit 1;
  select id into v_release from public.product_releases where organization_id = v_org and product_id = v_product order by id limit 1;
  select id into v_vulnerability from public.vulnerabilities order by id limit 1;
  select id into v_source_record from public.vulnerability_source_records order by id limit 1;
  select id into v_source_version from public.vulnerability_source_record_versions order by id limit 1;

  insert into public.vulnerability_assessment_approval_policies(
    organization_id, severity, approval_required, created_by, updated_by
  ) values (v_org, 'unknown', true, v_owner, v_owner)
  on conflict (organization_id, severity) do update set
    approval_required = true,
    version = public.vulnerability_assessment_approval_policies.version + 1,
    updated_by = excluded.updated_by;

  insert into public.vulnerability_affected_ranges(
    vulnerability_id, source_record_version_id, ecosystem, package_name,
    range_type, range_value, event_sequence
  ) values (
    v_vulnerability, v_source_version, 'npm', 'm5-vex-fixture',
    'SEMVER', '{"events":[{"introduced":"0"}]}'::jsonb, '[]'::jsonb
  ) returning id into v_range;

  insert into public.vulnerability_findings(
    id, organization_id, release_id, component_identity, canonical_advisory_id,
    vulnerability_id, source_feed_key, source_record_id, source_record_version_id,
    affected_range_id, match_method, comparator_name, comparator_version,
    evaluated_component_value, affected_range, event_sequence, confidence,
    confidence_table_version, confidence_explanation, reevaluation_state
  ) values (
    v_finding, v_org, v_release, 'pkg:npm/m5-vex-fixture@1.0.0',
    'CVE-M5-VEX-0001', v_vulnerability, 'cisa_kev', v_source_record,
    v_source_version, v_range, 'purl_osv', 'm5-test', '1',
    '1.0.0', '{"versions":["1.0.0"]}'::jsonb, '[]'::jsonb,
    0.91, 'm5-test', 'Rollback-only VEX fixture.', 'unchanged'
  );

  select * into v_row from public.submit_vulnerability_finding_vex_assessment_atomic(
    v_org, v_owner, v_finding, 'not_affected',
    'vulnerable_code_not_present', 'Reviewed source and vulnerable code is absent.',
    '[]'::jsonb, 'Initial VEX assessment.', 0,
    '11111111-1111-4111-8111-111111111111',
    repeat('a', 64)
  );
  perform pg_temp.check(
    'VEX submit creates an immutable pending revision with a policy snapshot',
    v_row.outcome = 'submitted'
    and v_row.result #>> '{assessment,status}' = 'not_affected'
    and v_row.result #>> '{assessment,justification}' = 'vulnerable_code_not_present'
    and v_row.result #>> '{assessment,approvalState}' = 'awaiting_approval'
    and (v_row.result #>> '{assessment,approvalRequired}')::boolean
    and (v_row.result #>> '{assessment,policySeverity}') = 'unknown'
  );
  v_assessment := (v_row.result #>> '{assessment,id}')::uuid;

  select * into v_row from public.submit_vulnerability_finding_vex_assessment_atomic(
    v_org, v_owner, v_finding, 'not_affected',
    'vulnerable_code_not_present', 'Reviewed source and vulnerable code is absent.',
    '[]'::jsonb, 'Initial VEX assessment.', 0,
    '11111111-1111-4111-8111-111111111111',
    repeat('a', 64)
  );
  perform pg_temp.check(
    'VEX submit idempotency replays the stored result without a duplicate revision',
    v_row.outcome = 'idempotent'
    and (v_row.result #>> '{idempotent}')::boolean
    and (select count(*) from public.vulnerability_finding_assessments where finding_id = v_finding) = 1
  );

  select * into v_row from public.submit_vulnerability_finding_vex_assessment_atomic(
    v_org, v_owner, v_finding, 'affected', null,
    'A stale editor is trying to write.', '[]'::jsonb,
    'Outdated browser state.', 0,
    '22222222-2222-4222-8222-222222222222', repeat('b', 64)
  );
  perform pg_temp.check(
    'VEX submit rejects stale expected versions without writing audit facts',
    v_row.outcome = 'conflict'
    and not exists (
      select 1 from public.audit_logs
      where organization_id = v_org and action = 'vulnerability.finding_vex_assessment_submitted'
        and changes ->> 'idempotencyKey' = '22222222-2222-4222-8222-222222222222'
    )
  );

  select * into v_row from public.submit_vulnerability_finding_vex_assessment_atomic(
    v_org, v_owner, v_finding, 'not_affected', null,
    'Bypassed UI omitted the required justification.', '[]'::jsonb,
    'Invalid request.', 1,
    '33333333-3333-4333-8333-333333333333', repeat('c', 64)
  );
  perform pg_temp.check(
    'VEX submit enforces the not_affected justification matrix server-side',
    v_row.outcome = 'invalid_request'
  );

  select * into v_row from public.approve_vulnerability_finding_vex_assessment_atomic(
    v_org, v_owner, v_finding, v_assessment, 1, null,
    '44444444-4444-4444-8444-444444444444', repeat('d', 64)
  );
  perform pg_temp.check(
    'VEX approval enforces separation of duties at the database boundary',
    v_row.outcome = 'forbidden'
  );

  select * into v_row from public.approve_vulnerability_finding_vex_assessment_atomic(
    v_org, v_admin, v_finding, v_assessment, 1, null,
    '55555555-5555-4555-8555-555555555555', repeat('e', 64)
  );
  perform pg_temp.check(
    'VEX approval is versioned and audited atomically',
    v_row.outcome = 'approved'
    and v_row.result #>> '{assessment,approvalState}' = 'approved'
    and (v_row.result #>> '{assessment,version}')::integer = 2
    and exists (
      select 1 from public.audit_logs
      where organization_id = v_org and entity_id = v_assessment::text
        and action = 'vulnerability.finding_vex_assessment_approved'
    )
  );

  select * into v_row from public.submit_vulnerability_finding_vex_assessment_atomic(
    v_org, v_owner, v_finding, 'affected', null,
    'A new review found reachable affected code.', '[]'::jsonb,
    'Revised after additional evidence.', 2,
    '66666666-6666-4666-8666-666666666666', repeat('f', 64)
  );
  v_revised := (v_row.result #>> '{assessment,id}')::uuid;
  perform pg_temp.check(
    'VEX revision supersedes instead of mutating the prior approved revision',
    v_row.outcome = 'submitted'
    and v_revised <> v_assessment
    and (select count(*) from public.vulnerability_finding_assessments
      where organization_id = v_org and finding_id = v_finding and is_current) = 1
    and exists (select 1 from public.vulnerability_finding_assessments
      where id = v_assessment and not is_current and superseded_by_id = v_revised)
    and exists (select 1 from public.vulnerability_finding_assessments
      where id = v_assessment and vex_status = 'not_affected' and approval_state = 'approved')
  );

  select * into v_row from public.set_vulnerability_assessment_approval_policy_atomic(
    v_org, v_admin, 'unknown', false,
    (select version from public.vulnerability_assessment_approval_policies
      where organization_id = v_org and severity = 'unknown'),
    '77777777-7777-4777-8777-777777777777', repeat('7', 64)
  );
  perform pg_temp.check(
    'VEX policy changes do not silently approve pending assessment snapshots',
    v_row.outcome = 'updated'
    and exists (select 1 from public.vulnerability_finding_assessments
      where id = v_revised and approval_required and approval_state = 'awaiting_approval')
  );

  select * into v_row from public.list_finding_triage_queue(
    v_org, v_owner,
    jsonb_build_object(
      'approvalStates', jsonb_build_array('awaiting_approval'),
      'vexStatuses', jsonb_build_array('affected'),
      'reEvaluationStates', jsonb_build_array('unchanged')
    ),
    10, null, 'lastEvaluatedAt', 'desc'
  );
  perform pg_temp.check(
    'M5 queue filters current VEX approvals and the corrected reEvaluation key',
    v_row.outcome = 'found'
    and jsonb_array_length(v_row.result -> 'rows') = 1
    and v_row.result #>> '{rows,0,vexStatus}' = 'affected'
    and v_row.result #>> '{rows,0,approvalState}' = 'awaiting_approval'
  );
end;
$$;

rollback;
