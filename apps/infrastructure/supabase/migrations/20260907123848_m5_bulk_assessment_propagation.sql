-- CRA-M5-03: bounded, tenant-scoped bulk VEX submissions.  This is a
-- deliberately small, synchronous workflow: snapshots and outcomes are data,
-- not a replacement for M2's graph propagation jobs.

alter table public.vulnerability_finding_assessment_commands
  drop constraint vulnerability_finding_assessment_commands_operation_check;
alter table public.vulnerability_finding_assessment_commands
  add constraint vulnerability_finding_assessment_commands_operation_check check
  (operation in ('submit', 'approve', 'reject', 'set_policy',
    'bulk_preview', 'bulk_execute', 'bulk_retry', 'bulk_undo'));

create table public.vulnerability_finding_assessment_bulk_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references public.users(id) on delete restrict,
  operation_kind text not null check (operation_kind in ('bulk', 'propagation')),
  selection_mode text not null check (selection_mode in ('selected_rows', 'all_matching')),
  selection_filters jsonb,
  source_finding_id uuid,
  source_assessment_id uuid,
  source_assessment_version integer,
  submission jsonb not null check (jsonb_typeof(submission) = 'object'),
  snapshot_digest text not null check (snapshot_digest ~ '^[a-f0-9]{64}$'),
  version integer not null default 1 check (version > 0),
  state text not null default 'previewed' check (state in ('previewed', 'executing', 'scope_changed', 'partially_completed', 'completed', 'undone', 'expired')),
  expires_at timestamptz not null,
  parent_audit_log_id uuid,
  excluded_count integer not null default 0 check (excluded_count >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  foreign key (organization_id, source_finding_id)
    references public.vulnerability_findings(organization_id, id) on delete restrict,
  foreign key (organization_id, source_assessment_id)
    references public.vulnerability_finding_assessments(organization_id, id) on delete restrict
);

create table public.vulnerability_finding_assessment_bulk_operation_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_id uuid not null,
  finding_id uuid not null,
  ordinal integer not null check (ordinal between 1 and 500),
  product_name text not null check (char_length(btrim(product_name)) between 1 and 500),
  release_name text not null check (char_length(btrim(release_name)) between 1 and 500),
  component_identity text not null check (char_length(btrim(component_identity)) between 1 and 4096),
  component_version text not null check (char_length(btrim(component_version)) between 1 and 1024),
  expected_assessment_id uuid,
  expected_assessment_version integer not null default 0 check (expected_assessment_version >= 0),
  previous_assessment_id uuid,
  created_assessment_id uuid,
  state text not null default 'pending' check (state in ('pending', 'applied', 'excluded', 'skipped_scope_changed', 'failed', 'undone', 'undo_conflict')),
  failure_code text check (failure_code is null or failure_code in ('scope_changed', 'not_found', 'conflict', 'invalid_state')),
  applied_at timestamptz,
  undone_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (organization_id, operation_id, finding_id),
  foreign key (organization_id, operation_id)
    references public.vulnerability_finding_assessment_bulk_operations(organization_id, id) on delete restrict,
  foreign key (organization_id, expected_assessment_id)
    references public.vulnerability_finding_assessments(organization_id, id) on delete restrict,
  foreign key (organization_id, previous_assessment_id)
    references public.vulnerability_finding_assessments(organization_id, id) on delete restrict,
  foreign key (organization_id, created_assessment_id)
    references public.vulnerability_finding_assessments(organization_id, id) on delete restrict
);

alter table public.vulnerability_finding_assessments
  add column bulk_operation_target_id uuid;
alter table public.vulnerability_finding_assessments
  add constraint vulnerability_finding_assessments_bulk_target_fkey
  foreign key (organization_id, bulk_operation_target_id)
  references public.vulnerability_finding_assessment_bulk_operation_targets(organization_id, id)
  on delete restrict deferrable initially deferred;

create index vulnerability_finding_assessment_bulk_operations_owner_idx
  on public.vulnerability_finding_assessment_bulk_operations(organization_id, created_by, created_at desc, id);
create index vulnerability_finding_assessment_bulk_operations_expiry_idx
  on public.vulnerability_finding_assessment_bulk_operations(organization_id, expires_at, id)
  where state = 'previewed';
create index vulnerability_finding_assessment_bulk_targets_pending_idx
  on public.vulnerability_finding_assessment_bulk_operation_targets(organization_id, operation_id, ordinal)
  where state in ('pending', 'failed');
