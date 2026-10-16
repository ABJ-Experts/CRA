-- Source-owned quota admissions and downgrade preservation, rollback only.
begin;
set local statement_timeout='30s';
create function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$ begin if not coalesce(ok,false) then raise exception 'M15 growth check failed: %',label;end if;end $$;
do $$ declare o uuid:=gen_random_uuid();u uuid;v uuid;email text;le uuid:=gen_random_uuid();p uuid;i uuid;a jsonb;begin
 select id into strict u from public.users where is_active and email_verified_at is not null limit 1;
 select id,users.email into strict v,email from public.users where is_active and email_verified_at is not null and id<>u limit 1;
 insert into public.organizations(id,name,slug)values(o,'M15 growth rollback fixture','m15-growth-'||o);
 insert into public.organization_members(organization_id,user_id,role)values(o,u,'owner');
 a:=jsonb_build_object('schemaVersion',1,'licenseId',gen_random_uuid(),'sequence',1,'issuer','fixture','organizationId',o,'instanceId',gen_random_uuid(),'issuedAt',clock_timestamp()-interval '1 day','startsAt',clock_timestamp()-interval '1 day','expiresAt',clock_timestamp()+interval '1 day','graceDays',30,'entitlements',jsonb_build_array('administration','products'),'limits',jsonb_build_object('activeMembers',2,'products',1,'storageBytes',null));
 -- Direct privileged fixture state exercises SQL authority only. API signature
 -- validation has separate dynamically signed tests and no production bypass.
 insert into public.organization_license_states(organization_id,artifact,artifact_digest,artifact_object_path,verified_claims,issuance_sequence,version,time_high_water_at,verification_version,verification_artifact_digest,verification_valid,effective_capabilities,policy_revision,configuration_digest,verification_checked_at)
 values(o,'fixture',repeat('a',64),o::text||'/'||repeat('a',64)||'.jws',a,1,1,clock_timestamp(),1,repeat('a',64),true,a->'entitlements',1,repeat('b',64),clock_timestamp());
 insert into public.invitations(organization_id,invited_by,email,role,token_hash,expires_at)values(o,u,email,'member',encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),clock_timestamp()+interval '1 day') returning id into i;
 perform pg_temp.check('pending invitation reserves seat',public.m15_01_usage(o)->>'reservedInvitations'='1');
 begin insert into public.invitations(organization_id,invited_by,email,role,token_hash,expires_at)values(o,u,'m15-third@cra.test','viewer',encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),clock_timestamp()+interval '1 day');raise exception 'seat cap bypass';exception when insufficient_privilege then null;end;
 insert into public.organization_members(organization_id,user_id,role)values(o,v,'member');
 update public.invitations set status='accepted',accepted_at=clock_timestamp() where id=i;
 perform pg_temp.check('acceptance transfers reservation',public.m15_01_usage(o)->>'activeMembers'='2' and public.m15_01_usage(o)->>'reservedInvitations'='0');
 insert into public.organization_legal_entities(id,organization_id,identifier,display_name,legal_name,registered_address_line_1,registered_address_locality,registered_address_postal_code,registered_address_country,main_establishment_country,manufacturer_contact_name,manufacturer_contact_email,created_by,updated_by)
 values(le,o,'fixture','Fixture manufacturer','Fixture manufacturer','Test street','Test city','12345','DE','DE','Test contact','manufacturer@cra.test',u,u);
 insert into public.products(organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
 values(o,le,0,'{}','M15 product','M15-ONE','standalone_software',u,u,u) returning id into p;
 begin insert into public.products(organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
 values(o,le,0,'{}','M15 extra','M15-TWO','standalone_software',u,u,u);raise exception 'product cap bypass';exception when insufficient_privilege then null;end;
 update public.organization_license_states set verified_claims=jsonb_set(verified_claims,'{limits,products}','0') where organization_id=o;
 perform pg_temp.check('downgrade retains product',exists(select 1 from public.products where organization_id=o and id=p));
 perform pg_temp.check('downgrade retains members',public.m15_01_usage(o)->>'activeMembers'='2');
 update public.organization_license_states set verified_claims=jsonb_set(verified_claims,'{expiresAt}',to_jsonb((clock_timestamp()-interval '1 minute')::text)) where organization_id=o;
 perform pg_temp.check('grace allows existing writes',public.m15_01_customer_write_allowed(o,'products'));
 update public.organization_license_states set verified_claims=jsonb_set(verified_claims,'{expiresAt}',to_jsonb((clock_timestamp()-interval '30 days')::text)) where organization_id=o;
 perform pg_temp.check('grace boundary denies writes',not public.m15_01_customer_write_allowed(o,'products'));
 perform pg_temp.check('expiry preserves data',exists(select 1 from public.products where organization_id=o and id=p));
end $$;
rollback;
