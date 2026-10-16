-- Minimal report audit identity follows the reviewed export_job audit policy.
-- Omit recipient eligibility entirely; its owner-only run snapshot is authority.
create or replace function public.m14_04_audit(p_org uuid,p_actor uuid,p_entity uuid,p_action text,p_key uuid,p_details jsonb default '{}') returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare outcome text;begin
 select x.outcome into outcome from public.m13_01_append_audit_event(p_org,'organization','reports.'||p_action||':'||p_key,
 'user',p_actor::text,'reports.'||p_action,'scheduled_report',p_entity::text,'completed',p_key,null,p_details-'recipientEligibility',null,null,null,p_actor) x;
 if outcome='conflict' then raise exception 'report_audit_conflict' using errcode='P0001';end if;end $$;

-- Durable checksum publication is atomic with ready state and the notice hook.
-- Existing immutable manifests are backfilled without changing their contents.
alter table public.report_run_recipients add column manifest_digest text
 check(manifest_digest is null or (manifest_digest ~ '^[a-f0-9]{64}$' and manifest is not null and manifest_digest=public.m14_04_digest(manifest)));
update public.report_run_recipients set manifest_digest=public.m14_04_digest(manifest) where manifest is not null;
create or replace function public.m14_04_freeze_recipient() returns trigger language plpgsql set search_path=pg_catalog,public as $$ begin
 if tg_op='DELETE' or (new.id,new.created_at,new.organization_id,new.run_id,new.user_id) is distinct from (old.id,old.created_at,old.organization_id,old.run_id,old.user_id)
 or (old.generation_state='revoked' and new.generation_state<>'revoked') or (old.manifest is not null and new.manifest is distinct from old.manifest)
 or (old.manifest_digest is not null and new.manifest_digest is distinct from old.manifest_digest)
 or (old.export_job_id is not null and new.export_job_id is distinct from old.export_job_id)
 then raise exception 'report_recipient_immutable' using errcode='55000';end if;return new;end $$;

create or replace function public.m14_04_publish_recipient(p_organization_id uuid,p_recipient_id uuid,p_worker_id text,p_expected_version integer,p_manifest jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare q public.report_run_recipients;r public.report_runs;j public.export_jobs;m jsonb;pv text;begin
 q:=public.m14_04_worker_recipient(p_organization_id,p_recipient_id,p_worker_id,p_expected_version);
 if not public.m14_04_authorize_recipient(p_organization_id,p_recipient_id) then raise exception 'report_access_changed' using errcode='42501';end if;
 select * into r from public.report_runs where organization_id=p_organization_id and id=q.run_id;
 select * into j from public.export_jobs where organization_id=p_organization_id and id=q.export_job_id;
 if j.id is null or j.state in ('queued','capturing','audit_pending','rendering') then return null;end if;
 if j.state<>'ready' or j.manifest is null then return public.m14_04_fail_recipient(p_organization_id,p_recipient_id,p_worker_id,p_expected_version,coalesce(j.failure_code,'export_unavailable'));end if;
 if not public.m14_03_snapshot_access(j) then raise exception 'report_access_changed' using errcode='42501';end if;
 pv:=j.permission_version::text; -- Frozen capture authority; current authority was checked above.
 m:=jsonb_build_object('schemaVersion','m14_04_v1','definitionId',r.definition_id,'definitionVersion',r.definition_version,'configDigest',r.config_digest,'runId',r.id,'recipientId',q.id,'occurrenceKey',r.occurrence_key,'scheduledFor',r.scheduled_for,'asOf',j.snapshot_as_of,'sourceContextDigest',public.m14_04_digest(j.context),'ownerPermissionVersion',coalesce(pv,'0'),'recipientPermissionVersion',coalesce(pv,'0'),'scopeDigest',public.m14_04_digest(jsonb_build_object('owner',r.owner_user_id,'recipient',q.user_id,'source',j.source,'permissionVersion',coalesce(pv,'0'),'sourceContextDigest',public.m14_04_digest(j.context))),'exportManifest',j.manifest);
 if p_manifest is null or (p_manifest<>'{}'::jsonb and p_manifest<>m) then raise exception 'report_manifest_mismatch' using errcode='22023';end if;
 update public.report_run_recipients set manifest=m,manifest_digest=public.m14_04_digest(m),generation_state='ready',expires_at=j.expires_at,worker_id=null,lease_expires_at=null,version=version+1 where organization_id=p_organization_id and id=q.id;
 perform public.m14_04_audit(p_organization_id,r.owner_user_id,q.id,'published',q.id,jsonb_build_object('manifestDigest',public.m14_04_digest(m)));
 if r.kind='scheduled' then perform public.m14_04_enqueue_notice(p_organization_id,p_recipient_id);end if;
 perform public.m14_04_finish_run(p_organization_id,r.id);return jsonb_build_object('outcome','ready');end $$;

create or replace function public.m14_04_authorize_recipient(p_organization_id uuid,p_actor_user_id uuid,p_run_id uuid,p_recipient_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.report_run_recipients where organization_id=p_organization_id and id=p_recipient_id and run_id=p_run_id and user_id=p_actor_user_id and generation_state='ready' and manifest is not null and manifest_digest=public.m14_04_digest(manifest)) and public.m14_04_authorize_history(p_organization_id,p_recipient_id) and exists(select 1 from public.export_jobs j join public.report_run_recipients q on q.organization_id=j.organization_id and q.export_job_id=j.id where q.organization_id=p_organization_id and q.id=p_recipient_id and j.state='ready' and j.expires_at>clock_timestamp() and public.m14_04_scheduled_snapshot_access(j)) $$;

-- Narrow canonical scheduling evidence: no source/report row counts, contents,
-- filters, eligibility, or arbitrary strings are added to the global projector.
-- The explorer's separate read projection intentionally remains unchanged.
do $projector$ declare d text;needle text;begin
 d:=pg_get_functiondef('public.m13_01_project_v2_audit_json(jsonb)'::regprocedure);
 if md5(d)<>'3767bcb36d3867f1bfe2bb577bffd016' then raise exception 'reviewed_report_audit_projector_baseline_changed';end if;
 needle:='    else v_result:=v_result||jsonb_build_object(v_key,''[REDACTED]'');';
 if position(needle in d)=0 then raise exception 'report_audit_projector_anchor_changed';end if;
 d:=replace(d,needle,$branch$    elsif v_key='coalescedWithinWindow' and jsonb_typeof(v_value)='number'
      and v_value::text ~ '^(0|[1-9]|1[0-9]|2[0-5])$'
    then v_result:=v_result||jsonb_build_object(v_key,v_value);
    elsif v_key='skippedBeforeCutoff' and jsonb_typeof(v_value)='boolean'
    then v_result:=v_result||jsonb_build_object(v_key,v_value);
    elsif v_key in ('previousNextDueAt','catchUpCutoff','nextDueAt','scheduledFor')
      and v_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|\+00:00)$'
    then v_result:=v_result||jsonb_build_object(v_key,v_value);
    else v_result:=v_result||jsonb_build_object(v_key,'[REDACTED]');$branch$);
 execute d;
