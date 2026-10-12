begin;
set local statement_timeout='10s';
do $$
begin
 if to_regprocedure('public.m14_03_export_cleanup_eligibility(uuid,uuid,uuid,uuid,integer)') is null then
   raise exception 'M14 export retention eligibility projection missing';
 end if;
end $$;
rollback;
begin;
set local statement_timeout='10s';
create function pg_temp.check(p_name text,p_ok boolean) returns void language plpgsql as $$ begin
 if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;
select pg_temp.check('projection service-only',
 has_function_privilege('service_role','public.m14_03_export_cleanup_eligibility(uuid,uuid,uuid,uuid,integer)','execute')
 and not has_function_privilege('authenticated','public.m14_03_export_cleanup_eligibility(uuid,uuid,uuid,uuid,integer)','execute')
 and not has_function_privilege('anon','public.m14_03_export_cleanup_eligibility(uuid,uuid,uuid,uuid,integer)','execute'));
select pg_temp.check('projection is stable read-only',
 (select provolatile='s' from pg_proc where oid='public.m14_03_export_cleanup_eligibility(uuid,uuid,uuid,uuid,integer)'::regprocedure));
do $$
declare v_org uuid:=gen_random_uuid();v_job uuid:=gen_random_uuid();v_run uuid:=gen_random_uuid();
 v_worker uuid:=gen_random_uuid();v_user uuid;v_result jsonb;v_time timestamptz:=now()-interval '10 days';
begin
 select id into strict v_user from public.users order by id limit 1;
 insert into public.organizations(id,name,slug) values(v_org,'M14 rollback retention fixture','m14-retention-'||v_org);
 insert into public.export_jobs(id,organization_id,requester_id,session_id,source,format,scope,filters,context,columns,
  idempotency_key,request_digest,permission_version,state,requested_at,expires_at)
 values(v_job,v_org,v_user,gen_random_uuid(),'products.registry','csv','all_filtered','{}','{}','["id"]',
  gen_random_uuid(),repeat('a',64),0,'expired',v_time,now()-interval '1 day');
 v_result:=public.m14_03_export_cleanup_eligibility(v_org,v_job);
 perform pg_temp.check('expiry alone never deletes',(v_result->>'eligible')::boolean=false
   and (v_result->>'deletionAuthorized')::boolean=false
   and v_result->'blockers' ? 'cleanup_authority_unavailable');
 perform pg_temp.check('forged tenant reveals no metadata',
   public.m14_03_export_cleanup_eligibility(gen_random_uuid(),v_job)='{"eligible":false,"deletionAuthorized":false,"blockers":["not_found"]}'::jsonb);
 insert into public.organization_retention_policies(organization_id,evidence_class,requested_retention_days,effective_retention_days)
 values(v_org,'export_artifact',0,0) on conflict(organization_id,evidence_class)
 do update set requested_retention_days=0,effective_floor_days=0,effective_retention_days=0;
 insert into public.retention_authority_states(organization_id,authority_kind,available,last_reconciled_at)
 select v_org,kind,true,now() from unnest(array['product','evidence_class','obligation','legal_hold']) kind
 on conflict(organization_id,authority_kind) do update set available=true,last_reconciled_at=now();
 insert into public.evidence_protection_watermarks(organization_id,evidence_class,protected_through)
 values(v_org,'export_artifact','-infinity') on conflict(organization_id,evidence_class) do update set protected_through='-infinity';
 insert into public.retention_cleanup_runs(id,organization_id,evidence_class,status,lease_owner,lease_expires_at)
 values(v_run,v_org,'export_artifact','running',v_worker,now()+interval '1 minute');
 insert into public.retention_cleanup_items(organization_id,cleanup_run_id,evidence_class,source_record_id,observed_at,protection_watermark)
 values(v_org,v_run,'export_artifact',v_job,v_time,'-infinity');
 v_result:=public.m14_03_export_cleanup_eligibility(v_org,v_job,v_run,v_worker,0);
 perform pg_temp.check('complete existing projections still lack cleanup authority',
  v_result->'blockers'='["cleanup_authority_unavailable"]'::jsonb and (v_result->>'deletionAuthorized')::boolean=false);
 v_result:=public.m14_03_export_cleanup_eligibility(v_org,v_job,v_run,gen_random_uuid(),0);
 perform pg_temp.check('stale worker cannot authorize',v_result->'blockers' ? 'cleanup_lease_unavailable');
 update public.retention_authority_states set available=false where organization_id=v_org and authority_kind='legal_hold';
 v_result:=public.m14_03_export_cleanup_eligibility(v_org,v_job,v_run,v_worker,0);
 perform pg_temp.check('unavailable legal hold authority fails closed',v_result->'blockers' ? 'authority_unavailable:legal_hold');
 update public.retention_authority_states set available=true where organization_id=v_org and authority_kind='legal_hold';
 update public.evidence_protection_watermarks set protected_through=now()+interval '1 day' where organization_id=v_org and evidence_class='export_artifact';
 v_result:=public.m14_03_export_cleanup_eligibility(v_org,v_job,v_run,v_worker,0);
 perform pg_temp.check('new protection watermark invalidates candidate',v_result->'blockers' ? 'protection_watermark_changed');
 update public.evidence_protection_watermarks set protected_through='-infinity' where organization_id=v_org and evidence_class='export_artifact';
 update public.organization_retention_policies set requested_retention_days=30,effective_retention_days=30 where organization_id=v_org and evidence_class='export_artifact';
 v_result:=public.m14_03_export_cleanup_eligibility(v_org,v_job,v_run,v_worker,0);
 perform pg_temp.check('expiry does not shorten configured retention',v_result->'blockers' ? 'retention_period_active');
 update public.organization_retention_policies set requested_retention_days=0,effective_retention_days=0 where organization_id=v_org and evidence_class='export_artifact';
 update public.retention_cleanup_runs set lease_expires_at=now()-interval '1 second' where organization_id=v_org and id=v_run;
 v_result:=public.m14_03_export_cleanup_eligibility(v_org,v_job,v_run,v_worker,0);
 perform pg_temp.check('expired lease fails closed',v_result->'blockers' ? 'cleanup_lease_unavailable');
 update public.retention_cleanup_runs set lease_expires_at=now()+interval '1 minute' where organization_id=v_org and id=v_run;

 insert into public.retention_authoritative_facts(organization_id,evidence_class,reason_kind,source_record_id,required_retention_days)
 values(v_org,'export_artifact','legal_hold',gen_random_uuid(),0);
 v_result:=public.m14_03_export_cleanup_eligibility(v_org,v_job,v_run,v_worker,0);
 perform pg_temp.check('legal hold is preserved',v_result->'blockers' ? 'authoritative_retention_protection');
 perform pg_temp.check('read-only checks preserve export job',exists(select 1 from public.export_jobs where organization_id=v_org and id=v_job));
 perform pg_temp.check('M13 purge archival boundary remains',position('audit_archival_required' in
  pg_get_functiondef('public.complete_organization_purge_atomic(uuid,uuid,uuid,integer)'::regprocedure))>0);
end $$;
rollback;
