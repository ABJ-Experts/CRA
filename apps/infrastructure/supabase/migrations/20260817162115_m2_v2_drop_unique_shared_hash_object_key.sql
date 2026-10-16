-- Remove the legacy unique content/object-key index so identical verified
-- bytes can be attested by multiple release-scoped artifact records.

alter table public.product_security_update_artifacts
  drop constraint if exists product_security_update_artif_organization_id_sha256_object_key;

create index if not exists product_security_update_artifacts_org_sha256_object_key_idx
  on public.product_security_update_artifacts(organization_id, sha256, object_key)
  where object_key is not null;
