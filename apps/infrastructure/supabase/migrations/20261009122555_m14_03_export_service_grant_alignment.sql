-- Explicitly override baseline default privileges on a new workflow. Frozen
-- evidence cannot be updated/deleted through a service client; lifecycle writes
-- are performed by the transactionally scoped RPC owner and retention boundary.
revoke all on table public.export_jobs from service_role;
grant select,insert,update on table public.export_jobs to service_role;
revoke all on table public.export_snapshot_rows from service_role;
grant select,insert on table public.export_snapshot_rows to service_role;

-- Deliver the immutable public provenance manifest through the same fresh
-- metadata boundary. Private paths remain only in fenced worker checkpoints.
do $manifest$ declare v_def text;begin
 v_def:=pg_get_functiondef('public.m14_03_job_json(public.export_jobs)'::regprocedure);
 if position('''artifacts'',case' in v_def)=0 then raise exception 'export_manifest_projection_baseline_changed';end if;
 v_def:=replace(v_def,'''artifacts'',case','''manifest'',case when p_job.state=''ready'' and p_job.expires_at>clock_timestamp() and public.m14_03_job_access(p_job) then p_job.manifest else null end,''artifacts'',case');
 execute v_def;
end $manifest$;

-- Manifest delivery is an explicit durable access event, separate from status
-- polling. No public or browser RPC grants; the API verifies identity first.
create function public.m14_03_get_export_manifest(p_organization_id uuid,p_actor_user_id uuid,p_session_id uuid,p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs;
begin
 select * into v_job from public.export_jobs where organization_id=p_organization_id and requester_id=p_actor_user_id and session_id=p_session_id and id=p_job_id;
 if not found or not public.m14_03_snapshot_access(v_job) or v_job.state<>'ready'
 or v_job.expires_at<=clock_timestamp() or v_job.manifest is null then raise exception 'export_access_denied' using errcode='42501';end if;
 perform public.m14_03_audit(v_job,'manifest_downloaded',gen_random_uuid());
 return v_job.manifest;
end $$;
create function public.m14_03_get_portal_export_manifest(p_subject_kind text,p_session_digest text,p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.export_jobs;
begin
 v_job:=public.m14_03_portal_job(p_subject_kind,p_session_digest,p_job_id);
 if not public.m14_03_snapshot_access(v_job) or v_job.state<>'ready'
 or v_job.expires_at<=clock_timestamp() or v_job.manifest is null then raise exception 'export_access_denied' using errcode='42501';end if;
 perform public.m14_03_audit(v_job,'manifest_downloaded',gen_random_uuid());
 return v_job.manifest;
end $$;
revoke all on function public.m14_03_get_export_manifest(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.m14_03_get_portal_export_manifest(text,text,uuid) from public,anon,authenticated;
grant execute on function public.m14_03_get_export_manifest(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.m14_03_get_portal_export_manifest(text,text,uuid) to service_role;
