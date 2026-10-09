-- M6-04: report approval is an explicit, freshly reauthenticated action.
-- This is intentionally reporting-owned: lifecycle reauthentication grants are
-- tied to organization lifecycle versions and must not authorize reports.

create table public.reporting_stage_approval_proofs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  draft_id uuid not null references public.reporting_stage_drafts(id) on delete cascade,
  actor_user_id uuid not null references public.users(id),
  session_id uuid not null,
  draft_revision integer not null check (draft_revision > 0),
  draft_hash text not null check (draft_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check (expires_at > created_at),
  check ((consumed_at is null) or consumed_at >= created_at)
);

create index reporting_stage_approval_proofs_scope_idx
  on public.reporting_stage_approval_proofs(organization_id, actor_user_id, session_id, expires_at)
  where consumed_at is null;

create table public.reporting_stage_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  obligation_id uuid not null,
  stage_id uuid not null,
  draft_id uuid not null references public.reporting_stage_drafts(id),
  draft_revision integer not null check (draft_revision > 0),
  draft_hash text not null check (draft_hash ~ '^[a-f0-9]{64}$'),
  approved_by_user_id uuid not null references public.users(id),
  segregation_of_duties_override_reason text,
  approved_at timestamptz not null default clock_timestamp(),
  unique (organization_id, stage_id),
  foreign key (organization_id, obligation_id)
    references public.reporting_obligations(organization_id, id),
  foreign key (organization_id, stage_id)
    references public.reporting_obligation_stages(organization_id, id)
);

alter table public.reporting_stage_approval_proofs enable row level security;
alter table public.reporting_stage_approvals enable row level security;
revoke all on table public.reporting_stage_approval_proofs, public.reporting_stage_approvals from public, anon, authenticated;
grant all on table public.reporting_stage_approval_proofs, public.reporting_stage_approvals to service_role;

create or replace function public.m6_reporting_draft_hash(p_draft public.reporting_stage_drafts)
returns text language sql immutable set search_path = public, pg_temp as $$
  select encode(extensions.digest(jsonb_build_object(
    'content', p_draft.content,
    'fieldProvenance', p_draft.field_provenance,
    'memberStates', p_draft.member_states
  )::text, 'sha256'), 'hex')
$$;

-- Keep SQL authorization aligned with the shared permission matrix. Custom
-- roles and hard organization overrides retain their existing merge order.
create or replace function public.m5_triage_actor_has_permission(
  p_organization_id uuid, p_actor_user_id uuid, p_permission_key text
) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with membership as (
    select member.role from public.organization_members member
    join public.users user_record on user_record.id = member.user_id and user_record.is_active
    join public.organizations organization on organization.id = member.organization_id and organization.is_active
    where member.organization_id = p_organization_id and member.user_id = p_actor_user_id
  ), base_permissions as (
    select role, case p_permission_key
      when 'can_edit_findings' then role in ('owner','admin')
      when 'can_edit_organization' then role = 'owner'
      when 'can_submit_reporting' then role in ('owner','admin')
      else false end as granted from membership
  ), custom_permissions as (
    select bool_or((custom_role.permissions ->> p_permission_key)::boolean) as granted
    from membership join public.user_role_assignments assignment
      on assignment.organization_id=p_organization_id and assignment.user_id=p_actor_user_id
    join public.custom_roles custom_role on custom_role.organization_id=p_organization_id and custom_role.id=assignment.role_id
    where custom_role.is_active and not custom_role.is_deleted
      and jsonb_typeof(custom_role.permissions -> p_permission_key)='boolean'
      and (custom_role.permissions ->> p_permission_key)::boolean
  ), override_permissions as (
    select case when jsonb_typeof(permission_override.permissions -> p_permission_key)='boolean'
      then (permission_override.permissions ->> p_permission_key)::boolean end as granted
    from base_permissions base_permission left join public.base_role_permission_overrides permission_override
      on permission_override.organization_id=p_organization_id and permission_override.base_role=base_permission.role
  ) select coalesce((select granted from override_permissions where granted is not null limit 1),
    (select coalesce(base_permissions.granted,false) or coalesce(custom_permissions.granted,false)
       from base_permissions cross join custom_permissions), false)
$$;

