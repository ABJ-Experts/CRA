-- Repair the already-applied local M6-05 migration without resetting data.
-- Keep proof consumption at or after its stored creation timestamp.
do $$
declare v_definition text;
begin
  select pg_get_functiondef('public.approve_reporting_stage_draft_atomic(uuid,uuid,uuid,uuid,integer,text,uuid,text,text,uuid,uuid)'::regprocedure)
    into v_definition;
  v_definition := replace(v_definition,
    'select exists(select 1 from public.reporting_stage_draft_revisions r where r.organization_id=p_organization_id',
    'v_now:=greatest(v_now,v_proof.created_at);' || chr(10) || ' select exists(select 1 from public.reporting_stage_draft_revisions r where r.organization_id=p_organization_id');
  execute v_definition;
end $$;

-- The base function exists after the initial M6-05 migration.  On a developer
-- database where only the first half was applied, promote the previous read
-- function before installing the approval-aware wrapper.
do $$ begin
  if to_regprocedure('public.m6_reporting_draft_json_base(uuid,uuid)') is null then
    alter function public.m6_reporting_draft_json(uuid,uuid) rename to m6_reporting_draft_json_base;
  end if;
end $$;

create or replace function public.m6_reporting_draft_json(p_organization_id uuid, p_draft_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select public.m6_reporting_draft_json_base(p_organization_id,p_draft_id) || jsonb_build_object('approval',
    (select jsonb_build_object('id',a.id,'draftId',a.draft_id,'draftRevision',a.draft_revision,'draftHash',a.draft_hash,
      'approvedBy',jsonb_build_object('userId',a.approved_by_user_id,'displayName',public.m6_actor_display_name(a.approved_by_user_id)),
      'approvedAt',public.m6_utc_second_z(a.approved_at),'segregationOfDutiesOverrideReason',a.segregation_of_duties_override_reason)
     from public.reporting_stage_approvals a where a.organization_id=p_organization_id and a.draft_id=p_draft_id
       and a.draft_revision=(select version from public.reporting_stage_drafts where organization_id=p_organization_id and id=p_draft_id)
       and a.draft_hash=(select public.m6_reporting_draft_hash(d) from public.reporting_stage_drafts d where d.organization_id=p_organization_id and d.id=p_draft_id)))
$$;

create or replace function public.get_reporting_stage_evidence(p_organization_id uuid,p_actor_user_id uuid,p_stage_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_stage public.reporting_obligation_stages%rowtype;
begin
 if not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings') then return query select 'not_found',null::jsonb; return; end if;
 select * into v_stage from public.reporting_obligation_stages where organization_id=p_organization_id and id=p_stage_id;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 return query select 'found',jsonb_build_object(
  'approval',(select jsonb_build_object('id',a.id,'draftId',a.draft_id,'draftRevision',a.draft_revision,'draftHash',a.draft_hash,'approvedByUserId',a.approved_by_user_id,'approvedAt',public.m6_utc_second_z(a.approved_at),'segregationOfDutiesOverrideReason',a.segregation_of_duties_override_reason) from public.reporting_stage_approvals a where a.organization_id=p_organization_id and a.stage_id=v_stage.id),
  'packages',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'state',p.state,'draftRevision',p.draft_revision,'draftHash',p.draft_hash,'sha256',p.sha256,'byteSize',p.byte_size,'manifestSha256',p.manifest_sha256,'signingAlgorithm',p.signing_algorithm,'signingKeyId',p.signing_key_id,'detachedSignature',p.detached_signature,'publicKeyFingerprint',p.public_key_fingerprint,'generatedAt',public.m6_utc_second_z(p.reserved_at),'finalizedAt',case when p.finalized_at is null then null else public.m6_utc_second_z(p.finalized_at) end) order by p.reserved_at,p.id) from public.reporting_stage_packages p where p.organization_id=p_organization_id and p.stage_id=v_stage.id),'[]'::jsonb),
  'submission',(select jsonb_build_object('id',s.id,'reference',s.submission_reference,'submittedAt',public.m6_utc_second_z(s.submitted_at),'basis',s.actual_submission_basis,'packageId',s.package_id,'proofSha256',s.proof_sha256,'proofFilename',s.proof_filename) from public.reporting_stage_submissions s where s.organization_id=p_organization_id and s.stage_id=v_stage.id),
  'acknowledgements',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'reference',a.acknowledgement_reference,'acknowledgedAt',public.m6_utc_second_z(a.acknowledged_at),'notes',a.notes,'recordedByUserId',a.recorded_by_user_id) order by a.acknowledged_at,a.id) from public.reporting_stage_submission_acknowledgements a join public.reporting_stage_submissions s on s.organization_id=a.organization_id and s.id=a.submission_id where a.organization_id=p_organization_id and s.stage_id=v_stage.id),'[]'::jsonb),
  'timeline',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'kind',e.event_kind,'occurredAt',public.m6_utc_second_z(e.occurred_at),'stage',e.stage_kind,'anchor',e.anchor_kind,'actorUserId',e.actor_user_id,'newValue',e.new_value,'oldValue',e.old_value,'reason',e.reason) order by e.occurred_at,e.id) from public.reporting_obligation_events e where e.organization_id=p_organization_id and e.obligation_id=v_stage.obligation_id),'[]'::jsonb)
 );
