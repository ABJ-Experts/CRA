-- The pack is a durable domain state transition. Its audit row shares the
-- transaction with the pack and command result; an audit outage aborts all three.
-- M6 attached the stage-package immutability guard to obligation packs but
-- omitted the pack's one legal reserved-to-available transition. Preserve all
-- other append-only checks while permitting that verified transition.
create or replace function public.m6_prevent_reporting_evidence_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then
    raise exception 'reporting evidence is immutable' using errcode='55000';
  end if;
  if tg_table_name='reporting_stage_packages' then
    if old.state='reserved' and new.state in ('available','failed')
      and new.id=old.id and new.organization_id=old.organization_id
      and new.obligation_id=old.obligation_id and new.stage_id=old.stage_id
      and new.approval_id=old.approval_id and new.draft_id=old.draft_id
      and new.draft_revision=old.draft_revision and new.draft_hash=old.draft_hash
      and new.storage_bucket=old.storage_bucket
      and new.storage_object_path=old.storage_object_path
      and new.generated_by_user_id=old.generated_by_user_id
      and new.reserved_at=old.reserved_at then return new;
    end if;
  elsif tg_table_name='reporting_obligation_evidence_packs' then
    if old.state='reserved' and new.state='available'
      and new.id=old.id and new.organization_id=old.organization_id
      and new.obligation_id=old.obligation_id
      and new.storage_bucket=old.storage_bucket
      and new.storage_object_path=old.storage_object_path
      and new.generated_by_user_id=old.generated_by_user_id
      and new.created_at=old.created_at
      and new.is_rehearsal=old.is_rehearsal then return new;
    end if;
  end if;
  raise exception 'reporting evidence is immutable' using errcode='55000';
end $$;
alter function public.m6_prevent_reporting_evidence_mutation() owner to postgres;
revoke all on function public.m6_prevent_reporting_evidence_mutation()
  from public,anon,authenticated;
grant execute on function public.m6_prevent_reporting_evidence_mutation()
  to service_role;

create or replace function public.reserve_reporting_obligation_evidence_pack_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_obligation_id uuid,
  p_idempotency_key uuid,p_correlation_id uuid default null
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_id uuid:=gen_random_uuid();
  v_path text;
  v_existing record;
  v_digest text;
  v_audit_outcome text;
  v_result jsonb;
begin
  if p_idempotency_key is null or not public.m5_triage_actor_has_permission(
    p_organization_id,p_actor_user_id,'can_submit_reporting')
  then return query select 'forbidden',null::jsonb; return; end if;

  v_digest:=public.m6_command_digest(jsonb_build_object('obligationId',p_obligation_id));
  select * into v_existing from public.m6_reporting_draft_command_result(
    p_organization_id,p_actor_user_id,p_idempotency_key,'reserve_evidence_pack',v_digest);
  if found then return query select v_existing.outcome,v_existing.result; return; end if;
  if not exists(select 1 from public.reporting_obligations
    where organization_id=p_organization_id and id=p_obligation_id)
  then return query select 'not_found',null::jsonb; return; end if;

  v_path:=p_organization_id::text||'/evidence-packs/'||v_id::text||'.zip';
  insert into public.reporting_obligation_evidence_packs(
    id,organization_id,obligation_id,storage_object_path,generated_by_user_id
  ) values(v_id,p_organization_id,p_obligation_id,v_path,p_actor_user_id);

  select a.outcome into v_audit_outcome from public.m13_01_append_audit_event(
    p_organization_id,'organization',
    'reporting-pack:reserve:'||p_actor_user_id::text||':'||p_idempotency_key::text,
    'user',p_actor_user_id::text,'reporting.evidence_pack_reserved',
    'reporting_obligation_evidence_pack',v_id::text,'completed',
    coalesce(p_correlation_id,p_idempotency_key),null,
    jsonb_build_object('state','reserved','sourceId',p_obligation_id,
      'objectPath',v_path),null,null,null,p_actor_user_id) as a;
  if v_audit_outcome is distinct from 'inserted' then
    raise exception 'audit_event_conflict' using errcode='23505';
  end if;

  v_result:=jsonb_build_object('evidencePack',jsonb_build_object(
    'id',v_id,'state','reserved','objectPath',v_path));
  perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,
    p_idempotency_key,'reserve_evidence_pack',v_digest,v_result);
  return query select 'created',v_result;
