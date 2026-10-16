-- Rollback-only lifecycle compatibility. No retained tenant is deleted.
begin;
set local statement_timeout='30s';
create function pg_temp.check(label text,ok boolean) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'M15-02 lifecycle check: %',label;end if;end $$;
do $$
declare o uuid:=gen_random_uuid();a uuid;entity uuid:=gen_random_uuid();product uuid:=gen_random_uuid();job uuid:=gen_random_uuid();part uuid:=gen_random_uuid();admission uuid:=gen_random_uuid();source text;
begin
 select id into a from public.users where email='owner@cra.test';
 insert into public.organizations(id,name,slug) values(o,'M15-02 rollback purge fixture','m15-02-purge-'||replace(o::text,'-',''));
 insert into public.organization_members(organization_id,user_id,role) values(o,a,'owner');
 perform pg_temp.check('projection exists for newly created membership',exists(select 1 from public.organization_usage_meters where organization_id=o));
 -- This fixture is already archived and grants no unlicensed product growth.
 insert into public.organization_legal_entities(id,organization_id,identifier,display_name,completion_status,status,created_by,updated_by) values(entity,o,'fixture','Rollback fixture','needs_completion','inactive',a,a);
 insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,archived_at,created_by,updated_by) values(product,o,entity,0,'{}','Rollback archived fixture','fixture','component',a,clock_timestamp(),a,a);
 select source_id into source from public.organization_export_sources order by source_id limit 1;
 insert into public.organization_export_jobs(id,organization_id,actor_user_id,request_digest) values(job,o,a,repeat('a',64));
 insert into public.organization_export_parts(id,organization_id,export_job_id,source_id,part_number,object_path,sha256,byte_size) values(part,o,job,source,1,o::text||'/fixture.zip',repeat('a',64),0);
 insert into public.organization_storage_admissions(organization_id,operation_id,actor_user_id,bucket,object_path,reserved_bytes,token_digest,content_type,capability,state,expires_at) values(o,admission,a,'evidence-documents',o::text||'/released-fixture',0,repeat('a',64),'application/pdf','evidence','released',clock_timestamp());
 -- Original M15-01 admission FK is intentionally outside this projection fix.
 -- Exercise its DELETE maintenance hook, then remove only this rollback fixture.
 delete from public.organization_storage_admissions where organization_id=o and operation_id=admission;
 delete from public.organizations where id=o;
 perform pg_temp.check('authorized legacy parent cascade is not blocked by projection',not exists(select 1 from public.organizations where id=o));
 perform pg_temp.check('projection does not survive or resurrect during cascade',not exists(select 1 from public.organization_usage_meters where organization_id=o));
 perform pg_temp.check('original child cascade remains intact',not exists(select 1 from public.organization_members where organization_id=o) and not exists(select 1 from public.products where organization_id=o) and not exists(select 1 from public.organization_export_parts where organization_id=o));
 -- Cascades may invoke source hooks after the projection FK has run. A late
 -- rebuild for the now-absent fixture parent must not recreate a projection.
 perform public.m15_02_rebuild_meter(o);
 perform pg_temp.check('late source rebuild for removed tenant is harmless',not exists(select 1 from public.organization_usage_meters where organization_id=o));
 perform pg_temp.check('unknown tenant RPC still denies access',public.m15_02_read_usage(o,a,null)->>'outcome'='forbidden');
 perform pg_temp.check('projection remains private after lifecycle correction',not has_table_privilege('authenticated','public.organization_usage_meters','delete') and not has_table_privilege('service_role','public.organization_usage_meters','delete'));
end $$;
rollback;
