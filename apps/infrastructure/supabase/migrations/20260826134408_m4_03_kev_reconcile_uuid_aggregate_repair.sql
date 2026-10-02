-- PostgreSQL has no min(uuid). Preserve the deterministic representative
-- finding selection while making the aggregate explicitly text-ordered.
do $$
declare definition text;
begin
  select pg_get_functiondef('public.reconcile_vulnerability_kev_alerts_for_release(uuid,uuid)'::regprocedure)
    into definition;
  definition := replace(definition, 'min(findings.id)', 'min(findings.id::text)::uuid');
  execute definition;
end;
$$;
alter function public.reconcile_vulnerability_kev_alerts_for_release(uuid,uuid) owner to postgres;
revoke all on function public.reconcile_vulnerability_kev_alerts_for_release(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reconcile_vulnerability_kev_alerts_for_release(uuid,uuid) to service_role;
