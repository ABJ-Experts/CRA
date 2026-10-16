-- Rollback-only database read sample. This does not measure HTTP or provider latency.
begin;

create temporary table m12_05_load_result(metric text not null, elapsed_ms numeric not null)
  on commit drop;

do $$
declare v_org uuid:='00000000-0000-4000-8000-0000000000ca';
  v_owner uuid;
  v_channel uuid:=gen_random_uuid();
  v_start timestamptz;
  v_result jsonb;
  v_iteration integer;
begin
  select id into v_owner from public.users where email='owner@cra.test';
  insert into public.notification_chat_channels(
    id,organization_id,mode,display_name,event_classes,product_ids,
    include_organization_wide,target_metadata,credential_envelope,
    created_by_user_id,updated_by_user_id
  ) values (
    v_channel,v_org,'slack_webhook','Load sample',array['countdown_warning'],
    '{}'::uuid[],true,'{}'::jsonb,
    '{"format":"aes-256-gcm-v1","keyId":"load","ciphertext":"YWJj","nonce":"AAAAAAAAAAAAAAAA","authTag":"AAAAAAAAAAAAAAAAAAAAAA=="}'::jsonb,
    v_owner,v_owner
  );
  insert into public.notification_chat_deliveries(
    organization_id,channel_id,event_class,source_kind,source_id,
    source_revision,severity,effective_at,status,next_attempt_at,created_at,route_version
  ) select v_org,v_channel,'countdown_warning','m2_support',gen_random_uuid(),
      '1','high',clock_timestamp()-make_interval(secs=>n),
      'exhausted',clock_timestamp(),clock_timestamp()-make_interval(secs=>n),1
    from generate_series(1,1500) n;
  if (select count(*) from public.notification_chat_deliveries
      where organization_id=v_org and channel_id=v_channel)<>1500 then
    raise exception 'load fixture incomplete';
  end if;
  for v_iteration in 1..150 loop
    v_start:=clock_timestamp();
    v_result:=public.m12_05_list_chat_channels_atomic(v_org,v_owner);
    if jsonb_array_length(v_result->'channels')<1 then raise exception 'channel read failed'; end if;
    insert into m12_05_load_result values
      ('channel_list',extract(epoch from clock_timestamp()-v_start)*1000);
    v_start:=clock_timestamp();
    v_result:=public.m12_05_list_chat_deliveries_atomic(
      v_org,v_owner,null,null,v_channel,null,50);
    if jsonb_array_length(v_result->'rows')<>50 then raise exception 'delivery read failed'; end if;
    insert into m12_05_load_result values
      ('delivery_list',extract(epoch from clock_timestamp()-v_start)*1000);
  end loop;
end $$;

select metric,count(*) as samples,
  round(percentile_cont(0.95) within group (order by elapsed_ms)::numeric,3) as p95_ms,
  round(percentile_cont(0.99) within group (order by elapsed_ms)::numeric,3) as p99_ms,
  round(max(elapsed_ms),3) as max_ms
from m12_05_load_result group by metric order by metric;

rollback;
