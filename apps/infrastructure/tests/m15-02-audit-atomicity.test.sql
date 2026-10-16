begin;
set local statement_timeout='30s';
create function pg_temp.check(label text,ok boolean) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'M15-02 check: %',label;end if;end $$;
create function pg_temp.reject_usage_audit() returns trigger language plpgsql as $$begin
 if new.action in ('licensing.usage_exported','licensing.usage_reconciled') then raise exception 'test_usage_audit_outage' using errcode='P0002';end if;return new;
end $$;
create trigger m15_02_test_audit_outage before insert on public.audit_logs for each row execute function pg_temp.reject_usage_audit();
do $$
declare o uuid:='00000000-0000-4000-8000-0000000000ca';a uuid;r jsonb;v bigint;op uuid:=gen_random_uuid();key uuid:=gen_random_uuid();failed boolean:=false;
begin
 select id into a from public.users where email='owner@cra.test';
 insert into public.organization_storage_admissions(organization_id,operation_id,actor_user_id,bucket,object_path,reserved_bytes,token_digest,content_type,capability,state,expires_at)
 values(o,op,a,'evidence-documents',o::text||'/m15-02-audit-atomicity',43,repeat('c',64),'application/pdf','evidence','reserved',clock_timestamp()-interval '1 second');
 r:=public.m15_02_read_usage(o,a,null);v:=(r->>'meterVersion')::bigint;
 begin perform public.m15_02_reconcile_usage(o,a,(r->>'licenseVersion')::integer,v,key,repeat('a',64));exception when no_data_found then failed:=true;end;
 perform pg_temp.check('audit failure is propagated',failed);
 perform pg_temp.check('audit failure rolls back release',(select state='reserved' from public.organization_storage_admissions where operation_id=op));
 perform pg_temp.check('audit failure rolls back meter correction',(select meter_version=v from public.organization_usage_meters where organization_id=o));
 perform pg_temp.check('audit failure creates no replay receipt',public.m15_02_usage_receipt(o,a,'reconcile',key,repeat('a',64))->>'outcome'='absent');
end $$;
rollback;
