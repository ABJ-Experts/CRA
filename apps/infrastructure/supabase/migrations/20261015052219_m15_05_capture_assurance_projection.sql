-- Keep capture attempts and restore verification attempts independently visible.
-- CREATE OR REPLACE preserves the existing owner/ACL; restate the deny-by-default
-- grants explicitly without changing the callable authority or response shape.
create or replace function public.m15_05_backup_assurance(p_organization_id uuid,p_actor_user_id uuid,p_limit integer default 25,p_cursor uuid default null,p_kind text default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='350ms' as $$
declare attempt public.backup_runs;capture public.backup_runs;verification public.backup_runs;latest_verification public.backup_runs;policy public.backup_policies;summary jsonb;history jsonb;reason_codes text[]:=array[]::text[];current_status text;begin
 if not public.m15_03_health_can(p_organization_id,p_actor_user_id) then return jsonb_build_object('outcome','forbidden');end if;
 if p_limit is null or p_limit not between 1 and 100 or (p_kind is not null and p_kind not in ('capture','verification')) then raise exception 'invalid_backup_limit' using errcode='22023';end if;
 if (select count(*) from public.backup_policies where is_approved)<>1 then
  return jsonb_build_object('outcome','ok','assurance',jsonb_build_object('status','unavailable','lastAttempt',null,'lastCapture',null,'lastVerification',null,'lastVerifiedRestoreAt',null,'recoverablePointAt',null,'verificationDueAt',null,'residency',null,'sourceAt',null,'observedAt',public.m7_snapshot_timestamp_utc(clock_timestamp()),'reasons',array['not_configured']),'history',jsonb_build_object('items','[]'::jsonb,'nextCursor',null));
 end if;
 select * into policy from public.backup_policies where is_approved;
 select * into attempt from public.backup_runs where instance_id=policy.instance_id and kind='capture' and p_organization_id=any(covered_organization_ids) order by created_at desc,id desc limit 1;
 select * into capture from public.backup_runs where instance_id=policy.instance_id and state='certified' and cleanup_state<>'deleted' and p_organization_id=any(covered_organization_ids) order by completed_at desc,id desc limit 1;
 select v.* into verification from public.backup_runs v join public.backup_runs c on c.instance_id=v.instance_id and c.id=v.parent_capture_id where v.instance_id=policy.instance_id and v.state='verified' and v.cleanup_state<>'deleted' and p_organization_id=any(c.covered_organization_ids) order by v.completed_at desc,v.id desc limit 1;
 select v.* into latest_verification from public.backup_runs v join public.backup_runs c on c.instance_id=v.instance_id and c.id=v.parent_capture_id where v.instance_id=policy.instance_id and p_organization_id=any(c.covered_organization_ids) order by v.created_at desc,v.id desc limit 1;
 current_status:='verified';
 if attempt.state in ('queued','running') then current_status:='running';reason_codes:=array['capture_running'];
 elsif latest_verification.state in ('queued','running') then current_status:='running';reason_codes:=array['verification_running'];
 elsif attempt.state='incomplete' then current_status:='incomplete';reason_codes:=array['capture_incomplete'];
 elsif attempt.state='failed' then current_status:='failed';reason_codes:=array['capture_failed'];
 elsif latest_verification.state='incomplete' then current_status:='incomplete';reason_codes:=array['verification_incomplete'];
 elsif latest_verification.state='failed' then current_status:='failed';reason_codes:=array['verification_failed'];
 elsif capture.id is null then current_status:='unverified';reason_codes:=array['no_certified_capture'];
 elsif verification.id is null then current_status:='unverified';reason_codes:=array['no_verified_restore'];
 elsif (capture.configuration-'schedulingEnabled')<>(policy.configuration-'schedulingEnabled') or not exists(select 1 from public.backup_runs c where c.instance_id=policy.instance_id and c.id=verification.parent_capture_id and (c.configuration-'schedulingEnabled')=(policy.configuration-'schedulingEnabled')) then current_status:='unverified';reason_codes:=array['configuration_changed'];
 elsif verification.completed_at<clock_timestamp()-make_interval(days=>(policy.configuration->>'verificationIntervalDays')::integer) then current_status:='overdue';reason_codes:=array['verification_overdue'];
 elsif (capture.certificate->>'recoveryPointAt')::timestamptz<clock_timestamp()-interval '1 hour' then current_status:='overdue';reason_codes:=array['recovery_point_overdue'];
 elsif (capture.certificate->>'recoveryPointAt')::timestamptz>clock_timestamp()+interval '5 seconds' or verification.completed_at>clock_timestamp()+interval '5 seconds' then current_status:='unavailable';reason_codes:=array['clock_untrusted'];
 end if;
 summary:=jsonb_build_object('status',current_status,'lastAttempt',public.m15_05_customer_run_json(attempt),'lastCapture',public.m15_05_customer_run_json(capture),'lastVerification',public.m15_05_customer_run_json(latest_verification),'lastVerifiedRestoreAt',public.m7_snapshot_timestamp_utc(verification.completed_at),'recoverablePointAt',capture.certificate->'recoveryPointAt','verificationDueAt',public.m7_snapshot_timestamp_utc(verification.completed_at+make_interval(days=>(policy.configuration->>'verificationIntervalDays')::integer)),'residency',policy.configuration->>'residency','sourceAt',public.m7_snapshot_timestamp_utc(greatest(attempt.completed_at,attempt.created_at,latest_verification.completed_at,latest_verification.created_at)),'observedAt',public.m7_snapshot_timestamp_utc(clock_timestamp()),'reasons',reason_codes);
 select coalesce(jsonb_agg(public.m15_05_customer_run_json(x) order by x.created_at desc,x.id desc),'[]') into history from (select q.* from public.backup_runs q where q.instance_id=policy.instance_id and p_organization_id=any(q.covered_organization_ids) and (p_kind is null or q.kind=p_kind) and (p_cursor is null or (q.created_at,q.id)<(select c.created_at,c.id from public.backup_runs c where c.instance_id=policy.instance_id and c.id=p_cursor and p_organization_id=any(c.covered_organization_ids))) order by q.created_at desc,q.id desc limit p_limit) x;
 return jsonb_build_object('outcome','ok','assurance',summary,'history',jsonb_build_object('items',history,'nextCursor',case when jsonb_array_length(history)=p_limit then history->(p_limit-1)->>'id' end));
end $$;
revoke all on function public.m15_05_backup_assurance(uuid,uuid,integer,uuid,text)
 from public,anon,authenticated,service_role,cra_operator_registry_reader,cra_backup_control;
grant execute on function public.m15_05_backup_assurance(uuid,uuid,integer,uuid,text) to service_role;
notify pgrst,'reload schema';
