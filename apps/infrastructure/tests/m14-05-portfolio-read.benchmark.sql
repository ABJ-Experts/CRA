-- Read-only projection retiming for retained isolated fixtures. Caller supplies
-- organization, actor and samples using psql -v. No persisted fixture changes.
begin;
do $$begin if current_database()not in('cra_m14_benchmark','cra_m14_05_benchmark')then
 raise exception 'Portfolio retiming requires isolated database';end if;end$$;
set local statement_timeout='30min';
create temporary table m14_05_retiming_config as
 select :'organization'::uuid org,:'actor'::uuid actor,:'samples'::integer samples;
do $$declare c record;begin
 select *into c from m14_05_retiming_config;
 if c.samples not between 2 and 500 or not exists(select 1 from public.organizations where id=c.org and slug like'm14-05-bench-%')then
  raise exception 'Retiming requires a uniquely identified benchmark fixture';end if;
end$$;
create temporary table m14_05_retiming(endpoint text,ms numeric,bytes integer);
do $$declare c record;endpoint text;n integer;started timestamptz;v jsonb;component jsonb;filters jsonb;begin
 select *into c from m14_05_retiming_config;
 v:=public.get_portfolio_projection(c.org,c.actor,'concentration','{"limit":20}');
 if v->>'outcome'<>'found'then raise exception 'Isolated fixture access denied';end if;
 component:=v#>'{result,concentration,data,rows,0}';
 if component is null then raise exception 'Shared concentration absent';end if;
 foreach endpoint in array array['products','concentration','detail']loop
  filters:=case when endpoint='detail'then jsonb_build_object('limit',20,'component',jsonb_build_object('identityDigest',public.m14_05_identity_digest(component->>'packageIdentity',component->>'version')))else'{"limit":20}'::jsonb end;
  for n in 1..c.samples loop
   started:=clock_timestamp();v:=public.get_portfolio_projection(c.org,c.actor,endpoint,filters);
   insert into m14_05_retiming values(endpoint,1000*extract(epoch from clock_timestamp()-started),octet_length(v::text));
   if v->>'outcome'<>'found'then raise exception 'Projection failed: %',v->>'outcome';end if;
  end loop;
 end loop;
end$$;
select jsonb_build_object('endpoint',endpoint,'samples',count(*),'p50Ms',percentile_disc(0.50)within group(order by ms),'p95Ms',percentile_disc(0.95)within group(order by ms),'p99Ms',percentile_disc(0.99)within group(order by ms),'maxResponseBytes',max(bytes),'rawElapsedMs',jsonb_agg(ms),'measurement','SQL projection, not authenticated API')from m14_05_retiming group by endpoint order by endpoint;
explain(analyze,buffers,format json)select public.get_portfolio_projection(org,actor,'concentration','{"limit":20}')from m14_05_retiming_config;
rollback;
