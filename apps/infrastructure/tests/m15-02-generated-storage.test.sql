begin;
set local statement_timeout='30s';
create function pg_temp.check(label text,ok boolean) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'M15-02 check: %',label;end if;end $$;
do $$
declare o uuid:='00000000-0000-4000-8000-0000000000ca';other uuid;a uuid;job uuid:=gen_random_uuid();part uuid:=gen_random_uuid();second uuid:=gen_random_uuid();source text;path text:=o::text||'/m15-02-generated.zip';baseline bigint;other_baseline bigint;v bigint;admission uuid:=gen_random_uuid();
begin
 select id into a from public.users where email='owner@cra.test';
 select id into other from public.organizations where id<>o order by id limit 1;
 select source_id into source from public.organization_export_sources order by source_id limit 1;
 select protected_storage_bytes into baseline from public.organization_usage_meters where organization_id=o;
 select protected_storage_bytes into other_baseline from public.organization_usage_meters where organization_id=other;
 insert into storage.objects(bucket_id,name,metadata) values('tenant-exports',path,'{"size":47}');
 perform pg_temp.check('tenant-looking unowned object is excluded',(select protected_storage_bytes=baseline from public.organization_usage_meters where organization_id=o));
 insert into public.organization_export_jobs(id,organization_id,actor_user_id,request_digest) values(job,o,a,repeat('a',64));
 insert into public.organization_export_parts(id,organization_id,export_job_id,source_id,part_number,object_path,sha256,byte_size) values(part,o,job,source,1,path,repeat('a',64),47);
 perform pg_temp.check('owned generated object counted once',(select protected_storage_bytes=baseline+47 from public.organization_usage_meters where organization_id=o));
 insert into public.organization_export_parts(id,organization_id,export_job_id,source_id,part_number,object_path,sha256,byte_size) values(second,o,job,source,2,path,repeat('a',64),47);
 perform pg_temp.check('multiple source references are deduplicated',(select protected_storage_bytes=baseline+47 from public.organization_usage_meters where organization_id=o));
 select meter_version into v from public.organization_usage_meters where organization_id=o;
 update public.organization_export_jobs set checkpoint_version=checkpoint_version+1 where id=job;
 perform pg_temp.check('export checkpoint leaves gauges unchanged',(select meter_version=v from public.organization_usage_meters where organization_id=o));
 update public.organization_export_parts set organization_id=other where id=second;
 perform pg_temp.check('same-path ownership move adds destination',(select protected_storage_bytes=other_baseline+47 from public.organization_usage_meters where organization_id=other));
 update public.organization_export_parts set organization_id=other where id=part;
 perform pg_temp.check('last ownership move removes origin',(select protected_storage_bytes=baseline from public.organization_usage_meters where organization_id=o));
 update storage.objects set metadata='{"size":53}' where bucket_id='tenant-exports' and name=path;
 perform pg_temp.check('metadata delta follows current source ownership',(select protected_storage_bytes=other_baseline+53 from public.organization_usage_meters where organization_id=other));
 insert into public.organization_storage_admissions(organization_id,operation_id,actor_user_id,source_context,bucket,object_path,reserved_bytes,observed_bytes,token_digest,content_type,capability,state,expires_at,protected_input) values(other,admission,null,'{"kind":"existing"}','tenant-exports',path,53,53,repeat('a',64),'application/zip','evidence','completed',clock_timestamp(),true);
 perform pg_temp.check('ledger and generated object are not double charged',(select protected_storage_bytes=other_baseline+53 from public.organization_usage_meters where organization_id=other));
 update storage.objects set metadata='{}' where bucket_id='tenant-exports' and name=path;
 -- Ledger's exact completion receipt still charges those known bytes.
 perform pg_temp.check('unknown object size never erases admitted bytes',(select protected_storage_bytes=other_baseline+53 from public.organization_usage_meters where organization_id=other));
end $$;
rollback;