create index vulnerability_finding_assessment_bulk_targets_created_idx
  on public.vulnerability_finding_assessment_bulk_operation_targets(organization_id, created_assessment_id)
  where created_assessment_id is not null;
create index vulnerability_component_occurrences_identity_version_idx
  on public.vulnerability_component_occurrences(organization_id, component_identity, component_version, release_id, id);

alter table public.vulnerability_finding_assessment_bulk_operations enable row level security;
alter table public.vulnerability_finding_assessment_bulk_operation_targets enable row level security;
grant all on table public.vulnerability_finding_assessment_bulk_operations,
  public.vulnerability_finding_assessment_bulk_operation_targets to service_role;
revoke all on table public.vulnerability_finding_assessment_bulk_operations,
  public.vulnerability_finding_assessment_bulk_operation_targets from public, anon, authenticated;
create trigger set_vulnerability_finding_assessment_bulk_operations_updated_at
  before update on public.vulnerability_finding_assessment_bulk_operations
  for each row execute function public.set_updated_at();
create trigger set_vulnerability_finding_assessment_bulk_operation_targets_updated_at
  before update on public.vulnerability_finding_assessment_bulk_operation_targets
  for each row execute function public.set_updated_at();

-- Add a narrow internal provenance update to the immutable M5-02 guard. No
-- submitted content, decision, policy snapshot, or workflow field can change.
create or replace function public.m5_vex_guard_assessment_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.is_current and not new.is_current
    and new.superseded_at is not null and new.superseded_by_id is not null
    and new.version = old.version and new.updated_at = old.updated_at and new.updated_by = old.updated_by
    and new.approval_state = old.approval_state and new.decided_at is not distinct from old.decided_at
    and new.decided_by is not distinct from old.decided_by and new.decision_reason is not distinct from old.decision_reason
    and new.vex_status = old.vex_status and new.vex_justification is not distinct from old.vex_justification
    and new.detail = old.detail and new.change_reason is not distinct from old.change_reason
    and new.bulk_operation_target_id is not distinct from old.bulk_operation_target_id then return new; end if;
  if old.is_current and new.is_current and old.approval_state = 'awaiting_approval'
    and new.approval_state in ('approved', 'rejected') and new.version = old.version + 1
    and new.updated_at >= old.updated_at and new.updated_by = new.decided_by and new.decided_at is not null
    and new.vex_status = old.vex_status and new.vex_justification is not distinct from old.vex_justification
    and new.detail = old.detail and new.change_reason is not distinct from old.change_reason
    and new.approval_required = old.approval_required and new.policy_severity = old.policy_severity
    and new.policy_version = old.policy_version and new.submitted_at = old.submitted_at
    and new.submitted_by = old.submitted_by and new.superseded_at is null and new.superseded_by_id is null
    and new.bulk_operation_target_id is not distinct from old.bulk_operation_target_id then return new; end if;
  if old.is_current and new.is_current and old.bulk_operation_target_id is null and new.bulk_operation_target_id is not null
    and new.version = old.version and new.updated_at = old.updated_at and new.updated_by = old.updated_by
    and new.approval_state = old.approval_state and new.decided_at is not distinct from old.decided_at
    and new.decided_by is not distinct from old.decided_by and new.decision_reason is not distinct from old.decision_reason
    and new.vex_status = old.vex_status and new.vex_justification is not distinct from old.vex_justification
    and new.detail = old.detail and new.change_reason is not distinct from old.change_reason then return new; end if;
  raise exception 'submitted VEX assessment revisions are immutable' using errcode = 'check_violation';
end;
$$;

create or replace function public.execute_vulnerability_assessment_bulk_operation_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_operation_id uuid, p_expected_version integer,
  p_snapshot_digest text, p_confirm_scope_changes boolean, p_idempotency_key uuid, p_request_digest text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operation public.vulnerability_finding_assessment_bulk_operations%rowtype;
  v_target public.vulnerability_finding_assessment_bulk_operation_targets%rowtype;
  v_current public.vulnerability_finding_assessments%rowtype; v_result jsonb; v_submit_outcome text;
  v_applied integer:=0; v_changed boolean:=false; v_assessment_id uuid; v_target_key uuid;
