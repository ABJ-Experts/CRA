-- Preserve the existing bounded lineage lookup backfill without permitting
-- mutation of published SBOM payloads. No historical graph is rewritten.
create or replace function public.guard_completed_sbom_graph() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
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
        -- Existing lineage reads lazily materialize a deterministic secondary
        -- package lookup for legacy graphs. Only that exact derived INSERT is
        -- allowed; original identities and every UPDATE/DELETE remain frozen.
        if tg_table_name = 'sbom_component_identities' and tg_op = 'INSERT' then
          if new.identity_type = 'purl_package'
            and new.created_at = now() and new.updated_at = now()
            and exists(select 1 from public.sbom_components c
              where c.organization_id = new.organization_id and c.document_id = new.document_id
                and c.id = new.component_id and c.canonical_purl is not null
                and new.original_value = c.canonical_purl
                and new.canonical_value is not distinct from public.sbom_purl_package_identity(c.canonical_purl))
            then return new; end if;
        end if;
        raise exception 'Completed SBOM graph is immutable' using errcode = '55000';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.guard_completed_sbom_graph() from public, anon, authenticated, service_role;
