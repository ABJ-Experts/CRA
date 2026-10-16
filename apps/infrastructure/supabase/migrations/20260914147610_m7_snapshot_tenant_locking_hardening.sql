-- M7-04 local hardening: align terminal failures, command idempotency, and
-- snapshot consistency without introducing cross-tenant table locks.

alter table public.technical_file_snapshot_exports
  drop constraint if exists technical_file_snapshot_exports_failure_code_check;
alter table public.technical_file_snapshot_exports
  add constraint technical_file_snapshot_exports_failure_code_check
  check (
    failure_code is null
    or failure_code in (
      'snapshot_unavailable',
      'artifact_too_large',
      'storage_unavailable',
      'source_unavailable',
      'worker_unavailable',
      'unknown'
    )
  );

-- A successor must be a later, current snapshot of exactly the same technical
-- file/purpose/product. This keeps supersession one-way and prevents a foreign
-- key in the same organization from joining unrelated files.
create or replace function public.m7_reject_technical_file_snapshot_mutation()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
declare
  successor public.technical_file_snapshots%rowtype;
begin
  if new.payload is distinct from old.payload
    or new.payload_sha256 is distinct from old.payload_sha256
    or new.payload_byte_length is distinct from old.payload_byte_length
    or new.technical_file_id is distinct from old.technical_file_id
    or new.product_id is distinct from old.product_id
    or new.release_id is distinct from old.release_id
    or new.purpose is distinct from old.purpose
    or new.technical_file_version is distinct from old.technical_file_version
    or new.template_key is distinct from old.template_key
    or new.template_version is distinct from old.template_version
    or new.readiness_status is distinct from old.readiness_status
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'technical file snapshot payload is immutable';
  end if;

  if new.status is not distinct from old.status
    and new.superseded_by_snapshot_id is not distinct from old.superseded_by_snapshot_id then
    return new;
  end if;

  if old.status <> 'current'
    or new.status <> 'superseded'
    or new.superseded_by_snapshot_id is null
    or new.superseded_by_snapshot_id = old.id then
    raise exception 'invalid technical file snapshot transition';
  end if;

  select * into successor
  from public.technical_file_snapshots
  where organization_id = old.organization_id
    and id = new.superseded_by_snapshot_id
  for key share;

  if not found
    or successor.status <> 'current'
    or successor.superseded_by_snapshot_id is not null
    or successor.product_id <> old.product_id
    or successor.technical_file_id <> old.technical_file_id
    or successor.purpose <> old.purpose
    or successor.created_at <= old.created_at then
    raise exception 'invalid technical file snapshot successor';
  end if;

  return new;
end $$;

create or replace function public.create_technical_file_snapshot_atomic(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_product_id uuid,
  p_expected_technical_file_version integer,
  p_purpose text,
  p_release_id uuid,
  p_audit_rationale text,
  p_idempotency_key uuid
)
returns table(outcome text,result jsonb)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  f public.technical_files%rowtype;
  r public.product_releases%rowtype;
  snapshot_id uuid;
  payload jsonb;
  payload_text text;
  payload_digest text;
  command_digest text;
  replay record;
  legacy_matches boolean;
  readiness jsonb;
  retention jsonb;
  technical_file jsonb;
