-- Source mutation and page persistence acquire the source row before the job
-- lease. This shared lock order makes a resolved source unable to race an
-- already-running page back into `active` after its associations were closed.
create or replace function public.persist_finding_propagation_page_atomic(
  p_organization_id uuid, p_job_id uuid, p_lease_owner uuid,
  p_expected_checkpoint_version integer, p_candidates jsonb, p_next_cursor text,
  p_is_final boolean
) returns table(
  outcome text, processed_count bigint, upserted_count bigint,
  superseded_count bigint, checkpoint_version integer
)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_job public.finding_propagation_jobs%rowtype;
  v_source public.finding_propagation_sources%rowtype;
  v_row record;
  v_path uuid[];
  v_hash text;
  v_processed bigint := 0;
  v_upserted bigint := 0;
  v_superseded bigint := 0;
begin
  if p_organization_id is null or p_job_id is null or p_lease_owner is null
     or p_expected_checkpoint_version is null or jsonb_typeof(p_candidates) <> 'array'
     or p_is_final is null then
    return query select 'invalid_request'::text, 0::bigint, 0::bigint, 0::bigint, null::integer;
    return;
  end if;

  -- Read the immutable job-to-source relation before locking. Every mutation
  -- thereafter locks source first, then job, avoiding inverse-order deadlocks.
  select * into v_job from public.finding_propagation_jobs j
   where j.organization_id = p_organization_id and j.id = p_job_id;
  if not found then
    return query select 'not_found'::text, 0::bigint, 0::bigint, 0::bigint, null::integer;
    return;
  end if;
  select * into v_source from public.finding_propagation_sources s
   where s.organization_id = p_organization_id and s.id = v_job.source_finding_id
   for update;
  if not found then
    return query select 'not_found'::text, 0::bigint, 0::bigint, 0::bigint, null::integer;
    return;
  end if;
  select * into v_job from public.finding_propagation_jobs j
   where j.organization_id = p_organization_id and j.id = p_job_id
   for update;
  if not found then
    return query select 'not_found'::text, 0::bigint, 0::bigint, 0::bigint, null::integer;
    return;
  end if;
  if v_job.status <> 'leased' or v_job.lease_owner is distinct from p_lease_owner
     or v_job.checkpoint_version <> p_expected_checkpoint_version
     or v_job.lease_expires_at <= clock_timestamp()
     or v_source.status <> 'active' then
    return query select 'conflict'::text, 0::bigint, 0::bigint, 0::bigint, v_job.checkpoint_version;
    return;
  end if;

  for v_row in select * from jsonb_to_recordset(p_candidates) as x(
    "productId" uuid, "releaseId" uuid, "relationshipPathIds" jsonb,
    "graphVersion" integer, "evaluatedAt" timestamptz
  ) loop
    if v_row."productId" is null or jsonb_typeof(v_row."relationshipPathIds") <> 'array'
       or v_row."graphVersion" <> v_job.graph_version
       or not exists(
         select 1 from public.products
          where organization_id = p_organization_id and id = v_row."productId"
       )
       or (
         v_row."releaseId" is not null
         and not exists(
           select 1 from public.product_releases
            where organization_id = p_organization_id
              and product_id = v_row."productId"
              and id = v_row."releaseId"
         )
       ) then
      return query select 'not_found'::text, 0::bigint, 0::bigint, 0::bigint, v_job.checkpoint_version;
      return;
    end if;
    select coalesce(array_agg(value::uuid order by ordinality), '{}'::uuid[])
      into v_path
      from jsonb_array_elements_text(v_row."relationshipPathIds") with ordinality;
    v_hash := encode(extensions.digest(v_row."relationshipPathIds"::text, 'sha256'), 'hex');
    insert into public.finding_impact_associations(
      organization_id, source_finding_id, affected_product_id, affected_release_id,
      relationship_path_ids, relationship_path_hash, source_graph_version,
      rule_version, status, last_evaluated_at, last_seen_job_id
    ) values (
      p_organization_id, v_job.source_finding_id, v_row."productId", v_row."releaseId",
      v_path, v_hash, v_job.graph_version, v_job.rule_version, 'active',
      coalesce(v_row."evaluatedAt", clock_timestamp()), v_job.id
    ) on conflict (
      organization_id, source_finding_id, affected_product_id, affected_release_id,
      relationship_path_hash, source_graph_version, rule_version
    ) do update set
      status = 'active',
      last_evaluated_at = excluded.last_evaluated_at,
      last_seen_job_id = excluded.last_seen_job_id,
      updated_at = clock_timestamp(),
      version = public.finding_impact_associations.version + 1;
    v_processed := v_processed + 1;
    v_upserted := v_upserted + 1;
  end loop;

  if p_is_final then
    update public.finding_impact_associations a
       set status = 'superseded',
           superseded_at = clock_timestamp(),
           updated_at = clock_timestamp(),
           version = a.version + 1
     where a.organization_id = p_organization_id
       and a.source_finding_id = v_job.source_finding_id
       and a.status = 'active'
       and a.last_seen_job_id is distinct from v_job.id;
    get diagnostics v_superseded = row_count;
  end if;

  update public.finding_propagation_jobs j
     set status = case when p_is_final then 'completed' else 'scheduled' end,
         cursor = case when p_is_final then null else p_next_cursor end,
         processed_count = j.processed_count + v_processed,
         upserted_count = j.upserted_count + v_upserted,
         superseded_count = j.superseded_count + v_superseded,
         checkpoint_version = j.checkpoint_version + 1,
         lease_owner = null,
         lease_expires_at = null,
         due_at = case when p_is_final then j.due_at else clock_timestamp() end
   where j.organization_id = p_organization_id
     and j.id = p_job_id
  returning j.checkpoint_version into v_job.checkpoint_version;
  insert into public.audit_logs(
    organization_id, user_id, action, entity_type, entity_id, changes
  ) values (
    p_organization_id, v_job.requested_by, 'finding.propagation_page_persisted',
    'finding_propagation_job', p_job_id::text,
    jsonb_build_object(
      'processedCount', v_processed,
      'upsertedCount', v_upserted,
      'supersededCount', v_superseded,
      'final', p_is_final
    )
  );
  return query select
    case when p_is_final then 'completed' else 'scheduled' end,
    v_processed, v_upserted, v_superseded, v_job.checkpoint_version;
end;
$$;

alter function public.persist_finding_propagation_page_atomic(
  uuid, uuid, uuid, integer, jsonb, text, boolean
) owner to postgres;
revoke all on function public.persist_finding_propagation_page_atomic(
  uuid, uuid, uuid, integer, jsonb, text, boolean
) from public, anon, authenticated;
grant execute on function public.persist_finding_propagation_page_atomic(
  uuid, uuid, uuid, integer, jsonb, text, boolean
) to service_role;
