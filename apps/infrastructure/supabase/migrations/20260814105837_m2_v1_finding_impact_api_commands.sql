alter table public.finding_product_impact_overrides
  add column idempotency_key uuid,
  add column idempotency_request_digest text,
  add column end_idempotency_key uuid,
  add column end_idempotency_request_digest text,
  add constraint finding_product_impact_overrides_idempotency_check check (
    (idempotency_key is null) = (idempotency_request_digest is null)
    and (end_idempotency_key is null) = (end_idempotency_request_digest is null)
    and (idempotency_request_digest is null or idempotency_request_digest ~ '^[a-f0-9]{64}$')
    and (end_idempotency_request_digest is null or end_idempotency_request_digest ~ '^[a-f0-9]{64}$')
  );
create unique index finding_product_impact_override_actor_idempotency_key
  on public.finding_product_impact_overrides(organization_id,created_by,idempotency_key)
  where idempotency_key is not null;
create unique index finding_product_impact_override_end_actor_idempotency_key
  on public.finding_product_impact_overrides(organization_id,ended_by,end_idempotency_key)
  where end_idempotency_key is not null;

create or replace function public.get_finding_product_impact_summary(
  p_organization_id uuid,p_product_id uuid,p_release_id uuid,p_actor_user_id uuid
) returns table(outcome text,summary jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_active integer;v_superseded integer;v_closed integer;v_overrides integer;v_graph integer;v_evaluated timestamptz;
  v_queued integer;v_leased integer;v_retrying integer;v_dead integer;v_state text;
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id)
     or (p_release_id is not null and not exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=p_product_id and id=p_release_id)) then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  select count(*) filter(where status='active'),count(*) filter(where status='superseded'),count(*) filter(where status='closed'),max(source_graph_version),max(last_evaluated_at)
    into v_active,v_superseded,v_closed,v_graph,v_evaluated from public.finding_impact_associations a
   where a.organization_id=p_organization_id and a.affected_product_id=p_product_id and (p_release_id is null or a.affected_release_id=p_release_id);
  select count(*) into v_overrides from public.finding_product_impact_overrides o where o.organization_id=p_organization_id and o.affected_product_id=p_product_id and (p_release_id is null or o.affected_release_id=p_release_id) and o.ended_at is null;
  select count(*) filter(where j.status='scheduled'),count(*) filter(where j.status='leased'),count(*) filter(where j.status='retrying'),count(*) filter(where j.status='dead_letter') into v_queued,v_leased,v_retrying,v_dead
    from public.finding_propagation_jobs j join public.finding_impact_associations a on a.organization_id=j.organization_id and a.source_finding_id=j.source_finding_id
   where j.organization_id=p_organization_id and a.affected_product_id=p_product_id and (p_release_id is null or a.affected_release_id=p_release_id);
  v_state:=case when v_dead>0 then 'partial_failure' when v_queued+v_leased+v_retrying>0 then 'in_progress' else 'idle' end;
  return query select 'found'::text,jsonb_build_object('productId',p_product_id,'releaseId',p_release_id,'activeImpactCount',v_active,'supersededImpactCount',v_superseded,'closedImpactCount',v_closed,'overrideCount',v_overrides,'latestGraphVersion',v_graph,'latestEvaluatedAt',case when v_evaluated is null then null else public.m2_utc_z(v_evaluated) end,'propagationState',v_state,'queuedJobCount',v_queued,'inProgressJobCount',v_leased,'retryingJobCount',v_retrying,'deadLetterJobCount',v_dead);
end;
$$;

create or replace function public.m2_finding_override_json(p_override public.finding_product_impact_overrides)
returns jsonb language sql stable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',p_override.id,'organizationId',p_override.organization_id,'sourceId',p_override.source_finding_id,'affectedProductId',p_override.affected_product_id,'affectedReleaseId',p_override.affected_release_id,'overrideState',p_override.override_state,'reason',p_override.reason,'source',p_override.source,'provenance',p_override.provenance,'effectiveStartsAt',public.m2_utc_z(p_override.effective_starts_at),'effectiveEndsAt',case when p_override.effective_ends_at is null then null else public.m2_utc_z(p_override.effective_ends_at) end,'version',p_override.version,'createdAt',public.m2_utc_z(p_override.created_at),'createdBy',p_override.created_by,'updatedAt',public.m2_utc_z(p_override.updated_at),'updatedBy',p_override.updated_by)
$$;

