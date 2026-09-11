-- M6-05: manual filing is a separate, append-only fact from approval.  The
-- database only stores attestable metadata and private object paths; package,
-- receipt and evidence bytes are written by the server-side storage adapter.

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('reporting-evidence', 'reporting-evidence', false, 26214400,
  array['application/zip', 'application/pdf', 'image/png', 'image/jpeg', 'text/plain'])
on conflict (id) do update set public = false, file_size_limit = 26214400,
  allowed_mime_types = excluded.allowed_mime_types;

-- M6-04 predates the composite-FK convention used by reporting evidence.
-- Add the tenant-qualified candidate key before referencing an approval.
alter table public.reporting_stage_approvals
  add constraint reporting_stage_approvals_organization_id_id_key unique (organization_id, id);

create table public.reporting_stage_packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  obligation_id uuid not null,
  stage_id uuid not null,
  approval_id uuid not null,
  draft_id uuid not null,
  draft_revision integer not null check (draft_revision > 0),
  draft_hash text not null check (draft_hash ~ '^[a-f0-9]{64}$'),
  state text not null default 'reserved' check (state in ('reserved', 'available', 'failed')),
  storage_bucket text not null default 'reporting-evidence' check (storage_bucket = 'reporting-evidence'),
  storage_object_path text not null unique check (storage_object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/packages/[0-9a-f-]{36}\.zip$'),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  byte_size bigint check (byte_size is null or byte_size between 1 and 26214400),
  manifest_sha256 text check (manifest_sha256 is null or manifest_sha256 ~ '^[a-f0-9]{64}$'),
  signing_algorithm text check (signing_algorithm is null or signing_algorithm = 'Ed25519'),
  signing_key_id text check (signing_key_id is null or char_length(btrim(signing_key_id)) between 1 and 200),
  detached_signature text check (detached_signature is null or char_length(detached_signature) between 40 and 20000),
  public_key_fingerprint text check (public_key_fingerprint is null or public_key_fingerprint ~ '^[a-f0-9]{64}$'),
  failure_reason text check (failure_reason is null or char_length(btrim(failure_reason)) between 1 and 1000),
  generated_by_user_id uuid not null references public.users(id) on delete restrict,
  reserved_at timestamptz not null default date_trunc('second', clock_timestamp()),
  finalized_at timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, obligation_id) references public.reporting_obligations(organization_id, id) on delete cascade,
  foreign key (organization_id, stage_id) references public.reporting_obligation_stages(organization_id, id) on delete cascade,
  foreign key (organization_id, approval_id) references public.reporting_stage_approvals(organization_id, id) on delete restrict,
  foreign key (organization_id, draft_id) references public.reporting_stage_drafts(organization_id, id) on delete restrict,
  check ((state = 'available') = (sha256 is not null and byte_size is not null and manifest_sha256 is not null
    and signing_algorithm is not null and signing_key_id is not null and detached_signature is not null
    and public_key_fingerprint is not null and finalized_at is not null)),
  check (state <> 'failed' or failure_reason is not null)
);

create unique index reporting_stage_packages_one_available_approval_idx
  on public.reporting_stage_packages(organization_id, approval_id) where state = 'available';
create index reporting_stage_packages_stage_idx
  on public.reporting_stage_packages(organization_id, stage_id, reserved_at desc);

create table public.reporting_stage_filing_proofs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  package_id uuid not null,
  approval_id uuid not null,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  session_id uuid not null,
  action_digest text not null check (action_digest ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default date_trunc('second', clock_timestamp()),
  unique (organization_id, id),
  foreign key (organization_id, package_id) references public.reporting_stage_packages(organization_id, id) on delete cascade,
  foreign key (organization_id, approval_id) references public.reporting_stage_approvals(organization_id, id) on delete restrict,
  check (expires_at > created_at), check (consumed_at is null or consumed_at >= created_at)
);
create index reporting_stage_filing_proofs_active_idx
  on public.reporting_stage_filing_proofs(organization_id, actor_user_id, session_id, expires_at)
  where consumed_at is null;

alter table public.reporting_stage_submissions
  add column if not exists approval_id uuid,
  add column if not exists package_id uuid,
  add column if not exists filing_proof_id uuid,
  add column if not exists actual_submission_basis text,
  add column if not exists proof_storage_bucket text,
  add column if not exists proof_object_path text,
  add column if not exists proof_sha256 text,
  add column if not exists proof_byte_size bigint,
  add column if not exists proof_mime_type text,
  add column if not exists proof_filename text;
