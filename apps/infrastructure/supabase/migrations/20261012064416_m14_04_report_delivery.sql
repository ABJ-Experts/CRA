-- Scheduled reports reuse M12 dispatch identity. A published recipient is the
-- source; preview runs can never create a dispatch.
alter table public.notification_dispatches
  drop constraint notification_dispatches_category_check,
  add constraint notification_dispatches_category_check
    check (category in ('finding_triage','evidence','supplier_owner','scheduled_report')),
  drop constraint notification_dispatches_source_type_check,
  add constraint notification_dispatches_source_type_check
    check (source_type in ('evidence_validity','evidence_quarantined','evidence_integrity_failure',
      'finding_triage_alert','supplier_owner_escalation','report_run_recipient'));

alter table public.notification_preferences
  add column report_email_mode text not null default 'immediate'
    check (report_email_mode in ('immediate','off')),
  add column report_email_version integer not null default 1
    check (report_email_version > 0),
  add column report_email_last_key uuid,
  add column report_email_last_digest text;

alter table public.report_run_recipients
  add column grant_id uuid,
  add column grant_digest text check (grant_digest is null or grant_digest ~ '^[a-f0-9]{64}$'),
  add column grant_session_id uuid,
  add column grant_artifact_id uuid,
  add column grant_expires_at timestamptz,
  add constraint report_recipient_grant_all_or_none check (
    (grant_id is null and grant_digest is null and grant_session_id is null
      and grant_artifact_id is null and grant_expires_at is null)
    or (grant_id is not null and grant_digest is not null and grant_session_id is not null
      and grant_artifact_id is not null and grant_expires_at is not null)
  );

