-- CHECK treats SQL UNKNOWN as accepted. Explicitly require the digest when
-- a creation key exists, preserving historical connectors with neither value.
-- No backfill: invalid existing metadata must fail deployment for review.
begin;

alter table public.connectors
  drop constraint connectors_create_idempotency_pair_check,
  add constraint connectors_create_idempotency_pair_check check (
    (create_idempotency_key is null and create_request_digest is null)
    or (
      create_idempotency_key is not null
      and create_request_digest is not null
      and create_request_digest ~ '^[a-f0-9]{64}$'
    )
  ) not valid;

alter table public.connectors
  validate constraint connectors_create_idempotency_pair_check;

commit;
