-- Optional local performance fixture; run explicitly with psql after seed.sql.
-- It is intentionally separate from the normal seed to keep everyday resets fast.
do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_entity uuid;
begin
  select u.id into v_owner from public.users u where u.email = 'owner@cra.test';
  select e.id into v_entity from public.organization_legal_entities e
   where e.organization_id = v_org and e.status = 'active' and e.completion_status = 'complete'
   order by e.is_default desc, e.created_at asc limit 1;
  if v_owner is null or v_entity is null then
    raise notice 'M2 large tenant fixture skipped: seed owner or active legal entity missing';
    return;
  end if;
  insert into public.products (
    organization_id, legal_entity_id, legal_entity_version, legal_entity_snapshot,
    name, internal_code, product_type, responsible_owner_id, created_by, updated_by
  )
  select v_org, e.id, e.version, public.m1_v2_legal_entity_json(e.id),
    'Performance product ' || series, 'PERF-' || lpad(series::text, 5, '0'),
    'standalone_software', v_owner, v_owner, v_owner
  from generate_series(1, 1000) series
  cross join lateral (select * from public.organization_legal_entities where id = v_entity) e
  on conflict (organization_id, internal_code_normalized) do nothing;
end $$;