create function public.m14_04_get_email_preference(
  p_organization_id uuid,p_actor_user_id uuid
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare pref public.notification_preferences;
begin
  if not public.m14_04_member(p_organization_id,p_actor_user_id) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  perform public.m12_03_ensure_notification_preference(p_organization_id,p_actor_user_id);
  select * into pref from public.notification_preferences
  where organization_id=p_organization_id and user_id=p_actor_user_id;
  return query select 'found'::text,jsonb_build_object(
    'mode',pref.report_email_mode,'version',pref.report_email_version);
end $$;

create function public.m14_04_set_email_preference(
  p_organization_id uuid,p_actor_user_id uuid,p_input jsonb
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare pref public.notification_preferences; v_mode text; v_expected integer;
  v_key uuid; v_digest text; v_result jsonb;
begin
  if not public.m14_04_member(p_organization_id,p_actor_user_id) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_input is null or jsonb_typeof(p_input)<>'object'
    or not(p_input ?& array['mode','expectedVersion','idempotencyKey'])
    or p_input - array['mode','expectedVersion','idempotencyKey']<>'{}'::jsonb
    or p_input->>'mode' not in ('immediate','off')
    or coalesce(p_input->>'expectedVersion','') !~ '^[1-9][0-9]*$'
    or coalesce(p_input->>'idempotencyKey','') !~ '^[0-9a-f-]{36}$' then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  v_mode:=p_input->>'mode'; v_expected:=(p_input->>'expectedVersion')::integer;
  v_key:=(p_input->>'idempotencyKey')::uuid;
  v_digest:=public.m14_04_digest(p_input);
  perform public.m12_03_ensure_notification_preference(p_organization_id,p_actor_user_id);
  select * into pref from public.notification_preferences
  where organization_id=p_organization_id and user_id=p_actor_user_id for update;
  if pref.report_email_last_key=v_key then
    if pref.report_email_last_digest<>v_digest then
      return query select 'conflict'::text,null::jsonb; return;
    end if;
    return query select 'replayed'::text,jsonb_build_object(
      'mode',pref.report_email_mode,'version',pref.report_email_version); return;
  end if;
  if pref.report_email_version<>v_expected then
    return query select 'conflict'::text,null::jsonb; return;
  end if;
  update public.notification_preferences set
    report_email_mode=v_mode,report_email_version=report_email_version+1,
    report_email_last_key=v_key,report_email_last_digest=v_digest,
    updated_by=p_actor_user_id
  where organization_id=p_organization_id and user_id=p_actor_user_id
  returning * into pref;
  v_result:=jsonb_build_object('mode',pref.report_email_mode,
    'version',pref.report_email_version);
  perform public.m14_04_audit(p_organization_id,p_actor_user_id,pref.id,
    'email_preference_changed',v_key,jsonb_build_object('mode',v_mode));
  return query select 'updated'::text,v_result;
end $$;

create function public.m14_04_manifest(
  p_organization_id uuid,p_actor_user_id uuid,p_run_id uuid,p_recipient_id uuid
) returns table(outcome text,result jsonb)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r public.report_run_recipients;
begin
  select * into r from public.report_run_recipients
  where organization_id=p_organization_id and run_id=p_run_id and id=p_recipient_id
    and user_id=p_actor_user_id;
  if not found or not public.m14_04_authorize_recipient(
    p_organization_id,p_actor_user_id,p_run_id,p_recipient_id)
    or r.manifest is null then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  return query select 'found'::text,jsonb_build_object('data',r.manifest);
end $$;

create function public.m14_04_current_session(
  p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid
) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.organization_session_bindings binding
    join public.users u on u.id=binding.user_id
    join auth.sessions session on session.id=binding.session_id
      and session.user_id=u.auth_user_id
    where binding.organization_id=p_organization_id
      and binding.user_id=p_actor_user_id
      and binding.session_id=p_session_id
      and floor(extract(epoch from binding.issued_at))>=
        floor(extract(epoch from u.session_epoch_at))
      and (session.not_after is null or session.not_after>clock_timestamp()))
    and not exists(select 1 from public.organization_session_revocations revoked
      where revoked.organization_id=p_organization_id
        and revoked.user_id=p_actor_user_id and revoked.session_id=p_session_id)
$$;

create function public.m14_04_authorize_download(
  p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,
  p_run_id uuid,p_recipient_id uuid
) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select public.m14_04_current_session(
    p_organization_id,p_actor_user_id,p_session_id)
    and public.m14_04_authorize_recipient(
      p_organization_id,p_actor_user_id,p_run_id,p_recipient_id)
$$;

create function public.m14_04_grant(
  p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_run_id uuid,
  p_recipient_id uuid,p_artifact_id uuid,p_token_digest text
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.report_run_recipients; j public.export_jobs; artifact jsonb;
begin
  select * into r from public.report_run_recipients
  where organization_id=p_organization_id and run_id=p_run_id and id=p_recipient_id
    and user_id=p_actor_user_id for update;
  if not found or p_session_id is null or p_artifact_id is null
    or p_token_digest is null or p_token_digest !~ '^[a-f0-9]{64}$' then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  if not public.m14_04_authorize_recipient(
    p_organization_id,p_actor_user_id,p_run_id,p_recipient_id) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if not public.m14_04_current_session(
    p_organization_id,p_actor_user_id,p_session_id) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  select * into j from public.export_jobs
  where organization_id=p_organization_id and id=r.export_job_id and state='ready'
    and expires_at>clock_timestamp();
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  select p into artifact from jsonb_array_elements(j.parts) p
  where p->>'id'=p_artifact_id::text;
  if artifact is null then return query select 'not_found'::text,null::jsonb; return; end if;
  update public.report_run_recipients set grant_id=gen_random_uuid(),
    grant_digest=p_token_digest,grant_session_id=p_session_id,
    grant_artifact_id=p_artifact_id,
    grant_expires_at=least(r.expires_at,j.expires_at,clock_timestamp()+interval '5 minutes')
  where organization_id=p_organization_id and id=p_recipient_id returning * into r;
  perform public.m14_04_audit(p_organization_id,p_actor_user_id,p_recipient_id,
    'download_authorized',r.grant_id,'{}');
  return query select 'found'::text,jsonb_build_object('data',jsonb_build_object(
    'grantId',r.grant_id,'url','/api/v1/reports/runs/'||p_run_id::text||
      '/recipients/'||p_recipient_id::text||'/download/'||r.grant_id::text,
    'expiresAt',r.grant_expires_at,'artifact',artifact-'objectPath'-'startOrdinal'-'endOrdinal'));
end $$;

create function public.m14_04_redeem(
  p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_run_id uuid,
  p_recipient_id uuid,p_grant_id uuid,p_token_digest text
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.report_run_recipients; j public.export_jobs; artifact jsonb;
begin
  select * into r from public.report_run_recipients
  where organization_id=p_organization_id and run_id=p_run_id and id=p_recipient_id
    and user_id=p_actor_user_id for update;
  if not found or r.grant_id is distinct from p_grant_id
    or r.grant_session_id is distinct from p_session_id
    or r.grant_digest is distinct from p_token_digest
    or r.grant_expires_at<=clock_timestamp()
    or not public.m14_04_authorize_recipient(
      p_organization_id,p_actor_user_id,p_run_id,p_recipient_id)
    or not public.m14_04_current_session(
      p_organization_id,p_actor_user_id,p_session_id) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  select * into j from public.export_jobs
  where organization_id=p_organization_id and id=r.export_job_id
    and state='ready' and expires_at>clock_timestamp();
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  select p into artifact from jsonb_array_elements(j.parts) p
  where p->>'id'=r.grant_artifact_id::text;
  if artifact is null then return query select 'not_found'::text,null::jsonb; return; end if;
  update public.report_run_recipients set grant_id=null,grant_digest=null,
    grant_session_id=null,grant_artifact_id=null,grant_expires_at=null
  where organization_id=p_organization_id and id=p_recipient_id;
  perform public.m14_04_audit(p_organization_id,p_actor_user_id,p_recipient_id,
    'download_started',p_grant_id,'{}');
  return query select 'found'::text,jsonb_build_object(
    'artifact',artifact-'startOrdinal'-'endOrdinal','exportJobId',j.id);
end $$;

create function public.m14_04_enqueue_notice(
  p_organization_id uuid,p_recipient_id uuid
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_recipient public.report_run_recipients; v_run public.report_runs;
  v_mode text; v_dispatch_id uuid;
begin
  select * into v_recipient from public.report_run_recipients
  where organization_id=p_organization_id and id=p_recipient_id for update;
  if not found then raise exception 'report_recipient_missing' using errcode='22023'; end if;
  select * into v_run from public.report_runs
  where organization_id=p_organization_id and id=v_recipient.run_id;
  if v_run.kind<>'scheduled' or v_recipient.generation_state<>'ready'
    or v_recipient.manifest is null or v_recipient.export_job_id is null then
    return;
  end if;
  if not public.m14_04_authorize_recipient(p_organization_id,p_recipient_id)
    or not public.m14_04_authorize_recipient(
    p_organization_id,v_recipient.user_id,v_run.id,p_recipient_id) then
    update public.report_run_recipients set email_state='skipped',safe_error_code='access_revoked',version=version+1
    where organization_id=p_organization_id and id=p_recipient_id and email_state in ('pending','queued');
    return;
  end if;
  if v_run.config->>'emailEnabled'='false' then
    update public.report_run_recipients set email_state='off',version=version+1
    where organization_id=p_organization_id and id=p_recipient_id and email_state='pending';
    return;
  end if;
  select coalesce(p.report_email_mode,'immediate') into v_mode
  from public.organization_members m
  left join public.notification_preferences p
    on p.organization_id=m.organization_id and p.user_id=m.user_id
  where m.organization_id=p_organization_id and m.user_id=v_recipient.user_id;
  if v_mode='off' then
    update public.report_run_recipients set email_state='off',version=version+1
    where organization_id=p_organization_id and id=p_recipient_id and email_state='pending';
    return;
  end if;
  insert into public.notification_dispatches(
    organization_id,category,source_type,source_id,source_subtype,source_link,safe_title,
    original_recipient_user_id,effective_recipient_user_id,status,next_attempt_at
  ) values (
    p_organization_id,'scheduled_report','report_run_recipient',p_recipient_id,'ready',
    '/dashboard/reports/runs/'||v_run.id::text,'Your scheduled report is ready',
    v_recipient.user_id,v_recipient.user_id,'queued',clock_timestamp()
  ) on conflict (organization_id,source_type,source_id,original_recipient_user_id)
    do nothing returning id into v_dispatch_id;
  if v_dispatch_id is not null then
    update public.report_run_recipients set email_state='queued',version=version+1
    where organization_id=p_organization_id and id=p_recipient_id and email_state='pending';
  end if;
end $$;

-- Scheduled email is independent of the legacy/unified optional-notification
-- migration switch. Legacy mode claims only this new source from M12's ledger.
alter function public.claim_notification_dispatch_atomic(uuid,uuid,integer)
  rename to m14_04_claim_notification_base;
create function public.claim_notification_dispatch_atomic(
  p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer
) returns table(outcome text,dispatch jsonb)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.notification_dispatches; mode_now text;
begin
  if p_organization_id is null or p_worker_id is null
    or p_lease_seconds not between 30 and 900 then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  select notification_delivery_mode into mode_now
  from public.organization_settings where organization_id=p_organization_id for share;
  if mode_now='unified' then
    return query select * from public.m14_04_claim_notification_base(
      p_organization_id,p_worker_id,p_lease_seconds); return;
  end if;
  select * into d from public.notification_dispatches row
  where row.organization_id=p_organization_id and row.source_type='report_run_recipient'
    and row.status in ('queued','retrying') and row.next_attempt_at<=clock_timestamp()
  order by row.next_attempt_at,row.created_at,row.id for update skip locked limit 1;
  if not found then return query select 'none_available'::text,null::jsonb; return; end if;
  update public.notification_dispatches set status='leased',lease_owner=p_worker_id,
    lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),
    attempt_count=attempt_count+1,last_attempt_at=clock_timestamp(),
    safe_error_code=null,version=version+1
  where organization_id=p_organization_id and id=d.id returning * into d;
  return query select 'claimed'::text,jsonb_build_object(
    'dispatchId',d.id,'leaseOwner',d.lease_owner,'checkpointVersion',d.version);
end $$;

alter function public.set_notification_delivery_mode_atomic(uuid,text)
  rename to m14_04_set_delivery_mode_base;
create function public.set_notification_delivery_mode_atomic(
  p_organization_id uuid,p_mode text
) returns table(outcome text,previous_mode text,current_mode text)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare result_row record;
begin
  select * into result_row from public.m14_04_set_delivery_mode_base(
    p_organization_id,p_mode);
  if result_row.outcome='updated' and result_row.current_mode='legacy' then
    update public.notification_dispatches set status='queued',safe_error_code=null,
      next_attempt_at=clock_timestamp(),version=version+1
    where organization_id=p_organization_id and source_type='report_run_recipient'
      and status='cancelled' and safe_error_code='mode_rollback' and attempt_count=0;
  end if;
  return query select result_row.outcome::text,result_row.previous_mode::text,
    result_row.current_mode::text;
end $$;

alter function public.prepare_notification_dispatch_atomic(uuid,uuid,uuid,integer)
  rename to m14_04_prepare_notification_base;
create function public.prepare_notification_dispatch_atomic(
  p_organization_id uuid,p_dispatch_id uuid,p_worker_id uuid,p_expected_version integer
) returns table(outcome text,delivery jsonb)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.notification_dispatches; r public.report_run_recipients;
  run_id uuid; email text; pref public.notification_preferences;
  local_now timestamp; quiet_until timestamptz;
begin
  select * into d from public.notification_dispatches
  where organization_id=p_organization_id and id=p_dispatch_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if d.source_type<>'report_run_recipient' then
    return query select * from public.m14_04_prepare_notification_base(
      p_organization_id,p_dispatch_id,p_worker_id,p_expected_version); return;
  end if;
  if d.status<>'leased' or d.lease_owner is distinct from p_worker_id
    or d.version<>p_expected_version or d.lease_expires_at<=clock_timestamp() then
    return query select 'conflict'::text,null::jsonb; return;
  end if;
  select * into r from public.report_run_recipients
  where organization_id=p_organization_id and id=d.source_id for update;
  if not found or r.user_id<>d.effective_recipient_user_id
    or not public.m14_04_authorize_recipient(p_organization_id,d.source_id)
    or not public.m14_04_authorize_recipient(
      p_organization_id,r.user_id,r.run_id,d.source_id) then
    update public.notification_dispatches set status='cancelled',lease_owner=null,
      lease_expires_at=null,safe_error_code='source_unavailable',version=version+1
    where organization_id=p_organization_id and id=p_dispatch_id;
    if found then
      update public.report_run_recipients set email_state='skipped',safe_error_code='access_revoked',version=version+1
      where organization_id=p_organization_id and id=d.source_id and email_state='queued';
    end if;
    return query select 'cancelled'::text,null::jsonb; return;
  end if;
  select run.id into run_id from public.report_runs run
  where run.organization_id=p_organization_id and run.id=r.run_id
    and run.kind='scheduled' and run.config->>'emailEnabled'='true';
  if run_id is null then
    update public.notification_dispatches set status='cancelled',lease_owner=null,
      lease_expires_at=null,safe_error_code='source_unavailable',version=version+1
    where organization_id=p_organization_id and id=p_dispatch_id;
    return query select 'cancelled'::text,null::jsonb; return;
  end if;
  select * into pref from public.notification_preferences
  where organization_id=p_organization_id and user_id=r.user_id;
  if coalesce(pref.report_email_mode,'immediate')='off' then
    update public.notification_dispatches set status='cancelled',lease_owner=null,
      lease_expires_at=null,safe_error_code='preference_suppressed',version=version+1
    where organization_id=p_organization_id and id=p_dispatch_id;
    update public.report_run_recipients set email_state='off',version=version+1
    where organization_id=p_organization_id and id=r.id and email_state='queued';
    return query select 'cancelled'::text,null::jsonb; return;
  end if;
  if pref.id is not null and pref.quiet_start is not null then
    local_now:=clock_timestamp() at time zone pref.timezone;
    if public.m12_03_local_time_in_quiet(local_now::time,pref.quiet_start,pref.quiet_end) then
      quiet_until:=((local_now::date+pref.quiet_end+
        case when pref.quiet_start>pref.quiet_end and local_now::time>=pref.quiet_start
          then interval '1 day' else interval '0 day' end) at time zone pref.timezone);
      if quiet_until>=r.expires_at then
        update public.notification_dispatches set status='cancelled',lease_owner=null,
          lease_expires_at=null,safe_error_code='report_expired',version=version+1
        where organization_id=p_organization_id and id=p_dispatch_id;
        update public.report_run_recipients set email_state='skipped',safe_error_code='report_expired',version=version+1
        where organization_id=p_organization_id and id=r.id and email_state='queued';
      else
        update public.notification_dispatches set status='retrying',lease_owner=null,
          lease_expires_at=null,next_attempt_at=greatest(quiet_until,clock_timestamp()+interval '1 minute'),
          safe_error_code='quiet_hours_deferred',version=version+1
        where organization_id=p_organization_id and id=p_dispatch_id;
      end if;
      return query select 'cancelled'::text,null::jsonb; return;
    end if;
  end if;
  select u.email into email from public.users u where u.id=r.user_id and u.is_active;
  if email is null then
    update public.notification_dispatches set status='cancelled',lease_owner=null,
      lease_expires_at=null,safe_error_code='recipient_unavailable',version=version+1
    where organization_id=p_organization_id and id=p_dispatch_id;
    return query select 'cancelled'::text,null::jsonb; return;
  end if;
  return query select 'ready'::text,jsonb_build_object(
    'deliveryRef',d.id,'idempotencyKey','notification-dispatch:'||d.id::text,
    'recipient',jsonb_build_object('userId',r.user_id,'email',email),
    'payload',jsonb_build_object('kind','scheduled_report','runId',run_id));
end $$;

-- Keep the report recipient's delivery status synchronized with the M12
-- dispatch ledger, including restart reconciliation of expired SMTP leases.
create function public.m14_04_sync_email_state()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare next_state text;
begin
  if new.source_type<>'report_run_recipient' or
    (new.status,new.safe_error_code) is not distinct from (old.status,old.safe_error_code) then
    return new;
  end if;
  next_state:=case
    when new.status in ('provider_accepted','delivered') then 'accepted'
    when new.status='exhausted' and new.safe_error_code in
      ('delivery_uncertain','lease_expired_ambiguous') then 'uncertain'
    when new.status in ('failed','exhausted') then 'failed'
    when new.status='cancelled' and new.safe_error_code='preference_suppressed' then 'off'
    when new.status='cancelled' then 'skipped'
    else null end;
  if next_state is not null then
    update public.report_run_recipients set email_state=next_state,
      safe_error_code=case when next_state in ('failed','uncertain','skipped')
        then new.safe_error_code else safe_error_code end,
      version=version+1
    where organization_id=new.organization_id and id=new.source_id
      and email_state not in ('accepted','uncertain') and email_state<>next_state;
  end if;
  return new;
end $$;
create trigger report_dispatch_email_state
  after update of status,safe_error_code on public.notification_dispatches
  for each row execute function public.m14_04_sync_email_state();

alter function public.fail_notification_dispatch_atomic(uuid,uuid,uuid,integer,text,boolean)
  rename to m14_04_fail_notification_base;
create function public.fail_notification_dispatch_atomic(
  p_organization_id uuid,p_dispatch_id uuid,p_worker_id uuid,p_expected_version integer,
  p_error_code text,p_retryable boolean
) returns table(outcome text)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.notification_dispatches; safe_retry boolean;
begin
  select * into d from public.notification_dispatches
  where organization_id=p_organization_id and id=p_dispatch_id;
  safe_retry:=p_retryable;
  if found and d.source_type='report_run_recipient'
    and p_error_code in ('delivery_uncertain','lease_expired_ambiguous') then
    safe_retry:=false;
  end if;
  return query select * from public.m14_04_fail_notification_base(
    p_organization_id,p_dispatch_id,p_worker_id,p_expected_version,p_error_code,safe_retry);
end $$;

alter function public.retry_notification_dispatch_atomic(uuid,uuid,text,integer,uuid)
  rename to m14_04_retry_notification_base;
create function public.retry_notification_dispatch_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_delivery_ref text,p_expected_version integer,p_idempotency_key uuid
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.notification_dispatches;
begin
  if p_delivery_ref ~ '^[0-9a-f-]{36}$' then
    select * into d from public.notification_dispatches
    where organization_id=p_organization_id and id=p_delivery_ref::uuid;
    if found and d.source_type='report_run_recipient' then
      return query select 'invalid_request'::text,null::jsonb; return;
    end if;
  end if;
  return query select * from public.m14_04_retry_notification_base(
    p_organization_id,p_actor_user_id,p_delivery_ref,p_expected_version,p_idempotency_key);
end $$;

do $$ declare sig text; begin
  foreach sig in array array[
    'm14_04_get_email_preference(uuid,uuid)',
    'm14_04_set_email_preference(uuid,uuid,jsonb)',
    'm14_04_manifest(uuid,uuid,uuid,uuid)',
    'm14_04_current_session(uuid,uuid,uuid)',
    'm14_04_authorize_download(uuid,uuid,uuid,uuid,uuid)',
    'm14_04_grant(uuid,uuid,uuid,uuid,uuid,uuid,text)',
    'm14_04_redeem(uuid,uuid,uuid,uuid,uuid,uuid,text)',
    'm14_04_enqueue_notice(uuid,uuid)',
    'm14_04_claim_notification_base(uuid,uuid,integer)',
    'claim_notification_dispatch_atomic(uuid,uuid,integer)',
    'm14_04_set_delivery_mode_base(uuid,text)',
    'set_notification_delivery_mode_atomic(uuid,text)',
    'm14_04_prepare_notification_base(uuid,uuid,uuid,integer)',
    'prepare_notification_dispatch_atomic(uuid,uuid,uuid,integer)',
    'm14_04_sync_email_state()',
    'm14_04_fail_notification_base(uuid,uuid,uuid,integer,text,boolean)',
    'fail_notification_dispatch_atomic(uuid,uuid,uuid,integer,text,boolean)',
    'm14_04_retry_notification_base(uuid,uuid,text,integer,uuid)',
    'retry_notification_dispatch_atomic(uuid,uuid,text,integer,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public,anon,authenticated',sig);
    execute format('grant execute on function public.%s to service_role',sig);
  end loop;
end $$;
