begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'check failed: %', p_name;
  end if;
end;
$$;

select pg_temp.check(
  'M5-07 notes are private tenant records with a mutable timestamp trigger',
  (select relrowsecurity from pg_class where oid='public.vulnerability_finding_notes'::regclass)
  and not (select relforcerowsecurity from pg_class where oid='public.vulnerability_finding_notes'::regclass)
  and not has_table_privilege('authenticated','public.vulnerability_finding_notes','select')
  and exists (
    select 1 from pg_trigger
    where tgrelid='public.vulnerability_finding_notes'::regclass
      and tgname='set_vulnerability_finding_notes_updated_at' and not tgisinternal
  )
  and exists (
    select 1 from pg_constraint
    where conrelid='public.vulnerability_finding_note_mentions'::regclass
      and contype='u' and pg_get_constraintdef(oid) like '%note_id, recipient_user_id%'
  )
);

select pg_temp.check(
  'M5-07 note RPCs are service-only security definers with pinned paths',
  has_function_privilege('service_role','public.create_finding_triage_note_atomic(uuid,uuid,uuid,text,uuid[],uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.create_finding_triage_note_atomic(uuid,uuid,uuid,text,uuid[],uuid,uuid)','execute')
  and has_function_privilege('service_role','public.get_finding_triage_note_mention_notification_details(uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.get_finding_triage_note_mention_notification_details(uuid,uuid)','execute')
  and (select proconfig::text like '%search_path=public, pg_temp%'
       from pg_proc where oid='public.create_finding_triage_note_atomic(uuid,uuid,uuid,text,uuid[],uuid,uuid)'::regprocedure)
  and position('public.vulnerability_finding_notes' in pg_get_functiondef(
        'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure
      )) > 0
  and position('public.vulnerability_finding_note_revisions' in pg_get_functiondef(
        'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure
      )) > 0
  and position('public.vulnerability_finding_note_mentions' in pg_get_functiondef(
        'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure
      )) > 0
);

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_recipient uuid;
  v_finding uuid;
  v_create record;
  v_replay record;
  v_update record;
  v_delete record;
  v_invalid record;
  v_note_id uuid;
  v_create_key uuid := gen_random_uuid();
begin
  select u.id into v_actor from public.users u where u.email='owner@cra.test';
  select m.user_id into v_recipient from public.organization_members m
  where m.organization_id=v_org and m.user_id<>v_actor order by m.user_id limit 1;
  select f.id into v_finding from public.vulnerability_findings f
  where f.organization_id=v_org and f.status='active' order by f.id limit 1;

  select * into v_create from public.create_finding_triage_note_atomic(
    v_org,v_actor,v_finding,'M5-07 SQL transaction note',array[v_recipient],v_create_key,gen_random_uuid()
  );
  v_note_id := (v_create.result->'note'->>'id')::uuid;
  select * into v_replay from public.create_finding_triage_note_atomic(
    v_org,v_actor,v_finding,'M5-07 SQL transaction note',array[v_recipient],v_create_key,gen_random_uuid()
  );
  select * into v_update from public.update_finding_triage_note_atomic(
    v_org,v_actor,v_finding,v_note_id,'M5-07 SQL transaction note updated',array[v_recipient],1,gen_random_uuid(),gen_random_uuid()
  );
  select * into v_invalid from public.create_finding_triage_note_atomic(
    v_org,v_actor,v_finding,'duplicate mention input',array[v_recipient,v_recipient],gen_random_uuid(),gen_random_uuid()
  );
  select * into v_delete from public.delete_finding_triage_note_atomic(
    v_org,v_actor,v_finding,v_note_id,2,gen_random_uuid(),gen_random_uuid()
  );
  perform pg_temp.check(
    'M5-07 create/replay/update/tombstone are atomic and deduplicate recipients',
    v_create.outcome='created'
    and v_replay.outcome='idempotent'
    and (v_replay.result->'note'->>'id')::uuid=v_note_id
    and v_update.outcome='updated'
    and v_invalid.outcome='not_found'
    and v_delete.outcome='deleted'
    and (select version=3 and deleted_at is not null and body is null from public.vulnerability_finding_notes where id=v_note_id)
    and (select count(*)=3 from public.vulnerability_finding_note_revisions where note_id=v_note_id)
    and (select count(*)=1 from public.vulnerability_finding_note_mentions where note_id=v_note_id)
    and (select notification_status='cancelled' from public.vulnerability_finding_note_mentions where note_id=v_note_id)
    and (select count(*)=3 from public.audit_logs where entity_type='vulnerability_finding_note' and entity_id=v_note_id::text)
  );
end;
$$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_finding uuid;
  v_oldest record;
  v_middle record;
  v_newest record;
  v_page_one record;
  v_page_two record;
begin
  select u.id into v_actor from public.users u where u.email='owner@cra.test';
  select f.id into v_finding from public.vulnerability_findings f
  where f.organization_id=v_org and f.status='active' order by f.id limit 1;

  select * into v_oldest from public.create_finding_triage_note_atomic(
    v_org,v_actor,v_finding,'M5-07 oldest pagination note',array[]::uuid[],gen_random_uuid(),gen_random_uuid()
  );
  select * into v_middle from public.create_finding_triage_note_atomic(
    v_org,v_actor,v_finding,'M5-07 middle pagination note',array[]::uuid[],gen_random_uuid(),gen_random_uuid()
  );
  select * into v_newest from public.create_finding_triage_note_atomic(
    v_org,v_actor,v_finding,'M5-07 newest pagination note',array[]::uuid[],gen_random_uuid(),gen_random_uuid()
  );

  update public.vulnerability_finding_notes set created_at='2099-09-09 08:00:00+00'
  where id=(v_oldest.result->'note'->>'id')::uuid;
  update public.vulnerability_finding_notes set created_at='2099-09-09 08:01:00+00'
  where id=(v_middle.result->'note'->>'id')::uuid;
  update public.vulnerability_finding_notes set created_at='2099-09-09 08:02:00+00'
  where id=(v_newest.result->'note'->>'id')::uuid;

  select * into v_page_one from public.list_finding_triage_notes(v_org,v_actor,v_finding,null,2);
  select * into v_page_two from public.list_finding_triage_notes(
    v_org,v_actor,v_finding,v_page_one.result->>'nextCursor',2
  );
  perform pg_temp.check(
    'M5-07 note listing uses the last ordered row as its keyset cursor',
    v_page_one.outcome='found'
    and jsonb_array_length(v_page_one.result->'notes')=2
    and v_page_one.result->>'nextCursor' is not null
    and (v_page_one.result->>'nextCursor') !~ E'[\\r\\n]'
    and (v_page_one.result->'notes'->0->>'id')::uuid=(v_newest.result->'note'->>'id')::uuid
    and (v_page_one.result->'notes'->1->>'id')::uuid=(v_middle.result->'note'->>'id')::uuid
    and v_page_two.outcome='found'
    and jsonb_array_length(v_page_two.result->'notes')>=1
    and (v_page_two.result->'notes'->0->>'id')::uuid=(v_oldest.result->'note'->>'id')::uuid
  );
end;
$$;

rollback;
