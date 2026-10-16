-- M6-05 API completion: read models expose no storage paths except to the
-- trusted service-role adapter, and bind a filing proof to its package.

create or replace function public.get_reporting_stage_evidence_api(
  p_organization_id uuid, p_actor_user_id uuid, p_stage_id uuid
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_stage public.reporting_obligation_stages%rowtype;
begin
  if not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings') then
    return query select 'not_found',null::jsonb; return;
  end if;
  select * into v_stage from public.reporting_obligation_stages
    where organization_id=p_organization_id and id=p_stage_id;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  return query select 'found', jsonb_build_object(
    'obligationId',v_stage.obligation_id,
    'stageId',v_stage.id,
    'stage',v_stage.stage_kind,
    'approval',(select jsonb_build_object(
      'id',a.id,'draftId',a.draft_id,'draftRevision',a.draft_revision,'draftHash',a.draft_hash,'state','approved',
      'requestedBy',jsonb_build_object('userId',d.created_by_user_id,'displayName',public.m6_actor_display_name(d.created_by_user_id)),
      'requestedAt',public.m6_utc_second_z(d.created_at),
      'decidedBy',jsonb_build_object('userId',a.approved_by_user_id,'displayName',public.m6_actor_display_name(a.approved_by_user_id)),
      'decidedAt',public.m6_utc_second_z(a.approved_at),'segregationOfDutiesOverrideReason',a.segregation_of_duties_override_reason
    ) from public.reporting_stage_approvals a join public.reporting_stage_drafts d on d.organization_id=a.organization_id and d.id=a.draft_id
      where a.organization_id=p_organization_id and a.stage_id=v_stage.id order by a.approved_at desc limit 1),
    'packages',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'organizationId',p.organization_id,'obligationId',p.obligation_id,
      'stageId',p.stage_id,'approvalId',p.approval_id,'state',p.state,
      'objectPath',p.storage_object_path,'sha256',p.sha256,'byteLength',p.byte_size,
      'manifestSha256',p.manifest_sha256,'keyId',p.signing_key_id,
      'signature',p.detached_signature,'fingerprint',p.public_key_fingerprint,
      'createdAt',public.m6_utc_second_z(p.reserved_at),'completedAt',case when p.finalized_at is null then null else public.m6_utc_second_z(p.finalized_at) end
    ) order by p.reserved_at,p.id) from public.reporting_stage_packages p
      where p.organization_id=p_organization_id and p.stage_id=v_stage.id),'[]'::jsonb),
    'submission',(select jsonb_build_object(
      'id',s.id,'organizationId',s.organization_id,'obligationId',s.obligation_id,'stageId',s.stage_id,
      'stage',v_stage.stage_kind,'packageId',s.package_id,'approvalId',s.approval_id,
      'submissionReference',s.submission_reference,'submittedAt',public.m6_utc_second_z(s.submitted_at),
      'submittedAtBasis',s.actual_submission_basis,'receipt',jsonb_build_object(
        'id',s.id,'fileName',s.proof_filename,'mimeType',s.proof_mime_type,'byteLength',s.proof_byte_size,
        'sha256',s.proof_sha256,'uploadedAt',public.m6_utc_second_z(s.created_at)),
      'submittedBy',jsonb_build_object('userId',s.submitted_by_user_id,'displayName',public.m6_actor_display_name(s.submitted_by_user_id)),
      'recordedAt',public.m6_utc_second_z(s.created_at),'isLate',s.submitted_at > v_stage.due_at
    ) from public.reporting_stage_submissions s where s.organization_id=p_organization_id and s.stage_id=v_stage.id),
    'acknowledgements',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'organizationId',a.organization_id,'submissionId',a.submission_id,
      'acknowledgedAt',public.m6_utc_second_z(a.acknowledged_at),'acknowledgementReference',a.acknowledgement_reference,
      'acknowledgementBasis',a.notes,'recordedBy',jsonb_build_object('userId',a.recorded_by_user_id,'displayName',public.m6_actor_display_name(a.recorded_by_user_id)),
      'recordedAt',public.m6_utc_second_z(a.created_at)
    ) order by a.acknowledged_at,a.id) from public.reporting_stage_submission_acknowledgements a
      join public.reporting_stage_submissions s on s.organization_id=a.organization_id and s.id=a.submission_id
      where a.organization_id=p_organization_id and s.stage_id=v_stage.id),'[]'::jsonb),
    'timeline',coalesce((select jsonb_agg(jsonb_build_object(
      'id',e.id,'kind',case e.event_kind
        when 'stage_approved' then 'approval_recorded'
        when 'package_available' then 'package_generated'
        when 'filing_recorded' then 'external_filing_recorded'
        when 'stage_overdue' then 'deadline_breached'
        when 'cancelled' then 'obligation_cancelled'
        else e.event_kind end,
      'occurredAt',public.m6_utc_second_z(e.occurred_at),'recordedAt',public.m6_utc_second_z(e.occurred_at),
      'actor',case when e.actor_user_id is null then null else jsonb_build_object('userId',e.actor_user_id,'displayName',coalesce(e.actor_display_name,public.m6_actor_display_name(e.actor_user_id))) end,
      'stage',e.stage_kind,'summary',left(e.event_kind,2000),'contentSha256',e.new_value->>'draftHash'
    ) order by e.occurred_at,e.id) from public.reporting_obligation_events e
      where e.organization_id=p_organization_id and e.obligation_id=v_stage.obligation_id),'[]'::jsonb)
  );
