-- Roll-forward cleanup for the V1 variant command. This preserves the public
-- signature and behavior while avoiding unused row variables in the function.
create or replace function public.create_product_variant_relationship_atomic(
  p_organization_id uuid, p_base_release_id uuid, p_baseline_revision_id uuid,
  p_variant_product_id uuid, p_variant_release_id uuid, p_actor_user_id uuid,
  p_expected_graph_version integer, p_source text, p_provenance text, p_reason text,
  p_effective_starts_at timestamptz, p_effective_ends_at timestamptz,
  p_idempotency_key uuid, p_correlation_id uuid
) returns table(outcome text,relationship jsonb,graph_version integer)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_base_release public.product_releases%rowtype; v_relation public.product_relationships%rowtype;
  v_replay public.product_relationships%rowtype; v_lock_outcome text; v_current_graph integer; v_next_graph integer; v_digest text;
begin
  if p_idempotency_key is null or ((p_base_release_id is null)=(p_baseline_revision_id is null))
    or p_effective_starts_at is null or (p_effective_ends_at is not null and p_effective_ends_at<=p_effective_starts_at)
    or char_length(btrim(coalesce(p_source,'')))=0 or char_length(btrim(coalesce(p_provenance,'')))=0 or char_length(btrim(coalesce(p_reason,'')))=0 then
    return query select 'invalid_request'::text,null::jsonb,null::integer; return;
  end if;
  select lock_result.outcome, lock_result.graph_version into v_lock_outcome, v_current_graph from public.m2_lock_relationship_graph(p_organization_id,p_expected_graph_version,p_actor_user_id) lock_result;
  if v_lock_outcome<>'found' then return query select v_lock_outcome,null::jsonb,v_current_graph; return; end if;
  perform 1 from public.product_releases where organization_id=p_organization_id and product_id=p_variant_product_id and id=p_variant_release_id and archived_at is null for update;
  if not found then return query select 'not_found'::text,null::jsonb,null::integer; return; end if;
  if p_base_release_id is not null then
    select * into v_base_release from public.product_releases where organization_id=p_organization_id and id=p_base_release_id and archived_at is null for update;
    if not found or v_base_release.product_id=p_variant_product_id then return query select 'not_found'::text,null::jsonb,null::integer; return; end if;
  else
    perform 1 from public.software_baselines where organization_id=p_organization_id and id=p_baseline_revision_id and archived_at is null for update;
    if not found then return query select 'not_found'::text,null::jsonb,null::integer; return; end if;
  end if;
  v_digest:=public.m2_relationship_digest(jsonb_build_object('action','createVariant','baseReleaseId',p_base_release_id,'baselineRevisionId',p_baseline_revision_id,'variantProductId',p_variant_product_id,'variantReleaseId',p_variant_release_id,'expectedGraphVersion',p_expected_graph_version,'source',btrim(p_source),'provenance',btrim(p_provenance),'reason',btrim(p_reason),'effectiveStartsAt',public.m2_utc_z(p_effective_starts_at),'effectiveEndsAt',case when p_effective_ends_at is null then null else public.m2_utc_z(p_effective_ends_at) end));
  select * into v_replay from public.product_relationships where organization_id=p_organization_id and created_by=p_actor_user_id and idempotency_key=p_idempotency_key for update;
  if found then
    if v_replay.idempotency_request_digest=v_digest then return query select 'replayed'::text,public.m2_product_relationship_json(v_replay),v_replay.graph_version; end if;
    return query select 'idempotency_mismatch'::text,null::jsonb,null::integer; return;
  end if;
  v_next_graph:=public.m2_bump_relationship_graph(p_organization_id,p_actor_user_id);
  insert into public.product_relationships(organization_id,relationship_type,source_type,source_product_id,target_product_id,source_release_id,target_release_id,baseline_revision_id,source,provenance,reason,effective_starts_at,effective_ends_at,created_by,updated_by,graph_version,idempotency_key,idempotency_request_digest)
  values(p_organization_id,'variant',case when p_base_release_id is null then 'baseline_revision' else 'base_release' end,
    case when p_base_release_id is null then null else v_base_release.product_id end,p_variant_product_id,p_base_release_id,p_variant_release_id,p_baseline_revision_id,btrim(p_source),btrim(p_provenance),btrim(p_reason),p_effective_starts_at,p_effective_ends_at,p_actor_user_id,p_actor_user_id,v_next_graph,p_idempotency_key,v_digest) returning * into v_relation;
  perform public.m2_relationship_graph_event_atomic(p_organization_id,p_variant_product_id,v_next_graph,'variant_relationship',v_relation.id,p_correlation_id,jsonb_build_object('action','created','relationshipId',v_relation.id));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.variant_relationship_created','product_relationship',v_relation.id::text,jsonb_build_object('after',public.m2_product_relationship_json(v_relation),'graphVersion',v_next_graph,'correlationId',p_correlation_id,'requestDigest',v_digest));
  return query select 'created'::text,public.m2_product_relationship_json(v_relation),v_next_graph;
exception when unique_violation then return query select 'conflict'::text,null::jsonb,null::integer;
end;
$$;
