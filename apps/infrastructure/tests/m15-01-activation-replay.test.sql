-- Isolated, rollback-only receipt replay; no real tenant or audit state is changed.
begin;
set local statement_timeout='30s';
create function pg_temp.check(label text,ok boolean) returns void language plpgsql as $$begin
 if not coalesce(ok,false) then raise exception 'M15 replay check failed: %',label;end if;end$$;
select pg_temp.check('receipt RPC service only',
 has_function_privilege('service_role','public.m15_01_activation_receipt(uuid,uuid,text,text,uuid,text)','execute')
 and not has_function_privilege('authenticated','public.m15_01_activation_receipt(uuid,uuid,text,text,uuid,text)','execute'));
do $$ declare o uuid:=gen_random_uuid();foreign_org uuid:=gen_random_uuid();u uuid;other_actor uuid;k uuid:=gen_random_uuid();legacy_k uuid:=gen_random_uuid();license_id uuid:=gen_random_uuid();a jsonb;r jsonb;artifact text;digest text;legacy text;legacy_digest text;begin
 select id into strict u from public.users where is_active and email_verified_at is not null limit 1;
 select id into strict other_actor from public.users where is_active and email_verified_at is not null and id<>u limit 1;
 insert into public.organizations(id,name,slug)values(o,'M15 receipt rollback fixture','m15-receipt-'||o),(foreign_org,'M15 foreign receipt fixture','m15-foreign-receipt-'||foreign_org);
 insert into public.organization_members(organization_id,user_id,role)values(o,u,'owner'),(foreign_org,u,'owner');
 a:=jsonb_build_object('schemaVersion',1,'licenseId',license_id,'sequence',1,'issuer','fixture','organizationId',o,'instanceId',gen_random_uuid(),
 'issuedAt',clock_timestamp()-interval '1 day','startsAt',clock_timestamp()-interval '1 day','expiresAt',clock_timestamp()+interval '1 day','graceDays',30,
 'entitlements',jsonb_build_array('products'),'limits',jsonb_build_object('activeMembers',null,'products',null,'storageBytes',null));
 artifact:='rollback.receipt.fixture';digest:=encode(extensions.digest(artifact,'sha256'),'hex');
 insert into storage.objects(bucket_id,name)values('licence-artifacts',o::text||'/'||digest||'.jws');
 r:=public.m15_01_activate(o,u,artifact,digest,a,0,k,repeat('a',64),null,o::text||'/'||digest||'.jws');
 perform pg_temp.check('durable identifier returned',r->>'licenseId'=license_id::text);
 perform pg_temp.check('durable identifier in immutable audit',(select after_redacted->>'artifactId'=license_id::text from public.audit_logs where organization_id=o and event_key='licensing.activate:'||k));
 -- Changed clock, entitlement, version and expiry do not change an original receipt.
 update public.organization_license_states set clock_rollback_detected=true,version=version+1,
 verified_claims=jsonb_set(jsonb_set(verified_claims,'{expiresAt}',to_jsonb((clock_timestamp()-interval '31 days')::text)),'{entitlements}','[]') where organization_id=o;
 r:=public.m15_01_activation_receipt(o,u,artifact,digest,k,repeat('a',64));
 perform pg_temp.check('original receipt after expiry and downgrade',r->>'outcome'='replayed' and r->>'version'='1' and r->>'licenseId'=license_id::text);
 r:=public.m15_01_activate(o,u,artifact,digest,null,0,k,repeat('a',64),'unknown_key');
 perform pg_temp.check('late replacement race replay',r->>'outcome'='replayed' and r->>'licenseId'=license_id::text);
 perform pg_temp.check('replay did not renew or append',(select version=2 and clock_rollback_detected and verified_claims->'entitlements'='[]'::jsonb from public.organization_license_states where organization_id=o)
 and (select count(*)=1 from public.audit_logs where organization_id=o and action='licensing.activation'));
 perform pg_temp.check('changed request conflicts',public.m15_01_activation_receipt(o,u,artifact,digest,k,repeat('b',64))->>'outcome'='conflict');
 perform pg_temp.check('different actor denied',public.m15_01_activation_receipt(o,other_actor,artifact,digest,k,repeat('a',64))->>'outcome'='forbidden');
 perform pg_temp.check('foreign tenant does not replay',public.m15_01_activation_receipt(foreign_org,u,artifact,digest,k,repeat('a',64))->>'outcome'='absent');
 begin
  update public.users set is_active=false where id=u;
  perform pg_temp.check('revoked identity denied replay',public.m15_01_activation_receipt(o,u,artifact,digest,k,repeat('a',64))->>'outcome'='forbidden');
  raise exception using errcode='P0002',message='rollback revoked identity fixture';
 exception when no_data_found then null;end;
 -- A pre-migration receipt contains only the exact original artifact SHA-256.
 legacy:='e30.'||translate(rtrim(encode(convert_to(jsonb_build_object('licenseId',license_id)::text,'UTF8'),'base64'),'='),'+/','-_')||'.c2ln';
 legacy_digest:=encode(extensions.digest(legacy,'sha256'),'hex');
 perform public.m13_01_append_audit_event(o,'organization','licensing.activate:'||legacy_k,'user',u::text,'licensing.activation','organization_license',o::text,'completed',legacy_k,null,
 jsonb_build_object('licenseArtifactDigest',legacy_digest,'licenseRequestDigest',repeat('c',64),'version',1,'reasonCode','activated'),null,null,null,u);
 r:=public.m15_01_activation_receipt(o,u,legacy,legacy_digest,legacy_k,repeat('c',64));
 perform pg_temp.check('legacy receipt metadata compatibility',r->>'licenseId'=license_id::text and r->>'outcome'='replayed');
 perform pg_temp.check('legacy changed artifact conflicts',public.m15_01_activation_receipt(o,u,artifact,digest,legacy_k,repeat('c',64))->>'outcome'='conflict');
end$$;
rollback;
