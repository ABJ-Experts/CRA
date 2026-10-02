-- Validate the existing M2 connector-sync invariants against retained rows.
-- No data or schema shape changes: validation fails rather than repairing
-- historical records silently. All three checks become trusted together.
begin;

alter table public.connectors
  validate constraint connectors_create_idempotency_pair_check;

alter table public.sync_conflicts
  validate constraint sync_conflicts_exactly_one_target_check;

alter table public.sync_run_plan_items
  validate constraint sync_run_plan_items_field_diffs_schema_check;

commit;
