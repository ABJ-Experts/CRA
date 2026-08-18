-- Shared content-addressed bytes can support multiple release-specific records,
-- so object_key is indexed for lookup but no longer unique per organization.

alter table public.product_security_update_artifacts
  drop constraint if exists product_security_update_artifact_organization_id_object_key_key,
  drop constraint if exists product_security_update_artifacts_organization_id_object_key_key;

create index if not exists product_security_update_artifacts_org_object_key_idx
  on public.product_security_update_artifacts(organization_id, object_key)
  where object_key is not null;
