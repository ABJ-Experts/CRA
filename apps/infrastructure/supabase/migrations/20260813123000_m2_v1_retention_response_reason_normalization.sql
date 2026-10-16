-- Roll-forward response hardening: JSON arrays retain SQL NULL values, while
-- jsonb_strip_nulls removes only object fields. Canonicalize every published
-- incomplete-reason array before it crosses the strict Zod API boundary.

create or replace function public.m2_normalize_retention_calculation(
  p_calculation jsonb
) returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select jsonb_set(
    jsonb_set(
      p_calculation,
      '{incompleteReasons}',
      coalesce((
        select jsonb_agg(reason)
        from jsonb_array_elements(coalesce(p_calculation->'incompleteReasons', '[]'::jsonb)) reason
        where reason <> 'null'::jsonb
      ), '[]'::jsonb),
      true
    ),
    '{releaseCalculations}',
    coalesce((
      select jsonb_agg(
        jsonb_set(
          calculation,
          '{incompleteReasons}',
          coalesce((
            select jsonb_agg(reason)
            from jsonb_array_elements(coalesce(calculation->'incompleteReasons', '[]'::jsonb)) reason
            where reason <> 'null'::jsonb
          ), '[]'::jsonb),
          true
        )
      )
      from jsonb_array_elements(coalesce(p_calculation->'releaseCalculations', '[]'::jsonb)) calculation
    ), '[]'::jsonb),
    true
  )
$$;

create or replace function public.get_product_retention_calculation(
  p_organization_id uuid,
  p_product_id uuid,
  p_actor_user_id uuid
) returns table(outcome text, retention jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype; v_calculation jsonb;
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) then
    return query select 'not_found'::text,null::jsonb;
    return;
  end if;
  select * into v_product from public.products
  where organization_id=p_organization_id and id=p_product_id;
  if not found then
    return query select 'not_found'::text,null::jsonb;
    return;
  end if;
  v_calculation := public.m2_normalize_retention_calculation(
    public.m2_recalculate_product_retention_atomic(
      p_organization_id,p_product_id,p_actor_user_id,false
    )
  );
  return query select 'found'::text,v_calculation;
end $$;

alter function public.m2_normalize_retention_calculation(jsonb) owner to postgres;
alter function public.get_product_retention_calculation(uuid,uuid,uuid) owner to postgres;
revoke all on function public.m2_normalize_retention_calculation(jsonb) from public, anon, authenticated;
