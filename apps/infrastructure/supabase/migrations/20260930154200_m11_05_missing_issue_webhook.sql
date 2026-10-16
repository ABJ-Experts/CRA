-- CRA-M11-05: record authoritative missing Jira issue after signed webhook and provider refetch.

create or replace function public.record_missing_vulnerability_ticket_event_atomic(
  p_organization_id uuid,
  p_binding_id uuid,
  p_ticket_id uuid,
  p_correlation_id uuid,
  p_delivery_id text,
  p_external_issue_id text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.vulnerability_remediation_ticket_events%rowtype;
  v_binding public.vulnerability_remediation_ticket_bindings%rowtype;
  v_ticket public.vulnerability_remediation_tickets%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_organization_id is null or p_binding_id is null or p_ticket_id is null or p_correlation_id is null
    or char_length(btrim(coalesce(p_delivery_id,''))) not between 1 and 300
    or char_length(btrim(coalesce(p_external_issue_id,''))) not between 1 and 200 then
    return query select 'conflict'::text, jsonb_build_object('reason','invalid_request'); return;
  end if;

  select * into v_existing from public.vulnerability_remediation_ticket_events
  where provider = 'jira' and delivery_id = btrim(p_delivery_id);
  if found then
    return query select 'duplicate'::text,
      case when v_existing.organization_id <> p_organization_id or v_existing.binding_id <> p_binding_id or v_existing.ticket_id <> p_ticket_id then null::jsonb
        when v_existing.ticket_id is null then null::jsonb
        else public.m11_05_ticket_json(v_existing.organization_id, v_existing.ticket_id) end;
    return;
  end if;

  select * into v_binding
  from public.vulnerability_remediation_ticket_bindings
  where organization_id = p_organization_id and id = p_binding_id and provider = 'jira' and status = 'active'
  for share;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;

  select * into v_ticket
  from public.vulnerability_remediation_tickets
  where organization_id = p_organization_id and id = p_ticket_id and binding_id = p_binding_id
    and provider = 'jira'
  for update;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;

  if v_ticket.correlation_id <> p_correlation_id
    or v_ticket.external_issue_id is distinct from btrim(p_external_issue_id) then
    insert into public.vulnerability_remediation_ticket_events(
      organization_id, binding_id, ticket_id, provider, delivery_id, external_issue_id, external_issue_key,
      external_status_id, external_status_name, provider_project_id, provider_updated_at, outcome
    ) values (
      p_organization_id, p_binding_id, v_ticket.id, 'jira', btrim(p_delivery_id), btrim(p_external_issue_id),
      coalesce(v_ticket.external_issue_key, 'unknown'), 'missing', 'Missing',
      coalesce(v_ticket.provider_project_id, v_binding.project_id), v_now, 'unbound'
    );
    return query select 'conflict'::text, jsonb_build_object('reason','identity_mismatch'); return;
  end if;

  update public.vulnerability_remediation_tickets
  set status = 'deleted_or_moved',
    last_sync_direction = 'inbound',
    last_sync_at = v_now,
    last_provider_event_at = greatest(coalesce(last_provider_event_at, v_now), v_now),
    last_inbound_delivery_id = btrim(p_delivery_id),
    conflict_reason = 'provider_issue_missing',
    sync_revision = sync_revision + 1,
    version = version + 1,
    updated_at = v_now
  where organization_id = p_organization_id and id = v_ticket.id
  returning * into v_ticket;

  insert into public.vulnerability_remediation_ticket_events(
    organization_id, binding_id, ticket_id, provider, delivery_id, external_issue_id, external_issue_key,
    external_status_id, external_status_name, provider_project_id, provider_updated_at, outcome
  ) values (
    p_organization_id, p_binding_id, v_ticket.id, 'jira', btrim(p_delivery_id), btrim(p_external_issue_id),
    coalesce(v_ticket.external_issue_key, 'unknown'), 'missing', 'Missing',
    coalesce(v_ticket.provider_project_id, v_binding.project_id), v_now, 'moved'
  );

  insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'vulnerability.remediation_ticket_issue_missing',
    'vulnerability_remediation_ticket', v_ticket.id::text,
    jsonb_build_object('bindingId', p_binding_id, 'deliveryId', p_delivery_id,
      'externalIssueId', p_external_issue_id, 'reason', 'provider_issue_missing'));

  return query select 'moved'::text, public.m11_05_ticket_json(p_organization_id, v_ticket.id);
end;
$$;

revoke all on function public.record_missing_vulnerability_ticket_event_atomic(uuid,uuid,uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.record_missing_vulnerability_ticket_event_atomic(uuid,uuid,uuid,uuid,text,text)
  to service_role;