end $projector$;

-- Exact baseline and resulting fingerprints are fixed after policy review.
-- Never replace the dependency gate with a dynamically accepted fingerprint.
do $report_audit$ declare d text;needle text;begin
 d:=pg_get_functiondef('public.m13_03_event_visible_cached(uuid,uuid,public.audit_logs,jsonb)'::regprocedure);
 if md5(d)<>'c68cd7ec1545d18572acbbd2aba9b92c' then raise exception 'report_audit_visibility_baseline_changed';end if;
 needle:='''audit_chain'',''audit_search'',''audit_export'',''export_job'',';
 d:=replace(d,needle,needle||'''scheduled_report'',');
 execute d;
 if md5(pg_get_functiondef('public.m13_03_event_visible_cached(uuid,uuid,public.audit_logs,jsonb)'::regprocedure))<>'c1ae071b0085e142fa2a8fd3ffbfc7a4' then raise exception 'reviewed_report_audit_predicate_changed';end if;
 if public.m13_04_dependency_fingerprints()->>'m13_03_event_visible_cached(uuid,uuid,audit_logs,jsonb)'<>'c68cd7ec1545d18572acbbd2aba9b92c' then raise exception 'report_range_fingerprint_baseline_changed';end if;
 d:=pg_get_functiondef('public.m13_04_dependency_fingerprints()'::regprocedure);
 execute replace(d,'c68cd7ec1545d18572acbbd2aba9b92c','c1ae071b0085e142fa2a8fd3ffbfc7a4');
end $report_audit$;

-- Publish scope invalidation through the established MVCC receipt authority.
-- No dataset epoch, source row, checked chain, range, or checkpoint is rewritten.
do $scope_rollout$ declare org record;current_xid text:=pg_current_xact_id()::text;begin
 for org in select distinct o.id,o.audit_dataset_epoch from public.organizations o
 join public.audit_verification_jobs j on j.organization_id=o.id loop
 perform public.m13_04_security_receipt(org.id,null,gen_random_uuid(),'audit.range.scope_changed',null,
 encode(extensions.digest(convert_to('m14-04-report-audit-scope:c1ae071b0085e142fa2a8fd3ffbfc7a4','UTF8'),'sha256'),'hex'),
 jsonb_build_object('epoch',org.audit_dataset_epoch,'xid',current_xid,'policyVersion',1));
 end loop;
end $scope_rollout$;
-- Replaced functions retain their existing service-only/private ACLs.