alter table public.reporting_stage_submissions
  add constraint reporting_stage_submissions_approval_fk foreign key (organization_id, approval_id)
    references public.reporting_stage_approvals(organization_id, id) on delete restrict,
  add constraint reporting_stage_submissions_package_fk foreign key (organization_id, package_id)
    references public.reporting_stage_packages(organization_id, id) on delete restrict,
  add constraint reporting_stage_submissions_filing_proof_fk foreign key (organization_id, filing_proof_id)
    references public.reporting_stage_filing_proofs(organization_id, id) on delete restrict,
  add constraint reporting_stage_submissions_basis_check check (actual_submission_basis is null
    or actual_submission_basis in ('external_portal', 'email', 'secure_transfer', 'other')),
  add constraint reporting_stage_submissions_proof_check check (
    (proof_storage_bucket is null and proof_object_path is null and proof_sha256 is null and proof_byte_size is null and proof_mime_type is null and proof_filename is null)
    or (proof_storage_bucket = 'reporting-evidence'
      and proof_object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/filings/[0-9a-f-]{36}/receipt\.(pdf|png|jpg|txt)$'
      and proof_sha256 ~ '^[a-f0-9]{64}$' and proof_byte_size between 1 and 10485760
      and proof_mime_type in ('application/pdf','image/png','image/jpeg','text/plain')
      and proof_filename ~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$')
  ),
  add constraint reporting_stage_submissions_m6_filing_check check (
    approval_id is null or (package_id is not null and filing_proof_id is not null and actual_submission_basis is not null
      and proof_storage_bucket is not null and proof_object_path is not null)
  );
create unique index reporting_stage_submissions_package_unique_idx
  on public.reporting_stage_submissions(organization_id, package_id) where package_id is not null;

create table public.reporting_stage_submission_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submission_id uuid not null,
  acknowledgement_reference text check (acknowledgement_reference is null or char_length(btrim(acknowledgement_reference)) between 1 and 1000),
  acknowledged_at timestamptz not null,
  notes text check (notes is null or char_length(btrim(notes)) between 1 and 4000),
  recorded_by_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default date_trunc('second', clock_timestamp()),
  unique (organization_id, id),
  foreign key (organization_id, submission_id) references public.reporting_stage_submissions(organization_id, id) on delete restrict
);
create index reporting_stage_submission_acknowledgements_submission_idx
  on public.reporting_stage_submission_acknowledgements(organization_id, submission_id, acknowledged_at, id);

alter table public.reporting_stage_packages enable row level security;
alter table public.reporting_stage_filing_proofs enable row level security;
alter table public.reporting_stage_submission_acknowledgements enable row level security;
revoke all on table public.reporting_stage_packages, public.reporting_stage_filing_proofs,
  public.reporting_stage_submission_acknowledgements from public, anon, authenticated;
grant all on table public.reporting_stage_packages, public.reporting_stage_filing_proofs,
  public.reporting_stage_submission_acknowledgements to service_role;

-- Reporting evidence is append-only.  A package may only advance once from a
-- reservation to its verified immutable artifact; failed reservations are not
-- overwritten and are retained for recovery/audit.
create or replace function public.m6_prevent_reporting_evidence_mutation()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then raise exception 'reporting evidence is immutable' using errcode = '55000'; end if;
  if tg_table_name = 'reporting_stage_packages' then
    if old.state = 'reserved' and new.state in ('available','failed')
      and new.id = old.id and new.organization_id = old.organization_id and new.obligation_id = old.obligation_id
      and new.stage_id = old.stage_id and new.approval_id = old.approval_id and new.draft_id = old.draft_id
      and new.draft_revision = old.draft_revision and new.draft_hash = old.draft_hash
      and new.storage_bucket = old.storage_bucket and new.storage_object_path = old.storage_object_path
      and new.generated_by_user_id = old.generated_by_user_id and new.reserved_at = old.reserved_at then return new;
    end if;
  end if;
  raise exception 'reporting evidence is immutable' using errcode = '55000';
end $$;
create trigger reporting_stage_packages_immutable before update or delete on public.reporting_stage_packages
  for each row execute function public.m6_prevent_reporting_evidence_mutation();
create trigger reporting_stage_submissions_immutable before update or delete on public.reporting_stage_submissions
  for each row execute function public.m6_prevent_reporting_evidence_mutation();
create trigger reporting_stage_submission_acknowledgements_immutable before update or delete on public.reporting_stage_submission_acknowledgements
  for each row execute function public.m6_prevent_reporting_evidence_mutation();

alter table public.reporting_obligation_events drop constraint if exists reporting_obligation_events_event_kind_check;
alter table public.reporting_obligation_events add constraint reporting_obligation_events_event_kind_check check (event_kind in (
  'created','anchor_corrected','stage_submitted','stage_overdue','cancelled','draft_created','draft_saved',
  'stage_approved','approval_invalidated','package_reserved','package_available','package_failed',
  'filing_reauthenticated','filing_recorded','acknowledgement_recorded'
));

create or replace function public.m6_reporting_draft_approval_invalidation_event()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_approval public.reporting_stage_approvals%rowtype;
begin
  if old.version = new.version or (old.content = new.content and old.field_provenance = new.field_provenance and old.member_states = new.member_states) then return new; end if;
  select * into v_approval from public.reporting_stage_approvals a
    where a.organization_id = new.organization_id and a.stage_id = new.stage_id
      and a.draft_id = new.id and a.draft_revision = old.version and a.draft_hash = public.m6_reporting_draft_hash(old);
  if found then
    insert into public.reporting_obligation_events(organization_id, obligation_id, event_kind, stage_kind, occurred_at, actor_user_id, actor_display_name, old_value, new_value)
    values(new.organization_id,new.obligation_id,'approval_invalidated',
      (select stage_kind from public.reporting_obligation_stages where organization_id=new.organization_id and id=new.stage_id),
      date_trunc('second',clock_timestamp()),new.locked_by_user_id,public.m6_actor_display_name(new.locked_by_user_id),
      jsonb_build_object('approvalId',v_approval.id,'draftRevision',old.version,'draftHash',v_approval.draft_hash),
      jsonb_build_object('draftRevision',new.version,'draftHash',public.m6_reporting_draft_hash(new)));
  end if;
  return new;
