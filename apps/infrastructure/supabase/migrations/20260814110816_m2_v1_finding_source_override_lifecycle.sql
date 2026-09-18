create or replace function public.obsolete_finding_propagation_job_atomic(
  p_organization_id uuid,p_job_id uuid,p_lease_owner uuid,p_expected_checkpoint_version integer,p_reason text
) returns table(outcome text,checkpoint_version integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.finding_propagation_jobs%rowtype;
begin
  if p_organization_id is null or p_job_id is null or p_lease_owner is null or p_expected_checkpoint_version is null or char_length(btrim(coalesce(p_reason,''))) not between 1 and 100 then return query select 'invalid_request'::text,null::integer;return;end if;
  select * into v_job from public.finding_propagation_jobs j where j.organization_id=p_organization_id and j.id=p_job_id for update;
  if not found then return query select 'not_found'::text,null::integer;return;end if;
  if v_job.status<>'leased' or v_job.lease_owner is distinct from p_lease_owner or v_job.checkpoint_version<>p_expected_checkpoint_version or v_job.lease_expires_at<=clock_timestamp() then return query select 'conflict'::text,v_job.checkpoint_version;return;end if;
  update public.finding_propagation_jobs j set status='obsolete',lease_owner=null,lease_expires_at=null,checkpoint_version=j.checkpoint_version+1,last_error_code='stale_graph' where j.organization_id=p_organization_id and j.id=p_job_id returning j.checkpoint_version into v_job.checkpoint_version;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,v_job.requested_by,'finding.propagation_job_obsoleted','finding_propagation_job',p_job_id::text,jsonb_build_object('reason',btrim(p_reason),'checkpointVersion',v_job.checkpoint_version));
  return query select 'obsolete'::text,v_job.checkpoint_version;
end;
$$;

create or replace function public.m2_finding_override_json(p_override public.finding_product_impact_overrides)
returns jsonb language sql stable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',p_override.id,'organizationId',p_override.organization_id,'sourceId',p_override.source_finding_id,'affectedProductId',p_override.affected_product_id,'affectedReleaseId',p_override.affected_release_id,'overrideState',p_override.override_state,'reason',p_override.reason,'source',p_override.source,'provenance',p_override.provenance,'effectiveStartsAt',public.m2_utc_z(p_override.effective_starts_at),'effectiveEndsAt',case when p_override.effective_ends_at is null then null else public.m2_utc_z(p_override.effective_ends_at) end,'endedAt',case when p_override.ended_at is null then null else public.m2_utc_z(p_override.ended_at) end,'endedBy',p_override.ended_by,'endReason',p_override.end_reason,'version',p_override.version,'createdAt',public.m2_utc_z(p_override.created_at),'createdBy',p_override.created_by,'updatedAt',public.m2_utc_z(p_override.updated_at),'updatedBy',p_override.updated_by)
$$;

alter function public.obsolete_finding_propagation_job_atomic(uuid,uuid,uuid,integer,text) owner to postgres;
alter function public.m2_finding_override_json(public.finding_product_impact_overrides) owner to postgres;
revoke all on function public.obsolete_finding_propagation_job_atomic(uuid,uuid,uuid,integer,text),public.m2_finding_override_json(public.finding_product_impact_overrides) from public,anon,authenticated;
grant execute on function public.obsolete_finding_propagation_job_atomic(uuid,uuid,uuid,integer,text) to service_role;