begin
  if not public.m5_vex_active_member(p_organization_id,p_actor_user_id) or p_operation_id is null
    or p_expected_version is null or p_snapshot_digest !~ '^[a-f0-9]{64}$' or p_confirm_scope_changes is null
    or p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' then return query select 'invalid_state'::text,null::jsonb; return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text||':'||p_idempotency_key::text,0));
  return query select * from public.m5_vex_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'bulk_execute',p_request_digest); if found then return; end if;
  select * into v_operation from public.vulnerability_finding_assessment_bulk_operations o where o.organization_id=p_organization_id and o.id=p_operation_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_operation.version<>p_expected_version or v_operation.snapshot_digest<>p_snapshot_digest then return query select 'conflict'::text,jsonb_build_object('operation',public.m5_bulk_operation_json(p_organization_id,p_operation_id)); return; end if;
  if v_operation.state in ('undone','expired') then return query select 'invalid_state'::text,jsonb_build_object('operation',public.m5_bulk_operation_json(p_organization_id,p_operation_id)); return; end if;
  if v_operation.expires_at<=clock_timestamp() and v_operation.state='previewed' then update public.vulnerability_finding_assessment_bulk_operations set state='expired',version=version+1 where organization_id=p_organization_id and id=p_operation_id; return query select 'invalid_state'::text,jsonb_build_object('operation',public.m5_bulk_operation_json(p_organization_id,p_operation_id)); return; end if;
  -- Detect every changed member of the frozen scope before mutating anything.
  for v_target in select * from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=p_organization_id and t.operation_id=p_operation_id and t.state='pending' order by t.ordinal for update loop
    select * into v_current from public.vulnerability_finding_assessments a where a.organization_id=p_organization_id and a.finding_id=v_target.finding_id and a.is_current;
    if not exists(select 1 from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=v_target.finding_id and f.status='active')
      or (v_target.expected_assessment_id is null and found) or (v_target.expected_assessment_id is not null and (not found or v_current.id<>v_target.expected_assessment_id or v_current.version<>v_target.expected_assessment_version)) then v_changed:=true; end if;
  end loop;
  if v_changed and not p_confirm_scope_changes then
    update public.vulnerability_finding_assessment_bulk_operations set state='scope_changed',version=version+1 where organization_id=p_organization_id and id=p_operation_id;
    return query select 'scope_changed'::text,jsonb_build_object('operation',public.m5_bulk_operation_json(p_organization_id,p_operation_id)); return;
  end if;
  if v_operation.parent_audit_log_id is null then
    insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'vulnerability.finding_vex_assessment_bulk_started','vulnerability_finding_assessment_bulk_operation',p_operation_id::text,jsonb_build_object('snapshotDigest',v_operation.snapshot_digest,'targetCount',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=p_organization_id and t.operation_id=p_operation_id))) returning id into v_operation.parent_audit_log_id;
    update public.vulnerability_finding_assessment_bulk_operations set parent_audit_log_id=v_operation.parent_audit_log_id,state='executing' where organization_id=p_organization_id and id=p_operation_id;
  end if;
  for v_target in select * from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=p_organization_id and t.operation_id=p_operation_id and t.state='pending' order by t.ordinal limit 100 for update loop
    select * into v_current from public.vulnerability_finding_assessments a where a.organization_id=p_organization_id and a.finding_id=v_target.finding_id and a.is_current;
    if not exists(select 1 from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=v_target.finding_id and f.status='active')
      or (v_target.expected_assessment_id is null and found) or (v_target.expected_assessment_id is not null and (not found or v_current.id<>v_target.expected_assessment_id or v_current.version<>v_target.expected_assessment_version)) then
      update public.vulnerability_finding_assessment_bulk_operation_targets set state='skipped_scope_changed',failure_code='scope_changed' where organization_id=p_organization_id and id=v_target.id; continue;
    end if;
    v_target_key:=gen_random_uuid();
    select submission.outcome,submission.result into v_submit_outcome,v_result from public.submit_vulnerability_finding_vex_assessment_atomic(p_organization_id,p_actor_user_id,v_target.finding_id,v_operation.submission->>'status',v_operation.submission->>'justification',v_operation.submission->>'detail',coalesce(v_operation.submission->'evidenceLinks','[]'::jsonb),v_operation.submission->>'changeReason',v_target.expected_assessment_version,v_target_key,encode(digest(v_target_key::text,'sha256'),'hex')) submission limit 1;
    if v_submit_outcome='submitted' then
      v_assessment_id:=(v_result#>>'{assessment,id}')::uuid;
      update public.vulnerability_finding_assessments set bulk_operation_target_id=v_target.id where organization_id=p_organization_id and id=v_assessment_id;
      update public.vulnerability_finding_assessment_bulk_operation_targets set state='applied',created_assessment_id=v_assessment_id,applied_at=clock_timestamp(),failure_code=null where organization_id=p_organization_id and id=v_target.id;
      v_applied:=v_applied+1;
    else
      update public.vulnerability_finding_assessment_bulk_operation_targets set state='failed',failure_code=case when v_submit_outcome in ('conflict','not_found','invalid_state') then v_submit_outcome else 'invalid_state' end where organization_id=p_organization_id and id=v_target.id;
    end if;
  end loop;
  update public.vulnerability_finding_assessment_bulk_operations set state=case when exists(select 1 from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=p_organization_id and t.operation_id=p_operation_id and t.state='pending') then 'executing' when exists(select 1 from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=p_organization_id and t.operation_id=p_operation_id and t.state in ('failed','skipped_scope_changed')) then 'partially_completed' else 'completed' end,version=version+1 where organization_id=p_organization_id and id=p_operation_id;
  insert into public.vulnerability_finding_assessment_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'bulk_execute',p_request_digest,jsonb_build_object('operation',public.m5_bulk_operation_json(p_organization_id,p_operation_id),'idempotent',false));
  return query select 'executed'::text,jsonb_build_object('operation',public.m5_bulk_operation_json(p_organization_id,p_operation_id),'idempotent',false);
