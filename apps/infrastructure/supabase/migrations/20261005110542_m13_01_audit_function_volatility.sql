-- JSON aggregation and object concatenation are STABLE in PostgreSQL.
-- Match the declared volatility to the expressions used by the redaction
-- functions so the database linter can detect real future regressions.
alter function public.m13_01_redact_audit_json(jsonb,text) stable;
alter function public.m13_01_project_v2_audit_json(jsonb) stable;