end $$;
create trigger reporting_stage_drafts_approval_invalidation after update of content, field_provenance, member_states on public.reporting_stage_drafts
  for each row execute function public.m6_reporting_draft_approval_invalidation_event();

-- Preserve the established draft read shape while making the exact current
-- approval visible after reload.  The wrapper leaves historical snapshot
-- rendering unchanged and never exposes proof/session material.
alter function public.m6_reporting_draft_json(uuid, uuid) rename to m6_reporting_draft_json_base;
create function public.m6_reporting_draft_json(p_organization_id uuid, p_draft_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select public.m6_reporting_draft_json_base(p_organization_id,p_draft_id) || jsonb_build_object('approval',
    (select jsonb_build_object('id',a.id,'draftId',a.draft_id,'draftRevision',a.draft_revision,'draftHash',a.draft_hash,
      'approvedBy',jsonb_build_object('userId',a.approved_by_user_id,'displayName',public.m6_actor_display_name(a.approved_by_user_id)),
      'approvedAt',public.m6_utc_second_z(a.approved_at),'segregationOfDutiesOverrideReason',a.segregation_of_duties_override_reason)
     from public.reporting_stage_approvals a
     where a.organization_id=p_organization_id and a.draft_id=p_draft_id
       and a.draft_revision=(select version from public.reporting_stage_drafts where organization_id=p_organization_id and id=p_draft_id)
       and a.draft_hash=(select public.m6_reporting_draft_hash(d) from public.reporting_stage_drafts d where d.organization_id=p_organization_id and d.id=p_draft_id)))
$$;

create or replace function public.get_reporting_stage_evidence(
  p_organization_id uuid,p_actor_user_id uuid,p_stage_id uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_stage public.reporting_obligation_stages%rowtype;
begin
  if not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings') then
    return query select 'not_found',null::jsonb; return;
  end if;
  select * into v_stage from public.reporting_obligation_stages where organization_id=p_organization_id and id=p_stage_id;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  return query select 'found', jsonb_build_object(
    'approval',(select jsonb_build_object('id',a.id,'draftId',a.draft_id,'draftRevision',a.draft_revision,'draftHash',a.draft_hash,
      'approvedByUserId',a.approved_by_user_id,'approvedAt',public.m6_utc_second_z(a.approved_at),'segregationOfDutiesOverrideReason',a.segregation_of_duties_override_reason)
      from public.reporting_stage_approvals a where a.organization_id=p_organization_id and a.stage_id=v_stage.id),
    'packages',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'state',p.state,'draftRevision',p.draft_revision,'draftHash',p.draft_hash,
      'sha256',p.sha256,'byteSize',p.byte_size,'manifestSha256',p.manifest_sha256,'signingAlgorithm',p.signing_algorithm,
      'signingKeyId',p.signing_key_id,'detachedSignature',p.detached_signature,'publicKeyFingerprint',p.public_key_fingerprint,
      'generatedAt',public.m6_utc_second_z(p.reserved_at),'finalizedAt',case when p.finalized_at is null then null else public.m6_utc_second_z(p.finalized_at) end)
      order by p.reserved_at,p.id) from public.reporting_stage_packages p where p.organization_id=p_organization_id and p.stage_id=v_stage.id),'[]'::jsonb),
    'submission',(select jsonb_build_object('id',s.id,'reference',s.submission_reference,'submittedAt',public.m6_utc_second_z(s.submitted_at),
      'basis',s.actual_submission_basis,'packageId',s.package_id,'proofSha256',s.proof_sha256,'proofFilename',s.proof_filename)
      from public.reporting_stage_submissions s where s.organization_id=p_organization_id and s.stage_id=v_stage.id),
    'acknowledgements',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'reference',a.acknowledgement_reference,
      'acknowledgedAt',public.m6_utc_second_z(a.acknowledged_at),'notes',a.notes,'recordedByUserId',a.recorded_by_user_id) order by a.acknowledged_at,a.id)
      from public.reporting_stage_submission_acknowledgements a join public.reporting_stage_submissions s on s.organization_id=a.organization_id and s.id=a.submission_id
      where a.organization_id=p_organization_id and s.stage_id=v_stage.id),'[]'::jsonb),
    'timeline',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'kind',e.event_kind,'occurredAt',public.m6_utc_second_z(e.occurred_at),
      'stage',e.stage_kind,'anchor',e.anchor_kind,'actorUserId',e.actor_user_id,'newValue',e.new_value,'oldValue',e.old_value,'reason',e.reason) order by e.occurred_at,e.id)
      from public.reporting_obligation_events e where e.organization_id=p_organization_id and e.obligation_id=v_stage.obligation_id),'[]'::jsonb)
  );
end $$;

create or replace function public.get_reporting_stage_draft(p_organization_id uuid,p_actor_user_id uuid,p_stage_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare d uuid;
begin
  if not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings') then return query select 'not_found',null::jsonb; return; end if;
  select id into d from public.reporting_stage_drafts where organization_id=p_organization_id and stage_id=p_stage_id;
  if d is null then return query select 'not_found',null::jsonb; else return query select 'found',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d)); end if;
end $$;

