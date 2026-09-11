-- Preserve the strict public failure blocker shape when a lifecycle is read
-- repeatedly. The preceding lifecycle-contract migration is already deployed
-- locally, so this is deliberately additive.
create or replace function public.m1_normalize_lifecycle_blockers(p_reasons jsonb)
  returns jsonb
  language sql
  stable
  security definer
  set search_path = public, pg_temp
as $$
  with raw as (
    select value
    from jsonb_array_elements(coalesce(p_reasons, '[]'::jsonb))
  ), normalized as (
    select jsonb_build_object(
      'kind', 'unavailable', 'code', 'dependency_unavailable'
    ) as blocker
    where exists (
      select 1
      from raw
      where value->>'code' = 'unavailable'
         or (
           value->>'kind' = 'unavailable'
           and value->>'code' = 'dependency_unavailable'
         )
    )

    union all

    select jsonb_build_object(
      'kind', 'worker_failure', 'code', 'worker_failure'
    ) as blocker
    where exists (select 1 from raw where value->>'kind' = 'worker_failure')

    union all

    select jsonb_build_object(
      'kind', value->>'kind',
      'recordId', value->>'recordId',
      'requiredRetentionDays', (value->>'requiredRetentionDays')::integer
    ) as blocker
    from raw
    where value->>'kind' in ('product', 'evidence_class', 'obligation', 'legal_hold')
      and value->>'recordId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and value->>'requiredRetentionDays' ~ '^[0-9]+$'
  )
  select coalesce(jsonb_agg(distinct blocker order by blocker), '[]'::jsonb)
  from normalized;
$$;

alter function public.m1_normalize_lifecycle_blockers(jsonb) owner to postgres;
revoke all on function public.m1_normalize_lifecycle_blockers(jsonb)
  from public, anon, authenticated, service_role;

update public.organization_lifecycles l
   set purge_block_reasons = public.m1_normalize_lifecycle_blockers(l.purge_block_reasons),
       safe_error_code = case
         when public.m1_normalize_lifecycle_blockers(l.purge_block_reasons)
              @> jsonb_build_array(jsonb_build_object(
                'kind', 'unavailable', 'code', 'dependency_unavailable'
              ))
         then 'unavailable'
         else 'invalid_state'
       end,
       updated_at = now()
 where l.status = 'purge_blocked';
