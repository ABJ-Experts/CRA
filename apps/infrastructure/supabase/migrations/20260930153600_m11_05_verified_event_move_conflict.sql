-- CRA-M11-05: verified Jira event handling for moved issues and equal-timestamp conflicts.

alter table public.vulnerability_remediation_ticket_events
  drop constraint if exists vulnerability_remediation_ticket_events_outcome_check,
  add constraint vulnerability_remediation_ticket_events_outcome_check check (
    outcome in ('processed','duplicate','unbound','stale','unknown_status','moved','conflict')
  );

create or replace function public.record_verified_vulnerability_ticket_event_atomic(
  p_organization_id uuid,
  p_binding_id uuid,
  p_ticket_id uuid,
  p_delivery_id text,
  p_external_issue_id text,
  p_external_issue_key text,
  p_external_status_id text,
  p_external_status_name text,
  p_provider_project_id text,
  p_provider_updated_at timestamptz,
  p_correlation_id uuid
) returns table(outcome text, ticket jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.vulnerability_remediation_ticket_events%rowtype;
  v_binding public.vulnerability_remediation_ticket_bindings%rowtype;
  v_ticket public.vulnerability_remediation_tickets%rowtype;
  v_status text;
  v_outcome text;
  v_now timestamptz := clock_timestamp();
  v_observed_project_id text;
begin
  v_observed_project_id := btrim(coalesce(p_provider_project_id,''));
  if p_ticket_id is null
    or char_length(btrim(coalesce(p_delivery_id,''))) not between 1 and 300
    or char_length(btrim(coalesce(p_external_issue_id,''))) not between 1 and 200
    or char_length(btrim(coalesce(p_external_issue_key,''))) not between 1 and 200
    or char_length(btrim(coalesce(p_external_status_id,''))) not between 1 and 120
    or char_length(btrim(coalesce(p_external_status_name,''))) not between 1 and 200
    or char_length(v_observed_project_id) not between 1 and 120
    or p_provider_updated_at is null
    or p_correlation_id is null then
    return query select 'invalid_request'::text, null::jsonb; return;
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

  select * into v_binding from public.vulnerability_remediation_ticket_bindings
  where organization_id = p_organization_id and id = p_binding_id and provider = 'jira'
    and status = 'active'
  for share;
  if not found then return query select 'not_found'::text, null::jsonb; return; end if;

  select * into v_ticket from public.vulnerability_remediation_tickets
  where organization_id = p_organization_id and id = p_ticket_id and binding_id = p_binding_id
    and provider = 'jira'
    and external_issue_id = btrim(p_external_issue_id)
  for update;
  if not found then
    insert into public.vulnerability_remediation_ticket_events(
      organization_id, binding_id, provider, delivery_id, external_issue_id, external_issue_key,
      external_status_id, external_status_name, provider_project_id, provider_updated_at, outcome
    ) values (
      p_organization_id, p_binding_id, 'jira', btrim(p_delivery_id), btrim(p_external_issue_id),
      btrim(p_external_issue_key), btrim(p_external_status_id), btrim(p_external_status_name),
      v_observed_project_id, p_provider_updated_at, 'unbound'
    );
    return query select 'not_found'::text, null::jsonb; return;
  end if;

  if v_ticket.correlation_id <> p_correlation_id then
    insert into public.vulnerability_remediation_ticket_events(
      organization_id, binding_id, ticket_id, provider, delivery_id, external_issue_id, external_issue_key,
      external_status_id, external_status_name, provider_project_id, provider_updated_at, outcome
    ) values (
      p_organization_id, p_binding_id, v_ticket.id, 'jira', btrim(p_delivery_id), btrim(p_external_issue_id),
      btrim(p_external_issue_key), btrim(p_external_status_id), btrim(p_external_status_name),
      v_observed_project_id, p_provider_updated_at, 'unbound'
    );
    return query select 'not_found'::text, null::jsonb; return;
  end if;

  if v_observed_project_id <> v_binding.project_id then
    update public.vulnerability_remediation_tickets
    set external_issue_key = btrim(p_external_issue_key),
      external_status_id = btrim(p_external_status_id),
      external_status_name = btrim(p_external_status_name),
      provider_project_id = v_observed_project_id,
      status = 'deleted_or_moved',
      last_sync_direction = 'inbound',
      last_sync_at = v_now,
      last_provider_event_at = greatest(coalesce(last_provider_event_at, p_provider_updated_at), p_provider_updated_at),
      last_inbound_delivery_id = btrim(p_delivery_id),
      conflict_reason = 'provider_project_changed',
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
      btrim(p_external_issue_key), btrim(p_external_status_id), btrim(p_external_status_name),
      v_observed_project_id, p_provider_updated_at, 'moved'
    );
    insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'vulnerability.remediation_ticket_deleted_or_moved',
      'vulnerability_remediation_ticket', v_ticket.id::text,
      jsonb_build_object('deliveryId', p_delivery_id, 'expectedProjectId', v_binding.project_id,
        'observedProjectId', v_observed_project_id, 'externalIssueId', p_external_issue_id));
    return query select 'moved'::text, public.m11_05_ticket_json(p_organization_id, v_ticket.id); return;
  end if;

  if v_ticket.last_provider_event_at is not null and p_provider_updated_at < v_ticket.last_provider_event_at then
    insert into public.vulnerability_remediation_ticket_events(
      organization_id, binding_id, ticket_id, provider, delivery_id, external_issue_id, external_issue_key,
      external_status_id, external_status_name, provider_project_id, provider_updated_at, outcome
    ) values (
      p_organization_id, p_binding_id, v_ticket.id, 'jira', btrim(p_delivery_id), btrim(p_external_issue_id),
      btrim(p_external_issue_key), btrim(p_external_status_id), btrim(p_external_status_name),
      v_observed_project_id, p_provider_updated_at, 'stale'
    );
    return query select 'stale'::text, public.m11_05_ticket_json(p_organization_id, v_ticket.id); return;
  end if;

  if v_ticket.last_provider_event_at is not null and p_provider_updated_at = v_ticket.last_provider_event_at
    and (v_ticket.external_issue_key is distinct from btrim(p_external_issue_key)
      or v_ticket.external_status_id is distinct from btrim(p_external_status_id)
      or v_ticket.external_status_name is distinct from btrim(p_external_status_name)
      or v_ticket.provider_project_id is distinct from v_observed_project_id) then
    update public.vulnerability_remediation_tickets
    set status = 'conflict', last_sync_direction = 'inbound', last_sync_at = v_now,
      last_inbound_delivery_id = btrim(p_delivery_id), conflict_reason = 'provider_equal_timestamp_conflict',
      sync_revision = sync_revision + 1, version = version + 1, updated_at = v_now
    where organization_id = p_organization_id and id = v_ticket.id
    returning * into v_ticket;
    insert into public.vulnerability_remediation_ticket_events(
      organization_id, binding_id, ticket_id, provider, delivery_id, external_issue_id, external_issue_key,
      external_status_id, external_status_name, provider_project_id, provider_updated_at, outcome
    ) values (
      p_organization_id, p_binding_id, v_ticket.id, 'jira', btrim(p_delivery_id), btrim(p_external_issue_id),
      btrim(p_external_issue_key), btrim(p_external_status_id), btrim(p_external_status_name),
      v_observed_project_id, p_provider_updated_at, 'conflict'
    );
    insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
    values (p_organization_id, 'vulnerability.remediation_ticket_event_conflict',
      'vulnerability_remediation_ticket', v_ticket.id::text,
      jsonb_build_object('deliveryId', p_delivery_id, 'reason', 'provider_equal_timestamp_conflict',
        'externalIssueId', p_external_issue_id));
    return query select 'conflict'::text, public.m11_05_ticket_json(p_organization_id, v_ticket.id); return;
  end if;

  v_status := public.m11_05_ticket_status(p_organization_id, p_binding_id, p_external_status_id, p_external_status_name);
  v_outcome := case when v_status = 'conflict' then 'unknown_status' else 'processed' end;
  if v_ticket.external_status_id = btrim(p_external_status_id)
    and v_ticket.external_status_name = btrim(p_external_status_name)
    and v_ticket.external_issue_key = btrim(p_external_issue_key)
    and v_ticket.provider_project_id = v_observed_project_id
    and v_ticket.status = v_status
    and v_ticket.last_provider_event_at is not null
    and p_provider_updated_at <= v_ticket.last_provider_event_at then
    insert into public.vulnerability_remediation_ticket_events(
      organization_id, binding_id, ticket_id, provider, delivery_id, external_issue_id, external_issue_key,
      external_status_id, external_status_name, provider_project_id, provider_updated_at, outcome
    ) values (
      p_organization_id, p_binding_id, v_ticket.id, 'jira', btrim(p_delivery_id), btrim(p_external_issue_id),
      btrim(p_external_issue_key), btrim(p_external_status_id), btrim(p_external_status_name),
      v_observed_project_id, v_ticket.last_provider_event_at, v_outcome
    );
    return query select case when v_outcome = 'unknown_status' then 'unknown_status' else 'recorded' end,
      public.m11_05_ticket_json(p_organization_id, v_ticket.id);
    return;
  end if;

  update public.vulnerability_remediation_tickets
  set external_issue_key = btrim(p_external_issue_key),
    external_status_id = btrim(p_external_status_id),
    external_status_name = btrim(p_external_status_name),
    provider_project_id = v_observed_project_id,
    status = v_status,
    last_sync_direction = 'inbound',
    last_sync_at = v_now,
    last_provider_event_at = p_provider_updated_at,
    last_inbound_delivery_id = btrim(p_delivery_id),
    conflict_reason = case when v_status = 'conflict' then 'unknown_external_status' else null end,
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
    btrim(p_external_issue_key), btrim(p_external_status_id), btrim(p_external_status_name),
    v_observed_project_id, p_provider_updated_at, v_outcome
  );
  insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
  values (p_organization_id, 'vulnerability.remediation_ticket_event_recorded',
    'vulnerability_remediation_ticket', v_ticket.id::text,
    jsonb_build_object('deliveryId', p_delivery_id, 'externalStatusId', p_external_status_id,
      'externalStatusName', p_external_status_name, 'mappedStatus', v_status));
  return query select case when v_outcome = 'unknown_status' then 'unknown_status' else 'recorded' end,
    public.m11_05_ticket_json(p_organization_id, v_ticket.id);
end;
$$;

revoke all on function public.record_verified_vulnerability_ticket_event_atomic(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone,uuid)
  from public, anon, authenticated;
grant execute on function public.record_verified_vulnerability_ticket_event_atomic(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone,uuid)
  to service_role;