-- Retain the M6-04 RPC signature for safely deployed callers, but its former
-- submission reference is intentionally ignored. Approval records only the
-- exact reviewed snapshot and cannot pause a deadline.
create or replace function public.approve_reporting_stage_draft_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_draft_id uuid,
  p_draft_revision integer,p_draft_hash text,p_reauthentication_proof_id uuid,
  p_submission_reference text,p_sod_override_reason text,p_idempotency_key uuid,p_correlation_id uuid default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.reporting_stage_drafts%rowtype; v_stage public.reporting_obligation_stages%rowtype;
 v_obligation public.reporting_obligations%rowtype; v_proof public.reporting_stage_approval_proofs%rowtype;
 v_approval uuid; v_now timestamptz:=date_trunc('second',clock_timestamp()); v_hash text;
 v_drafter_overlap boolean; v_digest text; v_existing record; v_result jsonb;
begin
 if p_idempotency_key is null or p_session_id is null or p_draft_revision < 1 or p_draft_hash !~ '^[a-f0-9]{64}$'
  or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_submit_reporting') then return query select 'forbidden',null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('draftId',p_draft_id,'draftRevision',p_draft_revision,'draftHash',p_draft_hash,'proofId',p_reauthentication_proof_id,'overrideReason',nullif(btrim(coalesce(p_sod_override_reason,'')),''))::text,'sha256'),'hex');
 select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'approve_stage_draft',v_digest); if found then return query select v_existing.outcome,v_existing.result; return; end if;
 select * into d from public.reporting_stage_drafts where organization_id=p_organization_id and id=p_draft_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 select * into v_obligation from public.reporting_obligations where organization_id=p_organization_id and id=d.obligation_id for update;
 select * into v_stage from public.reporting_obligation_stages where organization_id=p_organization_id and id=d.stage_id for update;
 if not found or v_obligation.status<>'active' or exists(select 1 from public.reporting_stage_submissions s where s.organization_id=p_organization_id and s.stage_id=d.stage_id) then return query select 'conflict',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id)); return; end if;
 v_hash:=public.m6_reporting_draft_hash(d); if d.version<>p_draft_revision or v_hash<>p_draft_hash then return query select 'conflict',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id)); return; end if;
 select * into v_proof from public.reporting_stage_approval_proofs where organization_id=p_organization_id and id=p_reauthentication_proof_id for update;
 if not found or v_proof.actor_user_id<>p_actor_user_id or v_proof.session_id<>p_session_id or v_proof.draft_id<>d.id or v_proof.draft_revision<>d.version or v_proof.draft_hash<>v_hash or v_proof.consumed_at is not null or v_proof.expires_at<=v_now then return query select 'proof_invalid',null::jsonb; return; end if;
 select exists(select 1 from public.reporting_stage_draft_revisions r where r.organization_id=p_organization_id and r.draft_id=d.id and r.changed_by_user_id=p_actor_user_id) or d.created_by_user_id=p_actor_user_id into v_drafter_overlap;
 if v_drafter_overlap and char_length(btrim(coalesce(p_sod_override_reason,''))) < 10 then return query select 'sod_conflict',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id)); return; end if;
 if v_drafter_overlap and not exists(select 1 from public.organization_members m where m.organization_id=p_organization_id and m.user_id=p_actor_user_id and m.role='owner') then return query select 'forbidden',null::jsonb; return; end if;
 if not public.m6_reporting_draft_payload_valid(d.content,d.field_provenance,d.member_states,v_obligation.obligation_type,v_stage.stage_kind) or not public.m6_reporting_draft_complete(d.content,public.m6_reporting_stage_field_definitions(v_obligation.obligation_type,v_stage.stage_kind),d.member_states) or coalesce((d.field_provenance->'_template'->>'reviewRequired')::boolean,false) then return query select 'invalid_state',jsonb_build_object('draft',public.m6_reporting_draft_json(p_organization_id,d.id)); return; end if;
 update public.reporting_stage_approval_proofs set consumed_at=v_now where id=v_proof.id and organization_id=p_organization_id;
 insert into public.reporting_stage_approvals(organization_id,obligation_id,stage_id,draft_id,draft_revision,draft_hash,approved_by_user_id,segregation_of_duties_override_reason,approved_at)
 values(p_organization_id,d.obligation_id,d.stage_id,d.id,d.version,v_hash,p_actor_user_id,nullif(btrim(coalesce(p_sod_override_reason,'')),''),v_now) returning id into v_approval;
 update public.reporting_stage_drafts set locked_by_user_id=null,lock_token=null,lock_expires_at=null where organization_id=p_organization_id and id=d.id;
 insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,stage_kind,occurred_at,actor_user_id,actor_display_name,new_value,correlation_id)
 values(p_organization_id,d.obligation_id,'stage_approved',v_stage.stage_kind,v_now,p_actor_user_id,public.m6_actor_display_name(p_actor_user_id),jsonb_build_object('approvalId',v_approval,'draftRevision',d.version,'draftHash',v_hash,'segregationOfDutiesOverride',v_drafter_overlap),p_correlation_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
 values(p_organization_id,p_actor_user_id,'reporting.stage_approved','reporting_stage_approval',v_approval::text,jsonb_build_object('draftId',d.id,'draftRevision',d.version,'draftHash',v_hash,'proofId',v_proof.id,'segregationOfDutiesOverrideReason',nullif(btrim(coalesce(p_sod_override_reason,'')),''),'idempotencyKey',p_idempotency_key));
 v_result:=jsonb_build_object('approval',jsonb_build_object('id',v_approval,'draftId',d.id,'draftRevision',d.version,'draftHash',v_hash,'state','approved','requestedBy',jsonb_build_object('userId',d.created_by_user_id,'displayName',public.m6_actor_display_name(d.created_by_user_id)),'requestedAt',public.m6_utc_second_z(d.created_at),'decidedBy',jsonb_build_object('userId',p_actor_user_id,'displayName',public.m6_actor_display_name(p_actor_user_id)),'decidedAt',public.m6_utc_second_z(v_now),'segregationOfDutiesOverrideReason',nullif(btrim(coalesce(p_sod_override_reason,'')),'')));
 perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'approve_stage_draft',v_digest,v_result); return query select 'updated',v_result;
