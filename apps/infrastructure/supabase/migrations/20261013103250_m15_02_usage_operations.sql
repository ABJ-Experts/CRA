-- Typed M13 receipts share the existing append-only audit envelope.
create function public.m15_02_safe_integer(v jsonb,nullable boolean default false) returns boolean language sql immutable set search_path=pg_catalog,public as $$
 select case when nullable and v='null' then true when jsonb_typeof(v)='number' and v::text ~ '^(0|[1-9][0-9]{0,15})$' then v::text::numeric<=9007199254740991 else false end
$$;
create function public.m15_02_safe_reasons(v jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
begin
 if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v)>30 then return false;end if;
 return not exists(select 1 from jsonb_array_elements(v) x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[a-z][a-z0-9_]{0,99}$');
end $$;
create function public.m15_02_safe_snapshot(v jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
declare l jsonb; c jsonb; component jsonb; i integer; j integer; value_sum numeric; expected_state text; ids text[]:=array['seats','products','storage','protected_storage'];
 labels text[]:=array['Seats','Products','Customer storage','Protected storage']; units text[]:=array['seats','products','bytes','bytes'];
 definitions text[]:=array['Active organization members plus distinct live pending invitation reservations; active member emails are not reserved twice.','Organization products whose archived_at is null; archiving changes this gauge without deleting storage.','Completed customer storage plus reserved, uploading and uncertain customer bytes; protected inputs and generated artifacts are excluded.','Deduplicated protected input and generated artifact bytes; informational and exempt from customer storage limits.'];
 keys text[][]:=array[array['activeMembers','reservedInvitations'],array['products',null],array['storageBytes','storageReservedBytes'],array['protectedStorageBytes',null]];
 n integer;
begin
 if v is null or jsonb_typeof(v)<>'object' or octet_length(v::text)>12000 or v-array['schemaVersion','definitionVersion','organizationId','observedAt','meterVersion','reconciledAt','license','counters']<>'{}' or not v?&array['schemaVersion','definitionVersion','organizationId','observedAt','meterVersion','reconciledAt','license','counters']
 or v->'schemaVersion'<>'1' or v->>'definitionVersion'<>'m15_02_v1' or v->>'organizationId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 or v->>'observedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$' or not public.m15_02_safe_integer(v->'meterVersion') then return false;end if;
 if v->'reconciledAt'<>'null' and (v->>'reconciledAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$' or (v->>'reconciledAt')::timestamptz>(v->>'observedAt')::timestamptz) then return false;end if;
 l:=v->'license';
 if jsonb_typeof(l)<>'object' or l-array['version','issuanceSequence','policyRevision','state','verified','reasons','startsAt','expiresAt','graceEndsAt','effectiveCapabilities']<>'{}' or not l?&array['version','issuanceSequence','policyRevision','state','verified','reasons','startsAt','expiresAt','graceEndsAt','effectiveCapabilities']
 or not public.m15_02_safe_integer(l->'version') or not public.m15_02_safe_integer(l->'policyRevision') or not public.m15_02_safe_integer(l->'issuanceSequence',true) or l->'issuanceSequence'='0' or jsonb_typeof(l->'verified')<>'boolean' or not public.m15_02_safe_reasons(l->'reasons') then return false;end if;
 if l->'state'<>'null' and l->>'state' not in ('missing','active','grace','expired_read_only','invalid','clock_untrusted') then return false;end if;
 for component in select value from jsonb_each(l) where key in ('startsAt','expiresAt','graceEndsAt') loop
  if component<>'null' and (component#>>'{}' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$') then return false;end if;
 end loop;
 if jsonb_typeof(l->'effectiveCapabilities')<>'array' or jsonb_array_length(l->'effectiveCapabilities')>17 or exists(select 1 from jsonb_array_elements_text(l->'effectiveCapabilities') x where x not in ('administration','products','sboms','vulnerabilities','findings','reporting','technical_files','evidence','suppliers','frameworks','connectors','tasks','notifications','dashboards','scheduled_reports','portfolio','ai')) then return false;end if;
 if jsonb_typeof(v->'counters')<>'array' or jsonb_array_length(v->'counters')<>4 then return false;end if;
 for i in 1..4 loop
  c:=v->'counters'->(i-1);n:=case when i in (1,3) then 2 else 1 end;
  if jsonb_typeof(c)<>'object' or c-array['id','label','kind','unit','scope','definition','period','value','components','availability','limit','state','reasons']<>'{}' or not c?&array['id','label','kind','unit','scope','definition','period','value','components','availability','limit','state','reasons']
  or c->>'id'<>ids[i] or c->>'label'<>labels[i] or c->>'definition'<>definitions[i] or c->>'unit'<>units[i] or c->>'kind'<>'gauge' or c->>'scope'<>'organization' or c->'period'<>'{"kind":"current_state","resetRule":"source_changes_only","nextResetAt":null}' or not public.m15_02_safe_reasons(c->'reasons')
  or c->>'availability' not in ('ready','unavailable') or not public.m15_02_safe_integer(c->'value',true) or jsonb_typeof(c->'components')<>'array' or jsonb_array_length(c->'components')<>n then return false;end if;
  value_sum:=0;
  for j in 1..n loop
   component:=c->'components'->(j-1);
   if component-array['key','value']<>'{}' or not component?&array['key','value'] or component->>'key'<>keys[i][j] or not public.m15_02_safe_integer(component->'value',true) then return false;end if;
   value_sum:=value_sum+(component->>'value')::numeric;
  end loop;
  if (c->'limit')-array['kind','value']<>'{}' or not (c->'limit')?&array['kind','value'] or c->'limit'->>'kind' not in ('finite','unlimited','unverified','exempt') then return false;end if;
  if c->'limit'->>'kind'='finite' then
   if not public.m15_02_safe_integer(c->'limit'->'value') then return false;end if;
  elsif c->'limit'->'value'<>'null' then return false;end if;
  if (i=4 and c->'limit'->>'kind'<>'exempt') or (i<>4 and (c->'limit'->>'kind'='exempt' or ((l->>'verified')::boolean is distinct from (c->'limit'->>'kind'<>'unverified')))) then return false;end if;
  if c->>'availability'='unavailable' then
   if c->'value'<>'null' or c->>'state'<>'unavailable' then return false;end if;
  else
   if c->'value'='null' or value_sum is null or value_sum is distinct from (c->>'value')::numeric then return false;end if;
   expected_state:=case when c->'limit'->>'kind'='unverified' then 'unavailable' when c->'limit'->>'kind'<>'finite' then 'normal' when value_sum>(c->'limit'->>'value')::numeric then 'over_limit' when value_sum=(c->'limit'->>'value')::numeric then 'at_limit' when value_sum*5>=(c->'limit'->>'value')::numeric*4 then 'near_limit' else 'normal' end;
   if c->>'state'<>expected_state then return false;end if;
  end if;
 end loop;
 return true;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then return false;
end $$;
create function public.m15_02_safe_receipt(v jsonb) returns boolean language plpgsql immutable set search_path=pg_catalog,public as $$
begin
 if jsonb_typeof(v)<>'object' then return false;end if;
 if v->>'outcome'='exported' then return v-array['outcome','snapshot','replayed']='{}' and v->'replayed'='false' and public.m15_02_safe_snapshot(v->'snapshot');end if;
 return v->>'outcome'='reconciled' and v-array['outcome','meterVersion','checked','repaired','released','unresolved','completedAt','replayed']='{}' and v?&array['outcome','meterVersion','checked','repaired','released','unresolved','completedAt','replayed']
 and v->'replayed'='false' and public.m15_02_safe_integer(v->'meterVersion') and public.m15_02_safe_integer(v->'checked') and (v->>'checked')::numeric<=100 and public.m15_02_safe_integer(v->'repaired') and public.m15_02_safe_integer(v->'released') and (v->>'released')::numeric<=100 and public.m15_02_safe_integer(v->'unresolved') and v->>'completedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$';
end $$;
do $$ declare d text;begin
 d:=pg_get_functiondef('public.m13_01_project_v2_audit_json(jsonb)'::regprocedure);
 if strpos(d,'usageReceipt')=0 then
 d:=replace(d,'if v_key in (','if v_key=''usageReceipt'' and public.m15_02_safe_receipt(v_value) then v_result:=v_result||jsonb_build_object(v_key,v_value); elsif v_key=''usageRequestDigest'' and v_text ~ ''^[a-f0-9]{64}$'' then v_result:=v_result||jsonb_build_object(v_key,v_value); elsif v_key in (');execute d;
 end if;
end $$;
create function public.m15_02_usage_receipt(p_organization_id uuid,p_actor_user_id uuid,p_operation text,p_idempotency_key uuid,p_request_digest text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare a public.audit_logs%rowtype;
begin
 if p_operation not in ('export','reconcile') or p_operation is null or p_idempotency_key is null or p_request_digest is null or p_request_digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid_usage_operation' using errcode='22023';end if;
 if not public.m15_01_actor_can(p_organization_id,p_actor_user_id,case when p_operation='reconcile' then 'can_manage_licensing' else 'can_view_licensing' end) then return jsonb_build_object('outcome','forbidden');end if;
 select * into a from public.audit_logs where organization_id=p_organization_id and event_scope='organization' and event_key='licensing.usage.'||p_operation||':'||p_idempotency_key::text;
 if not found then return jsonb_build_object('outcome','absent');end if;
 if a.actor_id is distinct from p_actor_user_id::text or a.action<>('licensing.usage_'||(case when p_operation='export' then 'exported' else 'reconciled' end)) or a.after_redacted->>'usageRequestDigest' is distinct from p_request_digest or not public.m15_02_safe_receipt(a.after_redacted->'usageReceipt') then return jsonb_build_object('outcome','conflict');end if;
 return jsonb_build_object('outcome','replayed','receipt',a.after_redacted->'usageReceipt'||jsonb_build_object('auditEventId',a.id,'replayed',true));
end $$;
create function public.m15_02_snapshot_policy_matches(p_organization_id uuid,p_snapshot jsonb) returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare s public.organization_license_states%rowtype;l jsonb:=p_snapshot->'license';c jsonb;cap jsonb;expected_caps jsonb;expected_state text;observed timestamptz:=(p_snapshot->>'observedAt')::timestamptz;idx integer;has_state boolean;trusted_floor timestamptz;observed_state text;
begin
 select * into s from public.organization_license_states where organization_id=p_organization_id;has_state:=found;
 if not (l->>'verified')::boolean then
  if l->'effectiveCapabilities'<>'[]' or (l->'state'<>'null' and l->>'state' not in ('missing','invalid','clock_untrusted')) then return false;end if;
  for c in select value from jsonb_array_elements(p_snapshot->'counters') where value->>'id'<>'protected_storage' loop if c->'limit'<>'{"kind":"unverified","value":null}' then return false;end if;end loop;
  if has_state then
   if (l->>'policyRevision')::integer is distinct from s.policy_revision then return false;end if;
   if l->'startsAt'<>'null' and (l->>'startsAt')::timestamptz is distinct from (s.verified_claims->>'startsAt')::timestamptz then return false;end if;
   if l->'expiresAt'<>'null' and (l->>'expiresAt')::timestamptz is distinct from (s.verified_claims->>'expiresAt')::timestamptz then return false;end if;
   if l->'graceEndsAt'<>'null' and (l->>'graceEndsAt')::timestamptz is distinct from (s.verified_claims->>'expiresAt')::timestamptz+interval '30 days' then return false;end if;
  elsif (l->>'policyRevision')::bigint<>0 or l->'startsAt'<>'null' or l->'expiresAt'<>'null' or l->'graceEndsAt'<>'null' then return false;end if;
  return true;
 end if;
 if not has_state or not s.verification_valid or s.verification_version is distinct from s.version or s.verification_artifact_digest is distinct from s.artifact_digest or s.policy_revision<1 or s.verification_checked_at is null or s.verification_checked_at<clock_timestamp()-interval '60 seconds' or s.verification_checked_at>clock_timestamp()+interval '5 minutes'
 or s.clock_rollback_detected or clock_timestamp()<s.time_high_water_at-interval '5 minutes' or (l->>'policyRevision')::integer is distinct from s.policy_revision or observed<(s.verified_claims->>'startsAt')::timestamptz then return false;end if;
 -- The existing trusted checkpoint persists the API observation floor. Do not
 -- accept backdated policy or a future timestamp that can invent an expiry.
 trusted_floor:=greatest(clock_timestamp(),s.time_high_water_at,s.verification_checked_at);
 if observed<trusted_floor-interval '5 seconds' or observed>trusted_floor+interval '5 seconds' then return false;end if;
 observed_state:=case when observed>=(s.verified_claims->>'expiresAt')::timestamptz+interval '30 days' then 'expired_read_only' when observed>=(s.verified_claims->>'expiresAt')::timestamptz then 'grace' else 'active' end;
 expected_state:=case when trusted_floor>=(s.verified_claims->>'expiresAt')::timestamptz+interval '30 days' then 'expired_read_only' when trusted_floor>=(s.verified_claims->>'expiresAt')::timestamptz then 'grace' else 'active' end;
 if observed_state<>expected_state then return false;end if;
 expected_caps:=case when expected_state='expired_read_only' then '[]'::jsonb else s.effective_capabilities end;
 if l->>'state' is distinct from expected_state or l->'effectiveCapabilities' is distinct from expected_caps or (l->>'startsAt')::timestamptz is distinct from (s.verified_claims->>'startsAt')::timestamptz or (l->>'expiresAt')::timestamptz is distinct from (s.verified_claims->>'expiresAt')::timestamptz or (l->>'graceEndsAt')::timestamptz is distinct from (s.verified_claims->>'expiresAt')::timestamptz+interval '30 days' then return false;end if;
 for idx in 0..2 loop
  c:=p_snapshot->'counters'->idx;cap:=s.verified_claims->'limits'->(case idx when 0 then 'activeMembers' when 1 then 'products' else 'storageBytes' end);
  if c->'limit' is distinct from jsonb_build_object('kind',case when cap='null' then 'unlimited' else 'finite' end,'value',cap) then return false;end if;
 end loop;
 return true;
end $$;
create function public.m15_02_export_usage(p_organization_id uuid,p_actor_user_id uuid,p_expected_license_version integer,p_expected_meter_version bigint,p_idempotency_key uuid,p_request_digest text,p_snapshot jsonb) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare prior jsonb; current jsonb; c jsonb; comp jsonb; receipt jsonb; a uuid; result text;
begin
 prior:=public.m15_02_usage_receipt(p_organization_id,p_actor_user_id,'export',p_idempotency_key,p_request_digest);
 if prior->>'outcome'='replayed' then return prior->'receipt'||'{"outcome":"replayed"}'::jsonb;elsif prior->>'outcome'<>'absent' then return prior;end if;
 perform public.m15_01_lock(p_organization_id);
 prior:=public.m15_02_usage_receipt(p_organization_id,p_actor_user_id,'export',p_idempotency_key,p_request_digest);
 if prior->>'outcome'='replayed' then return prior->'receipt'||'{"outcome":"replayed"}'::jsonb;elsif prior->>'outcome'<>'absent' then return prior;end if;
 current:=public.m15_02_read_usage(p_organization_id,p_actor_user_id,p_expected_license_version);
 if current->>'outcome'='forbidden' then return current;end if;
 if current->>'outcome'='conflict' or (current->>'meterVersion')::bigint is distinct from p_expected_meter_version then return jsonb_build_object('outcome','conflict');end if;
 if not public.m15_02_safe_snapshot(p_snapshot) or p_snapshot->>'organizationId' is distinct from p_organization_id::text or (p_snapshot->'license'->>'version')::bigint is distinct from p_expected_license_version or (p_snapshot->>'meterVersion')::bigint is distinct from p_expected_meter_version
 or (p_snapshot->'license'->>'issuanceSequence')::bigint is distinct from (current->>'issuanceSequence')::bigint then raise exception 'invalid_usage_snapshot' using errcode='22023';end if;
 if not public.m15_02_snapshot_policy_matches(p_organization_id,p_snapshot) then return jsonb_build_object('outcome','conflict');end if;
 for c in select value from jsonb_array_elements(p_snapshot->'counters') loop
  if c->>'availability' is distinct from current->'availability'->>(c->>'id') then return jsonb_build_object('outcome','conflict');end if;
  for comp in select value from jsonb_array_elements(c->'components') loop
   if comp->'value' is distinct from current->'components'->(comp->>'key') then return jsonb_build_object('outcome','conflict');end if;
  end loop;
 end loop;
 receipt:=jsonb_build_object('outcome','exported','snapshot',p_snapshot,'replayed',false);
 select x.outcome,x.audit_id into result,a from public.m13_01_append_audit_event(p_organization_id,'organization','licensing.usage.export:'||p_idempotency_key::text,'user',p_actor_user_id::text,'licensing.usage_exported','organization',p_organization_id::text,'completed',p_idempotency_key,null,jsonb_build_object('usageRequestDigest',p_request_digest,'usageReceipt',receipt),null,null,null,p_actor_user_id)x;
 if result<>'inserted' then raise exception 'usage_audit_conflict' using errcode='40001';end if;
 return receipt||jsonb_build_object('auditEventId',a);
end $$;
create function public.m15_02_reconcile_usage(p_organization_id uuid,p_actor_user_id uuid,p_expected_license_version integer,p_expected_meter_version bigint,p_idempotency_key uuid,p_request_digest text) returns jsonb language plpgsql security definer set search_path=pg_catalog,public set statement_timeout='3s' as $$
declare prior jsonb; current jsonb; admission public.organization_storage_admissions%rowtype; obj record; receipt jsonb; a uuid; result text;
 checked integer:=0; repaired integer:=0; released integer:=0; unresolved bigint; n integer;
begin
 prior:=public.m15_02_usage_receipt(p_organization_id,p_actor_user_id,'reconcile',p_idempotency_key,p_request_digest);
 if prior->>'outcome'='replayed' then return prior->'receipt'||'{"outcome":"replayed"}'::jsonb;elsif prior->>'outcome'<>'absent' then return prior;end if;
 if not pg_try_advisory_xact_lock(hashtextextended('m15:'||p_organization_id::text,0)) then return jsonb_build_object('outcome','busy');end if;
 prior:=public.m15_02_usage_receipt(p_organization_id,p_actor_user_id,'reconcile',p_idempotency_key,p_request_digest);
 if prior->>'outcome'='replayed' then return prior->'receipt'||'{"outcome":"replayed"}'::jsonb;elsif prior->>'outcome'<>'absent' then return prior;end if;
 current:=public.m15_02_read_usage(p_organization_id,p_actor_user_id,p_expected_license_version);
 if current->>'outcome'='forbidden' then return current;end if;
 if current->>'outcome'='conflict' or (current->>'meterVersion')::bigint is distinct from p_expected_meter_version then return jsonb_build_object('outcome','conflict');end if;
 -- At most 100 existing reservations are inspected; never started expiry is a
 -- release proof. Uploading/uncertain without exact publication stays charged.
 for admission in select * from public.organization_storage_admissions where organization_id=p_organization_id and state in ('reserved','uploading','uncertain') order by expires_at,id limit 100 for update skip locked loop
  checked:=checked+1;
  if public.m15_01_storage_object_matches(admission) then
   update public.organization_storage_admissions set state='completed',observed_bytes=reserved_bytes,updated_at=clock_timestamp() where organization_id=p_organization_id and id=admission.id;repaired:=repaired+1;
  elsif admission.state='reserved' and admission.expires_at<clock_timestamp() and not exists(select 1 from storage.objects where bucket_id=admission.bucket and name=admission.object_path) then
   update public.organization_storage_admissions set state='released',updated_at=clock_timestamp() where organization_id=p_organization_id and id=admission.id;released:=released+1;
  end if;
 end loop;
 -- Backfill only currently existing, uniquely owned, safely sized objects.
 -- Deleted/missing source objects are never recreated. Ownership ambiguity is
 -- preserved as unavailable rather than guessed from the path.
 for obj in select so.id,so.bucket_id,so.name,so.metadata from storage.objects so join public.m15_01_customer_objects() c on c.bucket=so.bucket_id and c.object_path=so.name
 where c.organization_id=p_organization_id and not exists(select 1 from public.organization_storage_admissions x where x.organization_id=p_organization_id and x.bucket=so.bucket_id and x.object_path=so.name)
 and so.metadata->>'size' ~ '^[0-9]{1,16}$' and (so.metadata->>'size')::numeric<=9007199254740991
 and (select count(distinct owner.organization_id) from public.m15_01_customer_objects() owner where owner.bucket=so.bucket_id and owner.object_path=so.name)=1 order by so.id limit 100 loop
  insert into public.organization_storage_admissions(organization_id,operation_id,actor_user_id,source_context,bucket,object_path,reserved_bytes,observed_bytes,token_digest,content_type,capability,state,expires_at)
  values(p_organization_id,obj.id,null,'{"kind":"existing"}',obj.bucket_id,obj.name,(obj.metadata->>'size')::bigint,(obj.metadata->>'size')::bigint,repeat('0',64),coalesce(obj.metadata->>'mimetype','application/octet-stream'),'evidence','completed',clock_timestamp()) on conflict do nothing;
  get diagnostics n=row_count;repaired:=repaired+n;
 end loop;
 perform public.m15_02_rebuild_meter(p_organization_id,true);
 select count(*) into unresolved from public.organization_storage_admissions where organization_id=p_organization_id and state in ('uploading','uncertain');
 if not (select storage_ready and protected_storage_ready from public.organization_usage_meters where organization_id=p_organization_id) then unresolved:=unresolved+1;end if;
 receipt:=jsonb_build_object('outcome','reconciled','meterVersion',(select meter_version from public.organization_usage_meters where organization_id=p_organization_id),'checked',checked,'repaired',repaired,'released',released,'unresolved',unresolved,'completedAt',public.m7_snapshot_timestamp_utc(clock_timestamp()),'replayed',false);
 select x.outcome,x.audit_id into result,a from public.m13_01_append_audit_event(p_organization_id,'organization','licensing.usage.reconcile:'||p_idempotency_key::text,'user',p_actor_user_id::text,'licensing.usage_reconciled','organization',p_organization_id::text,'completed',p_idempotency_key,null,jsonb_build_object('usageRequestDigest',p_request_digest,'usageReceipt',receipt),null,null,null,p_actor_user_id)x;
 if result<>'inserted' then raise exception 'usage_audit_conflict' using errcode='40001';end if;
 return receipt||jsonb_build_object('auditEventId',a);
end $$;
revoke all on function public.m15_02_safe_integer(jsonb,boolean),public.m15_02_safe_reasons(jsonb),public.m15_02_safe_snapshot(jsonb),public.m15_02_safe_receipt(jsonb),public.m15_02_snapshot_policy_matches(uuid,jsonb),public.m15_02_usage_receipt(uuid,uuid,text,uuid,text),public.m15_02_export_usage(uuid,uuid,integer,bigint,uuid,text,jsonb),public.m15_02_reconcile_usage(uuid,uuid,integer,bigint,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.m15_02_usage_receipt(uuid,uuid,text,uuid,text),public.m15_02_export_usage(uuid,uuid,integer,bigint,uuid,text,jsonb),public.m15_02_reconcile_usage(uuid,uuid,integer,bigint,uuid,text) to service_role;
notify pgrst,'reload schema';