begin
  if p_purpose not in ('release','audit')
    or p_expected_technical_file_version < 1
    or p_idempotency_key is null
    or not public.m7_technical_file_actor_can(
      p_organization_id,p_actor_user_id,'can_snapshot_technical_files'
    ) then
    return query select 'forbidden',null::jsonb;
    return;
  end if;

  command_digest := encode(
    extensions.digest(
      jsonb_build_object(
        'operation','snapshot',
        'productId',p_product_id,
        'expectedTechnicalFileVersion',p_expected_technical_file_version,
        'purpose',p_purpose,
        'releaseId',p_release_id,
        'auditRationale',case when p_purpose='audit' then btrim(p_audit_rationale) else null end
      )::text,
      'sha256'
    ),
    'hex'
  );

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_organization_id::text || ':' || p_actor_user_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  select a.* into replay
  from public.audit_logs a
  where a.organization_id=p_organization_id
    and a.user_id=p_actor_user_id
    and a.changes->>'idempotencyKey'=p_idempotency_key::text
  order by a.created_at desc,a.id desc
  limit 1;

  if found then
    if replay.action <> 'technical_file.snapshot_created' then
      return query select 'idempotency_conflict',null::jsonb;
      return;
    end if;

    if replay.changes->>'commandDigest' = command_digest then
      return query select 'replayed',public.m7_snapshot_json(
        p_organization_id,(replay.changes->>'snapshotId')::uuid
      );
      return;
    end if;

    -- Older local records predate commandDigest. They can only replay when
    -- their immutable command fields exactly equal this command.
    select exists(
      select 1
      from public.technical_file_snapshots s
      where s.organization_id=p_organization_id
        and s.id=(replay.changes->>'snapshotId')::uuid
        and s.product_id=p_product_id
        and s.technical_file_version=p_expected_technical_file_version
        and s.purpose=p_purpose
        and s.release_id is not distinct from p_release_id
        and s.audit_rationale is not distinct from case when p_purpose='audit' then btrim(p_audit_rationale) else null end
    ) into legacy_matches;
    if legacy_matches then
      return query select 'replayed',public.m7_snapshot_json(
        p_organization_id,(replay.changes->>'snapshotId')::uuid
      );
    else
      return query select 'idempotency_conflict',null::jsonb;
    end if;
    return;
  end if;

  -- Every M7 mutation that can add a risk takes this same per-file advisory
  -- lock. It closes the new-risk race without blocking unrelated tenants.
  select * into f
  from public.technical_files
  where organization_id=p_organization_id
    and product_id=p_product_id
    and status='active'
  for update;
  if not found then
    return query select 'not_found',null::jsonb;
    return;
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || f.id::text,0)
  );
  if f.version<>p_expected_technical_file_version then
    return query select 'conflict',jsonb_build_object('currentVersion',f.version);
    return;
  end if;

  -- Row-level locks establish a stable revision set for only this file.
  perform 1 from public.products
  where organization_id=p_organization_id and id=p_product_id
  for share;
  perform 1 from public.technical_file_sections
  where organization_id=p_organization_id and technical_file_id=f.id
  order by sort_order,id
  for share;
  perform 1
  from public.technical_file_section_sources x
  join public.technical_file_sections s
    on s.organization_id=x.organization_id and s.id=x.section_id
  where x.organization_id=p_organization_id and s.technical_file_id=f.id
  for share of x;
  perform 1
  from public.technical_file_section_source_reviews review
  join public.technical_file_section_sources x
    on x.organization_id=review.organization_id and x.id=review.section_source_id
  join public.technical_file_sections s
    on s.organization_id=x.organization_id and s.id=x.section_id
  where review.organization_id=p_organization_id and s.technical_file_id=f.id
  for share of review;
  perform 1 from public.technical_file_risk_registers
  where organization_id=p_organization_id and technical_file_id=f.id
  for share;
  perform 1
  from public.technical_file_risks risk
  join public.technical_file_risk_registers register
    on register.organization_id=risk.organization_id and register.id=risk.risk_register_id
  where risk.organization_id=p_organization_id and register.technical_file_id=f.id
  for share of risk;
  perform 1
  from public.technical_file_risk_revisions revision
  join public.technical_file_risks risk
    on risk.organization_id=revision.organization_id and risk.id=revision.risk_id
  join public.technical_file_risk_registers register
    on register.organization_id=risk.organization_id and register.id=risk.risk_register_id
  where revision.organization_id=p_organization_id and register.technical_file_id=f.id
  for share of revision;
  perform 1
  from public.technical_file_risk_revision_assets asset
  join public.technical_file_risk_revisions revision
    on revision.organization_id=asset.organization_id and revision.id=asset.revision_id
  join public.technical_file_risks risk
    on risk.organization_id=revision.organization_id and risk.id=revision.risk_id
  join public.technical_file_risk_registers register
    on register.organization_id=risk.organization_id and register.id=risk.risk_register_id
  where asset.organization_id=p_organization_id and register.technical_file_id=f.id
  for share of asset;
  perform 1
  from public.technical_file_risk_revision_requirements requirement
  join public.technical_file_risk_revisions revision
    on revision.organization_id=requirement.organization_id and revision.id=requirement.revision_id
  join public.technical_file_risks risk
    on risk.organization_id=revision.organization_id and risk.id=revision.risk_id
  join public.technical_file_risk_registers register
    on register.organization_id=risk.organization_id and register.id=risk.risk_register_id
  where requirement.organization_id=p_organization_id and register.technical_file_id=f.id
  for share of requirement;
  perform 1
  from public.technical_file_risk_revision_evidence evidence
  join public.technical_file_risk_revisions revision
    on revision.organization_id=evidence.organization_id and revision.id=evidence.revision_id
  join public.technical_file_risks risk
    on risk.organization_id=revision.organization_id and risk.id=revision.risk_id
  join public.technical_file_risk_registers register
    on register.organization_id=risk.organization_id and register.id=risk.risk_register_id
  where evidence.organization_id=p_organization_id and register.technical_file_id=f.id
  for share of evidence;

  if p_purpose='release' then
    select * into r
    from public.product_releases
    where organization_id=p_organization_id
      and product_id=p_product_id
      and id=p_release_id
      and archived_at is null
      and lifecycle='released'
    for share;
    if not found then
      return query select 'invalid_request',null::jsonb;
      return;
    end if;
  elsif p_release_id is not null
    or char_length(btrim(coalesce(p_audit_rationale,''))) not between 1 and 4000 then
    return query select 'invalid_request',null::jsonb;
    return;
  end if;

  select x.result->'technicalFile' into technical_file
  from public.get_technical_file(p_organization_id,p_actor_user_id,p_product_id) x
  where x.outcome='found';
  if technical_file is null then
    return query select 'not_found',null::jsonb;
    return;
  end if;
  readiness:=public.m7_evidence_readiness_json(p_organization_id,p_product_id);
  select t.retention into retention
  from public.get_product_retention_calculation(p_organization_id,p_product_id,p_actor_user_id) t
  where t.outcome='found';
  if retention is null then
    return query select 'invalid_request',null::jsonb;
    return;
  end if;

  payload:=jsonb_build_object(
    'schemaVersion','m7_04_v1',
    'capturedAt',public.m7_snapshot_timestamp_utc(clock_timestamp()),
    'technicalFile',technical_file,
    'readiness',readiness,
    'riskRegister',public.m7_risk_register_json(p_organization_id,p_product_id,true),
    'retention',retention
  );
  payload_text:=payload::text;
  payload_digest:=encode(extensions.digest(payload_text,'sha256'),'hex');
  if octet_length(payload_text)>5242880 then
    return query select 'invalid_request',null::jsonb;
    return;
  end if;

  insert into public.technical_file_snapshots(
    organization_id,technical_file_id,product_id,release_id,purpose,audit_rationale,
    technical_file_version,template_key,template_version,readiness_status,payload,
    payload_sha256,payload_byte_length,created_by
  ) values (
    p_organization_id,f.id,p_product_id,p_release_id,p_purpose,
    case when p_purpose='audit' then btrim(p_audit_rationale) else null end,
    f.version,f.template_key,f.template_version,coalesce(readiness->>'overallStatus','empty'),
    payload,payload_digest,octet_length(payload_text),p_actor_user_id
  ) returning id into snapshot_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values (
    p_organization_id,p_actor_user_id,'technical_file.snapshot_created',
    'technical_file_snapshot',snapshot_id::text,
    jsonb_build_object(
      'snapshotId',snapshot_id,
      'idempotencyKey',p_idempotency_key,
      'commandDigest',command_digest,
      'payloadDigest',payload_digest
    )
  );
  return query select 'created',public.m7_snapshot_json(p_organization_id,snapshot_id);
end $$;

revoke all on function public.m7_reject_technical_file_snapshot_mutation(),public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid) to service_role;
alter function public.m7_reject_technical_file_snapshot_mutation() owner to postgres;
alter function public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid) owner to postgres;

notify pgrst, 'reload schema';
