-- Database-only read timing diagnostic, not an HTTP latency SLO claim.
-- 100 products x 10 immutable runs, rolled back without altering seed data.
\set ON_ERROR_STOP on
begin;
do $$
declare
  v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_entity uuid;
  v_product uuid;
  v_products uuid[]:='{}';
  v_policy jsonb:=public.m2_classification_policy();
  v_answers jsonb:='{"scope":"in_scope","criticalCoreFunction":"no","classIICoreFunction":"no","classICoreFunction":"no"}';
  v_started timestamptz;
  v_latest_timings double precision[]:='{}';
  v_history_timings double precision[]:='{}';
  v_latest_p95 double precision;
  v_latest_p99 double precision;
  v_history_p95 double precision;
  v_history_p99 double precision;
  v_result record;
begin
  select id into v_actor from public.users where email='owner@cra.test';
  select id into v_entity from public.organization_legal_entities where organization_id=v_org and is_default;
  for product_index in 1..100 loop
    v_product:=gen_random_uuid();
    v_products:=array_append(v_products,v_product);
    insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
    values(v_product,v_org,v_entity,0,'{}','Classification read diagnostic','LOAD-'||v_product,'standalone_software',v_actor,v_actor,v_actor);
    for run_index in 0..9 loop
      select * into v_result from public.save_product_classification_atomic(v_org,v_actor,v_product,0,run_index,v_policy,v_policy->>'hash',v_answers,'Database timing fixture',gen_random_uuid());
      if v_result.outcome<>'saved' then raise exception 'Read-load fixture creation failed: %',v_result.outcome; end if;
    end loop;
  end loop;
  for sample in 1..30 loop
    v_started:=clock_timestamp();
    select * into v_result from public.get_product_classifications_latest(v_org,v_actor,v_products);
    if v_result.outcome<>'found' or jsonb_array_length(v_result.classifications)<>100 then raise exception 'Bounded latest read incorrect'; end if;
    v_latest_timings:=array_append(v_latest_timings,extract(epoch from clock_timestamp()-v_started)*1000);
    v_started:=clock_timestamp();
    select * into v_result from public.get_product_classification_history(v_org,v_actor,v_products[1],1,15);
    if v_result.outcome<>'found' or jsonb_array_length(v_result.history->'runs'->'rows')<>10 then raise exception 'Bounded history read incorrect'; end if;
    v_history_timings:=array_append(v_history_timings,extract(epoch from clock_timestamp()-v_started)*1000);
  end loop;
  select percentile_cont(0.95) within group(order by t),percentile_cont(0.99) within group(order by t)
    into v_latest_p95,v_latest_p99 from unnest(v_latest_timings) t;
  select percentile_cont(0.95) within group(order by t),percentile_cont(0.99) within group(order by t)
    into v_history_p95,v_history_p99 from unnest(v_history_timings) t;
  raise notice 'Classification local DB diagnostic: 100 products/1000 runs/30 samples; latest100 p95=%ms p99=%ms; history15 p95=%ms p99=%ms',
    round(v_latest_p95::numeric,3),round(v_latest_p99::numeric,3),round(v_history_p95::numeric,3),round(v_history_p99::numeric,3);
end $$;
rollback;
