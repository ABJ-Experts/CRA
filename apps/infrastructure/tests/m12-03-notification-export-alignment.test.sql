\set ON_ERROR_STOP on
begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'check failed: %', p_name; end if;
end $$;

select pg_temp.check('notification export contains durable records only',
  (select array_agg(table_name order by table_sort)
     from public.organization_export_source_tables
    where source_id='notification_delivery')
    = array['notification_preferences','notification_dispatches','notification_feed_reads']::text[]
  and exists(select 1 from public.organization_export_sources
    where source_id='notification_delivery' and enabled)
);

select pg_temp.check('notification export locks all physical tables',
  (select position('public.notification_preferences' in definition)>0
      and position('public.notification_dispatches' in definition)>0
      and position('public.notification_feed_reads' in definition)>0
   from (
     select split_part(split_part(pg_get_functiondef(
       'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure
     ),'lock table',2),'in share mode;',1) as definition
   ) locks)
);

select pg_temp.check('dispatch export drops retry and secret state',
  public.m1_export_business_record_jsonb('notification_dispatches',
    '{"id":"safe","status":"provider_accepted","safe_error_code":"smtp_timeout", "provider_message_id":"msg-safe", "next_attempt_at":"2030-01-01", "lease_owner":"secret", "lease_expires_at":"2030-01-01", "attempt_count":2, "nested":{"access_token":"secret"}}'::jsonb)
  = '{"id":"safe","status":"provider_accepted","safe_error_code":"smtp_timeout","provider_message_id":"msg-safe","nested":{}}'::jsonb
);

do $$
declare
  v_user_id uuid;
  v_organization_id uuid;
  v_job_id uuid;
  v_lease_owner uuid := gen_random_uuid();
  v_result record;
begin
  insert into public.users(email)
  values (gen_random_uuid()::text || '@notification-export.test')
  returning id into v_user_id;
  insert into public.organizations(name,slug)
  values ('Notification export test','notification-export-' || gen_random_uuid()::text)
  returning id into v_organization_id;
  insert into public.organization_members(organization_id,user_id,role)
  values(v_organization_id,v_user_id,'owner');
  insert into public.notification_preferences(organization_id,user_id)
  values(v_organization_id,v_user_id);
  insert into public.notification_dispatches(
    organization_id,category,source_type,source_id,source_subtype,
    original_recipient_user_id,effective_recipient_user_id,status,provider_message_id
  ) values (
    v_organization_id,'evidence','evidence_validity',gen_random_uuid(),'expiring',
    v_user_id,v_user_id,'provider_accepted','notification-export-test-message'
  );
  insert into public.notification_feed_reads(
    organization_id,user_id,ref,fingerprint,event_occurred_at
  ) values (
    v_organization_id,v_user_id,
    'm2_00000000-0000-4000-8000-000000120498_event',repeat('a',64),clock_timestamp()
  );
  insert into public.organization_export_jobs(
    organization_id,actor_user_id,request_digest,status,lease_owner,lease_expires_at
  ) values (
    v_organization_id,v_user_id,repeat('a',64),'running',v_lease_owner,
    now()+interval '1 minute'
  ) returning id into v_job_id;
  insert into public.organization_export_snapshots(
    organization_id,export_job_id,snapshot_version,source_ids
  ) values (v_organization_id,v_job_id,1,array['notification_delivery']::text[]);

  select * into v_result from public.materialize_organization_export_snapshot_atomic(
    v_organization_id,v_job_id,v_lease_owner,0
  );
  perform pg_temp.check('atomic export snapshots all notification record types',
    v_result.outcome='materialized'
    and (select count(*)=3 from public.organization_export_snapshot_records
      where organization_id=v_organization_id and export_job_id=v_job_id)
    and exists(select 1 from public.organization_export_snapshot_records
      where organization_id=v_organization_id and export_job_id=v_job_id
        and table_name='notification_feed_reads'
        and record_payload->>'ref'='m2_00000000-0000-4000-8000-000000120498_event')
    and exists(select 1 from public.organization_export_snapshot_records
      where organization_id=v_organization_id and export_job_id=v_job_id
        and table_name='notification_dispatches'
        and record_payload->>'provider_message_id'='notification-export-test-message'
        and not record_payload ? 'next_attempt_at')
    and not exists(select 1 from public.organization_export_snapshot_records
      where organization_id=v_organization_id and export_job_id=v_job_id
        and table_name='notification_digest_batches')
  );
end $$;

rollback;