end $$;

create or replace function public.get_reporting_stage_draft(p_organization_id uuid,p_actor_user_id uuid,p_stage_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare d uuid; begin
 if not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings') then return query select 'not_found',null::jsonb; return; end if;
 select id into d from public.reporting_stage_drafts where organization_id=p_organization_id and stage_id=p_stage_id;
 if d is null then return query select 'not_found',null::jsonb; else return query select 'found',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d)); end if;
end $$;

create table public.reporting_obligation_evidence_packs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 obligation_id uuid not null, state text not null default 'reserved' check(state in ('reserved','available','failed')),
 storage_bucket text not null default 'reporting-evidence' check(storage_bucket='reporting-evidence'),
 storage_object_path text not null unique check(storage_object_path ~ '^[0-9a-f-]{36}/evidence-packs/[0-9a-f-]{36}\.zip$'),
 sha256 text check(sha256 is null or sha256 ~ '^[a-f0-9]{64}$'), byte_size bigint check(byte_size is null or byte_size between 1 and 26214400),
 manifest_sha256 text check(manifest_sha256 is null or manifest_sha256 ~ '^[a-f0-9]{64}$'), generated_by_user_id uuid not null references public.users(id) on delete restrict,
 created_at timestamptz not null default date_trunc('second',clock_timestamp()), finalized_at timestamptz,
 unique(organization_id,id), foreign key(organization_id,obligation_id) references public.reporting_obligations(organization_id,id) on delete cascade,
 check((state='available')=(sha256 is not null and byte_size is not null and manifest_sha256 is not null and finalized_at is not null))
);
alter table public.reporting_obligation_evidence_packs enable row level security;
revoke all on table public.reporting_obligation_evidence_packs from public,anon,authenticated;
grant all on table public.reporting_obligation_evidence_packs to service_role;
create trigger reporting_obligation_evidence_packs_immutable before update or delete on public.reporting_obligation_evidence_packs for each row execute function public.m6_prevent_reporting_evidence_mutation();

create or replace function public.reserve_reporting_obligation_evidence_pack_atomic(p_organization_id uuid,p_actor_user_id uuid,p_obligation_id uuid,p_idempotency_key uuid,p_correlation_id uuid default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid:=gen_random_uuid(); v_path text; v_existing record; v_digest text;
begin
 if p_idempotency_key is null or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_submit_reporting') then return query select 'forbidden',null::jsonb;return;end if;
 v_digest:=public.m6_command_digest(jsonb_build_object('obligationId',p_obligation_id)); select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'reserve_evidence_pack',v_digest); if found then return query select v_existing.outcome,v_existing.result;return;end if;
 if not exists(select 1 from public.reporting_obligations where organization_id=p_organization_id and id=p_obligation_id) then return query select 'not_found',null::jsonb;return;end if;
 v_path:=p_organization_id::text||'/evidence-packs/'||v_id::text||'.zip'; insert into public.reporting_obligation_evidence_packs(id,organization_id,obligation_id,storage_object_path,generated_by_user_id) values(v_id,p_organization_id,p_obligation_id,v_path,p_actor_user_id);
 perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'reserve_evidence_pack',v_digest,jsonb_build_object('evidencePack',jsonb_build_object('id',v_id,'state','reserved','objectPath',v_path))); return query select 'created',jsonb_build_object('evidencePack',jsonb_build_object('id',v_id,'state','reserved','objectPath',v_path));
end $$;

