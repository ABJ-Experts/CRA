-- Generic JSON conversion/to_char are STABLE in PostgreSQL. Declare truthful
-- volatility without changing the frozen canonical version, bytes or hashes.
alter function public.m13_02_canonical_json(jsonb) stable;
alter function public.m13_02_canonical_content(public.audit_logs,bigint) stable;
