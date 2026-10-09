-- Published normalized payloads are retained evidence. Provenance aliases in
-- sbom_document_sources intentionally remain appendable for hash replay.
create function public.guard_completed_sbom_graph() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_completed boolean;
begin
  -- Consume the existing M1 organization-purge boundary. Direct graph/product
  -- deletion cannot use this exception while the organization remains present.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1
    and not exists(select 1 from public.organizations where id = old.organization_id)
    then return old; end if;

  if tg_table_name = 'sbom_documents' then
    if old.state = 'completed' then
      raise exception 'Completed SBOM graph is immutable' using errcode = '55000';
    end if;
  else
    -- A parent SHARE lock serializes writes with the finalizer's FOR UPDATE:
    -- a mutation waiting behind publication observes completed and is rejected.
    -- Check both scopes to prevent moving rows into or out of retained graphs.
    if tg_op in ('UPDATE', 'DELETE') then
      select state = 'completed' into v_completed from public.sbom_documents
       where organization_id = old.organization_id and id = old.document_id for share;
      if coalesce(v_completed, false) then
        raise exception 'Completed SBOM graph is immutable' using errcode = '55000';
      end if;
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      select state = 'completed' into v_completed from public.sbom_documents
       where organization_id = new.organization_id and id = new.document_id for share;
      if coalesce(v_completed, false) then
        raise exception 'Completed SBOM graph is immutable' using errcode = '55000';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_completed_sbom_graph() from public, anon, authenticated, service_role;
create trigger guard_completed_sbom_graph before update or delete on public.sbom_documents
for each row execute function public.guard_completed_sbom_graph();
create trigger guard_completed_sbom_graph before insert or update or delete on public.sbom_components
for each row execute function public.guard_completed_sbom_graph();
create trigger guard_completed_sbom_graph before insert or update or delete on public.sbom_component_identities
for each row execute function public.guard_completed_sbom_graph();
create trigger guard_completed_sbom_graph before insert or update or delete on public.sbom_component_dependencies
for each row execute function public.guard_completed_sbom_graph();