create or replace function public.m6_reporting_draft_json(p_organization_id uuid, p_draft_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
 select jsonb_build_object('id',d.id,'organizationId',d.organization_id,'obligationId',d.obligation_id,'stageId',d.stage_id,'releaseId',d.release_id,
  'stage',s.stage_kind,'fieldDefinitions',public.m6_reporting_stage_field_definitions(o.obligation_type,s.stage_kind),
  'fields',public.m6_reporting_draft_fields(d.content,d.field_provenance,public.m6_reporting_stage_field_definitions(o.obligation_type,s.stage_kind),d.updated_at),
  'memberStates',coalesce((select jsonb_agg(jsonb_build_object('countryCode',country,'provenance',coalesce(d.field_provenance->'_memberStates'->country,jsonb_build_object('origin','platform','source','release market availability','recordedAt',public.m6_utc_second_z(d.updated_at)))) order by country) from jsonb_array_elements_text(d.member_states) country),'[]'::jsonb),'revision',d.version,
  'contentHash',public.m6_reporting_draft_hash(d),
  'completeness',case when public.m6_reporting_draft_complete(d.content,public.m6_reporting_stage_field_definitions(o.obligation_type,s.stage_kind),d.member_states) then 'valid' else 'incomplete' end,
  'status',case when exists(select 1 from public.reporting_stage_submissions submitted where submitted.organization_id=d.organization_id and submitted.stage_id=d.stage_id) then 'submitted' when d.lock_expires_at > clock_timestamp() then 'locked' else 'editable' end,
  'requiresTemplateReview',coalesce((d.field_provenance->'_template'->>'reviewRequired')::boolean,false),
  'prepopulatedFromSubmissionId',d.prepopulated_from_submission_id,'lock',case when not exists(select 1 from public.reporting_stage_submissions submitted where submitted.organization_id=d.organization_id and submitted.stage_id=d.stage_id) and d.lock_expires_at > clock_timestamp() then jsonb_build_object('heldBy',jsonb_build_object('userId',d.locked_by_user_id,'displayName',public.m6_actor_display_name(d.locked_by_user_id)),'expiresAt',public.m6_utc_second_z(d.lock_expires_at)) else null end,
  'createdBy',jsonb_build_object('userId',d.created_by_user_id,'displayName',public.m6_actor_display_name(d.created_by_user_id)),'createdAt',public.m6_utc_second_z(d.created_at),'updatedAt',public.m6_utc_second_z(d.updated_at))
 from public.reporting_stage_drafts d join public.reporting_obligations o on o.organization_id=d.organization_id and o.id=d.obligation_id join public.reporting_obligation_stages s on s.organization_id=d.organization_id and s.id=d.stage_id where d.organization_id=p_organization_id and d.id=p_draft_id
$$;

create or replace function public.create_reporting_stage_approval_proof_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_session_id uuid,
  p_draft_id uuid, p_draft_revision integer, p_draft_hash text,
  p_expires_at timestamptz, p_correlation_id uuid default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.reporting_stage_drafts%rowtype; v_now timestamptz := clock_timestamp(); v_proof uuid;
begin
 if p_session_id is null or p_draft_revision < 1 or p_draft_hash !~ '^[a-f0-9]{64}$'
    or p_expires_at <= v_now or p_expires_at > v_now + interval '5 minutes'
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_submit_reporting') then
   return query select 'forbidden',null::jsonb; return;
 end if;
 select * into d from public.reporting_stage_drafts where organization_id=p_organization_id and id=p_draft_id for update;
 if not found or exists(select 1 from public.reporting_stage_submissions s where s.organization_id=p_organization_id and s.stage_id=d.stage_id)
    or d.version<>p_draft_revision or public.m6_reporting_draft_hash(d)<>p_draft_hash then
   return query select 'conflict',null::jsonb; return;
 end if;
 insert into public.reporting_stage_approval_proofs(organization_id,draft_id,actor_user_id,session_id,draft_revision,draft_hash,expires_at)
 values(p_organization_id,d.id,p_actor_user_id,p_session_id,p_draft_revision,p_draft_hash,p_expires_at) returning id into v_proof;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(p_organization_id,p_actor_user_id,'reporting.stage_approval_reauthenticated','reporting_stage_draft',d.id::text,
   jsonb_build_object('draftRevision',d.version,'draftHash',p_draft_hash,'proofId',v_proof,'correlationId',p_correlation_id));
 return query select 'created',jsonb_build_object('reauthenticationProofId',v_proof,'expiresAt',public.m6_utc_second_z(p_expires_at));
end $$;

create or replace function public.approve_reporting_stage_draft_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_draft_id uuid,
  p_draft_revision integer,p_draft_hash text,p_reauthentication_proof_id uuid,
  p_submission_reference text,p_sod_override_reason text,p_idempotency_key uuid,p_correlation_id uuid default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.reporting_stage_drafts%rowtype; v_stage public.reporting_obligation_stages%rowtype;
 v_obligation public.reporting_obligations%rowtype; v_proof public.reporting_stage_approval_proofs%rowtype;
 v_submission uuid; v_approval uuid; v_now timestamptz:=date_trunc('second',clock_timestamp()); v_hash text;
 v_drafter_overlap boolean; v_digest text; v_existing record; v_result jsonb;
begin
 if p_idempotency_key is null or p_session_id is null or p_draft_revision < 1
  or p_draft_hash !~ '^[a-f0-9]{64}$' or char_length(btrim(coalesce(p_submission_reference,''))) not between 1 and 1000
  or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_submit_reporting') then
  return query select 'forbidden',null::jsonb; return;
 end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('draftId',p_draft_id,'draftRevision',p_draft_revision,'draftHash',p_draft_hash,'proofId',p_reauthentication_proof_id,'submissionReference',btrim(p_submission_reference),'overrideReason',nullif(btrim(coalesce(p_sod_override_reason,'')),''))::text,'sha256'),'hex');
 select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'approve_stage_draft',v_digest);
 if found then return query select v_existing.outcome,v_existing.result; return; end if;
 select * into d from public.reporting_stage_drafts where organization_id=p_organization_id and id=p_draft_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 select * into v_obligation from public.reporting_obligations where organization_id=p_organization_id and id=d.obligation_id for update;
 select * into v_stage from public.reporting_obligation_stages where organization_id=p_organization_id and id=d.stage_id for update;
 if not found or v_obligation.status<>'active' or exists(select 1 from public.reporting_stage_submissions s where s.organization_id=p_organization_id and s.stage_id=d.stage_id) then
  return query select 'conflict',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id)); return;
 end if;
 v_hash:=public.m6_reporting_draft_hash(d);
 if d.version<>p_draft_revision or v_hash<>p_draft_hash then return query select 'conflict',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id)); return; end if;
 select * into v_proof from public.reporting_stage_approval_proofs where organization_id=p_organization_id and id=p_reauthentication_proof_id for update;
 if not found or v_proof.actor_user_id<>p_actor_user_id or v_proof.session_id<>p_session_id or v_proof.draft_id<>d.id
  or v_proof.draft_revision<>d.version or v_proof.draft_hash<>v_hash or v_proof.consumed_at is not null or v_proof.expires_at<=v_now then
  return query select 'proof_invalid',null::jsonb; return;
 end if;
 select exists(select 1 from public.reporting_stage_draft_revisions r where r.organization_id=p_organization_id and r.draft_id=d.id and r.changed_by_user_id=p_actor_user_id)
  or d.created_by_user_id=p_actor_user_id into v_drafter_overlap;
 if v_drafter_overlap and char_length(btrim(coalesce(p_sod_override_reason,''))) < 10 then
  return query select 'sod_conflict',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id)); return;
 end if;
 -- Only an owner may use the deliberate, visible exception. A custom submit
 -- grant alone never silently permits self-approval.
 if v_drafter_overlap and not exists(select 1 from public.organization_members m where m.organization_id=p_organization_id and m.user_id=p_actor_user_id and m.role='owner') then
  return query select 'forbidden',null::jsonb; return;
 end if;
 if not public.m6_reporting_draft_payload_valid(d.content,d.field_provenance,d.member_states,v_obligation.obligation_type,v_stage.stage_kind)
  or not public.m6_reporting_draft_complete(d.content,public.m6_reporting_stage_field_definitions(v_obligation.obligation_type,v_stage.stage_kind),d.member_states)
  or coalesce((d.field_provenance->'_template'->>'reviewRequired')::boolean,false) then return query select 'invalid_state',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id)); return; end if;
 update public.reporting_stage_approval_proofs set consumed_at=v_now where id=v_proof.id and organization_id=p_organization_id;
 insert into public.reporting_stage_approvals(organization_id,obligation_id,stage_id,draft_id,draft_revision,draft_hash,approved_by_user_id,segregation_of_duties_override_reason,approved_at)
 values(p_organization_id,d.obligation_id,d.stage_id,d.id,d.version,v_hash,p_actor_user_id,nullif(btrim(coalesce(p_sod_override_reason,'')),''),v_now) returning id into v_approval;
 insert into public.reporting_stage_submissions(organization_id,obligation_id,stage_id,draft_id,draft_revision,release_id,content,field_provenance,member_states,submission_reference,submitted_by_user_id,submitted_at)
 values(p_organization_id,d.obligation_id,d.stage_id,d.id,d.version,d.release_id,d.content,d.field_provenance,d.member_states,btrim(p_submission_reference),p_actor_user_id,v_now) returning id into v_submission;
 update public.reporting_obligation_stages set submitted_at=v_now,submission_reference=btrim(p_submission_reference),state='submitted',version=version+1,updated_at=v_now where organization_id=p_organization_id and id=v_stage.id;
 update public.reporting_obligations set version=version+1,updated_at=v_now where organization_id=p_organization_id and id=d.obligation_id returning * into v_obligation;
 update public.reporting_stage_drafts set locked_by_user_id=null,lock_token=null,lock_expires_at=null where organization_id=p_organization_id and id=d.id;
 insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,stage_kind,occurred_at,actor_user_id,actor_display_name,new_value,correlation_id)
 values(p_organization_id,d.obligation_id,'stage_submitted',v_stage.stage_kind,v_now,p_actor_user_id,public.m6_actor_display_name(p_actor_user_id),jsonb_build_object('approvalId',v_approval,'draftRevision',d.version,'draftHash',v_hash,'segregationOfDutiesOverride',v_drafter_overlap),p_correlation_id);
 perform public.m6_refresh_reporting_obligation_stages(p_organization_id,d.obligation_id,v_now);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(p_organization_id,p_actor_user_id,'reporting.stage_approved','reporting_stage_approval',v_approval::text,jsonb_build_object('submissionId',v_submission,'draftId',d.id,'draftRevision',d.version,'draftHash',v_hash,'proofId',v_proof.id,'segregationOfDutiesOverrideReason',nullif(btrim(coalesce(p_sod_override_reason,'')),''),'idempotencyKey',p_idempotency_key));
 v_result:=jsonb_build_object('approval',jsonb_build_object(
   'id',v_approval,'draftId',d.id,'draftRevision',d.version,'draftHash',v_hash,
   'state','approved','requestedBy',jsonb_build_object('userId',d.created_by_user_id,'displayName',public.m6_actor_display_name(d.created_by_user_id)),
   'requestedAt',public.m6_utc_second_z(d.created_at),'decidedBy',jsonb_build_object('userId',p_actor_user_id,'displayName',public.m6_actor_display_name(p_actor_user_id)),
   'decidedAt',public.m6_utc_second_z(v_now),'segregationOfDutiesOverrideReason',nullif(btrim(coalesce(p_sod_override_reason,'')),'')));
 perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'approve_stage_draft',v_digest,v_result);
 return query select 'updated',v_result;
