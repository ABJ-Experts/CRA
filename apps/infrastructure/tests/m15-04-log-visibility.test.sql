begin;
set local statement_timeout='30s';
create function pg_temp.check(label text,ok boolean) returns void language plpgsql as $$begin
 if not coalesce(ok,false) then raise exception 'M15-04 logs: %',label;end if;
end $$;
do $$
declare org uuid:=gen_random_uuid();actor uuid;session uuid;job uuid;r jsonb;v int;
 selection jsonb:=jsonb_build_object('categories',jsonb_build_array('logs'),'from',public.m7_snapshot_timestamp_utc(clock_timestamp()-interval '1 day'),'to',public.m7_snapshot_timestamp_utc(clock_timestamp()-interval '1 millisecond'));
begin
 select u.id,s.id into strict actor,session from public.users u join auth.sessions s on s.user_id=u.auth_user_id
 where u.is_active and u.email_verified_at is not null and (s.not_after is null or s.not_after>clock_timestamp()) order by s.created_at desc limit 1;
 insert into public.organizations(id,name,slug) values(org,'M15-04 log rollback','m15-04-log-'||org);
 insert into public.organization_members(organization_id,user_id,role) values(org,actor,'owner');
 insert into public.organization_session_bindings(organization_id,session_id,user_id,issued_at,last_seen_at) values(org,session,actor,clock_timestamp(),clock_timestamp());
 r:=public.m15_04_create(org,actor,session,repeat('a',64),selection,gen_random_uuid());job:=(r->'result'->>'id')::uuid;
 r:=public.m15_04_claim('log_visibility_test');v:=(r->'result'->'job'->>'version')::int;
 -- These events are visible audit metadata but have no approved log alias.
 insert into public.audit_logs(organization_id,created_at,schema_version,event_scope,event_key,actor_type,actor_id,action,entity_type,entity_id,outcome,correlation_id,redaction_version)
 select org,clock_timestamp()-interval '2 hours',2,'organization','test.unknown:'||gen_random_uuid()::text,'system','m15-log-test','test.unknown','organization',org::text,'completed',gen_random_uuid(),1 from generate_series(1,5001);
 insert into public.audit_logs(organization_id,created_at,schema_version,event_scope,event_key,actor_type,actor_id,action,entity_type,entity_id,outcome,correlation_id,redaction_version)
 values(org,clock_timestamp()-interval '1 hour',2,'organization','test.visible:'||gen_random_uuid()::text,'system','m15-log-test','test.visible','audit_search',gen_random_uuid()::text,'completed',gen_random_uuid(),1);
 r:=public.m15_04_logs(org,job,'log_visibility_test',v);
 perform pg_temp.check('unsupported aliases cannot starve later visible events',r->>'outcome'='ok' and jsonb_array_length(r->'result'->'logs')=1 and r->'result'->'logs'->0->>'source'='audit');
 perform pg_temp.check('unsupported events do not fabricate row-limit omission',r->'result'->'omissions'='[]'::jsonb);
 insert into public.audit_logs(organization_id,created_at,schema_version,event_scope,event_key,actor_type,actor_id,action,entity_type,entity_id,outcome,correlation_id,redaction_version)
 select org,clock_timestamp()-interval '30 minutes',2,'organization','test.visible:'||gen_random_uuid()::text,'system','m15-log-test','test.visible','audit_search',gen_random_uuid()::text,'completed',gen_random_uuid(),1 from generate_series(1,5001);
 r:=public.m15_04_logs(org,job,'log_visibility_test',v);
 perform pg_temp.check('visible rows capped after projection permissions',r->>'outcome'='ok' and jsonb_array_length(r->'result'->'logs')=5000);
 perform pg_temp.check('visible overflow reports safe omission',r->'result'->'omissions' @> '[{"category":"logs","code":"row_limit"}]'::jsonb);
end $$;
rollback;
