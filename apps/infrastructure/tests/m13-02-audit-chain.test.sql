begin;
create or replace function pg_temp.check(p_name text,p_ok boolean)
returns void language plpgsql as $$ begin
 if not coalesce(p_ok,false) then raise exception 'check failed: %',p_name; end if;
end $$;
select pg_temp.check('chain columns exist',(select count(*)=5 from information_schema.columns where table_schema='public' and table_name='audit_logs' and column_name in ('chain_version','chain_sequence','previous_hash','content_hash','canonical_content')));
select pg_temp.check('writer cannot log in',(select not rolcanlogin and not rolbypassrls from pg_roles where rolname='cra_audit_chain_writer'));
select pg_temp.check('service role retains INSERT only for mutation',has_table_privilege('service_role','public.audit_logs','INSERT') and not has_table_privilege('service_role','public.audit_logs','UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
select pg_temp.check('canonical JSON golden Unicode and decimal',public.m13_02_canonical_json('{"é":"é","a":[null,-0.0,1.2300,1e3],"Z":"\n"}'::jsonb)='{"Z":"\n","a":[null,0,1.23,1000],"é":"é"}');
select pg_temp.check('large numeric retains exact value',public.m13_02_canonical_json('900719925474099312345678901234567890.1000'::jsonb)='900719925474099312345678901234567890.1');


do $$ declare v_row public.audit_logs; v_canonical text; begin
 select * into v_row from jsonb_populate_record(null::public.audit_logs,'{"id":"11111111-1111-4111-8111-111111111111","organization_id":"00000000-0000-4000-8000-0000000000ca","action":"test.golden","schema_version":1,"changes":{"null":null,"number":1.2300,"unicode":"é"},"created_at":"2026-10-06T01:02:03.123456Z"}');
 v_canonical:=public.m13_02_canonical_content(v_row,1);
 perform pg_temp.check('full canonical envelope golden bytes',v_canonical=$canonical${"action":"test.golden","actor_email":null,"actor_id":null,"actor_type":null,"after_redacted":null,"before_redacted":null,"chain_sequence":"1","chain_version":1,"changes":{"null":null,"number":1.23,"unicode":"é"},"correlation_id":null,"created_at":"2026-10-06T01:02:03.123456Z","entity_id":null,"entity_type":null,"event_key":null,"event_scope":null,"id":"11111111-1111-4111-8111-111111111111","ip_address":null,"organization_id":"00000000-0000-4000-8000-0000000000ca","outcome":null,"reason":null,"redaction_version":null,"schema_version":1,"user_agent":null,"user_id":null}$canonical$);
 perform pg_temp.check('SHA256 binary genesis golden hash',encode(extensions.digest(decode(repeat('0',64),'hex')||convert_to(v_canonical,'UTF8'),'sha256'),'hex')='f010556bd4f771dd0e9fa71956a6283f6c814e695d65fff2f44f05ed9010fb2f');
end $$;

do $$ declare v_org uuid:='00000000-0000-4000-8000-0000000000ca'; v_start bigint; v_first public.audit_logs; v_last public.audit_logs; v_before bigint; v_actor uuid:=gen_random_uuid(); v_id uuid:=gen_random_uuid(); begin
 select last_sequence into v_start from public.audit_chain_heads where organization_id=v_org;
 insert into public.audit_logs(organization_id,action,changes) values(v_org,'test.chain.first','{"counter":1.00}'),(v_org,'test.chain.second','{"counter":2}');
 set constraints m13_02_finalize_audit_chain immediate;
 select * into v_first from public.audit_logs where organization_id=v_org and chain_sequence=v_start+1;
 select * into v_last from public.audit_logs where organization_id=v_org and chain_sequence=v_start+2;
 perform pg_temp.check('multirow chain contiguous',v_first.chain_version=1 and v_last.previous_hash=v_first.content_hash);
 perform pg_temp.check('canonical retained bytes hashed',v_first.content_hash=encode(extensions.digest(decode(v_first.previous_hash,'hex')||convert_to(v_first.canonical_content,'UTF8'),'sha256'),'hex'));
 perform pg_temp.check('head agrees',(select last_sequence=v_start+2 and last_event_id=v_last.id and last_hash=v_last.content_hash from public.audit_chain_heads where organization_id=v_org));
 set constraints m13_02_finalize_audit_chain deferred;
 begin
  insert into public.audit_logs(organization_id,action) values(v_org,'test.chain.rollback');
  set constraints m13_02_finalize_audit_chain immediate;
  raise exception using errcode='P0002',message='force subtransaction rollback';
 exception when no_data_found then null;
 end;
 perform pg_temp.check('rollback consumes no sequence',(select last_sequence=v_start+2 from public.audit_chain_heads where organization_id=v_org));
 -- EXCEPTION opens a subtransaction even on a successful insert. Its xmin is
 -- not the top-level XID; the explicit pending marker must still finalize it.
 begin
  insert into public.audit_logs(organization_id,action) values(v_org,'test.chain.subtransaction');
 exception when check_violation then raise;
 end;
 set constraints m13_02_finalize_audit_chain immediate;
 perform pg_temp.check('subtransaction insert chained',(select chain_sequence=v_start+3 from public.audit_logs where organization_id=v_org and action='test.chain.subtransaction'));
 set constraints m13_02_finalize_audit_chain deferred;
 select last_sequence into v_before from public.audit_chain_heads where organization_id=v_org;
 insert into public.audit_logs(id,organization_id,action) values(v_id,v_org,'test.chain.duplicate') on conflict(id) do nothing;
 insert into public.audit_logs(id,organization_id,action) values(v_id,v_org,'test.chain.duplicate') on conflict(id) do nothing;
 set constraints m13_02_finalize_audit_chain immediate;
 perform pg_temp.check('duplicate consumes exactly one sequence',(select last_sequence=v_before+1 from public.audit_chain_heads where organization_id=v_org));
 insert into public.users(id,email) values(v_actor,'m13-chain-actor-'||v_actor::text||'@cra.test');
 insert into public.audit_logs(id,organization_id,user_id,action) values(gen_random_uuid(),v_org,v_actor,'test.chain.actor_deleted');
 delete from public.users where id=v_actor;
 perform pg_temp.check('actor deletion leaves immutable snapshot',(select user_id=v_actor and chain_sequence is not null from public.audit_logs where organization_id=v_org and action='test.chain.actor_deleted'));
 begin update public.audit_logs set action='forged' where id=v_first.id; raise exception 'update accepted'; exception when insufficient_privilege then null; end;
 begin delete from public.audit_logs where id=v_first.id; raise exception 'delete accepted'; exception when insufficient_privilege then null; end;
 -- Include the new referencing workflow explicitly so the immutable-audit
 -- trigger is exercised rather than PostgreSQL's FK precheck. No CASCADE; the
 -- expected denial and outer rollback preserve all retained rows.
 begin truncate public.siem_delivery_attempts, public.siem_deliveries, public.audit_export_jobs, public.audit_logs; raise exception 'truncate accepted'; exception when insufficient_privilege then null; end;
 begin insert into public.audit_logs(organization_id,action,chain_sequence) values(v_org,'forged',999); raise exception 'metadata accepted'; exception when check_violation then null; end;
 begin insert into public.audit_logs(organization_id,action,created_at) values(v_org,'invalid.timestamp','infinity'); raise exception 'infinite accepted'; exception when check_violation then null; end;
 perform pg_temp.check('page bounded and serialized sequence',jsonb_typeof(public.m13_02_audit_chain_page(v_org,v_start::text,(v_start+2)::text,1))='array' and public.m13_02_audit_chain_page(v_org,v_start::text,(v_start+2)::text,1)->0->>'chain_sequence'=(v_start+1)::text);
 begin perform public.m13_02_audit_chain_page(v_org,'0','1',1001); raise exception 'unbounded page accepted'; exception when invalid_parameter_value then null; end;
 update public.audit_chain_heads set last_hash=repeat('f',64) where organization_id=v_org;
 begin perform public.m13_02_audit_chain_snapshot(v_org); raise exception 'corrupt head accepted'; exception when check_violation then null; end;
 begin insert into public.audit_logs(organization_id,action) values(v_org,'test.corrupt_head'); raise exception 'corrupt append accepted'; exception when check_violation then null; end;
end $$;
set local role service_role;
do $$ begin
 begin update public.audit_logs set action='forged' where false; raise exception 'service update accepted'; exception when insufficient_privilege then null; end;
 begin delete from public.audit_logs where false; raise exception 'service delete accepted'; exception when insufficient_privilege then null; end;
 begin truncate public.siem_delivery_attempts, public.siem_deliveries, public.audit_export_jobs, public.audit_logs; raise exception 'service truncate accepted'; exception when insufficient_privilege then null; end;
 begin perform public.m13_02_finalize_audit_chain(); raise exception 'indirect finalizer accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.check('NOLOGIN writer has no application membership',not pg_has_role('service_role','cra_audit_chain_writer','MEMBER') and not pg_has_role('authenticated','cra_audit_chain_writer','MEMBER') and not pg_has_role('anon','cra_audit_chain_writer','MEMBER'));
select pg_temp.check('internal RPC paths unavailable',not has_function_privilege('service_role','public.m13_02_finalize_audit_chain()','EXECUTE') and not has_function_privilege('authenticated','public.m13_02_audit_chain_page(uuid,text,text,integer)','EXECUTE'));
rollback;