end $$;

create or replace function public.get_reporting_submission_acknowledgement_api(
  p_organization_id uuid,p_actor_user_id uuid,p_submission_id uuid
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings') then return query select 'not_found',null::jsonb;return;end if;
 return query select 'found',jsonb_build_object('acknowledgement',jsonb_build_object(
  'id',a.id,'organizationId',a.organization_id,'submissionId',a.submission_id,
  'acknowledgedAt',public.m6_utc_second_z(a.acknowledged_at),'acknowledgementReference',a.acknowledgement_reference,
  'acknowledgementBasis',a.notes,'recordedBy',jsonb_build_object('userId',a.recorded_by_user_id,'displayName',public.m6_actor_display_name(a.recorded_by_user_id)),
  'recordedAt',public.m6_utc_second_z(a.created_at)))
 from public.reporting_stage_submission_acknowledgements a where a.organization_id=p_organization_id and a.submission_id=p_submission_id order by a.created_at desc limit 1;
 if not found then return query select 'not_found',null::jsonb; end if;
end $$;

create or replace function public.get_reporting_obligation_evidence_pack_api(
 p_organization_id uuid,p_actor_user_id uuid,p_obligation_id uuid,p_evidence_pack_id uuid
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings') then return query select 'not_found',null::jsonb;return;end if;
 return query select 'found',jsonb_build_object('evidencePack',jsonb_build_object(
  'id',p.id,'organizationId',p.organization_id,'obligationId',p.obligation_id,'state',p.state,'objectPath',p.storage_object_path,
  'sha256',p.sha256,'byteLength',p.byte_size,'manifestSha256',p.manifest_sha256,
  'createdAt',public.m6_utc_second_z(p.created_at),'completedAt',case when p.finalized_at is null then null else public.m6_utc_second_z(p.finalized_at) end))
 from public.reporting_obligation_evidence_packs p where p.organization_id=p_organization_id and p.obligation_id=p_obligation_id and p.id=p_evidence_pack_id;
 if not found then return query select 'not_found',null::jsonb;end if;
end $$;

do $$
declare v_definition text;
begin
 select pg_get_functiondef('public.record_reporting_stage_filing_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamp with time zone,text,text,text,text,bigint,text,text,uuid,uuid)'::regprocedure) into v_definition;
 v_definition := replace(v_definition,
   'or f.package_id<>p.id or f.approval_id<>a.id',
   'or f.action_digest<>encode(extensions.digest(jsonb_build_object(''packageId'',p_package_id)::text,''sha256''),''hex'') or f.package_id<>p.id or f.approval_id<>a.id');
 execute v_definition;
end $$;

alter function public.get_reporting_stage_evidence_api(uuid,uuid,uuid) owner to postgres;
alter function public.get_reporting_submission_acknowledgement_api(uuid,uuid,uuid) owner to postgres;
alter function public.get_reporting_obligation_evidence_pack_api(uuid,uuid,uuid,uuid) owner to postgres;
revoke all on function public.get_reporting_stage_evidence_api(uuid,uuid,uuid),public.get_reporting_submission_acknowledgement_api(uuid,uuid,uuid),public.get_reporting_obligation_evidence_pack_api(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_reporting_stage_evidence_api(uuid,uuid,uuid),public.get_reporting_submission_acknowledgement_api(uuid,uuid,uuid),public.get_reporting_obligation_evidence_pack_api(uuid,uuid,uuid,uuid) to service_role;
