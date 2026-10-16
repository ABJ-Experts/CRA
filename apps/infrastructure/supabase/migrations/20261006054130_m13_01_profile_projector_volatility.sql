-- The profile retry projection added a safe field mask. Keep the projector at
-- the STABLE volatility selected by the prior audit lint correction.
alter function public.m13_01_project_v2_audit_json(jsonb) stable;
