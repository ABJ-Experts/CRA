-- Preserve the applied authority migration. This additive step records the
-- timestamp convention for fresh installs and accepts only an identical trigger.
do $$
declare installed record;
begin
 select * into installed from pg_catalog.pg_trigger
 where tgrelid='public.organization_usage_meters'::regclass
 and tgname='organization_usage_meters_set_updated_at' and not tgisinternal;
 if not found then
  create trigger organization_usage_meters_set_updated_at
   before update on public.organization_usage_meters
   for each row execute function public.set_updated_at();
 elsif installed.tgtype <> 19 or installed.tgfoid <> 'public.set_updated_at()'::regprocedure
  or installed.tgenabled <> 'O' or installed.tgnargs <> 0 or installed.tgqual is not null
  or installed.tgattr::text <> '' then
  raise exception 'Conflicting organization usage meter timestamp trigger';
 end if;
end $$;
