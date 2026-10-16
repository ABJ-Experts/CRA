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
do $$
declare o uuid:=gen_random_uuid();a uuid;usage jsonb;legacy jsonb;bad jsonb;
begin
 select id into a from public.users where email='owner@cra.test';
 insert into public.organizations(id,name,slug) values(o,'M15-02 rollback fixture','m15-02-'||replace(o::text,'-',''));
 insert into public.organization_members(organization_id,user_id,role) values(o,a,'owner');
 usage:=public.m15_02_read_usage(o,a,null);
 perform pg_temp.check('missing licence has null policy head',usage->'policyRevision'='null');
 bad:=jsonb_set(pg_temp.snapshot(usage),'{license,policyRevision}','1');
 perform pg_temp.check('missing head revision is zero sentinel',public.m15_02_export_usage(o,a,0,(usage->>'meterVersion')::bigint,gen_random_uuid(),repeat('a',64),bad)->>'outcome'='conflict');
 delete from public.organization_usage_meters where organization_id=o;
 legacy:=public.m15_01_get_state(o,a);
 perform pg_temp.check('missing meter preserves genuine legacy accounting availability',legacy->>'storageAccountingReady'='true' and legacy->'usage'=public.m15_01_usage(o));
 perform pg_temp.check('missing meter new diagnostic remains unavailable',public.m15_02_read_usage(o,a,null)->>'outcome'='unavailable');
 perform public.m15_02_rebuild_meter(o);
 update public.organization_usage_meters set storage_ready=false,storage_reasons=array['meter_inconsistent'] where organization_id=o;
 perform pg_temp.check('known unavailable meter does not claim legacy ready',public.m15_01_get_state(o,a)->>'storageAccountingReady'='false');
end $$;
rollback;
