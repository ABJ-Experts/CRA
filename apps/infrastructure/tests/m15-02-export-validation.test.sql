-- No signed licence fixture: missing licence is legitimate metering state.
begin;
set local statement_timeout='30s';
create function pg_temp.check(label text,ok boolean) returns void language plpgsql as $$begin if not coalesce(ok,false) then raise exception 'M15-02 check: %',label;end if;end $$;
create function pg_temp.snapshot(r jsonb) returns jsonb language plpgsql as $$
declare counters jsonb:='[]';d record; component text;parts jsonb; value_sum bigint; value_null boolean;
begin
 for d in select * from (values
 ('seats','Seats','seats','Active organization members plus distinct live pending invitation reservations; active member emails are not reserved twice.',array['activeMembers','reservedInvitations']),
 ('products','Products','products','Organization products whose archived_at is null; archiving changes this gauge without deleting storage.',array['products']),
 ('storage','Customer storage','bytes','Completed customer storage plus reserved, uploading and uncertain customer bytes; protected inputs and generated artifacts are excluded.',array['storageBytes','storageReservedBytes']),
 ('protected_storage','Protected storage','bytes','Deduplicated protected input and generated artifact bytes; informational and exempt from customer storage limits.',array['protectedStorageBytes']))v(id,label,unit,definition,keys) loop
  parts:='[]';value_sum:=0;value_null:=false;
  foreach component in array d.keys loop
   parts:=parts||jsonb_build_array(jsonb_build_object('key',component,'value',r->'components'->component));
   value_null:=value_null or r->'components'->component='null';value_sum:=value_sum+coalesce((r->'components'->>component)::bigint,0);
  end loop;
  counters:=counters||jsonb_build_array(jsonb_build_object('id',d.id,'label',d.label,'kind','gauge','unit',d.unit,'scope','organization','definition',d.definition,'period','{"kind":"current_state","resetRule":"source_changes_only","nextResetAt":null}'::jsonb,'value',case when value_null then null else value_sum end,'components',parts,'availability',r->'availability'->d.id,'limit',jsonb_build_object('kind',case when d.id='protected_storage' then 'exempt' else 'unverified' end,'value',null),'state',case when d.id='protected_storage' and not value_null then 'normal' else 'unavailable' end,'reasons','[]'::jsonb));
 end loop;
 return jsonb_build_object('schemaVersion',1,'definitionVersion','m15_02_v1','organizationId',r->'organizationId','observedAt',r->'observedAt','meterVersion',r->'meterVersion','reconciledAt',r->'reconciledAt','license',jsonb_build_object('version',r->'licenseVersion','issuanceSequence',r->'issuanceSequence','policyRevision',coalesce((select policy_revision from public.organization_license_states where organization_id=(r->>'organizationId')::uuid),0),'state',null,'verified',false,'reasons',jsonb_build_array('license_missing'),'startsAt',null,'expiresAt',null,'graceEndsAt',null,'effectiveCapabilities','[]'::jsonb),'counters',counters);
end $$;
create function pg_temp.expect_rejected(o uuid,a uuid,r jsonb,s jsonb) returns boolean language plpgsql as $$
declare response jsonb;begin
 response:=public.m15_02_export_usage(o,a,(r->>'licenseVersion')::integer,(r->>'meterVersion')::bigint,gen_random_uuid(),repeat('a',64),s);
 return response->>'outcome'='conflict';
exception when invalid_parameter_value then return true;
end $$;
do $$
declare o uuid:='00000000-0000-4000-8000-0000000000ca';a uuid;r jsonb;s jsonb;bad jsonb;stored public.organization_license_states%rowtype;counter jsonb;idx integer;cap jsonb;value numeric;expected text;
begin
 select id into a from public.users where email='owner@cra.test';
 r:=public.m15_02_read_usage(o,a,null);s:=pg_temp.snapshot(r);
 bad:=jsonb_set(s,'{license,effectiveCapabilities}','["ai"]');
 perform pg_temp.check('unverified snapshot cannot invent capabilities',pg_temp.expect_rejected(o,a,r,bad));
 bad:=jsonb_set(s,'{license,state}','"active"');
 perform pg_temp.check('unverified snapshot cannot claim active policy',pg_temp.expect_rejected(o,a,r,bad));
 select * into stored from public.organization_license_states where organization_id=o;
 if found and stored.verification_valid then
  -- Refresh only the timestamp of the existing signed and verified fixture.
  -- No claims/artifact/validity/limits/configuration are fabricated.
  update public.organization_license_states set verification_checked_at=clock_timestamp() where organization_id=o;
  s:=jsonb_set(s,'{license}',jsonb_build_object('version',stored.version,'issuanceSequence',stored.issuance_sequence,'policyRevision',stored.policy_revision,'state','active','verified',true,'reasons','[]'::jsonb,'startsAt',public.m7_snapshot_timestamp_utc((stored.verified_claims->>'startsAt')::timestamptz),'expiresAt',public.m7_snapshot_timestamp_utc((stored.verified_claims->>'expiresAt')::timestamptz),'graceEndsAt',public.m7_snapshot_timestamp_utc((stored.verified_claims->>'expiresAt')::timestamptz+interval '30 days'),'effectiveCapabilities',stored.effective_capabilities));
  for idx in 0..2 loop
   counter:=s->'counters'->idx;
   cap:=stored.verified_claims->'limits'->(case idx when 0 then 'activeMembers' when 1 then 'products' else 'storageBytes' end);
   value:=(counter->>'value')::numeric;
   expected:=case when counter->>'availability'='unavailable' then 'unavailable' when cap='null' then 'normal' when value>cap::text::numeric then 'over_limit' when value=cap::text::numeric then 'at_limit' when value*5>=cap::text::numeric*4 then 'near_limit' else 'normal' end;
   counter:=counter||jsonb_build_object('limit',jsonb_build_object('kind',case when cap='null' then 'unlimited' else 'finite' end,'value',cap),'state',expected);
   s:=jsonb_set(s,array['counters',idx::text],counter);
  end loop;
  perform pg_temp.check('legitimate fresh verified snapshot exports',public.m15_02_export_usage(o,a,(r->>'licenseVersion')::integer,(r->>'meterVersion')::bigint,gen_random_uuid(),repeat('b',64),s)->>'outcome'='exported');
  bad:=jsonb_set(s,'{counters,0,limit}',jsonb_build_object('kind','finite','value',9007199254740991));
  bad:=jsonb_set(bad,'{counters,0,state}','"normal"');
  perform pg_temp.check('finite cap is bound to signed source',pg_temp.expect_rejected(o,a,r,bad));
  bad:=jsonb_set(s,'{license,effectiveCapabilities}','[]');
  if stored.effective_capabilities<>'[]' then perform pg_temp.check('capabilities match current proof',pg_temp.expect_rejected(o,a,r,bad));end if;
  update public.organization_license_states set verification_valid=false where organization_id=o;
  perform pg_temp.check('verified flag requires valid proof',pg_temp.expect_rejected(o,a,r,s));
 end if;
 bad:=jsonb_set(pg_temp.snapshot(r),'{counters,0,state}','"normal"');
 perform pg_temp.check('counter diagnostic state matches authority',pg_temp.expect_rejected(o,a,r,bad));
end $$;
rollback;
