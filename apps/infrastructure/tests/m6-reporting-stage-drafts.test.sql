begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$ begin if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if; end $$;

select pg_temp.check('M6-03 tables are private service-role records',
  (select relrowsecurity and not relforcerowsecurity from pg_class where oid='public.reporting_stage_drafts'::regclass)
  and not has_table_privilege('authenticated','public.reporting_stage_drafts','select,insert,update,delete')
  and has_table_privilege('service_role','public.reporting_stage_drafts','select,insert,update,delete'));

select pg_temp.check('M6-03 draft RPCs are pinned service-only security definers',
  has_function_privilege('service_role','public.save_reporting_stage_draft_atomic(uuid,uuid,uuid,integer,uuid,jsonb,jsonb,jsonb,uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.save_reporting_stage_draft_atomic(uuid,uuid,uuid,integer,uuid,jsonb,jsonb,jsonb,uuid,uuid)','execute')
  and (select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_proc where oid='public.save_reporting_stage_draft_atomic(uuid,uuid,uuid,integer,uuid,jsonb,jsonb,jsonb,uuid,uuid)'::regprocedure));

do $$
declare v_org uuid:='00000000-0000-4000-8000-0000000000ca'; v_actor uuid; v_release uuid; v_created record; v_draft uuid; v_lock record; v_saved record; v_review_saved record; v_replayed record; v_idempotency_conflict record; v_stale record; v_cross record; v_expired record; v_template record; v_applied record; v_review_block record; v_submitted record; v_obligation uuid; v_stage uuid; v_save_key uuid:=gen_random_uuid();
begin
 select id into v_actor from public.users where email='owner@cra.test';
 select r.id into v_release from public.product_releases r where r.organization_id=v_org and r.archived_at is null order by r.created_at limit 1;
 select * into v_created from public.create_reporting_obligation_atomic(v_org,v_actor,'severe_incident',null,clock_timestamp()-interval '1 hour','Draft SQL test',gen_random_uuid(),gen_random_uuid());
 v_obligation:=(v_created.result->'obligation'->>'id')::uuid;
 select id into v_stage from public.reporting_obligation_stages where organization_id=v_org and obligation_id=v_obligation and stage_kind='early_warning';
 select * into v_created from public.create_reporting_stage_draft_atomic(v_org,v_actor,v_obligation,v_stage,v_release,gen_random_uuid(),gen_random_uuid());
 v_draft:=(v_created.result->'draft'->>'id')::uuid;
 select * into v_lock from public.acquire_reporting_stage_draft_lock_atomic(v_org,v_actor,v_draft,1,gen_random_uuid(),gen_random_uuid());
 select * into v_saved from public.save_reporting_stage_draft_atomic(v_org,v_actor,v_draft,1,(v_lock.result->>'lockToken')::uuid,'{"summary":"confirmed","impact":"bounded"}'::jsonb,'{"summary":{"origin":"human"},"impact":{"origin":"human"}}'::jsonb,'[{"countryCode":"DE","provenance":{"origin":"human"}}]'::jsonb,v_save_key,gen_random_uuid());
 select * into v_replayed from public.save_reporting_stage_draft_atomic(v_org,v_actor,v_draft,1,(v_lock.result->>'lockToken')::uuid,'{"summary":"confirmed","impact":"bounded"}'::jsonb,'{"summary":{"origin":"human"},"impact":{"origin":"human"}}'::jsonb,'[{"countryCode":"DE","provenance":{"origin":"human"}}]'::jsonb,v_save_key,gen_random_uuid());
 select * into v_idempotency_conflict from public.save_reporting_stage_draft_atomic(v_org,v_actor,v_draft,1,(v_lock.result->>'lockToken')::uuid,'{"summary":"changed","impact":"bounded"}'::jsonb,'{"summary":{"origin":"human"},"impact":{"origin":"human"}}'::jsonb,'[{"countryCode":"DE","provenance":{"origin":"human"}}]'::jsonb,v_save_key,gen_random_uuid());
 update public.reporting_stage_drafts set lock_expires_at=clock_timestamp()-interval '1 second' where organization_id=v_org and id=v_draft;
 select * into v_expired from public.save_reporting_stage_draft_atomic(v_org,v_actor,v_draft,2,(v_lock.result->>'lockToken')::uuid,'{"summary":"confirmed","impact":"bounded"}'::jsonb,'{"summary":{"origin":"human"},"impact":{"origin":"human"}}'::jsonb,'[{"countryCode":"DE","provenance":{"origin":"human"}}]'::jsonb,gen_random_uuid(),gen_random_uuid());
 select * into v_lock from public.acquire_reporting_stage_draft_lock_atomic(v_org,v_actor,v_draft,2,gen_random_uuid(),gen_random_uuid());
 select * into v_template from public.create_reporting_family_template_atomic(v_org,v_actor,'M6 SQL template','severe_incident','early_warning','Reusable impact wording','{"fields":[{"value":{"key":"summary","type":"long_text","value":"templated summary"},"provenance":{"origin":"human","actor":{"userId":"00000000-0000-0000-0000-000000000000","displayName":"Ignored"},"recordedAt":"2026-09-10T00:00:00Z"},"updatedAt":"2026-09-10T00:00:00Z"}]}'::jsonb,gen_random_uuid(),gen_random_uuid());
 select * into v_applied from public.apply_reporting_family_template_atomic(v_org,v_actor,v_draft,(v_template.result->'template'->'currentVersion'->>'id')::uuid,2,(v_lock.result->>'lockToken')::uuid,gen_random_uuid(),gen_random_uuid());
 select * into v_review_block from public.submit_reporting_stage_draft_atomic(v_org,v_actor,v_draft,3,(v_lock.result->>'lockToken')::uuid,'blocked before review',gen_random_uuid(),gen_random_uuid());
 select * into v_review_saved from public.save_reporting_stage_draft_atomic(v_org,v_actor,v_draft,3,(v_lock.result->>'lockToken')::uuid,'{"summary":"reviewed template","impact":"bounded"}'::jsonb,'{"summary":{"origin":"platform"},"impact":{"origin":"human"}}'::jsonb,'[{"countryCode":"DE","provenance":{"origin":"human"}}]'::jsonb,gen_random_uuid(),gen_random_uuid());
 select * into v_stale from public.save_reporting_stage_draft_atomic(v_org,v_actor,v_draft,1,(v_lock.result->>'lockToken')::uuid,'{"summary":"stale","impact":"bounded"}'::jsonb,'{"summary":{"origin":"human"},"impact":{"origin":"human"}}'::jsonb,'[{"countryCode":"DE","provenance":{"origin":"human"}}]'::jsonb,gen_random_uuid(),gen_random_uuid());
 select * into v_submitted from public.submit_reporting_stage_draft_atomic(v_org,v_actor,v_draft,4,(v_lock.result->>'lockToken')::uuid,'filing ref 603',gen_random_uuid(),gen_random_uuid());
 select * into v_cross from public.get_reporting_stage_draft('00000000-0000-4000-8000-0000000000cb',v_actor,v_stage);
 perform pg_temp.check('M6-03 locks, revisions and conflicts preserve the current draft',v_created.outcome='created' and v_lock.outcome='updated' and v_saved.outcome='updated' and v_review_saved.outcome='updated' and v_replayed.outcome='idempotent' and v_replayed.result=v_saved.result and v_idempotency_conflict.outcome='conflict' and v_idempotency_conflict.result is null and v_expired.outcome='locked' and v_review_block.outcome='invalid_state' and v_submitted.outcome='updated' and v_stale.outcome='conflict' and v_stale.result ? 'draft' and v_cross.outcome='not_found' and (select count(*)=4 from public.reporting_stage_draft_revisions where organization_id=v_org and draft_id=v_draft));
 perform pg_temp.check('M6-03 saved corrections are durably attributed to the actor',
  (select field_provenance->'summary'->>'origin'='human' and field_provenance->'summary'->'actor'->>'userId'=v_actor::text and field_provenance->'_memberStates'->'DE'->>'origin'='human' from public.reporting_stage_drafts where organization_id=v_org and id=v_draft));
 perform pg_temp.check('M6-03 submission advances the canonical stage and obligation atomically',
  (select state='submitted' and submitted_at is not null and submission_reference='filing ref 603' from public.reporting_obligation_stages where organization_id=v_org and id=v_stage)
  and (select version=2 from public.reporting_obligations where organization_id=v_org and id=v_obligation)
  and exists(select 1 from public.reporting_obligation_events where organization_id=v_org and obligation_id=v_obligation and event_kind='stage_submitted'));
 perform pg_temp.check('M6-03 templates are scoped, described and review gated',
  v_template.outcome='created' and v_template.result->'template'->>'description'='Reusable impact wording' and v_applied.outcome='updated' and v_applied.result->'draft'->>'requiresTemplateReview'='true' and (select result->'templates'->0->>'id' from public.list_reporting_family_templates(v_org,v_actor,'severe_incident','early_warning'))=(v_template.result->'template'->>'id'));
 perform pg_temp.check('M6-03 normalized draft never exposes lock token',not ((select public.m6_reporting_draft_json(v_org,v_draft))::text like '%lockToken%') and (select public.m6_reporting_draft_json(v_org,v_draft) ? 'fieldDefinitions'));
end $$;

rollback;