end $$;

create or replace function public.reserve_reporting_stage_package_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_obligation_id uuid,p_stage_id uuid,p_approval_id uuid,
  p_draft_revision integer,p_draft_hash text,p_idempotency_key uuid,p_correlation_id uuid default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.reporting_stage_approvals%rowtype; d public.reporting_stage_drafts%rowtype; p uuid; v_digest text; v_existing record; v_path text;
begin
 if p_idempotency_key is null or p_draft_revision<1 or p_draft_hash !~ '^[a-f0-9]{64}$' or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_submit_reporting') then return query select 'forbidden',null::jsonb; return; end if;
 v_digest:=public.m6_command_digest(jsonb_build_object('obligationId',p_obligation_id,'stageId',p_stage_id,'approvalId',p_approval_id,'draftRevision',p_draft_revision,'draftHash',p_draft_hash));
 select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'reserve_stage_package',v_digest); if found then return query select v_existing.outcome,v_existing.result; return; end if;
 select * into a from public.reporting_stage_approvals where organization_id=p_organization_id and id=p_approval_id for update;
 select * into d from public.reporting_stage_drafts where organization_id=p_organization_id and id=a.draft_id for update;
 if not found or a.obligation_id<>p_obligation_id or a.stage_id<>p_stage_id or a.draft_revision<>p_draft_revision or a.draft_hash<>p_draft_hash or d.version<>a.draft_revision or public.m6_reporting_draft_hash(d)<>a.draft_hash or exists(select 1 from public.reporting_stage_submissions s where s.organization_id=p_organization_id and s.stage_id=p_stage_id) then return query select 'conflict',null::jsonb; return; end if;
 p:=gen_random_uuid(); v_path:=p_organization_id::text||'/'||p_stage_id::text||'/packages/'||p::text||'.zip';
 insert into public.reporting_stage_packages(id,organization_id,obligation_id,stage_id,approval_id,draft_id,draft_revision,draft_hash,storage_object_path,generated_by_user_id)
 values(p,p_organization_id,p_obligation_id,p_stage_id,a.id,d.id,d.version,a.draft_hash,v_path,p_actor_user_id);
 insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,stage_kind,occurred_at,actor_user_id,actor_display_name,new_value,correlation_id) values(p_organization_id,p_obligation_id,'package_reserved',(select stage_kind from public.reporting_obligation_stages where organization_id=p_organization_id and id=p_stage_id),date_trunc('second',clock_timestamp()),p_actor_user_id,public.m6_actor_display_name(p_actor_user_id),jsonb_build_object('packageId',p,'approvalId',a.id,'draftHash',a.draft_hash),p_correlation_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'reporting.package_reserved','reporting_stage_package',p::text,jsonb_build_object('approvalId',a.id,'idempotencyKey',p_idempotency_key));
 perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'reserve_stage_package',v_digest,jsonb_build_object('package',jsonb_build_object('id',p,'state','reserved','objectPath',v_path)));
 return query select 'created',jsonb_build_object('package',jsonb_build_object('id',p,'state','reserved','objectPath',v_path));
end $$;

create or replace function public.finalize_reporting_stage_package_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_package_id uuid,p_sha256 text,p_byte_size bigint,p_key_id text,
  p_signature text,p_manifest_sha256 text,p_object_path text,p_idempotency_key uuid,p_correlation_id uuid default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.reporting_stage_packages%rowtype; v_digest text; v_existing record; v_fingerprint text;
