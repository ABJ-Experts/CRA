begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$ begin
  if not coalesce(p_ok, false) then raise exception 'check failed: %', p_name; end if;
end $$;

select pg_temp.check('M6-05 evidence tables are private service-role records',
  (select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.reporting_stage_packages'::regclass)
  and (select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.reporting_stage_filing_proofs'::regclass)
  and (select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.reporting_stage_submission_acknowledgements'::regclass)
  and not has_table_privilege('authenticated','public.reporting_stage_packages','select,insert,update,delete')
  and has_table_privilege('service_role','public.reporting_stage_packages','select,insert,update,delete'));

select pg_temp.check('M6-05 command RPCs are pinned security definers and service-only',
  has_function_privilege('service_role','public.reserve_reporting_stage_package_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.reserve_reporting_stage_package_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,uuid,uuid)','execute')
  and (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.record_reporting_stage_filing_atomic(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,timestamp with time zone,text,text,text,text,bigint,text,text,uuid,uuid)'::regprocedure));

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid; v_release uuid; v_obligation uuid; v_stage uuid; v_draft uuid;
  v_create record; v_lock record; v_save record; v_proof record; v_approval record; v_reserve record;
  v_hash text; v_package uuid; v_mutation_blocked boolean := false;
begin
  select id into v_actor from public.users where email='owner@cra.test';
  select id into v_release from public.product_releases where organization_id=v_org and archived_at is null order by created_at limit 1;
  select * into v_create from public.create_reporting_obligation_atomic(v_org,v_actor,'severe_incident',null,clock_timestamp()-interval '1 hour','M6-05 evidence SQL test',gen_random_uuid(),gen_random_uuid());
  v_obligation := (v_create.result->'obligation'->>'id')::uuid;
  select id into v_stage from public.reporting_obligation_stages where organization_id=v_org and obligation_id=v_obligation and stage_kind='early_warning';
  select * into v_create from public.create_reporting_stage_draft_atomic(v_org,v_actor,v_obligation,v_stage,v_release,gen_random_uuid(),gen_random_uuid());
  v_draft := (v_create.result->'draft'->>'id')::uuid;
  select * into v_lock from public.acquire_reporting_stage_draft_lock_atomic(v_org,v_actor,v_draft,1,gen_random_uuid(),gen_random_uuid());
  select * into v_save from public.save_reporting_stage_draft_atomic(v_org,v_actor,v_draft,1,(v_lock.result->>'lockToken')::uuid,
    '{"summary":"confirmed","impact":"bounded"}'::jsonb,
    '{"summary":{"origin":"human"},"impact":{"origin":"human"}}'::jsonb,
    '[{"countryCode":"DE","provenance":{"origin":"human"}}]'::jsonb,gen_random_uuid(),gen_random_uuid());
  select public.m6_reporting_draft_hash(d) into v_hash from public.reporting_stage_drafts d where d.organization_id=v_org and d.id=v_draft;
  select * into v_proof from public.create_reporting_stage_approval_proof_atomic(v_org,v_actor,gen_random_uuid(),v_draft,2,v_hash,clock_timestamp()+interval '2 minutes',gen_random_uuid());
  select * into v_approval from public.approve_reporting_stage_draft_atomic(v_org,v_actor,
    (select session_id from public.reporting_stage_approval_proofs where id=(v_proof.result->>'reauthenticationProofId')::uuid),v_draft,2,v_hash,
    (v_proof.result->>'reauthenticationProofId')::uuid,null,'Deliberate owner self-approval for SQL test.',gen_random_uuid(),gen_random_uuid());
  select * into v_reserve from public.reserve_reporting_stage_package_atomic(v_org,v_actor,v_obligation,v_stage,
    (v_approval.result->'approval'->>'id')::uuid,2,v_hash,gen_random_uuid(),gen_random_uuid());
  v_package := (v_reserve.result->'package'->>'id')::uuid;
  begin
    update public.reporting_stage_packages set draft_hash=repeat('a',64) where organization_id=v_org and id=v_package;
  exception when sqlstate '55000' then v_mutation_blocked := true;
  end;
  perform pg_temp.check('M6-05 approval does not create filing or stop deadline',
    v_save.outcome='updated' and v_proof.outcome='created' and v_approval.outcome='updated'
    and not exists(select 1 from public.reporting_stage_submissions where organization_id=v_org and stage_id=v_stage)
    and (select state in ('running','overdue') and submitted_at is null from public.reporting_obligation_stages where organization_id=v_org and id=v_stage)
    and exists(select 1 from public.reporting_obligation_events where organization_id=v_org and obligation_id=v_obligation and event_kind='stage_approved'));
  perform pg_temp.check('M6-05 package is exact approved snapshot and append-only',
    v_reserve.outcome='created'
    and (select state='reserved' and draft_revision=2 and draft_hash=v_hash and storage_object_path like v_org::text||'/'||v_stage::text||'/packages/%' from public.reporting_stage_packages where organization_id=v_org and id=v_package)
    and v_mutation_blocked);
end $$;

rollback;
