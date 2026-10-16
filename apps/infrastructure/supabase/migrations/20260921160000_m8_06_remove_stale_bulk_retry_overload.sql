-- A development-only, short-signature retry overload predates the durable
-- M8-06 replacement workflow. Its input shape permits bypassing the explicit
-- class review captured by the supported overload, and no repository caller
-- or database object depends on it. Remove it without touching evidence rows
-- or objects so production schema matches the versioned contract.

drop function if exists public.retry_evidence_bulk_intake_item_atomic(
  uuid, uuid, uuid, uuid, uuid, uuid, text, timestamptz, text
);