end $$;

-- Close legacy direct-submit bypasses. New callers use the approval RPC above.
create or replace function public.submit_reporting_stage_draft_atomic(p_organization_id uuid,p_actor_user_id uuid,p_draft_id uuid,p_expected_version integer,p_lock_token uuid,p_submission_reference text,p_idempotency_key uuid,p_correlation_id uuid default null)
returns table(outcome text,result jsonb) language sql security definer set search_path = public, pg_temp as $$
 select 'approval_required'::text, null::jsonb
$$;


alter function public.m6_reporting_draft_hash(public.reporting_stage_drafts) owner to postgres;
alter function public.create_reporting_stage_approval_proof_atomic(uuid,uuid,uuid,uuid,integer,text,timestamptz,uuid) owner to postgres;
alter function public.approve_reporting_stage_draft_atomic(uuid,uuid,uuid,uuid,integer,text,uuid,text,text,uuid,uuid) owner to postgres;
revoke all on function public.m6_reporting_draft_hash(public.reporting_stage_drafts), public.create_reporting_stage_approval_proof_atomic(uuid,uuid,uuid,uuid,integer,text,timestamptz,uuid), public.approve_reporting_stage_draft_atomic(uuid,uuid,uuid,uuid,integer,text,uuid,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_reporting_stage_approval_proof_atomic(uuid,uuid,uuid,uuid,integer,text,timestamptz,uuid), public.approve_reporting_stage_draft_atomic(uuid,uuid,uuid,uuid,integer,text,uuid,text,text,uuid,uuid) to service_role;
