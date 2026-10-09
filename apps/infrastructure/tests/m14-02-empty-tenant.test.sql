begin;
create temporary table m14_existing_markers as select organization_id,sequence,effective_at,payload,recorded_transaction_id from public.vulnerability_finding_lifecycle_facts where finding_id is null;
create or replace function pg_temp.check(name text,truth boolean)returns void language plpgsql as $$begin if not coalesce(truth,false)then raise exception 'M14-02 check failed: %',name;end if;raise notice 'M14-02 verified: %',name;end$$;
do $$
declare org uuid:=gen_random_uuid();actor uuid;before_at timestamptz:=clock_timestamp();j jsonb;pin jsonb;filters jsonb;baseline timestamptz;epoch uuid;
begin
 select id into actor from public.users where email='owner@cra.test';
 insert into public.organizations(id,name,slug,created_at)values(org,'M14 rollback-only empty tenant','m14-empty-'||org,now()-interval'10 days');
 insert into public.organization_members(organization_id,user_id,role)values(org,actor,'owner');
 perform pg_temp.check('new empty organization has finding baseline',(select count(*)=1 from public.vulnerability_finding_lifecycle_facts where organization_id=org and finding_id is null));
 perform pg_temp.check('new empty organization has coverage baseline',(select count(*)=1 from public.sbom_release_coverage_facts where organization_id=org and release_id is null));
 select effective_at,(payload->>'epoch')::uuid into baseline,epoch from public.vulnerability_finding_lifecycle_facts where organization_id=org and finding_id is null;
 perform pg_temp.check('new tenant baseline is capture time never imported creation date',baseline>=before_at);
 filters:=jsonb_build_object('from',(before_at at time zone'UTC')::date,'to',(before_at at time zone'UTC')::date,'timezone','UTC','bucket','day');
 j:=public.get_dashboard_trends(org,actor,filters,null);
 perform pg_temp.check('authorized empty tenant returns a UUID dataset epoch',j->>'outcome'='found'and(j#>>'{snapshot,epoch}')::uuid<>epoch and substring(j#>>'{snapshot,epoch}'from 15 for 1)='5');
 perform pg_temp.check('old capture epoch cannot replay after policy deployment',public.get_dashboard_trends(org,actor,filters,(j->'snapshot')||jsonb_build_object('epoch',epoch))->>'outcome'='conflict');
 perform pg_temp.check('old policy source position cannot replay after deployment',public.get_dashboard_trend_sources(org,actor,filters||jsonb_build_object('metric','activity','datasetRevision',j#>>'{result,datasetRevision}'),(j->'snapshot')||jsonb_build_object('epoch',epoch))->>'outcome'='conflict');
 pin:=(j->'snapshot')||jsonb_build_object('cutoffAt',public.m7_snapshot_timestamp_utc(clock_timestamp()+interval'1 millisecond'),'snapshot',(pg_current_xact_id()::text::bigint+1)||':'||(pg_current_xact_id()::text::bigint+1)||':');
 j:=public.get_dashboard_trends(org,actor,filters,pin);
 perform pg_temp.check('empty tenant activity is actual zero after capture begins',j#>>'{result,series,activity,buckets,0,opened}'='0');
 perform pg_temp.check('empty tenant coverage has actual zero denominator',j#>>'{result,series,sbomCoverage,buckets,0,denominator}'='0');
 perform pg_temp.check('empty tenant coverage does not invent a zero percentage',j#>'{result,series,sbomCoverage,buckets,0,value}'='null'::jsonb);
 perform pg_temp.check('empty tenant duration requires selected product',j#>>'{result,series,triage,reason}'='select_product');
 update public.organizations set name=name||' renamed'where id=org;
 perform pg_temp.check('organization update never replaces deployment baseline',(select count(*)=1 and min(effective_at)=baseline from public.vulnerability_finding_lifecycle_facts where organization_id=org and finding_id is null));
 begin delete from public.vulnerability_finding_lifecycle_facts where organization_id=org;raise exception 'Expected immutable rejection';exception when raise_exception then perform pg_temp.check('empty tenant marker cannot be directly deleted',sqlerrm='source trend facts are immutable');end;
 delete from public.organizations where id=org;
 perform pg_temp.check('authorized parent cascade removes only its source markers',not exists(select 1 from public.vulnerability_finding_lifecycle_facts where organization_id=org)and not exists(select 1 from public.sbom_release_coverage_facts where organization_id=org));
end$$;
select pg_temp.check('every current tenant has both source markers',not exists(select 1 from public.organizations o where not exists(select 1 from public.vulnerability_finding_lifecycle_facts f where f.organization_id=o.id and f.finding_id is null)or not exists(select 1 from public.sbom_release_coverage_facts f where f.organization_id=o.id and f.release_id is null)));
select pg_temp.check('existing immutable markers remain byte-for-byte unchanged',not exists(select *from m14_existing_markers except select organization_id,sequence,effective_at,payload,recorded_transaction_id from public.vulnerability_finding_lifecycle_facts where finding_id is null));
select pg_temp.check('source entity foreign keys retain deletion protection',(select bool_and(confdeltype='a')from pg_constraint where conrelid in('public.vulnerability_finding_lifecycle_facts'::regclass,'public.sbom_release_coverage_facts'::regclass)and contype='f'and confrelid<>'public.organizations'::regclass));
select pg_temp.check('organization capture helper is private',not has_function_privilege('anon','public.m14_02_capture_new_organization()','EXECUTE')and not has_function_privilege('authenticated','public.m14_02_capture_new_organization()','EXECUTE'));
create function pg_temp.fail_empty_tenant_capture()returns trigger language plpgsql as $$begin raise exception 'synthetic empty tenant capture failure';end$$;
create trigger m14_empty_test_failure before insert on public.vulnerability_finding_lifecycle_facts for each row execute function pg_temp.fail_empty_tenant_capture();
do $$declare org uuid:=gen_random_uuid();begin
 begin
  insert into public.organizations(id,name,slug)values(org,'M14 rollback-only failed empty tenant','m14-empty-failed-'||org);
  raise exception 'Expected capture failure';
 exception when raise_exception then perform pg_temp.check('empty tenant capture failure is surfaced',sqlerrm='synthetic empty tenant capture failure');end;
 perform pg_temp.check('empty tenant capture failure rolls back organization',not exists(select 1 from public.organizations where id=org));
 perform pg_temp.check('empty tenant capture failure leaves no partial source markers',not exists(select 1 from public.vulnerability_finding_lifecycle_facts where organization_id=org)and not exists(select 1 from public.sbom_release_coverage_facts where organization_id=org));
end$$;
rollback;
