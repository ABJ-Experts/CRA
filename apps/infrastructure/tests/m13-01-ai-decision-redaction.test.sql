begin;

create or replace function pg_temp.check(p_name text,p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;

do $$
declare
  v_owner uuid;
  v_field record;
  v_result record;
  v_key uuid:=gen_random_uuid();
  v_probe jsonb;
  v_forged_rejected boolean:=false;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  perform pg_temp.check('seed owner exists',v_owner is not null);
  select
    f.organization_id,f.id as field_id,f.version as field_version,
    f.run_id,f.evidence_version_id,f.evidence_sha256,
    s.id as submission_id,s.updated_at as submission_updated_at,
    r.id as request_id,r.product_id,r.version as request_version,
    ai.model,ai.prompt_version
  into v_field
  from public.supplier_document_fields f
  join public.supplier_evidence_submissions s
    on s.organization_id=f.organization_id and s.id=f.submission_id
  join public.supplier_evidence_requests r
    on r.organization_id=f.organization_id and r.id=s.request_id
  join public.ai_inference_runs ai
    on ai.organization_id=f.organization_id and ai.id=f.run_id
  where f.status='pending'
    and (public.m9_05_context(f.organization_id,v_owner,r.product_id,s.id)->>'accepted')::boolean
    and (public.m9_05_context(f.organization_id,v_owner,r.product_id,s.id)->>'current')::boolean
  order by f.created_at
  limit 1;
  perform pg_temp.check('seed has authorized pending AI field',v_field.field_id is not null);

  select * into v_result from public.decide_supplier_document_field_atomic(
    v_field.organization_id,v_owner,v_field.product_id,v_field.request_id,
    v_field.submission_id,v_field.request_version,v_field.submission_updated_at,
    v_field.evidence_version_id,v_field.evidence_sha256,
    v_field.field_id,v_field.field_version,'confirmed',
    'M13-AI-Secret-Canary-123456',v_key);
  perform pg_temp.check('existing AI field decision commits',v_result.outcome='confirmed');
  perform pg_temp.check('decision audit keeps references and redacts content',
    (select a.changes->>'submissionId'=v_field.submission_id::text
      and a.changes->>'evidenceVersionId'=v_field.evidence_version_id::text
      and a.changes->>'runId'=v_field.run_id::text
      and a.changes->>'model'=v_field.model
      and a.changes->>'promptVersion'=v_field.prompt_version
      and a.changes->>'userId'=v_owner::text
      and a.changes->>'fieldId'=v_field.field_id::text
      and a.changes->>'decision'='confirmed'
      and a.changes->>'idempotencyKey'=v_key::text
      and a.changes->>'originalValue'='[REDACTED]'
      and a.changes->>'correctedValue'='[REDACTED]'
      and a.changes->>'sourceSpan'='[REDACTED]'
      and position('M13-AI-Secret-Canary-123456' in a.changes::text)=0
    from public.audit_logs a
    where a.organization_id=v_field.organization_id
      and a.action='supplier.document_field_confirmed'
      and a.entity_id=v_field.field_id::text
      and a.changes->>'idempotencyKey'=v_key::text));
  perform pg_temp.check('decision has one authoritative audit event',
    (select count(*)=1 from public.audit_logs a
      where a.organization_id=v_field.organization_id
        and a.action='supplier.document_field_confirmed'
        and a.entity_id=v_field.field_id::text
        and a.changes->>'idempotencyKey'=v_key::text));
  perform pg_temp.check('source run retains model and prompt provenance',
    v_field.run_id is not null and nullif(v_field.model,'') is not null
      and nullif(v_field.prompt_version,'') is not null
      and exists(select 1 from public.ai_inference_runs ai
        where ai.organization_id=v_field.organization_id and ai.id=v_field.run_id
          and ai.model=v_field.model and ai.prompt_version=v_field.prompt_version));

  begin
    insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values('00000000-0000-4000-8000-0000000000cb',v_owner,
      'supplier.document_field_confirmed','supplier_document_field',v_field.field_id::text,
      jsonb_build_object('idempotencyKey',v_key));
  exception when sqlstate '22023' then
    v_forged_rejected:=true;
  end;
  perform pg_temp.check('AI provenance rejects a forged organization',v_forged_rejected);

  update public.ai_inference_runs set model='M13-AI-Secret-Canary-123456'
    where organization_id=v_field.organization_id and id=v_field.run_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(v_field.organization_id,v_owner,'supplier.document_field_confirmed',
    'supplier_document_field',v_field.field_id::text,
    jsonb_build_object('idempotencyKey',v_key,'model','forged','originalValue','secret-canary'))
  returning changes into v_probe;
  perform pg_temp.check('unsafe run metadata and direct secret fields fail closed',
    v_probe->>'model'='[REDACTED]'
    and v_probe->>'originalValue'='[REDACTED]'
    and v_probe->>'runId'=v_field.run_id::text
    and position('M13-AI-Secret-Canary-123456' in v_probe::text)=0);
end $$;

rollback;
