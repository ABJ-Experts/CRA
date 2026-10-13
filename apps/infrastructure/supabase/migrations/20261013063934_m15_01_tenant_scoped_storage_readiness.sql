-- Storage accounting readiness is tenant-local. A stray or legacy object owned
-- by another tenant must not make this tenant's licensing admission unavailable.
create or replace function public.m15_01_storage_accounting_ready(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
 select not exists(
  select 1
  from storage.objects o
  where o.bucket_id in ('evidence-documents','sbom-originals','organization-branding','product-imports','security-update-artifacts')
   and (
    o.name like p_organization_id::text||'/%'
    or exists(
     select 1
     from public.m15_01_customer_objects() c
     where c.organization_id=p_organization_id
      and c.bucket=o.bucket_id
      and c.object_path=o.name
    )
   )
   and (
    not exists(
     select 1
     from public.m15_01_customer_objects() c
     where c.organization_id=p_organization_id
      and c.bucket=o.bucket_id
      and c.object_path=o.name
    )
    or o.metadata->>'size' is null
    or o.metadata->>'size' !~ '^[0-9]+$'
    or not exists(
     select 1
     from public.organization_storage_admissions a
     where a.organization_id=p_organization_id
      and a.bucket=o.bucket_id
      and a.object_path=o.name
    )
   )
 )
$$;

revoke all on function public.m15_01_storage_accounting_ready(uuid) from public,anon,authenticated,service_role;
grant execute on function public.m15_01_storage_accounting_ready(uuid) to service_role;