begin
 if p_idempotency_key is null or p_sha256 !~ '^[a-f0-9]{64}$' or p_manifest_sha256 !~ '^[a-f0-9]{64}$' or p_byte_size not between 1 and 26214400 or char_length(btrim(coalesce(p_key_id,''))) not between 1 and 200 or char_length(coalesce(p_signature,'')) not between 40 and 20000 or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_submit_reporting') then return query select 'invalid_request',null::jsonb; return; end if;
 v_digest:=public.m6_command_digest(jsonb_build_object('packageId',p_package_id,'sha256',p_sha256,'byteSize',p_byte_size,'keyId',p_key_id,'signature',p_signature,'manifestSha256',p_manifest_sha256,'objectPath',p_object_path));
 select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'finalize_stage_package',v_digest); if found then return query select v_existing.outcome,v_existing.result; return; end if;
 select * into p from public.reporting_stage_packages where organization_id=p_organization_id and id=p_package_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if p.state <> 'reserved' or p.generated_by_user_id <> p_actor_user_id or p.storage_object_path <> p_object_path or not exists(select 1 from storage.objects o where o.bucket_id='reporting-evidence' and o.name=p_object_path) then return query select 'conflict',null::jsonb; return; end if;
 v_fingerprint:=encode(extensions.digest(btrim(p_key_id)||':'||p_signature,'sha256'),'hex');
 update public.reporting_stage_packages set state='available',sha256=p_sha256,byte_size=p_byte_size,manifest_sha256=p_manifest_sha256,signing_algorithm='Ed25519',signing_key_id=btrim(p_key_id),detached_signature=p_signature,public_key_fingerprint=v_fingerprint,finalized_at=date_trunc('second',clock_timestamp()) where organization_id=p_organization_id and id=p.id;
 insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,stage_kind,occurred_at,actor_user_id,actor_display_name,new_value,correlation_id) values(p_organization_id,p.obligation_id,'package_available',(select stage_kind from public.reporting_obligation_stages where organization_id=p_organization_id and id=p.stage_id),date_trunc('second',clock_timestamp()),p_actor_user_id,public.m6_actor_display_name(p_actor_user_id),jsonb_build_object('packageId',p.id,'sha256',p_sha256,'keyId',btrim(p_key_id)),p_correlation_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'reporting.package_finalized','reporting_stage_package',p.id::text,jsonb_build_object('sha256',p_sha256,'manifestSha256',p_manifest_sha256,'idempotencyKey',p_idempotency_key));
 perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'finalize_stage_package',v_digest,jsonb_build_object('packageId',p.id,'state','available','sha256',p_sha256)); return query select 'updated',jsonb_build_object('packageId',p.id,'state','available','sha256',p_sha256);
end $$;

create or replace function public.create_reporting_stage_filing_proof_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_package_id uuid,p_approval_id uuid,
  p_action_digest text,p_expires_at timestamptz,p_correlation_id uuid default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.reporting_stage_packages%rowtype; v_id uuid; v_now timestamptz:=date_trunc('second',clock_timestamp());
begin
 if p_session_id is null or p_action_digest !~ '^[a-f0-9]{64}$' or p_expires_at<=v_now or p_expires_at>v_now+interval '5 minutes' or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_submit_reporting') then return query select 'forbidden',null::jsonb; return; end if;
 select * into p from public.reporting_stage_packages where organization_id=p_organization_id and id=p_package_id for update;
 if not found or p.approval_id<>p_approval_id or p.state<>'available' or exists(select 1 from public.reporting_stage_submissions s where s.organization_id=p_organization_id and s.package_id=p.id) then return query select 'conflict',null::jsonb; return; end if;
 insert into public.reporting_stage_filing_proofs(organization_id,package_id,approval_id,actor_user_id,session_id,action_digest,expires_at) values(p_organization_id,p.id,p_approval_id,p_actor_user_id,p_session_id,p_action_digest,p_expires_at) returning id into v_id;
 insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,stage_kind,occurred_at,actor_user_id,actor_display_name,new_value,correlation_id) values(p_organization_id,p.obligation_id,'filing_reauthenticated',(select stage_kind from public.reporting_obligation_stages where organization_id=p_organization_id and id=p.stage_id),v_now,p_actor_user_id,public.m6_actor_display_name(p_actor_user_id),jsonb_build_object('proofId',v_id,'packageId',p.id),p_correlation_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'reporting.stage_filing_reauthenticated','reporting_stage_package',p.id::text,jsonb_build_object('proofId',v_id,'correlationId',p_correlation_id));
 return query select 'created',jsonb_build_object('reauthenticationProofId',v_id,'expiresAt',public.m6_utc_second_z(p_expires_at));
end $$;

create or replace function public.record_reporting_stage_filing_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_obligation_id uuid,p_stage_id uuid,p_package_id uuid,p_approval_id uuid,p_proof_id uuid,
  p_submitted_at timestamptz,p_basis text,p_reference text,p_proof_object_path text,p_proof_sha256 text,p_proof_size bigint,p_proof_mime text,p_proof_filename text,p_idempotency_key uuid,p_correlation_id uuid default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.reporting_stage_packages%rowtype; a public.reporting_stage_approvals%rowtype; d public.reporting_stage_drafts%rowtype; f public.reporting_stage_filing_proofs%rowtype; s public.reporting_obligation_stages%rowtype; o public.reporting_obligations%rowtype; v_existing record; v_digest text; v_now timestamptz:=date_trunc('second',clock_timestamp()); v_submission uuid;