end;
$$;

create or replace function public.retry_vulnerability_assessment_bulk_operation_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_operation_id uuid, p_expected_version integer,
  p_snapshot_digest text, p_confirm_scope_changes boolean, p_idempotency_key uuid, p_request_digest text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Failed outcomes are exposed rather than hidden. A retry reopens only
  -- retryable database conflicts; permanently changed scope remains excluded.
  if not public.m5_vex_active_member(p_organization_id,p_actor_user_id) or p_operation_id is null
    or p_expected_version is null or p_snapshot_digest !~ '^[a-f0-9]{64}$' or p_confirm_scope_changes is null
    or p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' then
    return query select 'invalid_state'::text,null::jsonb; return;
  end if;
  if exists(select 1 from public.vulnerability_finding_assessment_commands c where c.organization_id=p_organization_id and c.actor_user_id=p_actor_user_id and c.idempotency_key=p_idempotency_key) then
    return query select * from public.m5_vex_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'bulk_retry',p_request_digest); return;
  end if;
  if not exists(select 1 from public.vulnerability_finding_assessment_bulk_operations o where o.organization_id=p_organization_id and o.id=p_operation_id and o.version=p_expected_version and o.snapshot_digest=p_snapshot_digest for update) then
    return query select 'conflict'::text,null::jsonb; return;
  end if;
  update public.vulnerability_finding_assessment_bulk_operation_targets set state='pending',failure_code=null
  where organization_id=p_organization_id and operation_id=p_operation_id and state='failed' and failure_code='conflict';
  return query select * from public.execute_vulnerability_assessment_bulk_operation_atomic(p_organization_id,p_actor_user_id,p_operation_id,p_expected_version,p_snapshot_digest,p_confirm_scope_changes,p_idempotency_key,p_request_digest);
end;
$$;

create or replace function public.undo_vulnerability_assessment_bulk_operation_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_operation_id uuid, p_expected_version integer,
  p_idempotency_key uuid, p_request_digest text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operation public.vulnerability_finding_assessment_bulk_operations%rowtype; v_target public.vulnerability_finding_assessment_bulk_operation_targets%rowtype; v_current uuid;
