-- Enrich the existing M9 decision event, without introducing a second writer.
-- This trigger runs before m13_01_guard_audit_insert (trigger name order); the
-- latter still redacts legacy secret-bearing keys before persistence.
create or replace function public.m13_01_enrich_ai_decision_audit()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_field public.supplier_document_fields%rowtype;
  v_run public.ai_inference_runs%rowtype;
  v_safe jsonb;
begin
  if new.entity_id is null
    or new.entity_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or new.organization_id is null or new.user_id is null
  then
    raise exception 'AI decision audit source mismatch' using errcode='22023';
  end if;

  select f.* into v_field from public.supplier_document_fields f
  where f.organization_id=new.organization_id and f.id=new.entity_id::uuid
    and f.run_id is not null and f.reviewed_by_user_id=new.user_id
    and f.status=substring(new.action from length('supplier.document_field_')+1)
    and f.idempotency_key::text=new.changes->>'idempotencyKey';
  if not found then
    raise exception 'AI decision audit source mismatch' using errcode='22023';
  end if;

  select r.* into v_run from public.ai_inference_runs r
  where r.organization_id=v_field.organization_id and r.id=v_field.run_id
    and r.submission_id=v_field.submission_id
    and r.evidence_version_id=v_field.evidence_version_id;
  if not found then
    raise exception 'AI decision audit run mismatch' using errcode='22023';
  end if;

  -- The v2 projector allows only typed references and bounded code values.
  -- Unsafe model/prompt labels become markers, never copied as free text.
  v_safe:=public.m13_01_project_v2_audit_json(jsonb_build_object(
    'fieldId',v_field.id,'runId',v_run.id,'submissionId',v_run.submission_id,
    'evidenceVersionId',v_run.evidence_version_id,'userId',v_field.reviewed_by_user_id,
    'model',v_run.model,'promptVersion',v_run.prompt_version,'decision',v_field.status));
  new.changes:=coalesce(new.changes,'{}'::jsonb)||v_safe;
  return new;
end $$;

alter function public.m13_01_enrich_ai_decision_audit() owner to postgres;
revoke all on function public.m13_01_enrich_ai_decision_audit()
  from public,anon,authenticated,service_role;

create trigger m13_01_ai_decision_provenance
  before insert on public.audit_logs
  for each row
  when (new.schema_version=1
    and new.entity_type='supplier_document_field'
    and new.action in ('supplier.document_field_confirmed','supplier.document_field_rejected'))
  execute function public.m13_01_enrich_ai_decision_audit();
