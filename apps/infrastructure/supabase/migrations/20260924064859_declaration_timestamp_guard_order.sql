-- PostgreSQL fires same-kind triggers in name order. Stamp a declaration
-- before its immutable-state guard so a no-op UPDATE cannot acquire a new
-- updated_at after the guard has approved it. Explicit RPC timestamps still
-- bypass the stamp through the trigger's WHEN clause.
alter trigger technical_file_declarations_set_updated_at
  on public.technical_file_declarations
  rename to a_technical_file_declarations_set_updated_at;
