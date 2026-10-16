-- CRA-M5-05 metadata and privilege contract. Stateful/concurrent cases run in
-- the local-stack API suite because this shared SQL test runner is non-resetting.
create or replace function pg_temp.check(p_label text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'FAIL %', p_label;
  end if;
end;
$$;

select pg_temp.check(
  'M5-05 anchor history is append-only, tenant scoped, and browser private',
  (select relrowsecurity and not relforcerowsecurity
    from pg_class where oid = 'public.vulnerability_finding_remediation_anchors'::regclass)
  and exists (select 1 from pg_index where indexrelid =
    'public.vulnerability_finding_remediation_anchors_one_current_idx'::regclass)
  and not has_table_privilege('authenticated', 'public.vulnerability_finding_remediation_anchors', 'select,insert,update,delete')
  and has_table_privilege('service_role', 'public.vulnerability_finding_remediation_anchors', 'select,insert,update,delete')
  and position('remediation anchor revisions are immutable' in
    pg_get_functiondef('public.prevent_remediation_anchor_history_mutation()'::regprocedure)) > 0
);

select pg_temp.check(
  'M5-05 remediation event and reintroduction evidence are tenant scoped',
  exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'vulnerability_findings' and column_name = 'reintroduced_from_finding_id')
  and exists (select 1 from information_schema.columns where table_schema = 'public'
    and table_name = 'product_regulatory_outbox_events' and column_name = 'remediation_anchor_id')
  and exists (select 1 from pg_constraint where conrelid = 'public.product_regulatory_outbox_events'::regclass
    and pg_get_constraintdef(oid) like '%remediation_anchor.recorded%'
    and pg_get_constraintdef(oid) like '%component.reintroduced%')
  and exists (select 1 from pg_index where indexrelid =
    'public.product_regulatory_outbox_remediation_idx'::regclass)
);

select pg_temp.check(
  'M5-05 RPCs are pinned security definers and service-role only',
  has_function_privilege('service_role',
    'public.record_finding_remediation_anchor_atomic(uuid,uuid,uuid,text,text,text,timestamp with time zone,text,text,text,integer,uuid,uuid)', 'execute')
  and has_function_privilege('service_role',
    'public.get_finding_remediation_anchors(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'public.record_finding_remediation_anchor_atomic(uuid,uuid,uuid,text,text,text,timestamp with time zone,text,text,text,integer,uuid,uuid)', 'execute')
  and (select prosecdef and proconfig @> array['search_path=public, pg_temp']
    from pg_proc where oid =
      'public.record_finding_remediation_anchor_atomic(uuid,uuid,uuid,text,text,text,timestamp with time zone,text,text,text,integer,uuid,uuid)'::regprocedure)
);

select pg_temp.check(
  'M5-05 reintroduction uses lineage, normalized identity/version, and effective fixed VEX',
  position('completed_lineage' in pg_get_functiondef(
    'public.m5_remediation_mark_reintroduced_finding(uuid,uuid)'::regprocedure)) > 0
  and position('component_version = prior_occurrences.component_version' in pg_get_functiondef(
    'public.m5_remediation_mark_reintroduced_finding(uuid,uuid)'::regprocedure)) > 0
  and position('m5_bulk_effective_assessment_id' in pg_get_functiondef(
    'public.m5_remediation_mark_reintroduced_finding(uuid,uuid)'::regprocedure)) > 0
  and position('component.reintroduced' in pg_get_functiondef(
    'public.m5_remediation_mark_reintroduced_finding(uuid,uuid)'::regprocedure)) > 0
  and exists (
    select 1
    from pg_trigger trigger
    where trigger.tgrelid = 'public.vulnerability_finding_component_occurrences'::regclass
      and trigger.tgname = 'm5_remediation_detect_reintroduced_finding'
      and not trigger.tgisinternal
  )
);

select pg_temp.check(
  'M5-05 hands unconsumed remediation events to M6 through a narrow durable boundary',
  has_function_privilege('service_role',
    'public.list_m6_remediation_outbox_events(uuid,integer,uuid)', 'execute')
  and not has_function_privilege('authenticated',
    'public.list_m6_remediation_outbox_events(uuid,integer,uuid)', 'execute')
  and position('delivery_state = ''queued''' in pg_get_functiondef(
    'public.list_m6_remediation_outbox_events(uuid,integer,uuid)'::regprocedure)) > 0
  and position('events.payload -> ''remediation''' in pg_get_functiondef(
    'public.list_m6_remediation_outbox_events(uuid,integer,uuid)'::regprocedure)) > 0
  and position('not v_is_correction and nullif(btrim(coalesce(p_correction_reason' in pg_get_functiondef(
    'public.record_finding_remediation_anchor_atomic(uuid,uuid,uuid,text,text,text,timestamp with time zone,text,text,text,integer,uuid,uuid)'::regprocedure)) > 0
  and position('remediation-anchor:corrected:' in pg_get_functiondef(
    'public.record_finding_remediation_anchor_atomic(uuid,uuid,uuid,text,text,text,timestamp with time zone,text,text,text,integer,uuid,uuid)'::regprocedure)) > 0
  and position('''eventKey''' in pg_get_functiondef(
    'public.record_finding_remediation_anchor_atomic(uuid,uuid,uuid,text,text,text,timestamp with time zone,text,text,text,integer,uuid,uuid)'::regprocedure)) > 0
);
