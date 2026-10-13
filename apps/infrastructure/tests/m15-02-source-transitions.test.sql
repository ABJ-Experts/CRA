begin;
set local statement_timeout='30s';
create function pg_temp.check(label text,ok boolean) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'M15-02 check: %',label;end if;end $$;
do $$
declare o uuid:='00000000-0000-4000-8000-0000000000ca';a uuid;p uuid;v bigint;count_before bigint;admission uuid:=gen_random_uuid();r jsonb;old_authority jsonb;
begin
 select id into a from public.users where email='owner@cra.test';
 select id into p from public.products where organization_id=o and archived_at is null order by id limit 1;
 select meter_version,products into v,count_before from public.organization_usage_meters where organization_id=o;
 update public.products set updated_at=updated_at where organization_id=o and id=p;
 perform pg_temp.check('unrelated product update does not churn meter',(select meter_version=v from public.organization_usage_meters where organization_id=o));
 update public.products set archived_at=clock_timestamp() where organization_id=o and id=p;
 perform pg_temp.check('archive is exact product contribution',(select products=count_before-1 from public.organization_usage_meters where organization_id=o));
 select meter_version into v from public.organization_usage_meters where organization_id=o;
 update public.organization_members set role=role where organization_id=o and user_id=a;
 perform pg_temp.check('role-only update does not recount seats',(select meter_version=v from public.organization_usage_meters where organization_id=o));
 insert into public.organization_storage_admissions(organization_id,operation_id,actor_user_id,bucket,object_path,reserved_bytes,token_digest,content_type,capability,state,expires_at)
 values(o,admission,a,'evidence-documents',o::text||'/m15-02-delta',41,repeat('c',64),'application/pdf','evidence','uncertain',clock_timestamp());
 select meter_version into v from public.organization_usage_meters where organization_id=o;
 update public.organization_storage_admissions set token_digest=repeat('d',64),updated_at=clock_timestamp() where operation_id=admission;
 perform pg_temp.check('upload token/checkpoint does not scan or change meter',(select meter_version=v from public.organization_usage_meters where organization_id=o));
 old_authority:=public.m15_01_usage(o);
 update public.organization_usage_meters set storage_bytes=9007199254740991 where organization_id=o;
 update public.organization_storage_admissions set state='completed',observed_bytes=41 where operation_id=admission;
 perform pg_temp.check('projection overflow does not block protective completion',(select state='completed' from public.organization_storage_admissions where operation_id=admission));
 perform pg_temp.check('projection overflow marks only storage unavailable',(select not storage_ready and seats_ready and products_ready from public.organization_usage_meters where organization_id=o));
 r:=public.m15_02_read_usage(o,a,null);
 perform pg_temp.check('unknown storage is null instead of fabricated zero',r->'components'->'storageBytes'='null' and r->'availability'->>'storage'='unavailable');
 perform pg_temp.check('corrupt projection never controls source quota',(public.m15_01_usage(o)->>'storageBytes')::bigint=(old_authority->>'storageBytes')::bigint+41);
end $$;
rollback;
