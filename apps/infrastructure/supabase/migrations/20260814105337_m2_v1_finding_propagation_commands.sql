create or replace function public.register_finding_propagation_source_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_source_system text,
  p_source_finding_key text, p_source_product_id uuid, p_source_release_id uuid,
  p_source_baseline_revision_id uuid, p_rule_version text, p_source text,
  p_provenance text, p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text, source jsonb, job_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_source public.finding_propagation_sources%rowtype; v_existing public.finding_propagation_sources%rowtype;
  v_graph_version integer; v_digest text; v_job_id uuid;
begin
  if p_idempotency_key is null or (p_source_release_id is null) = (p_source_baseline_revision_id is null)
     or not public.m2_active_member(p_organization_id, p_actor_user_id)
     or char_length(btrim(coalesce(p_source_system,''))) not between 1 and 100
     or char_length(btrim(coalesce(p_source_finding_key,''))) not between 1 and 256
     or char_length(btrim(coalesce(p_rule_version,''))) not between 1 and 100
     or char_length(btrim(coalesce(p_source,''))) not between 1 and 1000
     or char_length(btrim(coalesce(p_provenance,''))) not between 1 and 1000 then
    return query select 'invalid_request'::text, null::jsonb, null::uuid; return;
  end if;
  if not exists (select 1 from public.products where organization_id=p_organization_id and id=p_source_product_id)
     or (p_source_release_id is not null and not exists (
       select 1 from public.product_releases where organization_id=p_organization_id
         and product_id=p_source_product_id and id=p_source_release_id))
     or (p_source_baseline_revision_id is not null and not exists (
       select 1 from public.software_baselines where organization_id=p_organization_id and id=p_source_baseline_revision_id)) then
    return query select 'not_found'::text, null::jsonb, null::uuid; return;
  end if;
  v_digest := encode(extensions.digest(jsonb_build_object(
    'sourceSystem',btrim(p_source_system),'sourceFindingKey',btrim(p_source_finding_key),
    'sourceProductId',p_source_product_id,'sourceReleaseId',p_source_release_id,
    'sourceBaselineRevisionId',p_source_baseline_revision_id,'ruleVersion',btrim(p_rule_version),
    'source',btrim(p_source),'provenance',btrim(p_provenance)
  )::text, 'sha256'), 'hex');
  select * into v_existing from public.finding_propagation_sources
   where organization_id=p_organization_id and created_by=p_actor_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_existing.idempotency_request_digest <> v_digest then
      return query select 'idempotency_mismatch'::text, null::jsonb, null::uuid; return;
    end if;
    select id into v_job_id from public.finding_propagation_jobs
     where organization_id=p_organization_id and trigger_key='source:'||v_existing.id::text||':registered';
    return query select 'replayed'::text, jsonb_build_object('id',v_existing.id,'organizationId',v_existing.organization_id,'status',v_existing.status,'version',v_existing.version), v_job_id; return;
  end if;
  insert into public.finding_propagation_sources(
    organization_id,source_system,source_finding_key,source_product_id,source_release_id,
    source_baseline_revision_id,rule_version,source,provenance,idempotency_key,
    idempotency_request_digest,created_by,updated_by
  ) values (
    p_organization_id,btrim(p_source_system),btrim(p_source_finding_key),p_source_product_id,p_source_release_id,
    p_source_baseline_revision_id,btrim(p_rule_version),btrim(p_source),btrim(p_provenance),p_idempotency_key,
    v_digest,p_actor_user_id,p_actor_user_id
  ) returning * into v_source;
  select product_relationship_graph_version into v_graph_version from public.organization_settings where organization_id=p_organization_id;
  insert into public.finding_propagation_jobs(
    organization_id,source_finding_id,trigger_key,graph_version,source_release_id,
    source_baseline_revision_id,rule_version,as_of,requested_by
  ) values (
    p_organization_id,v_source.id,'source:'||v_source.id::text||':registered',v_graph_version,
    v_source.source_release_id,v_source.source_baseline_revision_id,v_source.rule_version,clock_timestamp(),p_actor_user_id
  ) returning id into v_job_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'finding.propagation_source_registered','finding_propagation_source',v_source.id::text,
    jsonb_build_object('after',jsonb_build_object('status',v_source.status,'ruleVersion',v_source.rule_version,'sourceSystem',v_source.source_system),'jobId',v_job_id,'correlationId',p_correlation_id));
  return query select 'created'::text, jsonb_build_object('id',v_source.id,'organizationId',v_source.organization_id,'status',v_source.status,'version',v_source.version), v_job_id;
exception when unique_violation then return query select 'conflict'::text,null::jsonb,null::uuid;
end;
$$;

