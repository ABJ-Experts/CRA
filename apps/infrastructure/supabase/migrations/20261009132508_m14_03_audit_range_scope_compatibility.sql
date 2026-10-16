-- Explicit review of the M14 safe export_job audit-read addition. Keep the
-- fingerprint gate static: later predicate edits must undergo another review.
do $reviewed_fingerprint$ declare v_definition text;begin
 if md5(pg_get_functiondef('public.m13_03_event_visible_cached(uuid,uuid,public.audit_logs,jsonb)'::regprocedure))<>'c68cd7ec1545d18572acbbd2aba9b92c' then
  raise exception 'reviewed_export_audit_predicate_changed';
 end if;
 if public.m13_04_dependency_fingerprints()->>'m13_03_event_visible_cached(uuid,uuid,audit_logs,jsonb)'<>'f46693aa6776bffbfcd74b09d7d6c1a0' then
  raise exception 'audit_range_fingerprint_baseline_changed';
 end if;
 v_definition:=pg_get_functiondef('public.m13_04_dependency_fingerprints()'::regprocedure);
 v_definition:=replace(v_definition,'f46693aa6776bffbfcd74b09d7d6c1a0','c68cd7ec1545d18572acbbd2aba9b92c');
 execute v_definition;
end $reviewed_fingerprint$;

-- Predicate changes are not source-row mutations. Publish a durable scope
-- receipt through the existing MVCC invalidation authority so older range
-- authorizations/results cannot silently reuse the broader predicate. No range,
-- checkpoint, source decision, session epoch or dataset marker is rewritten.
do $scope_rollout$ declare v_org record;v_xid text:=pg_current_xact_id()::text;begin
 for v_org in select distinct o.id,o.audit_dataset_epoch from public.organizations o
  join public.audit_verification_jobs j on j.organization_id=o.id loop
  perform public.m13_04_security_receipt(v_org.id,null,gen_random_uuid(),'audit.range.scope_changed',null,
   encode(extensions.digest(convert_to('m14-03-export-audit-scope:c68cd7ec1545d18572acbbd2aba9b92c','UTF8'),'sha256'),'hex'),
   jsonb_build_object('epoch',v_org.audit_dataset_epoch,'xid',v_xid,'policyVersion',1));
 end loop;
end $scope_rollout$;