begin
 if p_idempotency_key is null or p_session_id is null or p_submitted_at is null or p_basis not in ('external_portal','email','secure_transfer','other') or char_length(btrim(coalesce(p_reference,''))) not between 1 and 1000 or p_proof_sha256 !~ '^[a-f0-9]{64}$' or p_proof_size not between 1 and 10485760 or p_proof_mime not in ('application/pdf','image/png','image/jpeg','text/plain') or p_proof_filename !~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,199}$' or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_submit_reporting') then return query select 'invalid_request',null::jsonb; return; end if;
 v_digest:=public.m6_command_digest(jsonb_build_object('obligationId',p_obligation_id,'stageId',p_stage_id,'packageId',p_package_id,'approvalId',p_approval_id,'proofId',p_proof_id,'submittedAt',date_trunc('second',p_submitted_at),'basis',p_basis,'reference',btrim(p_reference),'proofObjectPath',p_proof_object_path,'proofSha256',p_proof_sha256,'proofSize',p_proof_size,'proofMime',p_proof_mime,'proofFilename',p_proof_filename));
 select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'record_stage_filing',v_digest); if found then return query select v_existing.outcome,v_existing.result; return; end if;
 select * into p from public.reporting_stage_packages where organization_id=p_organization_id and id=p_package_id for update; select * into a from public.reporting_stage_approvals where organization_id=p_organization_id and id=p_approval_id for update; select * into d from public.reporting_stage_drafts where organization_id=p_organization_id and id=a.draft_id for update; select * into f from public.reporting_stage_filing_proofs where organization_id=p_organization_id and id=p_proof_id for update; select * into o from public.reporting_obligations where organization_id=p_organization_id and id=p_obligation_id for update; select * into s from public.reporting_obligation_stages where organization_id=p_organization_id and id=p_stage_id for update;
 if p.id is null or a.id is null or d.id is null or f.id is null or o.id is null or s.id is null
  or o.status<>'active' or s.obligation_id<>o.id or p.obligation_id<>p_obligation_id or p.stage_id<>p_stage_id
  or p.approval_id<>a.id or a.draft_id<>d.id or p.draft_revision<>a.draft_revision or p.draft_hash<>a.draft_hash
  or d.version<>a.draft_revision or public.m6_reporting_draft_hash(d)<>a.draft_hash or p.state<>'available'
  or f.package_id<>p.id or f.approval_id<>a.id or f.actor_user_id<>p_actor_user_id or f.session_id<>p_session_id
  or f.action_digest<>v_digest or f.consumed_at is not null or f.expires_at<=v_now
  or exists(select 1 from public.reporting_stage_submissions rs where rs.organization_id=p_organization_id and rs.stage_id=p_stage_id)
  or not exists(select 1 from storage.objects so where so.bucket_id='reporting-evidence' and so.name=p_proof_object_path)
 then return query select 'conflict',null::jsonb; return; end if;
 update public.reporting_stage_filing_proofs set consumed_at=v_now where organization_id=p_organization_id and id=f.id;
 insert into public.reporting_stage_submissions(organization_id,obligation_id,stage_id,draft_id,draft_revision,release_id,content,field_provenance,member_states,submission_reference,submitted_by_user_id,submitted_at,approval_id,package_id,filing_proof_id,actual_submission_basis,proof_storage_bucket,proof_object_path,proof_sha256,proof_byte_size,proof_mime_type,proof_filename) values(p_organization_id,p_obligation_id,p_stage_id,d.id,d.version,d.release_id,d.content,d.field_provenance,d.member_states,btrim(p_reference),p_actor_user_id,date_trunc('second',p_submitted_at),a.id,p.id,f.id,p_basis,'reporting-evidence',p_proof_object_path,p_proof_sha256,p_proof_size,p_proof_mime,p_proof_filename) returning id into v_submission;
 update public.reporting_obligation_stages set submitted_at=date_trunc('second',p_submitted_at),submission_reference=btrim(p_reference),state='submitted',overdue_at=case when overdue_at is not null then overdue_at when due_at is not null and p_submitted_at>due_at then due_at else null end,version=version+1,updated_at=v_now where organization_id=p_organization_id and id=s.id;
 update public.reporting_obligations set version=version+1,updated_at=v_now where organization_id=p_organization_id and id=o.id;
 insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,stage_kind,anchor_kind,occurred_at,actor_user_id,actor_display_name,new_value,correlation_id) values(p_organization_id,p_obligation_id,'filing_recorded',s.stage_kind,case when s.stage_kind='notification' and o.obligation_type='severe_incident' then 'notification_submitted' else null end,v_now,p_actor_user_id,public.m6_actor_display_name(p_actor_user_id),jsonb_build_object('submissionId',v_submission,'packageId',p.id,'approvalId',a.id,'submittedAt',public.m6_utc_second_z(p_submitted_at),'submissionReference',btrim(p_reference),'basis',p_basis,'proofSha256',p_proof_sha256,'anchoredAt',public.m6_utc_second_z(p_submitted_at)),p_correlation_id);
 perform public.m6_refresh_reporting_obligation_stages(p_organization_id,p_obligation_id,v_now);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'reporting.stage_filing_recorded','reporting_stage_submission',v_submission::text,jsonb_build_object('approvalId',a.id,'packageId',p.id,'submittedAt',public.m6_utc_second_z(p_submitted_at),'basis',p_basis,'proofSha256',p_proof_sha256,'idempotencyKey',p_idempotency_key));
 perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'record_stage_filing',v_digest,jsonb_build_object('submissionId',v_submission,'state','submitted')); return query select 'updated',jsonb_build_object('submissionId',v_submission,'state','submitted');
end $$;