create or replace function public.enqueue_finding_propagation_jobs_atomic(
  p_organization_id uuid, p_trigger_key text, p_graph_version integer,
  p_source_release_id uuid, p_source_baseline_revision_id uuid, p_as_of timestamptz
) returns table(outcome text, enqueued_count integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer := 0;
begin
  if p_organization_id is null or p_graph_version is null
     or (p_source_release_id is null) = (p_source_baseline_revision_id is null)
     or char_length(btrim(coalesce(p_trigger_key,''))) not between 1 and 240 then
    return query select 'invalid_request'::text, 0; return;
  end if;
  insert into public.finding_propagation_jobs(
    organization_id,source_finding_id,trigger_key,graph_version,source_release_id,
    source_baseline_revision_id,rule_version,as_of,requested_by
  ) select s.organization_id,s.id,btrim(p_trigger_key)||':'||s.id::text,p_graph_version,
    s.source_release_id,s.source_baseline_revision_id,s.rule_version,coalesce(p_as_of,clock_timestamp()),s.updated_by
    from public.finding_propagation_sources s
   where s.organization_id=p_organization_id and s.status='active'
     and ((p_source_release_id is not null and s.source_release_id=p_source_release_id)
       or (p_source_baseline_revision_id is not null and s.source_baseline_revision_id=p_source_baseline_revision_id))
  on conflict (organization_id,trigger_key) do nothing;
  get diagnostics v_count = row_count;
  return query select 'enqueued'::text, v_count;
end;
$$;

create or replace function public.persist_finding_propagation_page_atomic(
  p_organization_id uuid, p_job_id uuid, p_lease_owner uuid,
  p_expected_checkpoint_version integer, p_candidates jsonb, p_next_cursor text,
  p_is_final boolean
) returns table(outcome text, processed_count bigint, upserted_count bigint, superseded_count bigint, checkpoint_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.finding_propagation_jobs%rowtype; v_row record; v_path uuid[]; v_hash text;
  v_processed bigint := 0; v_upserted bigint := 0; v_superseded bigint := 0;
begin
  if p_organization_id is null or p_job_id is null or p_lease_owner is null
     or p_expected_checkpoint_version is null or jsonb_typeof(p_candidates) <> 'array'
     or p_is_final is null then
    return query select 'invalid_request'::text,0::bigint,0::bigint,0::bigint,null::integer; return;
  end if;
  select * into v_job from public.finding_propagation_jobs j
   where j.organization_id=p_organization_id and j.id=p_job_id for update;
  if not found then return query select 'not_found'::text,0::bigint,0::bigint,0::bigint,null::integer; return; end if;
  if v_job.status <> 'leased' or v_job.lease_owner is distinct from p_lease_owner
     or v_job.checkpoint_version <> p_expected_checkpoint_version
     or v_job.lease_expires_at <= clock_timestamp() then
    return query select 'conflict'::text,0::bigint,0::bigint,0::bigint,v_job.checkpoint_version; return;
  end if;
  for v_row in select * from jsonb_to_recordset(p_candidates) as x(
    "productId" uuid, "releaseId" uuid, "relationshipPathIds" jsonb,
    "graphVersion" integer, "evaluatedAt" timestamptz
  ) loop
    if v_row."productId" is null or jsonb_typeof(v_row."relationshipPathIds") <> 'array'
       or v_row."graphVersion" <> v_job.graph_version
       or not exists(select 1 from public.products where organization_id=p_organization_id and id=v_row."productId")
       or (v_row."releaseId" is not null and not exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=v_row."productId" and id=v_row."releaseId")) then
      return query select 'not_found'::text,0::bigint,0::bigint,0::bigint,v_job.checkpoint_version; return;
    end if;
    select coalesce(array_agg(value::uuid order by ordinality),'{}'::uuid[]) into v_path
      from jsonb_array_elements_text(v_row."relationshipPathIds") with ordinality;
    v_hash := encode(extensions.digest(v_row."relationshipPathIds"::text, 'sha256'),'hex');
    insert into public.finding_impact_associations(
      organization_id,source_finding_id,affected_product_id,affected_release_id,
      relationship_path_ids,relationship_path_hash,source_graph_version,rule_version,
      status,last_evaluated_at,last_seen_job_id
    ) values (
      p_organization_id,v_job.source_finding_id,v_row."productId",v_row."releaseId",
      v_path,v_hash,v_job.graph_version,v_job.rule_version,'active',coalesce(v_row."evaluatedAt",clock_timestamp()),v_job.id
    ) on conflict (organization_id,source_finding_id,affected_product_id,affected_release_id,relationship_path_hash,source_graph_version,rule_version)
    do update set status='active',last_evaluated_at=excluded.last_evaluated_at,last_seen_job_id=excluded.last_seen_job_id,updated_at=clock_timestamp(),version=public.finding_impact_associations.version+1;
    v_processed := v_processed + 1; v_upserted := v_upserted + 1;
  end loop;
  if p_is_final then
    update public.finding_impact_associations a set status='superseded',superseded_at=clock_timestamp(),updated_at=clock_timestamp(),version=a.version+1
     where a.organization_id=p_organization_id and a.source_finding_id=v_job.source_finding_id
       and a.status='active' and a.last_seen_job_id is distinct from v_job.id;
    get diagnostics v_superseded = row_count;
  end if;
  update public.finding_propagation_jobs j set
    status=case when p_is_final then 'completed' else 'scheduled' end,
    cursor=case when p_is_final then null else p_next_cursor end,
    processed_count=j.processed_count+v_processed,upserted_count=j.upserted_count+v_upserted,
    superseded_count=j.superseded_count+v_superseded,checkpoint_version=j.checkpoint_version+1,
    lease_owner=null,lease_expires_at=null,due_at=case when p_is_final then j.due_at else clock_timestamp() end
   where j.organization_id=p_organization_id and j.id=p_job_id returning checkpoint_version into v_job.checkpoint_version;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,v_job.requested_by,'finding.propagation_page_persisted','finding_propagation_job',p_job_id::text,
    jsonb_build_object('processedCount',v_processed,'upsertedCount',v_upserted,'supersededCount',v_superseded,'final',p_is_final));
  return query select case when p_is_final then 'completed' else 'scheduled' end,v_processed,v_upserted,v_superseded,v_job.checkpoint_version;