create or replace function public.create_finding_product_impact_override_atomic(
  p_organization_id uuid,p_source_finding_id uuid,p_product_id uuid,p_release_id uuid,p_actor_user_id uuid,p_override_state text,p_reason text,p_source text,p_provenance text,p_effective_starts_at timestamptz,p_effective_ends_at timestamptz,p_idempotency_key uuid,p_correlation_id uuid
) returns table(outcome text,override jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_override public.finding_product_impact_overrides%rowtype;v_digest text;
begin
  if p_idempotency_key is null or p_effective_starts_at is null or (p_effective_ends_at is not null and p_effective_ends_at<=p_effective_starts_at) or char_length(btrim(coalesce(p_reason,'')))=0 or char_length(btrim(coalesce(p_source,'')))=0 or char_length(btrim(coalesce(p_provenance,'')))=0 or not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'invalid_request'::text,null::jsonb;return;end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('sourceId',p_source_finding_id,'productId',p_product_id,'releaseId',p_release_id,'overrideState',p_override_state,'reason',btrim(p_reason),'source',btrim(p_source),'provenance',btrim(p_provenance),'startsAt',public.m2_utc_z(p_effective_starts_at),'endsAt',case when p_effective_ends_at is null then null else public.m2_utc_z(p_effective_ends_at) end)::text,'sha256'),'hex');
  select * into v_override from public.finding_product_impact_overrides o where o.organization_id=p_organization_id and o.created_by=p_actor_user_id and o.idempotency_key=p_idempotency_key for update;
  if found then if v_override.idempotency_request_digest=v_digest then return query select 'replayed'::text,public.m2_finding_override_json(v_override);else return query select 'idempotency_mismatch'::text,null::jsonb;end if;return;end if;
  if not exists(select 1 from public.finding_propagation_sources where organization_id=p_organization_id and id=p_source_finding_id) or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id) or (p_release_id is not null and not exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=p_product_id and id=p_release_id)) then return query select 'not_found'::text,null::jsonb;return;end if;
  insert into public.finding_product_impact_overrides(organization_id,source_finding_id,affected_product_id,affected_release_id,override_state,reason,source,provenance,effective_starts_at,effective_ends_at,idempotency_key,idempotency_request_digest,created_by,updated_by) values(p_organization_id,p_source_finding_id,p_product_id,p_release_id,p_override_state,btrim(p_reason),btrim(p_source),btrim(p_provenance),p_effective_starts_at,p_effective_ends_at,p_idempotency_key,v_digest,p_actor_user_id,p_actor_user_id) returning * into v_override;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'finding.product_impact_override_created','finding_product_impact_override',v_override.id::text,jsonb_build_object('after',public.m2_finding_override_json(v_override),'correlationId',p_correlation_id));
  return query select 'created'::text,public.m2_finding_override_json(v_override);
exception when unique_violation then return query select 'conflict'::text,null::jsonb;end;
$$;

alter function public.get_finding_product_impact_summary(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.m2_finding_override_json(public.finding_product_impact_overrides) owner to postgres;
alter function public.create_finding_product_impact_override_atomic(uuid,uuid,uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz,uuid,uuid) owner to postgres;
revoke all on function public.get_finding_product_impact_summary(uuid,uuid,uuid,uuid),public.m2_finding_override_json(public.finding_product_impact_overrides),public.create_finding_product_impact_override_atomic(uuid,uuid,uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_finding_product_impact_summary(uuid,uuid,uuid,uuid),public.create_finding_product_impact_override_atomic(uuid,uuid,uuid,uuid,uuid,text,text,text,text,timestamptz,timestamptz,uuid,uuid) to service_role;
