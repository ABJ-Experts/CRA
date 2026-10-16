-- Restore the platform's native versioned/partial object uniqueness model.
-- Compatible Storage runtimes do not require the legacy unqualified conflict
-- target. Remove only the index introduced by the preceding M14 amendment;
-- leave all objects, buckets, native indexes and migration history intact.
do $$
declare v_index regclass := to_regclass('storage.objects_bucket_id_name_compat_key');
begin
  if v_index is null then return; end if;
  if not exists (
    select 1 from pg_index i
    where i.indexrelid = v_index
      and i.indrelid = 'storage.objects'::regclass
      and i.indisunique and i.indnkeyatts = 2
      and pg_get_indexdef(i.indexrelid, 1, true) = 'bucket_id'
      and pg_get_indexdef(i.indexrelid, 2, true) = 'name'
  ) then
    raise exception 'storage_compatibility_index_definition_changed';
  end if;
  -- Only a local stack that applied the retired experiment needs owner access.
  execute 'set local role supabase_storage_admin';
  drop index storage.objects_bucket_id_name_compat_key;
  execute 'reset role';
end $$;
