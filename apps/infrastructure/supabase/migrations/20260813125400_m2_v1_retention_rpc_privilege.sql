-- This is an internal projection primitive, never a client RPC. PostgreSQL grants
-- EXECUTE to PUBLIC by default, so make the intended service-role boundary explicit.

alter function public.m2_recalculate_product_retention_atomic(uuid, uuid, uuid, boolean) owner to postgres;
revoke all on function public.m2_recalculate_product_retention_atomic(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.m2_recalculate_product_retention_atomic(uuid, uuid, uuid, boolean) to service_role;