end $$;

create or replace function public.finalize_reporting_obligation_evidence_pack_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_pack_id uuid,p_sha256 text,
  p_byte_size bigint,p_manifest_sha256 text,p_object_path text,
  p_idempotency_key uuid,p_correlation_id uuid default null
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_pack public.reporting_obligation_evidence_packs%rowtype;
  v_existing record;
  v_digest text;
  v_audit_outcome text;
  v_result jsonb;
begin
  if p_idempotency_key is null or p_sha256 !~ '^[a-f0-9]{64}$'
    or p_manifest_sha256 !~ '^[a-f0-9]{64}$'
    or p_byte_size not between 1 and 26214400
  then return query select 'invalid_request',null::jsonb; return; end if;
  if not public.m5_triage_actor_has_permission(
    p_organization_id,p_actor_user_id,'can_submit_reporting')
  then return query select 'conflict',null::jsonb; return; end if;

  v_digest:=public.m6_command_digest(jsonb_build_object(
    'packId',p_pack_id,'sha256',p_sha256,'byteSize',p_byte_size,
    'manifestSha256',p_manifest_sha256,'objectPath',p_object_path));
  select * into v_existing from public.m6_reporting_draft_command_result(
    p_organization_id,p_actor_user_id,p_idempotency_key,'finalize_evidence_pack',v_digest);
  if found then return query select v_existing.outcome,v_existing.result; return; end if;
  select * into v_pack from public.reporting_obligation_evidence_packs
    where organization_id=p_organization_id and id=p_pack_id for update;
  if not found or v_pack.state<>'reserved'
    or v_pack.generated_by_user_id<>p_actor_user_id
    or v_pack.storage_object_path<>p_object_path
    or not exists(select 1 from storage.objects
      where bucket_id='reporting-evidence' and name=p_object_path)
  then return query select 'conflict',null::jsonb; return; end if;

  update public.reporting_obligation_evidence_packs set state='available',
    sha256=p_sha256,byte_size=p_byte_size,manifest_sha256=p_manifest_sha256,
    finalized_at=date_trunc('second',clock_timestamp())
  where organization_id=p_organization_id and id=v_pack.id;

  select a.outcome into v_audit_outcome from public.m13_01_append_audit_event(
    p_organization_id,'organization',
    'reporting-pack:finalize:'||p_actor_user_id::text||':'||p_idempotency_key::text,
    'user',p_actor_user_id::text,'reporting.evidence_pack_finalized',
    'reporting_obligation_evidence_pack',v_pack.id::text,'completed',
    coalesce(p_correlation_id,p_idempotency_key),jsonb_build_object('state','reserved'),
    jsonb_build_object('state','available','sourceId',v_pack.obligation_id,
      'sha256',p_sha256,'objectPath',p_object_path),null,null,null,p_actor_user_id) as a;
  if v_audit_outcome is distinct from 'inserted' then
    raise exception 'audit_event_conflict' using errcode='23505';
  end if;

  v_result:=jsonb_build_object('evidencePackId',v_pack.id,'state','available');
  perform public.m6_reporting_draft_command_store(p_organization_id,p_actor_user_id,
    p_idempotency_key,'finalize_evidence_pack',v_digest,v_result);
  return query select 'updated',v_result;
end $$;

alter function public.reserve_reporting_obligation_evidence_pack_atomic(uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function public.finalize_reporting_obligation_evidence_pack_atomic(uuid,uuid,uuid,text,bigint,text,text,uuid,uuid) owner to postgres;
revoke all on function public.reserve_reporting_obligation_evidence_pack_atomic(uuid,uuid,uuid,uuid,uuid),
  public.finalize_reporting_obligation_evidence_pack_atomic(uuid,uuid,uuid,text,bigint,text,text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.reserve_reporting_obligation_evidence_pack_atomic(uuid,uuid,uuid,uuid,uuid),
  public.finalize_reporting_obligation_evidence_pack_atomic(uuid,uuid,uuid,text,bigint,text,text,uuid,uuid)
  to service_role;
