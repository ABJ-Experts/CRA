-- CRA-M11-05: include actor and scoped revalidation context in remediation ticket worker claims.

create or replace function public.m11_05_remediation_ticket_operation_json(
  p_operation_id uuid
) returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'operationId', o.id,
    'organizationId', o.organization_id,
    'operation', o.operation,
    'actorUserId', o.actor_user_id,
    'ticketId', o.ticket_id,
    'bindingId', o.binding_id,
    'findingId', o.finding_id,
    'correlationId', o.correlation_id,
    'state', o.state,
    'attemptCount', o.attempt_count,
    'leaseOwner', o.lease_owner,
    'leaseExpiresAt', case when o.lease_expires_at is null then null else public.m2_utc_z(o.lease_expires_at) end,
    'result', o.result,
    'connectorConnectionRevision', o.connector_connection_revision,
    'connectorCredentialRevision', o.connector_credential_revision,
    'context', jsonb_strip_nulls(jsonb_build_object(
      'organizationId', o.organization_id,
      'actorUserId', o.actor_user_id,
      'bindingId', b.id,
      'connectorId', b.connector_id,
      'connectorConnectionRevision', c.connection_revision,
      'connectorCredentialRevision', c.credential_revision,
      'provider', b.provider,
      'providerHost', b.provider_host,
      'cloudId', b.provider_cloud_id,
      'siteHost', b.site_host,
      'projectId', b.project_id,
      'projectKey', b.project_key,
      'issueTypeId', b.issue_type_id,
      'ticketId', t.id,
      'externalIssueId', t.external_issue_id,
      'externalIssueKey', t.external_issue_key,
      'providerProjectId', t.provider_project_id,
      'ticketCorrelationId', t.correlation_id,
      'ticketVersion', t.version,
      'syncRevision', t.sync_revision,
      'findingId', f.id,
      'releaseId', f.release_id,
      'productId', r.product_id,
      'fieldMapping', b.field_mapping,
      'customFieldMappings', b.custom_field_mappings,
      'statusTransitions', b.status_transitions,
      'statusMappings', b.status_mappings
    ))
  )
  from public.vulnerability_remediation_ticket_operations o
  join public.vulnerability_remediation_ticket_bindings b on b.organization_id = o.organization_id and b.id = o.binding_id
  join public.connectors c on c.organization_id = b.organization_id and c.id = b.connector_id
  left join public.vulnerability_remediation_tickets t on t.organization_id = o.organization_id and t.id = o.ticket_id
  left join public.vulnerability_findings f on f.organization_id = o.organization_id and f.id = o.finding_id
  left join public.product_releases r on r.organization_id = f.organization_id and r.id = f.release_id
  where o.id = p_operation_id
$$;

create or replace function public.resolve_vulnerability_remediation_ticket_worker_context(
  p_organization_id uuid,
  p_operation_id uuid
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_operation public.vulnerability_remediation_ticket_operations%rowtype;
begin
  if p_organization_id is null or p_operation_id is null then
    return query select 'invalid_request'::text, null::jsonb; return;
  end if;

  select o.* into v_operation
  from public.vulnerability_remediation_ticket_operations o
  join public.vulnerability_remediation_ticket_bindings b on b.organization_id = o.organization_id and b.id = o.binding_id
  join public.connectors c on c.organization_id = b.organization_id and c.id = b.connector_id
  join public.connector_secrets s on s.organization_id = c.organization_id and s.connector_id = c.id and s.id = c.secret_ref and s.revoked_at is null
  where o.organization_id = p_organization_id
    and o.id = p_operation_id
    and b.status = 'active'
    and c.connector_type = 'jira'
    and c.enabled
    and c.archived_at is null
    and c.connection_config->>'providerHost' = 'api.atlassian.com'
    and c.connection_config->>'cloudId' = b.provider_cloud_id
    and c.connection_config->>'siteHost' = b.site_host
    and (o.connector_connection_revision is null or o.connector_connection_revision = c.connection_revision)
    and (o.connector_credential_revision is null or o.connector_credential_revision = c.credential_revision)
  limit 1;

  if not found then
    return query select 'not_found'::text, null::jsonb; return;
  end if;

  return query select 'found'::text, public.m11_05_remediation_ticket_operation_json(v_operation.id);
end;
$$;

revoke all on function public.m11_05_remediation_ticket_operation_json(uuid),
  public.resolve_vulnerability_remediation_ticket_worker_context(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_vulnerability_remediation_ticket_worker_context(uuid,uuid)
  to service_role;
