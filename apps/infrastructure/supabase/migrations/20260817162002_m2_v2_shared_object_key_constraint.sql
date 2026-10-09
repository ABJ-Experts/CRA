-- Permit shared content-addressed artifact objects (`org/sha256`) while still
-- accepting previously reserved `org/artifact/sha256` objects.

alter table public.product_security_update_artifacts
  drop constraint if exists product_security_update_artifacts_object_key_check,
  add constraint product_security_update_artifacts_object_key_check check (
    object_key is null
    or object_key ~ '^[0-9a-f-]{36}/([0-9a-f-]{36}/)?[a-f0-9]{64}$'
  );