begin
  if not public.m5_vex_active_member(p_organization_id,p_actor_user_id) or p_operation_id is null or p_expected_version is null or p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' then return query select 'invalid_state'::text,null::jsonb; return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text||':'||p_idempotency_key::text,0));
  return query select * from public.m5_vex_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'bulk_undo',p_request_digest); if found then return; end if;
  select * into v_operation from public.vulnerability_finding_assessment_bulk_operations o where o.organization_id=p_organization_id and o.id=p_operation_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_operation.version<>p_expected_version then return query select 'conflict'::text,jsonb_build_object('operation',public.m5_bulk_operation_json(p_organization_id,p_operation_id)); return; end if;
  if v_operation.state not in ('completed','partially_completed') then return query select 'invalid_state'::text,jsonb_build_object('operation',public.m5_bulk_operation_json(p_organization_id,p_operation_id)); return; end if;
  for v_target in select * from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=p_organization_id and t.operation_id=p_operation_id and t.state='applied' for update loop
    select a.id into v_current from public.vulnerability_finding_assessments a where a.organization_id=p_organization_id and a.finding_id=v_target.finding_id and a.is_current for update;
    if v_current is distinct from v_target.created_assessment_id then update public.vulnerability_finding_assessment_bulk_operation_targets set state='undo_conflict',failure_code='conflict' where organization_id=p_organization_id and id=v_target.id;
    else update public.vulnerability_finding_assessment_bulk_operation_targets set state='undone',undone_at=clock_timestamp(),failure_code=null where organization_id=p_organization_id and id=v_target.id;
      insert into public.vulnerability_finding_assessment_history_events(organization_id,assessment_id,event_type,actor_user_id,reason,previous_values,new_values) values(p_organization_id,v_target.created_assessment_id,'superseded',p_actor_user_id,'bulk operation undone',jsonb_build_object('bulkOperationId',p_operation_id,'isEffective',true),jsonb_build_object('bulkOperationId',p_operation_id,'isEffective',false));
    end if;
  end loop;
  update public.vulnerability_finding_assessment_bulk_operations set state='undone',version=version+1 where organization_id=p_organization_id and id=p_operation_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'vulnerability.finding_vex_assessment_bulk_undone','vulnerability_finding_assessment_bulk_operation',p_operation_id::text,jsonb_build_object('parentAuditLogId',v_operation.parent_audit_log_id));
  insert into public.vulnerability_finding_assessment_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'bulk_undo',p_request_digest,jsonb_build_object('operation',public.m5_bulk_operation_json(p_organization_id,p_operation_id),'idempotent',false));
  return query select 'undone'::text,jsonb_build_object('operation',public.m5_bulk_operation_json(p_organization_id,p_operation_id),'idempotent',false);
end;
$$;

create or replace function public.m5_bulk_operation_json(p_organization_id uuid, p_operation_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', operations.id, 'organizationId', operations.organization_id, 'kind', operations.operation_kind, 'selectionMode', operations.selection_mode,
    'sourceFindingId', operations.source_finding_id, 'sourceAssessmentId', operations.source_assessment_id,
    'sourceAssessmentVersion', operations.source_assessment_version, 'assessment', operations.submission,
    'filterSnapshot', operations.selection_filters, 'version', operations.version, 'snapshotDigest', operations.snapshot_digest, 'state', operations.state,
    'expiresAt', to_char(operations.expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'createdAt', to_char(operations.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'createdByUserId', operations.created_by,
    'counts', jsonb_build_object('selected',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=operations.organization_id and t.operation_id=operations.id),'eligible',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=operations.organization_id and t.operation_id=operations.id and t.state not in ('skipped_scope_changed')),'excluded',0,'pending',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=operations.organization_id and t.operation_id=operations.id and t.state='pending'),'applied',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=operations.organization_id and t.operation_id=operations.id and t.state='applied'),'failed',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=operations.organization_id and t.operation_id=operations.id and t.state='failed'),'skippedScopeChanged',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=operations.organization_id and t.operation_id=operations.id and t.state='skipped_scope_changed'),'undone',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=operations.organization_id and t.operation_id=operations.id and t.state='undone'),'undoConflicts',(select count(*) from public.vulnerability_finding_assessment_bulk_operation_targets t where t.organization_id=operations.organization_id and t.operation_id=operations.id and t.state='undo_conflict')),
    'targets', coalesce((select jsonb_agg(jsonb_build_object('findingId',t.finding_id,'product',jsonb_build_object('id',p.id,'name',t.product_name),'release',jsonb_build_object('id',r.id,'name',t.release_name),'componentIdentity',t.component_identity,'componentVersion',t.component_version,'initialAssessmentId',t.expected_assessment_id,'initialAssessmentVersion',t.expected_assessment_version,'appliedAssessmentId',t.created_assessment_id,'outcome',t.state,'outcomeMessage',t.failure_code) order by t.ordinal) from public.vulnerability_finding_assessment_bulk_operation_targets t join public.vulnerability_findings f on f.organization_id=t.organization_id and f.id=t.finding_id join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id join public.products p on p.organization_id=r.organization_id and p.id=r.product_id where t.organization_id=operations.organization_id and t.operation_id=operations.id), '[]'::jsonb)
  ) from public.vulnerability_finding_assessment_bulk_operations operations
  where operations.organization_id=p_organization_id and operations.id=p_operation_id
