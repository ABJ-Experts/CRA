-- Rollback-only proof that exports leave native object versioning intact.
begin;
set local statement_timeout = '30s';

do $$
declare
  v_name text := 'm14-versioning-check/' || gen_random_uuid()::text;
  v_count bigint;
begin
  if to_regclass('storage.objects_bucket_id_name_compat_key') is not null then
    raise exception 'exports must not impose global object-name uniqueness';
  end if;
  insert into storage.objects(bucket_id, name, version, is_versioned, archived_at)
    values ('filtered-exports', v_name, gen_random_uuid()::text, true, clock_timestamp());
  insert into storage.objects(bucket_id, name, version, is_versioned)
    values ('filtered-exports', v_name, gen_random_uuid()::text, true);
  select count(*) into v_count from storage.objects
    where bucket_id = 'filtered-exports' and name = v_name;
  if v_count <> 2 then raise exception 'native versioned object identity lost'; end if;
end $$;

rollback;
