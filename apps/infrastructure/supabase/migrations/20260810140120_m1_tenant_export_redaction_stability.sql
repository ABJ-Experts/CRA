-- jsonb_object_agg/jsonb_agg are STABLE. Mark the recursive redactor with the
-- correct volatility so PostgreSQL cannot make invalid immutable assumptions.
alter function public.m1_export_redact_jsonb(jsonb) stable;