$$;

create or replace function public.get_vulnerability_assessment_bulk_operation(
  p_organization_id uuid, p_actor_user_id uuid, p_operation_id uuid
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.m5_vex_active_member(p_organization_id,p_actor_user_id) or p_operation_id is null
     or not exists(select 1 from public.vulnerability_finding_assessment_bulk_operations o where o.organization_id=p_organization_id and o.id=p_operation_id) then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  return query select 'found'::text, public.m5_bulk_operation_json(p_organization_id,p_operation_id);
end;
$$;

-- Preview snapshots use the M5 queue's already tenant-scoped filter semantics.
-- `all_matching` pages that exceed 500 deliberately fail rather than truncate.
create or replace function public.create_vulnerability_assessment_bulk_preview_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_operation_kind text, p_selection_mode text,
  p_finding_ids jsonb, p_filters jsonb, p_source_finding_id uuid, p_source_assessment_id uuid, p_source_assessment_version integer, p_submission jsonb,
  p_idempotency_key uuid, p_request_digest text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_operation uuid:=gen_random_uuid(); v_queue jsonb; v_cursor text:=null; v_count integer:=0; v_excluded integer:=0; v_row jsonb; v_finding uuid;
  v_source public.vulnerability_finding_assessments%rowtype; v_id text; v_digest text;
begin
  if not public.m5_vex_active_member(p_organization_id,p_actor_user_id) or p_operation_kind not in ('bulk','propagation')
    or p_selection_mode not in ('selected_rows','all_matching') or jsonb_typeof(p_submission)<>'object'
    or p_idempotency_key is null or p_request_digest !~ '^[a-f0-9]{64}$' then return query select 'invalid_request'::text,null::jsonb; return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text||':'||p_idempotency_key::text,0));
  return query select * from public.m5_vex_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'bulk_preview',p_request_digest); if found then return; end if;
  if p_operation_kind='propagation' then
    select * into v_source from public.vulnerability_finding_assessments a where a.organization_id=p_organization_id and a.finding_id=p_source_finding_id and a.id=p_source_assessment_id and a.version=p_source_assessment_version and a.is_current for share;
    if not found or not exists(select 1 from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=p_source_finding_id and f.status='active') then return query select 'not_found'::text,null::jsonb; return; end if;
    p_submission:=jsonb_build_object('status',v_source.vex_status,'justification',v_source.vex_justification,'detail',v_source.detail,'changeReason',coalesce(p_submission->>'changeReason',v_source.change_reason),'evidenceLinks',coalesce((select jsonb_agg(case when e.kind='external' then jsonb_build_object('kind','external','title',e.title,'url',e.external_url) else jsonb_build_object('kind','internal','title',e.title,'evidenceId',e.document_id) end order by e.id) from public.vulnerability_finding_assessment_evidence_links e where e.organization_id=p_organization_id and e.assessment_id=v_source.id),'[]'::jsonb));
  end if;
  insert into public.vulnerability_finding_assessment_bulk_operations(id,organization_id,created_by,operation_kind,selection_mode,selection_filters,source_finding_id,source_assessment_id,source_assessment_version,submission,snapshot_digest,expires_at)
  values(v_operation,p_organization_id,p_actor_user_id,p_operation_kind,p_selection_mode,p_filters,p_source_finding_id,v_source.id,v_source.version,p_submission,p_request_digest,clock_timestamp()+interval '30 minutes');
  if p_selection_mode='selected_rows' then
    if jsonb_typeof(p_finding_ids)<>'array' or jsonb_array_length(p_finding_ids) not between 1 and 500 then return query select 'invalid_request'::text,null::jsonb; return; end if;
    for v_id in select jsonb_array_elements_text(p_finding_ids) loop
      begin v_finding:=v_id::uuid; exception when others then return query select 'invalid_request'::text,null::jsonb; return; end;
      if exists(select 1 from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=v_finding and f.status='active') then
        v_count:=v_count+1;
        insert into public.vulnerability_finding_assessment_bulk_operation_targets(organization_id,operation_id,finding_id,ordinal,product_name,release_name,component_identity,component_version,expected_assessment_id,expected_assessment_version,previous_assessment_id)
        select p_organization_id,v_operation,f.id,v_count,p.name,r.label,f.component_identity,coalesce(o.component_version,f.evaluated_component_value),a.id,coalesce(a.version,0),a.id
        from public.vulnerability_findings f join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
        left join lateral(select o.* from public.vulnerability_finding_component_occurrences l join public.vulnerability_component_occurrences o on o.organization_id=l.organization_id and o.id=l.occurrence_id where l.organization_id=f.organization_id and l.finding_id=f.id and l.state='active' order by o.id limit 1)o on true
        left join public.vulnerability_finding_assessments a on a.organization_id=f.organization_id and a.finding_id=f.id and a.is_current where f.organization_id=p_organization_id and f.id=v_finding;
      else
        -- Keep a supplied UUID as an attributable, generic unavailable target.
        -- It is not a tenant FK because cross-tenant UUIDs must never resolve.
        v_excluded:=v_excluded+1;
        insert into public.vulnerability_finding_assessment_bulk_operation_targets(organization_id,operation_id,finding_id,ordinal,product_name,release_name,component_identity,component_version,state,failure_code)
        values(p_organization_id,v_operation,v_finding,v_count+v_excluded,'Unavailable','Unavailable','unavailable','unavailable','excluded','not_found');
      end if;
    end loop;
  else
    loop
      select queue.result into v_queue from public.list_finding_triage_queue(p_organization_id,p_actor_user_id,coalesce(p_filters,'{}'::jsonb),100,v_cursor,'lastEvaluatedAt','desc') queue limit 1;
      if v_queue is null or jsonb_array_length(coalesce(v_queue->'filterIssues','[]'))>0 then
        delete from public.vulnerability_finding_assessment_bulk_operations where organization_id=p_organization_id and id=v_operation;
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
      for v_row in select value from jsonb_array_elements(coalesce(v_queue->'rows','[]')) loop
        v_count:=v_count+1; if v_count>500 then
          delete from public.vulnerability_finding_assessment_bulk_operation_targets where organization_id=p_organization_id and operation_id=v_operation;
          delete from public.vulnerability_finding_assessment_bulk_operations where organization_id=p_organization_id and id=v_operation;
          return query select 'limit_exceeded'::text,null::jsonb; return;
        end if;
        v_finding:=(v_row#>>'{finding,id}')::uuid;
        insert into public.vulnerability_finding_assessment_bulk_operation_targets(organization_id,operation_id,finding_id,ordinal,product_name,release_name,component_identity,component_version,expected_assessment_id,expected_assessment_version,previous_assessment_id)
        select p_organization_id,v_operation,f.id,v_count,p.name,r.label,f.component_identity,coalesce(o.component_version,f.evaluated_component_value),a.id,coalesce(a.version,0),a.id from public.vulnerability_findings f join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id join public.products p on p.organization_id=r.organization_id and p.id=r.product_id left join lateral(select o.* from public.vulnerability_finding_component_occurrences l join public.vulnerability_component_occurrences o on o.organization_id=l.organization_id and o.id=l.occurrence_id where l.organization_id=f.organization_id and l.finding_id=f.id and l.state='active' order by o.id limit 1)o on true left join public.vulnerability_finding_assessments a on a.organization_id=f.organization_id and a.finding_id=f.id and a.is_current where f.organization_id=p_organization_id and f.id=v_finding;
      end loop;
      v_cursor:=v_queue->>'nextCursor'; exit when v_cursor is null;
    end loop;
  end if;
  if p_operation_kind='propagation' then
    delete from public.vulnerability_finding_assessment_bulk_operation_targets where organization_id=p_organization_id and operation_id=v_operation;
    v_count:=0;
    for v_finding in select distinct f.id from public.vulnerability_findings f join public.vulnerability_finding_component_occurrences l on l.organization_id=f.organization_id and l.finding_id=f.id and l.state='active' join public.vulnerability_component_occurrences o on o.organization_id=l.organization_id and o.id=l.occurrence_id join public.vulnerability_findings sf on sf.organization_id=f.organization_id and sf.id=p_source_finding_id join public.vulnerability_finding_component_occurrences sl on sl.organization_id=sf.organization_id and sl.finding_id=sf.id and sl.state='active' join public.vulnerability_component_occurrences so on so.organization_id=sl.organization_id and so.id=sl.occurrence_id where f.organization_id=p_organization_id and f.status='active' and f.id<>p_source_finding_id and f.vulnerability_id=sf.vulnerability_id and so.component_version is not null and o.component_identity=so.component_identity and o.component_version=so.component_version order by f.id limit 501 loop
      v_count:=v_count+1; if v_count>500 then
        delete from public.vulnerability_finding_assessment_bulk_operation_targets where organization_id=p_organization_id and operation_id=v_operation;
        delete from public.vulnerability_finding_assessment_bulk_operations where organization_id=p_organization_id and id=v_operation;
        return query select 'limit_exceeded'::text,null::jsonb; return;
      end if;
      insert into public.vulnerability_finding_assessment_bulk_operation_targets(organization_id,operation_id,finding_id,ordinal,product_name,release_name,component_identity,component_version,expected_assessment_id,expected_assessment_version,previous_assessment_id)
      select p_organization_id,v_operation,f.id,v_count,p.name,r.label,f.component_identity,coalesce(o.component_version,f.evaluated_component_value),a.id,coalesce(a.version,0),a.id from public.vulnerability_findings f join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id join public.products p on p.organization_id=r.organization_id and p.id=r.product_id left join lateral(select o.* from public.vulnerability_finding_component_occurrences l join public.vulnerability_component_occurrences o on o.organization_id=l.organization_id and o.id=l.occurrence_id where l.organization_id=f.organization_id and l.finding_id=f.id and l.state='active' order by o.id limit 1)o on true left join public.vulnerability_finding_assessments a on a.organization_id=f.organization_id and a.finding_id=f.id and a.is_current where f.organization_id=p_organization_id and f.id=v_finding;
    end loop;
  end if;
  if v_count=0 then
    delete from public.vulnerability_finding_assessment_bulk_operations where organization_id=p_organization_id and id=v_operation;
    return query select 'no_eligible_targets'::text,null::jsonb; return;
  end if;
  update public.vulnerability_finding_assessment_bulk_operations set excluded_count=v_excluded where organization_id=p_organization_id and id=v_operation;
  insert into public.vulnerability_finding_assessment_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'bulk_preview',p_request_digest,jsonb_build_object('operation',public.m5_bulk_operation_json(p_organization_id,v_operation),'idempotent',false));
  return query select 'previewed'::text,jsonb_build_object('operation',public.m5_bulk_operation_json(p_organization_id,v_operation),'idempotent',false);
