alter table public.vulnerability_vex_export_snapshots
  drop constraint if exists vulnerability_vex_export_snapshots_scope_version_check,
  add constraint vulnerability_vex_export_snapshots_scope_version_check
    check (scope_version >= 0);
