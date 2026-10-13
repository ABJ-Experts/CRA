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
create function pg_temp.verified_snapshot(r jsonb,observed timestamptz) returns jsonb language plpgsql as $$
declare s jsonb:=pg_temp.snapshot(r);head public.organization_license_states%rowtype;idx integer;c jsonb;cap jsonb;used numeric;state text;counter_state text;
begin
 select * into head from public.organization_license_states where organization_id=(r->>'organizationId')::uuid;
 state:=case when observed>=(head.verified_claims->>'expiresAt')::timestamptz+interval '30 days' then 'expired_read_only' when observed>=(head.verified_claims->>'expiresAt')::timestamptz then 'grace' else 'active' end;
 s:=jsonb_set(s,'{observedAt}',to_jsonb(public.m7_snapshot_timestamp_utc(observed)));
 s:=jsonb_set(s,'{license}',jsonb_build_object('version',head.version,'issuanceSequence',head.issuance_sequence,'policyRevision',head.policy_revision,'state',state,'verified',true,'reasons','[]'::jsonb,'startsAt',public.m7_snapshot_timestamp_utc((head.verified_claims->>'startsAt')::timestamptz),'expiresAt',public.m7_snapshot_timestamp_utc((head.verified_claims->>'expiresAt')::timestamptz),'graceEndsAt',public.m7_snapshot_timestamp_utc((head.verified_claims->>'expiresAt')::timestamptz+interval '30 days'),'effectiveCapabilities',case when state='expired_read_only' then '[]'::jsonb else head.effective_capabilities end));
 for idx in 0..2 loop
  c:=s->'counters'->idx;cap:=head.verified_claims->'limits'->(case idx when 0 then 'activeMembers' when 1 then 'products' else 'storageBytes' end);used:=(c->>'value')::numeric;
  counter_state:=case when c->>'availability'='unavailable' then 'unavailable' when cap='null' then 'normal' when used>cap::text::numeric then 'over_limit' when used=cap::text::numeric then 'at_limit' when used*5>=cap::text::numeric*4 then 'near_limit' else 'normal' end;
  c:=c||jsonb_build_object('limit',jsonb_build_object('kind',case when cap='null' then 'unlimited' else 'finite' end,'value',cap),'state',counter_state);s:=jsonb_set(s,array['counters',idx::text],c);
 end loop;
 return s;
end $$;
do $$
declare o uuid:='00000000-0000-4000-8000-0000000000ca';a uuid;r jsonb;s jsonb;head public.organization_license_states%rowtype;future timestamptz;expiry timestamptz;result jsonb;
begin
 select id into a from public.users where email='owner@cra.test';
 select * into head from public.organization_license_states where organization_id=o;
 if not found or not head.verification_valid then raise exception 'clock test requires existing verified retained fixture';end if;
 update public.organization_license_states set verification_checked_at=clock_timestamp() where organization_id=o;
 update public.organization_usage_meters set reconciled_at=clock_timestamp()-interval '1 day' where organization_id=o;
 r:=public.m15_02_read_usage(o,a,null);
 -- Expiry fault injection retains the existing artifact/head; no JWS or new
 -- licence fixture is manufactured. The cryptographic verifier is not bypassed
 -- in production; this SQL test isolates the post-verification export boundary.
 expiry:=clock_timestamp()-interval '1 second';
 update public.organization_license_states set verified_claims=jsonb_set(verified_claims,'{expiresAt}',to_jsonb(public.m7_snapshot_timestamp_utc(expiry))) where organization_id=o;
 s:=pg_temp.verified_snapshot(r,expiry-interval '1 second');
 result:=public.m15_02_export_usage(o,a,(r->>'licenseVersion')::integer,(r->>'meterVersion')::bigint,gen_random_uuid(),repeat('a',64),s);
 perform pg_temp.check('unchanged meter cannot export stale active classification after expiry',result->>'outcome'='conflict');
 expiry:=clock_timestamp()-interval '30 days 1 second';
 update public.organization_license_states set verified_claims=jsonb_set(verified_claims,'{expiresAt}',to_jsonb(public.m7_snapshot_timestamp_utc(expiry))) where organization_id=o;
 s:=pg_temp.verified_snapshot(r,expiry+interval '30 days'-interval '1 second');
 result:=public.m15_02_export_usage(o,a,(r->>'licenseVersion')::integer,(r->>'meterVersion')::bigint,gen_random_uuid(),repeat('b',64),s);
 perform pg_temp.check('unchanged meter cannot export stale grace classification after grace',result->>'outcome'='conflict');
 update public.organization_license_states set verified_claims=head.verified_claims,time_high_water_at=clock_timestamp()+interval '2 seconds',verification_checked_at=clock_timestamp() where organization_id=o returning time_high_water_at into future;
 s:=pg_temp.verified_snapshot(r,future);
 result:=public.m15_02_export_usage(o,a,(r->>'licenseVersion')::integer,(r->>'meterVersion')::bigint,gen_random_uuid(),repeat('c',64),s);
 perform pg_temp.check('common trusted observation ahead of DB wall remains valid',result->>'outcome'='exported');
end $$;
rollback;