end;
$$;

alter function public.m5_bulk_operation_json(uuid,uuid) owner to postgres;
alter function public.get_vulnerability_assessment_bulk_operation(uuid,uuid,uuid) owner to postgres;
alter function public.create_vulnerability_assessment_bulk_preview_atomic(uuid,uuid,text,text,jsonb,jsonb,uuid,uuid,integer,jsonb,uuid,text) owner to postgres;
alter function public.execute_vulnerability_assessment_bulk_operation_atomic(uuid,uuid,uuid,integer,text,boolean,uuid,text) owner to postgres;
alter function public.retry_vulnerability_assessment_bulk_operation_atomic(uuid,uuid,uuid,integer,text,boolean,uuid,text) owner to postgres;
alter function public.undo_vulnerability_assessment_bulk_operation_atomic(uuid,uuid,uuid,integer,uuid,text) owner to postgres;
revoke all on function public.m5_bulk_operation_json(uuid,uuid), public.get_vulnerability_assessment_bulk_operation(uuid,uuid,uuid), public.create_vulnerability_assessment_bulk_preview_atomic(uuid,uuid,text,text,jsonb,jsonb,uuid,uuid,integer,jsonb,uuid,text), public.execute_vulnerability_assessment_bulk_operation_atomic(uuid,uuid,uuid,integer,text,boolean,uuid,text), public.retry_vulnerability_assessment_bulk_operation_atomic(uuid,uuid,uuid,integer,text,boolean,uuid,text), public.undo_vulnerability_assessment_bulk_operation_atomic(uuid,uuid,uuid,integer,uuid,text) from public, anon, authenticated;
grant execute on function public.get_vulnerability_assessment_bulk_operation(uuid,uuid,uuid), public.create_vulnerability_assessment_bulk_preview_atomic(uuid,uuid,text,text,jsonb,jsonb,uuid,uuid,integer,jsonb,uuid,text), public.execute_vulnerability_assessment_bulk_operation_atomic(uuid,uuid,uuid,integer,text,boolean,uuid,text), public.retry_vulnerability_assessment_bulk_operation_atomic(uuid,uuid,uuid,integer,text,boolean,uuid,text), public.undo_vulnerability_assessment_bulk_operation_atomic(uuid,uuid,uuid,integer,uuid,text) to service_role;
