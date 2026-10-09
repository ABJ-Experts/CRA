-- The validator compares a supplied due date with the current clock, so it
-- must remain VOLATILE rather than promising a stable result within a query.
alter function public.m9_03_validate_follow_up_payload(uuid, uuid, jsonb)
  volatile;
