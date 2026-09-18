-- Timestamp parsing depends on PostgreSQL timestamp input semantics and is
-- stable within a statement, not immutable across server settings.
alter function public.m2_parse_utc_z(text) stable;
