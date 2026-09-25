-- Preserve M8 immutability while allowing the established tenant deletion
-- cascade to remove private evidence links with their parent organization.
create or replace function public.prevent_evidence_version_product_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' and pg_trigger_depth()>1 then return old; end if;
  if tg_op in ('UPDATE','DELETE') then
    raise exception using errcode='55000', message='Evidence version product applicability is immutable';
  end if;
  if not exists(
    select 1 from public.evidence_document_versions v
    where v.organization_id=new.organization_id
      and v.id=new.version_id
      and v.processing_state='uploading'
  ) then
    raise exception using errcode='55000', message='Evidence products may only be added during reservation';
  end if;
  return new;
end $$;

revoke all on function public.prevent_evidence_version_product_mutation() from public, anon, authenticated;
grant execute on function public.prevent_evidence_version_product_mutation() to service_role;
