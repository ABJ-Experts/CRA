-- Fifty-one busy tenants, all fixtures rolled back. No external delivery occurs.
\set ON_ERROR_STOP on
begin;
create function pg_temp.check(p_label text,p_ok boolean) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'FAIL %',p_label; end if;raise notice 'ok %',p_label;end $$;
do $$
declare u uuid:=gen_random_uuid();o uuid;p uuid;le uuid;ep uuid;kid uuid;d uuid;old_org uuid;i integer;epoch bigint;
begin
 insert into public.users(id,email) values(u,'m1103-fair-'||u||'@cra.test');
 for i in 1..51 loop
  o:=gen_random_uuid();p:=gen_random_uuid();le:=gen_random_uuid();ep:=gen_random_uuid();kid:=gen_random_uuid();d:=gen_random_uuid();
  insert into public.organizations(id,name,slug) values(o,'M1103 fairness','m1103-fair-'||o);
  insert into public.organization_members(organization_id,user_id,role) values(o,u,'owner');
  select version into epoch from public.organization_permissions_version where organization_id=o;
  insert into public.organization_legal_entities(id,organization_id,identifier,display_name,completion_status,status,created_by,updated_by) values(le,o,'fixture','M1103','needs_completion','inactive',u,u);
  insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by) values(p,o,le,0,'{}','Fixture','M1103','standalone_software',u,u,u);
  insert into public.webhook_endpoints(id,organization_id,display_name,url,event_types,product_ids,enabled,secret_id,signing_key_id,secret_revision,secret_ciphertext,secret_key_id,secret_nonce,secret_auth_tag,authorization_actor_user_id,permission_version,created_by,updated_by) values(ep,o,'Fixture','https://receiver.example/events',array['connector.sync_completed'],array[p],true,kid,kid,1,'cipher'::bytea,'fixture',decode(repeat('11',12),'hex'),decode(repeat('11',16),'hex'),u,epoch,u,u);
  insert into public.webhook_deliveries(id,organization_id,endpoint_id,event_id,delivery_id,event_type,resource_type,resource_id,product_ids,resource_url,occurred_at,endpoint_url,source_kind,source_id,authorization_actor_user_id,permission_version,endpoint_version,destination_revision,scope_revision,max_attempts,base_delay_seconds,max_delay_seconds,next_attempt_at)
   values(d,o,ep,'evt_'||repeat('a',64),d::text,'webhook.test','connector',ep,array[p],'/connectors/webhooks',clock_timestamp(),'https://receiver.example/events','test',ep,u,epoch,1,1,1,6,5,300,clock_timestamp()-case when i=1 then interval '1 hour' else interval '1 minute' end);
  if i=1 then
   old_org:=o;
   insert into public.webhook_delivery_attempts(organization_id,delivery_row_id,lease_generation,attempt_number,worker_id,started_at,finished_at,outcome) values(o,d,1,1,'previous-worker',clock_timestamp()-interval '1 second',clock_timestamp(),'retrying');
  end if;
 end loop;
 perform pg_temp.check('Fifty unserved tenants precede older served backlog',not exists(select 1 from public.m1103_list_due_webhook_delivery_organizations(50) x where x.organization_id=old_org));
 perform pg_temp.check('Served backlog remains eligible after unserved tenants',exists(select 1 from public.m1103_list_due_webhook_delivery_organizations(100) x where x.organization_id=old_org));
end $$;
rollback;
