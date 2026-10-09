-- Keep the existing tenant export source catalogue and materializer in sync
-- with the M11-05 physical tables. Jira replay identifiers and worker state
-- are deployment-local even when the corresponding business row is archived.
create or replace function public.m1_export_business_record_jsonb(
  p_table_name text,
  p_record jsonb
)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_record jsonb := public.m1_export_usable_security_redact_jsonb(coalesce(p_record, '{}'::jsonb))
    - array[
      'idempotency_key', 'request_digest', 'payload_digest', 'command_digest',
      'initialize_idempotency_key', 'initialize_request_digest',
      'finalize_idempotency_key', 'finalize_request_digest',
      'place_idempotency_key', 'place_payload_digest',
      'release_idempotency_key', 'release_payload_digest',
      'create_idempotency_key', 'intake_idempotency_key',
      'lock_token', 'lock_expires_at', 'lease_owner', 'lease_expires_at',
      'attempt_count'
    ];
begin
  if p_table_name = 'sync_run_plan_items' then
    return v_record - array['source_snapshot'];
  end if;
  if p_table_name = 'sync_runs' then
    return v_record - array['schema_snapshot', 'authority_snapshot'];
  end if;
  if p_table_name = 'webhook_endpoints' then
    return jsonb_build_object(
      'id', v_record->'id', 'display_name', v_record->'display_name',
      'event_types', v_record->'event_types', 'product_ids', v_record->'product_ids',
      'enabled', v_record->'enabled', 'version', v_record->'version'
    );
  end if;
  if p_table_name = 'webhook_endpoint_commands' then
    return v_record - array['idempotency_key', 'request_digest', 'request_digest_key_id', 'result', 'reason'];
  end if;
  if p_table_name = 'webhook_deliveries' then
    return v_record - array['payload_bytes', 'endpoint_url', 'lease_owner', 'lease_expires_at', 'lease_generation', 'replay_reason'];
  end if;
  if p_table_name = 'webhook_delivery_attempts' then
    return v_record - array['worker_id', 'lease_generation'];
  end if;
  case p_table_name
    when 'vulnerability_kev_alerts' then
      return v_record - array[
        'delivery_attempts', 'max_delivery_attempts',
        'last_delivery_error_code', 'last_delivery_error_message'
      ];
    when 'vulnerability_remediation_ticket_operations' then
      return v_record - array[
        'context_digest', 'result', 'correlation_id', 'next_attempt_at',
        'last_error', 'connector_connection_revision',
        'connector_credential_revision'
      ];
    when 'vulnerability_remediation_tickets' then
      return v_record - array['last_inbound_delivery_id', 'correlation_id'];
    when 'vulnerability_remediation_ticket_events' then
      return v_record - array['delivery_id'];
    else
      return v_record;
  end case;
end;
$$;

alter function public.m1_export_business_record_jsonb(text, jsonb) owner to postgres;
revoke all on function public.m1_export_business_record_jsonb(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.m1_export_business_record_jsonb(text, jsonb)
  to service_role;

do $$
declare
  v_definition text;
  v_lock_section text;
  v_anchor text := E'\n  in share mode;';
  v_new_lock text := 'public.vulnerability_remediation_ticket_bindings, public.vulnerability_remediation_ticket_status_mappings, public.vulnerability_remediation_tickets, public.vulnerability_remediation_ticket_operations, public.vulnerability_remediation_ticket_events';
  v_table text;
  v_missing text[] := array[]::text[];
begin
  select pg_get_functiondef(
    to_regprocedure('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)')
  ) into v_definition;
  if v_definition is null or position(v_anchor in v_definition) = 0 then
    raise exception 'M11-05 export lock anchor is missing';
  end if;
  v_lock_section := split_part(split_part(v_definition, 'lock table', 2), 'in share mode;', 1);
  foreach v_table in array string_to_array(v_new_lock, ', ') loop
    if position(v_table in v_lock_section) = 0 then
      v_missing := array_append(v_missing, v_table);
    end if;
  end loop;
  if cardinality(v_missing) > 0 then
    execute replace(v_definition, v_anchor,
      ', ' || array_to_string(v_missing, ', ') || v_anchor);
  end if;
end;
$$;
