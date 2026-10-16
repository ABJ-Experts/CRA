begin;
create extension if not exists pgtap;
set local search_path=public,extensions;
select plan(2);
select is(provolatile::text,'s','canonical JSON declares its stable PostgreSQL dependency')
 from pg_proc where oid='public.m13_02_canonical_json(jsonb)'::regprocedure;
select is(provolatile::text,'s','canonical envelope declares its stable PostgreSQL dependency')
 from pg_proc where oid='public.m13_02_canonical_content(public.audit_logs,bigint)'::regprocedure;
select * from finish();
rollback;
