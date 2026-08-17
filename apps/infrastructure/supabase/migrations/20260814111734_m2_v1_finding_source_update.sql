-- Source updates are versioned, request-idempotent commands. They never
-- overwrite the external finding identity, which was established at register.
alter table public.finding_propagation_sources
  add column update_idempotency_key uuid,
  add column update_idempotency_request_digest text,
  add column update_idempotency_actor_id uuid references public.users(id) on delete restrict,
  add constraint finding_propagation_sources_update_idempotency_check check (
    (update_idempotency_key is null) = (update_idempotency_request_digest is null)
    and (update_idempotency_key is null) = (update_idempotency_actor_id is null)
    and (
      update_idempotency_request_digest is null
      or update_idempotency_request_digest ~ '^[a-f0-9]{64}$'
    )
  );

create unique index finding_propagation_source_update_idempotency_key
  on public.finding_propagation_sources(
    organization_id, update_idempotency_actor_id, update_idempotency_key
  ) where update_idempotency_key is not null;

create or replace function public.update_finding_propagation_source_atomic(
  p_organization_id uuid,
  p_source_id uuid,
  p_actor_user_id uuid,
  p_source_product_id uuid,
  p_source_release_id uuid,
  p_source_baseline_revision_id uuid,
  p_rule_version text,
  p_status text,
  p_reason text,
  p_source text,
  p_provenance text,
  p_expected_version integer,
  p_idempotency_key uuid,
  p_correlation_id uuid
) returns table(outcome text, source jsonb, job_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_source public.finding_propagation_sources%rowtype;
  v_replay public.finding_propagation_sources%rowtype;
  v_graph_version integer;
  v_job_id uuid;
  v_digest text;
  v_before jsonb;
  v_closed_count bigint := 0;
begin
  if p_organization_id is null
     or p_source_id is null
     or p_actor_user_id is null
     or p_source_product_id is null
     or p_idempotency_key is null
     or p_correlation_id is null
     or p_expected_version is null
     or p_expected_version < 0
     or (p_source_release_id is null) = (p_source_baseline_revision_id is null)
     or p_status not in ('active', 'resolved', 'archived')
     or char_length(btrim(coalesce(p_rule_version, ''))) not between 1 and 100
     or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 1000
     or char_length(btrim(coalesce(p_source, ''))) not between 1 and 1000
     or char_length(btrim(coalesce(p_provenance, ''))) not between 1 and 1000 then
    return query select 'invalid_request'::text, null::jsonb, null::uuid;
    return;
  end if;

  if not public.m2_active_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb, null::uuid;
    return;
  end if;

  v_digest := encode(
    extensions.digest(
      jsonb_build_object(
        'sourceId', p_source_id,
        'sourceProductId', p_source_product_id,
        'sourceReleaseId', p_source_release_id,
        'sourceBaselineRevisionId', p_source_baseline_revision_id,
        'ruleVersion', btrim(p_rule_version),
        'status', p_status,
        'reason', btrim(p_reason),
        'source', btrim(p_source),
        'provenance', btrim(p_provenance),
        'expectedVersion', p_expected_version
      )::text,
      'sha256'
    ),
    'hex'
  );

  select * into v_replay
    from public.finding_propagation_sources s
   where s.organization_id = p_organization_id
     and s.update_idempotency_actor_id = p_actor_user_id
     and s.update_idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_replay.id <> p_source_id
       or v_replay.update_idempotency_request_digest <> v_digest then
      return query select 'idempotency_mismatch'::text, null::jsonb, null::uuid;
      return;
    end if;
    select j.id into v_job_id
      from public.finding_propagation_jobs j
     where j.organization_id = p_organization_id
       and j.trigger_key = 'source:' || v_replay.id::text || ':update:' || v_replay.version::text;
    return query select
      'replayed'::text,
      jsonb_build_object(
        'id', v_replay.id,
        'organizationId', v_replay.organization_id,
        'status', v_replay.status,
        'version', v_replay.version
      ),
      v_job_id;
    return;
  end if;

  select * into v_source
    from public.finding_propagation_sources s
   where s.organization_id = p_organization_id
     and s.id = p_source_id
   for update;
  if not found then
    return query select 'not_found'::text, null::jsonb, null::uuid;
    return;
  end if;
  if v_source.version <> p_expected_version then
    return query select 'conflict'::text, null::jsonb, null::uuid;
    return;
  end if;
  v_before := jsonb_build_object(
    'status', v_source.status,
    'version', v_source.version,
    'sourceProductId', v_source.source_product_id,
    'sourceReleaseId', v_source.source_release_id,
    'sourceBaselineRevisionId', v_source.source_baseline_revision_id,
    'ruleVersion', v_source.rule_version
  );
  if not exists (
      select 1 from public.products p
       where p.organization_id = p_organization_id and p.id = p_source_product_id
    )
    or (
      p_source_release_id is not null
      and not exists (
        select 1 from public.product_releases r
         where r.organization_id = p_organization_id
           and r.product_id = p_source_product_id
           and r.id = p_source_release_id
      )
    )
    or (
      p_source_baseline_revision_id is not null
      and not exists (
        select 1 from public.software_baselines b
         where b.organization_id = p_organization_id
           and b.id = p_source_baseline_revision_id
      )
    ) then
    return query select 'not_found'::text, null::jsonb, null::uuid;
    return;
  end if;

  select product_relationship_graph_version into v_graph_version
    from public.organization_settings
   where organization_id = p_organization_id;
  if v_graph_version is null then
    return query select 'not_found'::text, null::jsonb, null::uuid;
    return;
  end if;

  update public.finding_propagation_sources s
     set source_product_id = p_source_product_id,
         source_release_id = p_source_release_id,
         source_baseline_revision_id = p_source_baseline_revision_id,
         rule_version = btrim(p_rule_version),
         status = p_status,
         source = btrim(p_source),
         provenance = btrim(p_provenance),
         version = s.version + 1,
         updated_by = p_actor_user_id,
         update_idempotency_key = p_idempotency_key,
         update_idempotency_request_digest = v_digest,
         update_idempotency_actor_id = p_actor_user_id
   where s.organization_id = p_organization_id
     and s.id = p_source_id
     and s.version = p_expected_version
  returning * into v_source;
  if not found then
    return query select 'conflict'::text, null::jsonb, null::uuid;
    return;
  end if;

  insert into public.finding_propagation_jobs(
    organization_id, source_finding_id, trigger_key, graph_version,
    source_release_id, source_baseline_revision_id, rule_version, as_of,
    status, requested_by
  ) values (
    p_organization_id,
    v_source.id,
    'source:' || v_source.id::text || ':update:' || v_source.version::text,
    v_graph_version,
    v_source.source_release_id,
    v_source.source_baseline_revision_id,
    v_source.rule_version,
    clock_timestamp(),
    case when v_source.status = 'active' then 'scheduled' else 'completed' end,
    p_actor_user_id
  ) returning id into v_job_id;

  if v_source.status <> 'active' then
    update public.finding_impact_associations a
       set status = 'closed',
           updated_at = clock_timestamp(),
           version = a.version + 1
     where a.organization_id = p_organization_id
       and a.source_finding_id = v_source.id
       and a.status in ('candidate', 'active');
    get diagnostics v_closed_count = row_count;

    update public.finding_propagation_jobs j
       set status = 'obsolete',
           lease_owner = null,
           lease_expires_at = null,
           last_error_code = 'source_inactive'
     where j.organization_id = p_organization_id
       and j.source_finding_id = v_source.id
       and j.id <> v_job_id
       and j.status in ('scheduled', 'retrying', 'leased');
  end if;

  insert into public.audit_logs(
    organization_id, user_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id,
    p_actor_user_id,
    'finding.propagation_source_updated',
    'finding_propagation_source',
    v_source.id::text,
    jsonb_build_object(
      'before', jsonb_build_object(
        'status', v_before->>'status',
        'version', (v_before->>'version')::integer,
        'sourceProductId', v_before->'sourceProductId',
        'sourceReleaseId', v_before->'sourceReleaseId',
        'sourceBaselineRevisionId', v_before->'sourceBaselineRevisionId',
        'ruleVersion', v_before->>'ruleVersion'
      ),
      'after', jsonb_build_object(
        'status', v_source.status,
        'version', v_source.version,
        'sourceProductId', v_source.source_product_id,
        'sourceReleaseId', v_source.source_release_id,
        'sourceBaselineRevisionId', v_source.source_baseline_revision_id,
        'ruleVersion', v_source.rule_version
      ),
      'reason', btrim(p_reason),
      'closedImpactCount', v_closed_count,
      'jobId', v_job_id,
      'correlationId', p_correlation_id
    )
  );

  return query select
    'updated'::text,
    jsonb_build_object(
      'id', v_source.id,
      'organizationId', v_source.organization_id,
      'status', v_source.status,
      'version', v_source.version
    ),
    v_job_id;
exception
  when unique_violation then
    return query select 'conflict'::text, null::jsonb, null::uuid;
end;
$$;

alter function public.update_finding_propagation_source_atomic(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, integer, uuid, uuid
) owner to postgres;
revoke all on function public.update_finding_propagation_source_atomic(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, integer, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.update_finding_propagation_source_atomic(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, integer, uuid, uuid
) to service_role;