create or replace function public.finalize_reporting_obligation_evidence_pack_atomic(p_organization_id uuid,p_actor_user_id uuid,p_pack_id uuid,p_sha256 text,p_byte_size bigint,p_manifest_sha256 text,p_object_path text,p_idempotency_key uuid,p_correlation_id uuid default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.reporting_obligation_evidence_packs%rowtype; v_existing record; v_digest text;
begin
 if p_idempotency_key is null or p_sha256 !~ '^[a-f0-9]{64}$' or p_manifest_sha256 !~ '^[a-f0-9]{64}$' or p_byte_size not between 1 and 26214400 then return query select 'invalid_request',null::jsonb;return;end if;
 v_digest:=public.m6_command_digest(jsonb_build_object('packId',p_pack_id,'sha256',p_sha256,'byteSize',p_byte_size,'manifestSha256',p_manifest_sha256,'objectPath',p_object_path)); select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'finalize_evidence_pack',v_digest);if found then return query select v_existing.outcome,v_existing.result;return;end if;
 select * into p from public.reporting_obligation_evidence_packs where organization_id=p_organization_id and id=p_pack_id for update; if not found or p.state<>'reserved' or p.generated_by_user_id<>p_actor_user_id or p.storage_object_path<>p_object_path or not exists(select 1 from storage.objects where bucket_id='reporting-evidence' and name=p_object_path) then return query select 'conflict',null::jsonb;return;end if;
 update public.reporting_obligation_evidence_packs set state='available',sha256=p_sha256,byte_size=p_byte_size,manifest_sha256=p_manifest_sha256,finalized_at=date_trunc('second',clock_timestamp()) where organization_id=p_organization_id and id=p.id; perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'finalize_evidence_pack',v_digest,jsonb_build_object('evidencePackId',p.id,'state','available')); return query select 'updated',jsonb_build_object('evidencePackId',p.id,'state','available');
end $$;

-- Timestamp basis is evidence supplied by the filer (for example an external
-- portal receipt or mail header), not a transport channel. Keep it bounded but
-- do not coerce or discard the actual basis text.
alter table public.reporting_stage_submissions drop constraint if exists reporting_stage_submissions_basis_check;
alter table public.reporting_stage_submissions add constraint reporting_stage_submissions_basis_check
 check (actual_submission_basis is null or char_length(btrim(actual_submission_basis)) between 1 and 1000);
alter table public.reporting_stage_packages drop constraint if exists reporting_stage_packages_storage_object_path_check;
alter table public.reporting_stage_packages add constraint reporting_stage_packages_storage_object_path_check
  check (storage_object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/packages/[0-9a-f-]{36}\.zip$');
alter table public.reporting_stage_submissions drop constraint if exists reporting_stage_submissions_proof_check;
alter table public.reporting_stage_submissions add constraint reporting_stage_submissions_proof_check check (
  (proof_storage_bucket is null and proof_object_path is null and proof_sha256 is null and proof_byte_size is null and proof_mime_type is null and proof_filename is null)
  or (proof_storage_bucket = 'reporting-evidence' and proof_object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/filings/[0-9a-f-]{36}/receipt\.(pdf|png|jpg|txt)$'
    and proof_sha256 ~ '^[a-f0-9]{64}$' and proof_byte_size between 1 and 10485760 and proof_mime_type in ('application/pdf','image/png','image/jpeg','text/plain') and proof_filename ~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$')
);
do $$
declare v_definition text;
begin
 select pg_get_functiondef('public.record_reporting_stage_filing_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamp with time zone,text,text,text,text,bigint,text,text,uuid,uuid)'::regprocedure) into v_definition;
 v_definition := replace(v_definition,
   'p_basis not in (''external_portal'',''email'',''secure_transfer'',''other'')',
   'char_length(btrim(coalesce(p_basis,''''))) not between 1 and 1000');
 execute v_definition;
end $$;

alter function public.m6_reporting_draft_json(uuid,uuid) owner to postgres;
alter function public.get_reporting_stage_evidence(uuid,uuid,uuid) owner to postgres;
alter function public.get_reporting_stage_draft(uuid,uuid,uuid) owner to postgres;
alter function public.reserve_reporting_obligation_evidence_pack_atomic(uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function public.finalize_reporting_obligation_evidence_pack_atomic(uuid,uuid,uuid,text,bigint,text,text,uuid,uuid) owner to postgres;
revoke all on function public.m6_reporting_draft_json(uuid,uuid),public.get_reporting_stage_evidence(uuid,uuid,uuid),public.get_reporting_stage_draft(uuid,uuid,uuid),public.reserve_reporting_obligation_evidence_pack_atomic(uuid,uuid,uuid,uuid,uuid),public.finalize_reporting_obligation_evidence_pack_atomic(uuid,uuid,uuid,text,bigint,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_reporting_stage_evidence(uuid,uuid,uuid),public.get_reporting_stage_draft(uuid,uuid,uuid),public.reserve_reporting_obligation_evidence_pack_atomic(uuid,uuid,uuid,uuid,uuid),public.finalize_reporting_obligation_evidence_pack_atomic(uuid,uuid,uuid,text,bigint,text,text,uuid,uuid) to service_role;
