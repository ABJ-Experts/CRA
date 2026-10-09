begin;
create or replace function pg_temp.check(name text,truth boolean) returns void language plpgsql as $$begin if not coalesce(truth,false)then raise exception 'M14-02 check failed: %',name;end if;raise notice 'M14-02 verified: %',name;end$$;
-- Recreate the fresh migration chain's older lock list without changing any effect.
-- This deliberately makes the first assertion RED before the additive repair.
do $$declare definition text;lock_statement text;begin
 definition:=pg_get_functiondef('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure);
 lock_statement:=substring(definition from '(?is)lock\s+table\s+.*?\s+in\s+share\s+mode\s*;');
 execute replace(definition,lock_statement,replace(replace(lock_statement,', public.vulnerability_finding_lifecycle_facts',''),', public.sbom_release_coverage_facts',''));
end$$;
-- Preserve the existing durable export body, authority checks and grants.
-- Later source migrations can replace its earlier lock list; ensure the final
-- migration chain captures these append-only ledgers in the same SHARE window.
do $$
declare
  v_definition text;
  v_anchor text;
  v_new_lock text;
begin
  v_definition := pg_get_functiondef(
    'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure
  );
  v_anchor := substring(v_definition from '(?is)lock\s+table\s+.*?\s+in\s+share\s+mode\s*;');
  if v_anchor is null then
    raise exception 'M14-02 expected durable export SHARE lock is missing';
  end if;
  v_new_lock := v_anchor;
  if v_anchor not like '%public.vulnerability_finding_lifecycle_facts%' then
    v_new_lock := regexp_replace(v_new_lock, '(?is)\s+in\s+share\s+mode\s*;$',
      ', public.vulnerability_finding_lifecycle_facts' || chr(10) || '  in share mode;');
  end if;
  if v_anchor not like '%public.sbom_release_coverage_facts%' then
    v_new_lock := regexp_replace(v_new_lock, '(?is)\s+in\s+share\s+mode\s*;$',
      ', public.sbom_release_coverage_facts' || chr(10) || '  in share mode;');
  end if;
  if v_new_lock <> v_anchor then
    execute replace(v_definition, v_anchor, v_new_lock);
  end if;
end $$;

select pg_temp.check('fresh export locks both immutable source ledgers',
 substring(pg_get_functiondef('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure)from '(?is)lock\s+table\s+.*?\s+in\s+share\s+mode\s*;')like'%public.vulnerability_finding_lifecycle_facts%'
 and substring(pg_get_functiondef('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure)from '(?is)lock\s+table\s+.*?\s+in\s+share\s+mode\s*;')like'%public.sbom_release_coverage_facts%');
do $$declare org uuid:=gen_random_uuid();actor uuid;worker uuid:=gen_random_uuid();job uuid:=gen_random_uuid();result record;begin
 select id into actor from public.users where email='owner@cra.test';
 insert into public.organizations select(jsonb_populate_record(null::public.organizations,to_jsonb(o)||jsonb_build_object('id',org,'name','M14 rollback-only export','slug','m14-export-'||org))).*from public.organizations o where id='00000000-0000-4000-8000-0000000000ca';
 insert into public.organization_export_jobs(id,organization_id,actor_user_id,request_digest,status,lease_owner,lease_expires_at)values(job,org,actor,repeat('a',64),'running',worker,clock_timestamp()+interval'60 seconds');
 insert into public.organization_export_snapshots(organization_id,export_job_id,snapshot_version,source_ids)values(org,job,1,array['vulnerability_detection_records','sbom_normalized_graph']);
 select *into result from public.materialize_organization_export_snapshot_atomic(org,job,worker,0);
 perform pg_temp.check('canonical export materializes history',result.outcome='materialized');
 perform pg_temp.check('export includes finding baseline exactly once',(select count(*)=1 from public.organization_export_snapshot_records where organization_id=org and export_job_id=job and table_name='vulnerability_finding_lifecycle_facts'));
 perform pg_temp.check('export includes coverage baseline exactly once',(select count(*)=1 from public.organization_export_snapshot_records where organization_id=org and export_job_id=job and table_name='sbom_release_coverage_facts'));
 select *into result from public.materialize_organization_export_snapshot_atomic(org,job,worker,0);
 perform pg_temp.check('materialized export replay preserves snapshot',result.outcome='replayed');
end$$;
rollback;