create or replace function public.append_reporting_stage_acknowledgement_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_submission_id uuid,p_acknowledged_at timestamptz,p_reference text,p_notes text,p_idempotency_key uuid,p_correlation_id uuid default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.reporting_stage_submissions%rowtype; v_id uuid; v_digest text; v_existing record;
begin
 if p_idempotency_key is null or p_acknowledged_at is null or (p_reference is not null and char_length(btrim(p_reference)) not between 1 and 1000) or (p_notes is not null and char_length(btrim(p_notes)) not between 1 and 4000) or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_submit_reporting') then return query select 'invalid_request',null::jsonb; return; end if;
 v_digest:=public.m6_command_digest(jsonb_build_object('submissionId',p_submission_id,'acknowledgedAt',date_trunc('second',p_acknowledged_at),'reference',nullif(btrim(coalesce(p_reference,'')),''),'notes',nullif(btrim(coalesce(p_notes,'')),'')));
 select * into v_existing from public.m6_reporting_draft_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'append_stage_acknowledgement',v_digest); if found then return query select v_existing.outcome,v_existing.result; return; end if;
 select * into s from public.reporting_stage_submissions where organization_id=p_organization_id and id=p_submission_id for update; if not found then return query select 'not_found',null::jsonb; return; end if;
 insert into public.reporting_stage_submission_acknowledgements(organization_id,submission_id,acknowledgement_reference,acknowledged_at,notes,recorded_by_user_id) values(p_organization_id,s.id,nullif(btrim(coalesce(p_reference,'')),''),date_trunc('second',p_acknowledged_at),nullif(btrim(coalesce(p_notes,'')),''),p_actor_user_id) returning id into v_id;
 insert into public.reporting_obligation_events(organization_id,obligation_id,event_kind,stage_kind,occurred_at,actor_user_id,actor_display_name,new_value,correlation_id) values(p_organization_id,s.obligation_id,'acknowledgement_recorded',(select stage_kind from public.reporting_obligation_stages where organization_id=p_organization_id and id=s.stage_id),date_trunc('second',clock_timestamp()),p_actor_user_id,public.m6_actor_display_name(p_actor_user_id),jsonb_build_object('acknowledgementId',v_id,'submissionId',s.id,'acknowledgedAt',public.m6_utc_second_z(p_acknowledged_at)),p_correlation_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'reporting.stage_acknowledgement_recorded','reporting_stage_submission_acknowledgement',v_id::text,jsonb_build_object('submissionId',s.id,'idempotencyKey',p_idempotency_key));
 perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,p_idempotency_key,'append_stage_acknowledgement',v_digest,jsonb_build_object('acknowledgementId',v_id)); return query select 'created',jsonb_build_object('acknowledgementId',v_id);
end $$;

alter function public.m6_prevent_reporting_evidence_mutation() owner to postgres;
alter function public.m6_reporting_draft_approval_invalidation_event() owner to postgres;
alter function public.m6_reporting_draft_json_base(uuid,uuid) owner to postgres;
alter function public.m6_reporting_draft_json(uuid,uuid) owner to postgres;
alter function public.get_reporting_stage_evidence(uuid,uuid,uuid) owner to postgres;
alter function public.approve_reporting_stage_draft_atomic(uuid,uuid,uuid,uuid,integer,text,uuid,text,text,uuid,uuid) owner to postgres;
alter function public.reserve_reporting_stage_package_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,uuid,uuid) owner to postgres;
alter function public.finalize_reporting_stage_package_atomic(uuid,uuid,uuid,text,bigint,text,text,text,text,uuid,uuid) owner to postgres;
alter function public.create_reporting_stage_filing_proof_atomic(uuid,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid) owner to postgres;
alter function public.record_reporting_stage_filing_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamp with time zone,text,text,text,text,bigint,text,text,uuid,uuid) owner to postgres;
alter function public.append_reporting_stage_acknowledgement_atomic(uuid,uuid,uuid,timestamp with time zone,text,text,uuid,uuid) owner to postgres;
revoke all on function public.m6_prevent_reporting_evidence_mutation(), public.m6_reporting_draft_approval_invalidation_event(), public.m6_reporting_draft_json_base(uuid,uuid), public.m6_reporting_draft_json(uuid,uuid), public.get_reporting_stage_evidence(uuid,uuid,uuid),
  public.approve_reporting_stage_draft_atomic(uuid,uuid,uuid,uuid,integer,text,uuid,text,text,uuid,uuid),
  public.reserve_reporting_stage_package_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,uuid,uuid),
  public.finalize_reporting_stage_package_atomic(uuid,uuid,uuid,text,bigint,text,text,text,text,uuid,uuid),
  public.create_reporting_stage_filing_proof_atomic(uuid,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid),
  public.record_reporting_stage_filing_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamp with time zone,text,text,text,text,bigint,text,text,uuid,uuid),
  public.append_reporting_stage_acknowledgement_atomic(uuid,uuid,uuid,timestamp with time zone,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_reporting_stage_draft_atomic(uuid,uuid,uuid,uuid,integer,text,uuid,text,text,uuid,uuid),
  public.get_reporting_stage_evidence(uuid,uuid,uuid),
  public.reserve_reporting_stage_package_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,uuid,uuid),
  public.finalize_reporting_stage_package_atomic(uuid,uuid,uuid,text,bigint,text,text,text,text,uuid,uuid),
  public.create_reporting_stage_filing_proof_atomic(uuid,uuid,uuid,uuid,uuid,text,timestamp with time zone,uuid),
  public.record_reporting_stage_filing_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamp with time zone,text,text,text,text,bigint,text,text,uuid,uuid),
  public.append_reporting_stage_acknowledgement_atomic(uuid,uuid,uuid,timestamp with time zone,text,text,uuid,uuid) to service_role;