end;
$$;

create or replace function public.fail_finding_propagation_job_atomic(
  p_organization_id uuid,p_job_id uuid,p_lease_owner uuid,p_expected_checkpoint_version integer,
  p_error_code text,p_retryable boolean
) returns table(outcome text, checkpoint_version integer, error_code text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_job public.finding_propagation_jobs%rowtype; v_code text := lower(btrim(p_error_code)); v_state text;
begin
  if p_organization_id is null or p_job_id is null or p_lease_owner is null or p_expected_checkpoint_version is null
     or p_retryable is null or v_code !~ '^[a-z0-9][a-z0-9_.:-]{0,99}$' then
    return query select 'invalid_request'::text,null::integer,null::text; return;
  end if;
  select * into v_job from public.finding_propagation_jobs j where j.organization_id=p_organization_id and j.id=p_job_id for update;
  if not found then return query select 'not_found'::text,null::integer,null::text; return; end if;
  if v_job.status <> 'leased' or v_job.lease_owner is distinct from p_lease_owner or v_job.checkpoint_version <> p_expected_checkpoint_version or v_job.lease_expires_at <= clock_timestamp() then
    return query select 'conflict'::text,v_job.checkpoint_version,v_job.last_error_code; return;
  end if;
  v_state := case when not p_retryable or v_job.delivery_attempts >= 12 then 'dead_letter' else 'retrying' end;
  update public.finding_propagation_jobs j set status=v_state,lease_owner=null,lease_expires_at=null,last_error_code=v_code,
    due_at=case when v_state='dead_letter' then j.due_at else clock_timestamp()+make_interval(secs=>least(3600,30*power(2,least(j.delivery_attempts,7))::integer)) end
   where j.organization_id=p_organization_id and j.id=p_job_id returning checkpoint_version into v_job.checkpoint_version;
  return query select case when v_state='dead_letter' then 'dead_letter' else 'retry_scheduled' end,v_job.checkpoint_version,v_code;
end;
$$;

alter function public.register_finding_propagation_source_atomic(uuid,uuid,text,text,uuid,uuid,uuid,text,text,text,uuid,uuid) owner to postgres;
alter function public.enqueue_finding_propagation_jobs_atomic(uuid,text,integer,uuid,uuid,timestamptz) owner to postgres;
alter function public.persist_finding_propagation_page_atomic(uuid,uuid,uuid,integer,jsonb,text,boolean) owner to postgres;
alter function public.fail_finding_propagation_job_atomic(uuid,uuid,uuid,integer,text,boolean) owner to postgres;
revoke all on function public.register_finding_propagation_source_atomic(uuid,uuid,text,text,uuid,uuid,uuid,text,text,text,uuid,uuid), public.enqueue_finding_propagation_jobs_atomic(uuid,text,integer,uuid,uuid,timestamptz), public.persist_finding_propagation_page_atomic(uuid,uuid,uuid,integer,jsonb,text,boolean), public.fail_finding_propagation_job_atomic(uuid,uuid,uuid,integer,text,boolean) from public, anon, authenticated;
grant execute on function public.register_finding_propagation_source_atomic(uuid,uuid,text,text,uuid,uuid,uuid,text,text,text,uuid,uuid), public.enqueue_finding_propagation_jobs_atomic(uuid,text,integer,uuid,uuid,timestamptz), public.persist_finding_propagation_page_atomic(uuid,uuid,uuid,integer,jsonb,text,boolean), public.fail_finding_propagation_job_atomic(uuid,uuid,uuid,integer,text,boolean) to service_role;
