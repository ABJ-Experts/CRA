-- Review the intrinsic organization-scoped support diagnostic audit addition.
-- Keep static dependency fingerprints and durable MVCC invalidation in parity.
do $reviewed_fingerprint$ declare d text;begin
 if md5(pg_get_functiondef('public.m13_03_event_visible_cached(uuid,uuid,public.audit_logs,jsonb)'::regprocedure))<>'8ab862743366423c2f2533fdd054dedd' then raise exception 'reviewed_support_diagnostic_audit_predicate_changed';end if;
 if public.m13_04_dependency_fingerprints()->>'m13_03_event_visible_cached(uuid,uuid,audit_logs,jsonb)'<>'c1ae071b0085e142fa2a8fd3ffbfc7a4' then raise exception 'diagnostic_range_fingerprint_baseline_changed';end if;
 d:=pg_get_functiondef('public.m13_04_dependency_fingerprints()'::regprocedure);
 execute replace(d,'c1ae071b0085e142fa2a8fd3ffbfc7a4','8ab862743366423c2f2533fdd054dedd');
end $reviewed_fingerprint$;
do $scope_rollout$ declare org record;current_xid text:=pg_current_xact_id()::text;begin
 for org in select distinct o.id,o.audit_dataset_epoch from public.organizations o join public.audit_verification_jobs j on j.organization_id=o.id loop
  perform public.m13_04_security_receipt(org.id,null,gen_random_uuid(),'audit.range.scope_changed',null,
   encode(extensions.digest(convert_to('m15-04-diagnostic-audit-scope:8ab862743366423c2f2533fdd054dedd','UTF8'),'sha256'),'hex'),
   jsonb_build_object('epoch',org.audit_dataset_epoch,'xid',current_xid,'policyVersion',1));
 end loop;
end $scope_rollout$;

-- Filter approved aliases and source permissions before the bounded page, so
-- unsupported or withheld records cannot starve later visible diagnostics.
create or replace function public.m15_04_logs(p_organization_id uuid,p_job_id uuid,p_worker_id text,p_expected_version integer) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='2s' as $$
declare a jsonb;j public.support_diagnostic_jobs;rows jsonb;n integer;omissions jsonb:='[]';permissions jsonb;begin
 if p_expected_version is null or p_expected_version<1 then return jsonb_build_object('outcome','conflict');end if;
 a:=public.m15_04_authorize_worker(p_organization_id,p_job_id,p_worker_id,p_expected_version);if a->>'outcome'<>'ok' then return a;end if;
 select * into j from public.support_diagnostic_jobs where organization_id=p_organization_id and id=p_job_id;
 if not j.selection->'categories' ? 'logs' then return jsonb_build_object('outcome','conflict');end if;
 if not public.m13_03_actor_can(p_organization_id,j.creator_user_id,'can_view_audit') then return jsonb_build_object('outcome','ok','result',jsonb_build_object('logs','[]'::jsonb,'omissions','[{"category":"logs","code":"source_withheld"}]'::jsonb));end if;
 permissions:=public.m13_03_permission_snapshot(p_organization_id,j.creator_user_id);
 with source as(
  select e.id event_id,e.created_at,e.outcome,case
   when e.entity_type in ('user','invitation','session','organization_member') then 'authentication'
   when e.entity_type in ('audit_export','audit_search') then 'audit'
   when e.entity_type in ('connector','connector_run') then 'connectors'
   when e.entity_type in ('sbom','sbom_source','sbom_release','sbom_document','sbom_ingest_job','sbom_supplier_request','sbom_supplier_submission') then 'sboms'
   when e.entity_type in ('evidence_document','evidence_document_version') then 'evidence'
   when e.entity_type in ('reporting_obligation','reporting_stage','reporting_package') then 'reporting'
   when e.entity_type='task' then 'tasks'
   when e.entity_type in ('notification','notification_dispatch') then 'notifications'
   when e.entity_type in ('license','organization_license') then 'licensing' end source
  from public.audit_logs e where e.organization_id=p_organization_id and e.created_at>=(j.selection->>'from')::timestamptz and e.created_at<(j.selection->>'to')::timestamptz
   and e.outcome in ('intent','completed','failed','denied') and public.m13_03_event_visible_cached(p_organization_id,j.creator_user_id,e,permissions)
 ),visible as materialized(select * from source where source is not null and case source
 when 'connectors' then public.m13_03_actor_can(p_organization_id,j.creator_user_id,'can_view_connectors')
 when 'sboms' then public.m13_03_actor_can(p_organization_id,j.creator_user_id,'can_view_sboms')
 when 'evidence' then public.m13_03_actor_can(p_organization_id,j.creator_user_id,'can_view_evidence')
 when 'reporting' then public.m13_03_actor_can(p_organization_id,j.creator_user_id,'can_view_reporting')
 when 'licensing' then public.m15_01_actor_can(p_organization_id,j.creator_user_id,'can_view_licensing')
 when 'authentication' then public.m13_03_actor_can(p_organization_id,j.creator_user_id,'can_view_users')
 when 'tasks' then false when 'notifications' then false else true end order by created_at,event_id limit 5001), numbered as(select *,row_number()over(order by created_at,event_id)rn from visible)
 select coalesce(jsonb_agg(jsonb_build_object('at',public.m7_snapshot_timestamp_utc(created_at),'source',source,'outcome',outcome,'code',case outcome when 'intent' then 'operation_started' when 'completed' then 'operation_completed' when 'failed' then 'operation_failed' else 'operation_denied' end) order by rn)filter(where rn<=5000),'[]'),count(*) into rows,n from numbered;
 if n>5000 then omissions:='[{"category":"logs","code":"row_limit"}]';end if;
 return jsonb_build_object('outcome','ok','result',jsonb_build_object('logs',rows,'omissions',omissions));
end $$;

