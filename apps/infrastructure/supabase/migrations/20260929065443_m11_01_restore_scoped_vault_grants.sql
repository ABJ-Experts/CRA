-- Reassert only the integration vault's existing service boundary. A local
-- schema restore widened ACLs independently of the original migrations.
-- Idempotent and data-preserving; unrelated feature grants are untouched.
do $$
declare v_function regprocedure;
begin
 for v_function in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'm11\_%' escape '\' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',v_function);
  execute format('grant execute on function %s to service_role',v_function);
 end loop;
end $$;

revoke all on public.connector_commands from public,anon,authenticated,service_role;
grant select on public.connector_commands to service_role;

-- Preserve the reviewed M2 bridge grants; GCM writes use the atomic M11 RPC.
revoke all on public.connector_secrets from public,anon,authenticated,service_role;
grant select,insert on public.connector_secrets to service_role;

-- Preserve the existing service retirement state and never restore a retired
-- legacy RPC. Its guarded retirement remains an explicit operator cutover.
revoke all on function public.resolve_connector_secret(uuid,uuid,text),
 public.set_connector_secret_atomic(uuid,uuid,uuid,text,text) from public,anon,authenticated;
