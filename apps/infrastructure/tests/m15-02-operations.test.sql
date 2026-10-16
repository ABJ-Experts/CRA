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
declare o uuid:='00000000-0000-4000-8000-0000000000ca';a uuid;r jsonb;s jsonb;exported jsonb;repaired jsonb;key uuid:=gen_random_uuid();repairkey uuid:=gen_random_uuid();op uuid:=gen_random_uuid(); uncertain uuid:=gen_random_uuid();protected uuid:=gen_random_uuid();before_reserved bigint;before_protected bigint;before_member bigint;v bigint;
begin
 select id into a from public.users where email='owner@cra.test';
 r:=public.m15_02_read_usage(o,a,null);s:=pg_temp.snapshot(r);
 perform pg_temp.check('safe aggregate snapshot',public.m15_02_safe_snapshot(s));
 perform pg_temp.check('arbitrary snapshot fields are rejected',not public.m15_02_safe_snapshot(s||'{"memberEmail":"private@example.test"}'));
 exported:=public.m15_02_export_usage(o,a,(r->>'licenseVersion')::integer,(r->>'meterVersion')::bigint,key,repeat('a',64),s);
 perform pg_temp.check('export commits audit receipt',exported->>'outcome'='exported' and exists(select 1 from public.audit_logs where id=(exported->>'auditEventId')::uuid and after_redacted->'usageReceipt'->'snapshot'=s));
 perform pg_temp.check('export retry returns immutable snapshot',public.m15_02_export_usage(o,a,0,0,key,repeat('a',64),'{}')->>'outcome'='replayed');
 perform pg_temp.check('changed request conflicts',public.m15_02_usage_receipt(o,a,'export',key,repeat('b',64))->>'outcome'='conflict');
 perform pg_temp.check('foreign actor cannot replay',public.m15_02_usage_receipt(o,gen_random_uuid(),'export',key,repeat('a',64))->>'outcome'='forbidden');
 before_reserved:=coalesce((r->'components'->>'storageReservedBytes')::bigint,0);before_protected:=coalesce((r->'components'->>'protectedStorageBytes')::bigint,0);
 insert into public.organization_storage_admissions(organization_id,operation_id,actor_user_id,bucket,object_path,reserved_bytes,token_digest,content_type,capability,state,expires_at)
 values(o,op,a,'evidence-documents',o::text||'/m15-02-never-started',19,repeat('c',64),'application/pdf','evidence','reserved',clock_timestamp()-interval '1 second'),
 (o,uncertain,a,'evidence-documents',o::text||'/m15-02-uncertain',23,repeat('c',64),'application/pdf','evidence','uncertain',clock_timestamp()-interval '1 second');
 insert into public.organization_storage_admissions(organization_id,operation_id,actor_user_id,source_context,bucket,object_path,reserved_bytes,token_digest,content_type,capability,state,expires_at,protected_input)
 values(o,protected,null,'{"kind":"existing"}','reporting-evidence',o::text||'/m15-02-protected',31,repeat('c',64),'application/pdf','reporting','uncertain',clock_timestamp()-interval '1 second',true);
 r:=public.m15_02_read_usage(o,a,null);
 perform pg_temp.check('uncertain and reserved bytes stay charged',(r->'components'->>'storageReservedBytes')::bigint=before_reserved+42);
 perform pg_temp.check('protected bytes never enter customer cap',(r->'components'->>'protectedStorageBytes')::bigint=before_protected+31);
 repaired:=public.m15_02_reconcile_usage(o,a,(r->>'licenseVersion')::integer,(r->>'meterVersion')::bigint,repairkey,repeat('d',64));
 perform pg_temp.check('reconciliation bound',repaired->>'outcome'='reconciled' and (repaired->>'checked')::integer<=100 and (repaired->>'released')::integer<=100);
 perform pg_temp.check('never started expiry is released',(select state='released' from public.organization_storage_admissions where operation_id=op));
 perform pg_temp.check('uncertainty is preserved',(select state='uncertain' from public.organization_storage_admissions where operation_id=uncertain));
 perform pg_temp.check('repair receipt replay precedes stale versions',public.m15_02_reconcile_usage(o,a,0,0,repairkey,repeat('d',64))->>'outcome'='replayed');
 perform pg_temp.check('repair digest conflict',public.m15_02_reconcile_usage(o,a,0,0,repairkey,repeat('e',64))->>'outcome'='conflict');
 r:=public.m15_02_read_usage(o,a,null);v:=(r->>'meterVersion')::bigint;before_member:=(r->'components'->>'activeMembers')::bigint;
 begin
  update public.users set is_active=false where id=a;
  perform pg_temp.check('active member source transition',(select active_members=before_member-1 from public.organization_usage_meters where organization_id=o));
  perform pg_temp.check('revoked actor cannot replay',public.m15_02_usage_receipt(o,a,'export',key,repeat('a',64))->>'outcome'='forbidden');
  raise exception 'test_subtransaction_rollback' using errcode='P0002';
 exception when no_data_found then null;
 end;
 perform pg_temp.check('stale meter export conflicts',public.m15_02_export_usage(o,a,(r->>'licenseVersion')::integer,v-1,gen_random_uuid(),repeat('f',64),pg_temp.snapshot(r))->>'outcome'='conflict');
 perform pg_temp.check('three second function timeout',(select 'statement_timeout=3s'=any(proconfig) from pg_proc where oid='public.m15_02_reconcile_usage(uuid,uuid,integer,bigint,uuid,text)'::regprocedure));
end $$;
rollback;
