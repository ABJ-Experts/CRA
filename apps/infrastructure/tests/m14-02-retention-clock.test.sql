begin;
create or replace function pg_temp.check(name text,truth boolean)returns void language plpgsql as $$begin if not coalesce(truth,false)then raise exception 'M14-02 check failed: %',name;end if;raise notice 'M14-02 verified: %',name;end$$;
do $$begin
 perform pg_temp.check('observation effective time is capture clock',(select count(*)=2 from information_schema.columns where table_schema='public'and table_name in('vulnerability_finding_lifecycle_facts','sbom_release_coverage_facts')and column_name='effective_at'and column_default='clock_timestamp()'));
end$$;
do $$
declare org uuid:=gen_random_uuid();worker uuid:=gen_random_uuid();actor uuid;job uuid:=gen_random_uuid();result record;before_count bigint;fact_time timestamptz;reasons jsonb;
begin
 select id into actor from public.users where email='owner@cra.test';
 perform pg_sleep(0.02);
 insert into public.organizations select(jsonb_populate_record(null::public.organizations,to_jsonb(o)||jsonb_build_object('id',org,'name','M14-02 rollback-only retention scope','slug','m14-retention-'||org))).*from public.organizations o where o.id='00000000-0000-4000-8000-0000000000ca';
 insert into public.organization_lifecycles(organization_id,status,version,purge_after)values(org,'deactivated',1,clock_timestamp()-interval'1 day')on conflict(organization_id)do update set status='deactivated',version=1,purge_after=excluded.purge_after;
 select effective_at into fact_time from public.vulnerability_finding_lifecycle_facts where organization_id=org and finding_id is null;
 perform pg_temp.check('late observation never backdates to transaction start',fact_time>transaction_timestamp());
 select count(*)into before_count from public.vulnerability_finding_lifecycle_facts where organization_id=org;
 begin delete from public.vulnerability_finding_lifecycle_facts where organization_id=org;raise exception 'Expected immutable rejection';exception when raise_exception then perform pg_temp.check('ordinary history DELETE denied',sqlerrm='source trend facts are immutable');end;
 insert into public.organization_purge_jobs(id,organization_id,requested_by,lifecycle_version,status,purge_after,available_at)values(job,org,actor,1,'scheduled',clock_timestamp()-interval'1 day',clock_timestamp()-interval'1 day');
 select *into result from public.claim_organization_purge_atomic(org,worker,60);
 select blocked_reasons into reasons from public.organization_purge_jobs where id=job;
 perform pg_temp.check('current canonical claim remains audit archival blocked',result.outcome='blocked'and reasons @>'[{"kind":"audit_archival","code":"audit_archival_required"}]'::jsonb);
 perform pg_temp.check('blocked claim preserves finding history',(select count(*)=before_count from public.vulnerability_finding_lifecycle_facts where organization_id=org));
 update public.organization_purge_jobs set status='running',lease_owner=worker,lease_expires_at=clock_timestamp()+interval'60 seconds',checkpoint_version=0 where id=job;
 update public.organization_lifecycles set status='purging'where organization_id=org;
 select *into result from public.complete_organization_purge_atomic(org,job,worker,0);
 select blocked_reasons into reasons from public.organization_purge_jobs where id=job;
 perform pg_temp.check('current canonical completion remains audit archival blocked',result.outcome='blocked'and reasons @>'[{"kind":"audit_archival","code":"audit_archival_required"}]'::jsonb);
 perform pg_temp.check('blocked completion preserves both source histories',(select count(*)=before_count from public.vulnerability_finding_lifecycle_facts where organization_id=org)and exists(select 1 from public.sbom_release_coverage_facts where organization_id=org));
end$$;
rollback;
