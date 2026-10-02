-- M11-04: close the verified-connection-to-binding TOCTOU window.
-- Drop the prior overload so service-role callers cannot bypass the revision fence.
drop function if exists public.upsert_ci_provider_release_binding_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,uuid,bigint,uuid,text);

create or replace function public.upsert_ci_provider_release_binding_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_connector_id uuid,
  p_expected_connection_revision integer,
  p_expected_credential_revision integer,
  p_product_id uuid,
  p_release_id uuid,
  p_credential_id uuid,
  p_provider text,
  p_provider_host text,
  p_repository_owner text,
  p_repository_name text,
  p_repository_id text,
  p_provider_installation_id text,
  p_project_key text,
  p_pipeline_definition_id text,
  p_allowed_ref text,
  p_expected_binding_id uuid,
  p_expected_version bigint,
  p_idempotency_key uuid,
  p_request_digest text
) returns table(outcome text, binding jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_command public.ci_provider_release_binding_commands%rowtype; v_binding public.ci_provider_release_bindings%rowtype;
  v_connector public.connectors%rowtype; v_binding_id uuid;
begin
  if p_organization_id is null or p_actor_user_id is null or p_connector_id is null or p_product_id is null or p_release_id is null or p_credential_id is null
    or p_expected_connection_revision is null or p_expected_connection_revision < 1
    or p_expected_credential_revision is null or p_expected_credential_revision < 1
    or p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$'
    or p_provider not in ('github_actions','gitlab_ci','azure_devops')
    or p_provider_host is null or p_provider_host <> lower(p_provider_host)
    or p_provider_host !~ '^(?!localhost$)(?![0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    or char_length(btrim(coalesce(p_repository_owner,''))) not between 1 and 120
    or char_length(btrim(coalesce(p_repository_name,''))) not between 1 and 160
    or char_length(btrim(coalesce(p_repository_id,''))) not between 1 and 160
    or (p_provider = 'github_actions' and char_length(btrim(coalesce(p_provider_installation_id,''))) not between 1 and 160)
    or (p_provider <> 'github_actions' and p_provider_installation_id is not null)
    or (p_project_key is not null and char_length(btrim(p_project_key)) not between 1 and 200)
    or (p_pipeline_definition_id is not null and char_length(btrim(p_pipeline_definition_id)) not between 1 and 200)
    or p_allowed_ref !~ '^refs/(heads|tags)/[^[:cntrl:]]+$' or char_length(p_allowed_ref) not between 1 and 500
    or (p_expected_binding_id is null and p_expected_version is not null)
    or (p_expected_binding_id is not null and p_expected_version is null)
    or not public.m11_lock_connector_authorization(p_organization_id, p_actor_user_id,
      (select version from public.organization_permissions_version where organization_id=p_organization_id), true)
    or not exists (select 1 from public.product_releases r where r.organization_id = p_organization_id and r.product_id = p_product_id and r.id = p_release_id)
    or not exists (select 1 from public.sbom_ci_credentials c where c.organization_id = p_organization_id and c.id = p_credential_id and c.status = 'active') then
    return query select 'not_found'::text, null::jsonb; return;
  end if;
  select * into v_connector from public.connectors c where c.organization_id = p_organization_id
    and c.id = p_connector_id and c.connector_type = p_provider and c.enabled and c.archived_at is null
    and c.secret_ref is not null and c.credential_revision > 0
    and exists(select 1 from public.connector_secrets s where s.organization_id=p_organization_id
      and s.connector_id=c.id and s.id=c.secret_ref and s.revoked_at is null)
    and c.connection_config->>'providerHost' = p_provider_host
    and (p_provider <> 'github_actions' or c.connection_config->>'installationId' = p_provider_installation_id)
    and (p_provider <> 'gitlab_ci' or c.connection_config->>'projectId' = p_repository_id)
    and (p_provider <> 'azure_devops' or c.connection_config->>'projectId' = p_project_key)
    for share;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_connector.connection_revision <> p_expected_connection_revision
    or v_connector.credential_revision <> p_expected_credential_revision then
    return query select 'conflict'::text,null::jsonb; return;
  end if;

  select * into v_command from public.ci_provider_release_binding_commands c
  where c.organization_id = p_organization_id and c.actor_user_id = p_actor_user_id and c.idempotency_key = p_idempotency_key;
  if found then
    if v_command.request_digest = p_request_digest then
      return query select 'replayed'::text, v_command.result->'binding'; return;
    end if;
    return query select 'idempotency_mismatch'::text, null::jsonb; return;
  end if;

  if p_expected_binding_id is not null then
    select * into v_binding from public.ci_provider_release_bindings b
    where b.organization_id = p_organization_id and b.id = p_expected_binding_id and b.status = 'active' for update;
    if not found then return query select 'not_found'::text, null::jsonb; return; end if;
    if v_binding.version <> p_expected_version
      or v_binding.connector_id <> p_connector_id or v_binding.product_id <> p_product_id
      or v_binding.release_id <> p_release_id or v_binding.credential_id <> p_credential_id
      or v_binding.provider <> p_provider or v_binding.provider_host <> p_provider_host
      or v_binding.repository_id <> p_repository_id
      or v_binding.provider_installation_id is distinct from p_provider_installation_id
      or v_binding.project_key is distinct from p_project_key
      or v_binding.pipeline_definition_id is distinct from p_pipeline_definition_id
      or v_binding.allowed_ref is distinct from p_allowed_ref then
      return query select 'conflict'::text, null::jsonb; return;
    end if;
    update public.ci_provider_release_bindings set
      repository_owner = btrim(p_repository_owner),
      repository_name = btrim(p_repository_name),
      connection_revision = v_connector.connection_revision,
      credential_revision = v_connector.credential_revision,
      version = version + 1
    where organization_id = p_organization_id and id = p_expected_binding_id
    returning id into v_binding_id;
  else
    insert into public.ci_provider_release_bindings(
      organization_id, connector_id, product_id, release_id, credential_id, provider, provider_host,
      repository_owner, repository_name, repository_id, provider_installation_id,
      project_key, pipeline_definition_id, allowed_ref, connection_revision, credential_revision, created_by
    ) values (
      p_organization_id, p_connector_id, p_product_id, p_release_id, p_credential_id, p_provider, p_provider_host,
      btrim(p_repository_owner), btrim(p_repository_name), btrim(p_repository_id), nullif(btrim(coalesce(p_provider_installation_id, '')), ''),
      nullif(btrim(coalesce(p_project_key, '')), ''), nullif(btrim(coalesce(p_pipeline_definition_id, '')), ''),
      p_allowed_ref,
      v_connector.connection_revision,v_connector.credential_revision,p_actor_user_id
    ) returning id into v_binding_id;
  end if;

  insert into public.audit_logs(organization_id, user_id, action, entity_type, entity_id, changes)
  values (p_organization_id, p_actor_user_id, 'ci_provider_release_binding.upserted', 'ci_provider_release_binding', v_binding_id::text,
    jsonb_build_object('provider', p_provider, 'providerHost', p_provider_host, 'repositoryId', p_repository_id, 'releaseId', p_release_id));
  insert into public.ci_provider_release_binding_commands(organization_id, actor_user_id, binding_id, operation, idempotency_key, request_digest, result)
  values (p_organization_id, p_actor_user_id, v_binding_id, 'upsert', p_idempotency_key, p_request_digest,
    jsonb_build_object('binding', public.ci_provider_release_binding_json(p_organization_id, v_binding_id)));
  return query select 'upserted'::text, public.ci_provider_release_binding_json(p_organization_id, v_binding_id);
exception when unique_violation then
  return query select 'conflict'::text, null::jsonb;
end;
$$;

revoke all on function public.upsert_ci_provider_release_binding_atomic(uuid,uuid,uuid,integer,integer,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,uuid,bigint,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.upsert_ci_provider_release_binding_atomic(uuid,uuid,uuid,integer,integer,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,uuid,bigint,uuid,text) to service_role;
