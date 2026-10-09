-- M13-05 current-scope and restore guards; append-only attempt evidence.
create or replace function public.m13_05_guard_receipt() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v jsonb:=new.changes; begin
 if new.entity_type<>'audit_siem' then return new; end if;
 if new.organization_id is not null or new.event_scope<>'security' or new.action not like 'audit.siem.%' or v->>'organizationId' is null or v->>'organizationId' !~* '^[a-f0-9-]{36}$' or v->>'operationDigest' is null or v->>'operationDigest' !~ '^[a-f0-9]{64}$' then raise exception 'invalid SIEM receipt' using errcode='22023'; end if;
 new.after_redacted:=jsonb_build_object('organizationId',v->>'organizationId','operationDigest',v->>'operationDigest');
 if v ? 'result' then
  if jsonb_typeof(v->'result')<>'object' or exists(select 1 from jsonb_object_keys(v->'result') k where k not in ('id','version','status','deliveryId','previewDigest','destinationVersion','recipientChanged','credentialRevision','cursorDate','cursorId','previewExpiresAt','testState','safeFailureCode')) then raise exception 'invalid SIEM result receipt' using errcode='22023'; end if;
  if v->'result' ? 'previewDigest' and v->'result'->>'previewDigest' !~ '^[a-f0-9]{64}$' or v->'result' ? 'cursorId' and v->'result'->>'cursorId' !~* '^[a-f0-9-]{36}$' or v->'result' ? 'testState' and v->'result'->>'testState' not in ('accepted','sent_unacknowledged','failed') or v->'result' ? 'safeFailureCode' and v->'result'->>'safeFailureCode' !~ '^[a-z][a-z0-9_]{0,79}$' then raise exception 'invalid SIEM receipt values' using errcode='22023'; end if;
  if v->'result' ? 'cursorDate' and not isfinite((v->'result'->>'cursorDate')::timestamptz) or v->'result' ? 'previewExpiresAt' and not isfinite((v->'result'->>'previewExpiresAt')::timestamptz) or v->'result' ? 'destinationVersion' and v->'result'->>'destinationVersion' !~ '^[0-9]{1,9}$' or v->'result' ? 'credentialRevision' and v->'result'->>'credentialRevision' !~ '^[0-9]{1,9}$' or v->'result' ? 'recipientChanged' and jsonb_typeof(v->'result'->'recipientChanged')<>'boolean' then raise exception 'invalid SIEM receipt types' using errcode='22023';end if;
  if (v->'result' ? 'id' and v->'result'->>'id' !~* '^[a-f0-9-]{36}$') or (v->'result' ? 'deliveryId' and v->'result'->>'deliveryId' !~* '^[a-f0-9-]{36}$') or (v->'result' ? 'version' and v->'result'->>'version' !~ '^[0-9]{1,9}$') or (v->'result' ? 'status' and v->'result'->>'status' not in ('draft','enabled','disabled','paused')) or pg_column_size(v->'result')>1024 then raise exception 'invalid SIEM receipt values' using errcode='22023'; end if;
  new.after_redacted:=new.after_redacted||jsonb_build_object('result',v->'result');
 end if;
 if v->>'keyId' is not null then if v->>'keyId' !~ '^[A-Za-z0-9_.-]{1,80}$' then raise exception 'invalid key id' using errcode='22023'; end if; new.after_redacted:=new.after_redacted||jsonb_build_object('keyId',v->>'keyId'); end if;
 new.before_redacted:=null;new.reason:=null;new.changes:=null; return new;
end $$;

create or replace function public.m13_05_siem_command(p_organization_id uuid,p_actor_user_id uuid,p_operation text,p_request_id uuid,p_expected_version integer,p_destination_id uuid,p_input jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_dest public.siem_destinations;v_receipt public.audit_logs;v_delivery public.siem_deliveries;v_event public.audit_logs;v_result jsonb;v_digest text;v_head bigint;v_epoch uuid;v_limit integer;v_key text;v_preview_digest text;v_preview_expiry timestamptz;v_cursor_date timestamptz;v_cursor_id uuid;v_more boolean;v_receipt_result jsonb:='{}'::jsonb;v_intent public.audit_logs;begin
 if p_operation='denial' then
  if not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id and u.is_active where m.organization_id=p_organization_id and m.user_id=p_actor_user_id) then raise exception 'siem_access_denied' using errcode='42501';end if;
  if exists(select 1 from public.audit_logs where event_scope='security' and event_key='audit.siem:'||p_organization_id||':'||p_actor_user_id||':'||p_request_id and action='audit.siem.denial') then return jsonb_build_object('ok',true);end if;
  perform public.m13_05_receipt(p_organization_id,p_actor_user_id,p_request_id,'denial',p_destination_id,encode(extensions.digest(convert_to(p_input::text,'UTF8'),'sha256'),'hex'));return jsonb_build_object('ok',true);
 end if;
 if not public.m13_05_actor_can(p_organization_id,p_actor_user_id,'can_view_audit') or not public.m13_05_actor_can(p_organization_id,p_actor_user_id,'can_view_connectors') then raise exception 'siem_access_denied' using errcode='42501'; end if;
 if p_request_id is null or p_operation not in ('create','update','credentials','revoke_credentials','test','enable','disable','list','read','deliveries','delivery','replay_preview','replay','fingerprint_key','test_prepare','credential_context','catalogue','denial') then raise exception 'invalid SIEM operation' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('siem:'||p_organization_id||':'||p_actor_user_id||':'||p_request_id,0));
 select * into v_receipt from public.audit_logs where event_scope='security' and event_key='audit.siem:'||p_organization_id||':'||p_actor_user_id||':'||p_request_id;
 if p_operation='fingerprint_key' then
  if v_receipt.id is null then select * into v_receipt from public.audit_logs where event_scope='security' and event_key='audit.siem.prepare:'||p_organization_id||':'||p_actor_user_id||':'||p_request_id;end if;
  return jsonb_build_object('keyId',v_receipt.after_redacted->>'keyId'); end if;
 v_digest:=coalesce(p_input->>'operationDigest',encode(extensions.digest(convert_to(p_operation||':'||coalesce(p_destination_id::text,'')||':'||coalesce(p_expected_version::text,'')||':'||(p_input-'operationDigest'-'keyId')::text,'UTF8'),'sha256'),'hex'));
 if v_digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid SIEM digest' using errcode='22023'; end if;
 if p_operation='test_prepare' and v_receipt.id is not null and v_receipt.action='audit.siem.test' then
  if v_receipt.after_redacted->>'operationDigest'<>v_digest then raise exception 'siem_request_conflict' using errcode='23505'; end if;
  select * into v_dest from public.siem_destinations where organization_id=p_organization_id and id=p_destination_id;
  return jsonb_build_object('completed',true,'result',jsonb_build_object('destination',public.m13_05_public_destination(v_dest,p_actor_user_id),'state',v_receipt.after_redacted->'result'->>'testState','safeFailureCode',v_receipt.after_redacted->'result'->>'safeFailureCode'));
 end if;
 if v_receipt.id is not null then
  if v_receipt.after_redacted->>'operationDigest'<>v_digest or v_receipt.action<>'audit.siem.'||p_operation then raise exception 'siem_request_conflict' using errcode='23505'; end if;
  if p_operation='test' then select * into v_dest from public.siem_destinations where organization_id=p_organization_id and id=p_destination_id;return jsonb_build_object('destination',public.m13_05_public_destination(v_dest,p_actor_user_id),'state',v_receipt.after_redacted->'result'->>'testState','safeFailureCode',v_receipt.after_redacted->'result'->>'safeFailureCode');end if;
  if p_operation not in ('list','read','deliveries','delivery','replay_preview','test') then
   select * into v_dest from public.siem_destinations where organization_id=p_organization_id and id=(v_receipt.after_redacted->'result'->>'id')::uuid;
   if p_operation='replay' then select d.* into v_delivery from public.siem_deliveries d join public.audit_logs a on a.id=d.event_id where d.organization_id=p_organization_id and d.id=(v_receipt.after_redacted->'result'->>'deliveryId')::uuid and public.m13_05_event_selected(p_organization_id,p_actor_user_id,a,v_dest.product_ids); if not found then raise exception 'siem_not_found' using errcode='P0002'; end if; return public.m13_05_public_delivery(v_delivery); end if;
   return public.m13_05_public_destination(v_dest,p_actor_user_id);
  end if;
 end if;
 if p_operation not in ('list','read','deliveries','delivery','replay_preview','catalogue') and (not public.m13_05_actor_can(p_organization_id,p_actor_user_id,'can_export_audit') or not public.m13_05_actor_can(p_organization_id,p_actor_user_id,case when p_operation='create' then 'can_create_connectors' else 'can_edit_connectors' end)) then raise exception 'siem_access_denied' using errcode='42501'; end if;
 if p_operation in ('credentials','revoke_credentials') and not exists(select 1 from public.organization_members where organization_id=p_organization_id and user_id=p_actor_user_id and role='owner') then raise exception 'siem_owner_required' using errcode='42501'; end if;
 if p_operation='catalogue' then
  v_result:=jsonb_build_object('ok',true);
 elsif p_operation='create' then
  perform pg_advisory_xact_lock(hashtextextended('siem-config:'||p_organization_id,0));
  if (select count(*) from public.siem_destinations where organization_id=p_organization_id)>=10 then raise exception 'siem_destination_limit' using errcode='54000'; end if;
  select audit_dataset_epoch into v_epoch from public.organizations where id=p_organization_id;
  insert into public.siem_destinations(id,organization_id,display_name,transport,format,endpoint,event_classes,product_ids,authority_user_id,dataset_epoch,database_identity)
  values(p_destination_id,p_organization_id,p_input->>'name',p_input->>'transport',p_input->>'format',p_input->>'endpoint',array(select jsonb_array_elements_text(p_input->'eventClasses')),array(select jsonb_array_elements_text(p_input->'productIds'))::uuid[],p_actor_user_id,v_epoch,public.m13_04_database_identity()) returning * into v_dest;
 elsif p_operation='list' then
  select jsonb_build_object('items',coalesce(jsonb_agg(public.m13_05_public_destination(d,p_actor_user_id) order by d.created_at,d.id),'[]'::jsonb)) into v_result from public.siem_destinations d where organization_id=p_organization_id;
 else
  select * into v_dest from public.siem_destinations where organization_id=p_organization_id and id=p_destination_id for update;
  if not found then raise exception 'siem_not_found' using errcode='P0002'; end if;
  if p_operation not in ('read','deliveries','delivery','replay_preview','catalogue') and v_dest.version is distinct from p_expected_version then raise exception 'siem_version_conflict' using errcode='23505'; end if;
  if p_operation in ('test_prepare','credential_context','catalogue','denial') then
   if p_operation='test_prepare' then
    select * into v_intent from public.audit_logs where event_scope='security' and event_key='audit.siem.prepare:'||p_organization_id||':'||p_actor_user_id||':'||p_request_id;
    if v_intent.id is not null and v_intent.after_redacted->>'operationDigest'<>v_digest then raise exception 'siem_request_conflict' using errcode='23505';end if;
    if v_intent.id is null then perform public.m13_05_receipt(p_organization_id,p_actor_user_id,p_request_id,'test_prepare',v_dest.id,v_digest,jsonb_build_object('id',v_dest.id,'version',v_dest.version),p_input->>'keyId');end if;
   end if;
   if p_operation='test_prepare' and (not public.m13_05_actor_can(p_organization_id,p_actor_user_id,'can_export_audit') or v_dest.credentials is null) then raise exception 'siem_access_denied' using errcode='42501'; end if;
   return jsonb_build_object('organizationId',p_organization_id,'destinationId',v_dest.id,'endpoint',v_dest.endpoint,'transport',v_dest.transport,'format',v_dest.format,'credentials',v_dest.credentials,'credentialId',v_dest.credential_id,'credentialRevision',v_dest.credential_revision,'authorityUserId',v_dest.authority_user_id);
  elsif p_operation='update' then
   if p_input->>'backlogPolicy' is distinct from 'cancel_pending_start_future' then raise exception 'backlog confirmation required' using errcode='22023'; end if;
   update public.siem_deliveries set state='cancelled',version=version+1,lease_token=null,lease_expires_at=null,failure_code='destination_changed',updated_at=clock_timestamp() where organization_id=p_organization_id and destination_id=v_dest.id and state in ('queued','processing');
   update public.siem_destinations set display_name=p_input->>'name',transport=p_input->>'transport',format=p_input->>'format',endpoint=p_input->>'endpoint',event_classes=array(select jsonb_array_elements_text(p_input->'eventClasses')),product_ids=array(select jsonb_array_elements_text(p_input->'productIds'))::uuid[],destination_revision=destination_revision+1,tested_revision=null,state='disabled',version=version+1,updated_at=clock_timestamp() where id=v_dest.id returning * into v_dest;
  elsif p_operation='credentials' then
   if (p_input->>'credentialRevision')::integer is distinct from p_expected_version+1 or (p_input->>'credentialRevision')::integer<=v_dest.credential_revision then raise exception 'invalid credential revision' using errcode='22023'; end if;
   if p_input->'encryptedCredential' is null or p_input->>'credentialId' is null then raise exception 'encrypted credential required' using errcode='22023'; end if;
   update public.siem_destinations set credentials=p_input->'encryptedCredential',credential_id=(p_input->>'credentialId')::uuid,credential_revision=(p_input->>'credentialRevision')::integer,tested_revision=null,version=version+1,updated_at=clock_timestamp() where id=v_dest.id returning * into v_dest;
   update public.siem_deliveries set state='queued',version=version+1,lease_token=null,lease_expires_at=null,worker_id=null,updated_at=clock_timestamp() where organization_id=p_organization_id and destination_id=v_dest.id and state='processing';
  elsif p_operation='revoke_credentials' then
   update public.siem_destinations set credentials=null,state='paused',version=version+1,tested_revision=null,failure_code='credential_revoked',updated_at=clock_timestamp() where id=v_dest.id returning * into v_dest;
   update public.siem_deliveries set state='queued',version=version+1,lease_token=null,lease_expires_at=null,worker_id=null,updated_at=clock_timestamp() where organization_id=p_organization_id and destination_id=v_dest.id and state='processing';
  elsif p_operation='test' then
   if v_dest.credentials is null then raise exception 'credential_required' using errcode='22023'; end if;
   if p_input->>'state' in ('accepted','sent_unacknowledged') then update public.siem_destinations set tested_revision=destination_revision,version=version+1,failure_code=null,updated_at=clock_timestamp() where id=v_dest.id returning * into v_dest; end if;
   v_receipt_result:=jsonb_build_object('testState',coalesce(p_input->>'state','failed'),'safeFailureCode',p_input->>'safeFailureCode');
   v_result:=jsonb_build_object('destination',public.m13_05_public_destination(v_dest,p_actor_user_id),'state',coalesce(p_input->>'state','failed'),'safeFailureCode',p_input->>'safeFailureCode');
  elsif p_operation='enable' then
   v_dest.authority_user_id:=p_actor_user_id;
   if not public.m13_05_authority_valid(v_dest) and v_dest.dataset_epoch=(select audit_dataset_epoch from public.organizations where id=p_organization_id) and v_dest.database_identity=public.m13_04_database_identity() then raise exception 'scope_unavailable' using errcode='42501';end if;
   if v_dest.credentials is null or v_dest.tested_revision is distinct from v_dest.destination_revision then raise exception 'tested_credential_required' using errcode='22023'; end if;
   if exists(select 1 from unnest(v_dest.product_ids) p where not exists(select 1 from public.products where organization_id=p_organization_id and id=p)) then raise exception 'scope_unavailable' using errcode='42501'; end if;
   perform pg_advisory_xact_lock(public.m13_02_audit_lock_key(p_organization_id));
   select coalesce(last_sequence,0) into v_head from public.audit_chain_heads where organization_id=p_organization_id;
   select audit_dataset_epoch into v_epoch from public.organizations where id=p_organization_id;
   if v_dest.dataset_epoch<>v_epoch or v_dest.database_identity<>public.m13_04_database_identity() then
    if length(coalesce(p_input->>'reason',''))=0 then raise exception 'dataset fresh start reason required' using errcode='22023';end if;
    update public.siem_deliveries set state='cancelled',failure_code='dataset_changed',version=version+1,lease_token=null,lease_expires_at=null where organization_id=p_organization_id and destination_id=v_dest.id and state in ('queued','processing');
   end if;
   update public.siem_destinations set state='enabled',authority_user_id=p_actor_user_id,scan_sequence=case when state='paused' and dataset_epoch=v_epoch and database_identity=public.m13_04_database_identity() then scan_sequence else coalesce(v_head,0) end,dataset_epoch=v_epoch,database_identity=public.m13_04_database_identity(),version=version+1,failure_code=null,updated_at=clock_timestamp() where id=v_dest.id returning * into v_dest;
  elsif p_operation='disable' then
   update public.siem_destinations set state='disabled',version=version+1,updated_at=clock_timestamp() where id=v_dest.id returning * into v_dest;
   update public.siem_deliveries set state='cancelled',version=version+1,lease_token=null,lease_expires_at=null,failure_code='destination_disabled',updated_at=clock_timestamp() where organization_id=p_organization_id and destination_id=v_dest.id and state in ('queued','processing');
  elsif p_operation in ('deliveries','delivery','replay_preview','replay') then
   if p_operation='deliveries' then
    v_limit:=coalesce((p_input->>'limit')::integer,50); if v_limit<1 or v_limit>200 then raise exception 'invalid page limit' using errcode='22023'; end if;
    if p_input->>'cursor' is not null then
     select (after_redacted->'result'->>'cursorDate')::timestamptz,(after_redacted->'result'->>'cursorId')::uuid into v_cursor_date,v_cursor_id from public.audit_logs where event_scope='security' and action='audit.siem.deliveries' and correlation_id=(p_input->>'cursor')::uuid and actor_id=p_actor_user_id::text and entity_id=v_dest.id::text and after_redacted->>'organizationId'=p_organization_id::text;
     if not found or v_cursor_date is null then raise exception 'invalid cursor' using errcode='22023';end if;
    end if;
    with selected as (select d.* from public.siem_deliveries d join public.audit_logs a on a.id=d.event_id where d.organization_id=p_organization_id and d.destination_id=v_dest.id and (v_cursor_date is null or (d.created_at,d.id)<(v_cursor_date,v_cursor_id)) and public.m13_05_event_selected(p_organization_id,p_actor_user_id,a,v_dest.product_ids) order by d.created_at desc,d.id desc limit v_limit+1), page as(select * from selected order by created_at desc,id desc limit v_limit)
    select jsonb_build_object('items',coalesce(jsonb_agg(public.m13_05_public_delivery(page) order by page.created_at desc,page.id desc),'[]'::jsonb),'nextCursor',case when (select count(*) from selected)>v_limit then p_request_id::text else null end) into v_result from page;
    if v_result->>'nextCursor' is not null then v_receipt_result:=jsonb_build_object('cursorDate',v_result->'items'->(jsonb_array_length(v_result->'items')-1)->>'createdAt','cursorId',v_result->'items'->(jsonb_array_length(v_result->'items')-1)->>'id');end if;
   else
    select d.* into v_delivery from public.siem_deliveries d join public.audit_logs a on a.id=d.event_id where d.organization_id=p_organization_id and d.destination_id=v_dest.id and d.id=(p_input->>'deliveryId')::uuid and public.m13_05_event_selected(p_organization_id,p_actor_user_id,a,v_dest.product_ids);
    if not found then raise exception 'siem_not_found' using errcode='P0002'; end if;
    if p_operation='delivery' then
     select public.m13_05_public_delivery(v_delivery)||jsonb_build_object('attempts',coalesce(jsonb_agg(jsonb_build_object('id',id,'attempt',attempt_number,'state',case when state='retry' then 'retrying' when state='interrupted' then 'failed' else state end,'safeFailureCode',code,'httpStatus',http_status,'startedAt',created_at,'finishedAt',created_at) order by attempt_number),'[]'::jsonb)) into v_result from public.siem_delivery_attempts where organization_id=p_organization_id and delivery_id=v_delivery.id;
    else
     if v_delivery.state not in ('failed','cancelled','sent_unacknowledged') then raise exception 'replay_not_eligible' using errcode='22023'; end if;
     select * into v_event from public.audit_logs where id=v_delivery.event_id and organization_id=p_organization_id;
     v_preview_digest:=encode(extensions.digest(convert_to(v_delivery.id::text||':'||v_dest.version||':'||v_dest.endpoint||':'||v_dest.format||':'||public.m13_05_event_projection(v_event)::text,'UTF8'),'sha256'),'hex');
     if p_operation='replay_preview' then
      v_preview_expiry:=clock_timestamp()+interval '5 minutes';v_receipt_result:=jsonb_build_object('previewDigest',v_preview_digest,'previewExpiresAt',v_preview_expiry);
      v_result:=jsonb_build_object('deliveryId',v_delivery.id,'destinationId',v_dest.id,'expectedVersion',v_dest.version,'endpoint',v_dest.endpoint,'format',v_dest.format,'transport',v_dest.transport,'event',public.m13_05_event_projection(v_event),'previewDigest',v_preview_digest,'expiresAt',v_preview_expiry);
     else
      if not exists(select 1 from public.audit_logs where event_scope='security' and action='audit.siem.replay_preview' and actor_id=p_actor_user_id::text and entity_id=v_dest.id::text and after_redacted->>'organizationId'=p_organization_id::text and after_redacted->'result'->>'previewDigest'=v_preview_digest and (after_redacted->'result'->>'previewExpiresAt')::timestamptz>clock_timestamp()) then raise exception 'replay_preview_expired' using errcode='23505';end if;
      if v_dest.state<>'enabled' or not public.m13_05_authority_valid(v_dest) or p_input->>'previewDigest' is distinct from v_preview_digest or p_input->>'confirmRecipient' is distinct from 'true' then raise exception 'replay_preview_conflict' using errcode='23505'; end if;
      insert into public.siem_deliveries(organization_id,destination_id,event_id,event_sequence,destination_revision,payload,replay_of) values(p_organization_id,v_dest.id,v_event.id,v_event.chain_sequence,v_dest.destination_revision,public.m13_05_event_projection(v_event),v_delivery.id) returning * into v_delivery;
      v_result:=public.m13_05_public_delivery(v_delivery);
     end if;
    end if;
   end if;
  end if;
 end if;
 v_result:=coalesce(v_result,public.m13_05_public_destination(v_dest,p_actor_user_id));
 if v_receipt.id is null then perform public.m13_05_receipt(p_organization_id,p_actor_user_id,p_request_id,p_operation,p_destination_id,coalesce(p_input->>'operationDigest',v_digest),v_receipt_result||jsonb_strip_nulls(jsonb_build_object('id',v_dest.id,'version',v_dest.version,'status',v_dest.state,'deliveryId',case when p_operation='replay' then v_delivery.id else null end)),p_input->>'keyId'); end if;
 return v_result;
end $$;

create or replace function public.m13_05_authority_valid(p_dest public.siem_destinations) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.m13_05_actor_can(p_dest.organization_id,p_dest.authority_user_id,'can_view_audit') and public.m13_05_actor_can(p_dest.organization_id,p_dest.authority_user_id,'can_export_audit') and public.m13_05_actor_can(p_dest.organization_id,p_dest.authority_user_id,'can_edit_connectors') and public.m13_05_actor_can(p_dest.organization_id,p_dest.authority_user_id,'can_view_connectors') and (not 'access_control'=any(p_dest.event_classes) or public.m13_05_actor_can(p_dest.organization_id,p_dest.authority_user_id,'can_view_roles') and public.m13_05_actor_can(p_dest.organization_id,p_dest.authority_user_id,'can_view_invitations')) and not exists(select 1 from unnest(p_dest.product_ids) pid where not exists(select 1 from public.products where organization_id=p_dest.organization_id and id=pid)) and (cardinality(p_dest.product_ids)=0 or public.m13_05_actor_can(p_dest.organization_id,p_dest.authority_user_id,'can_view_products')) and not exists(select 1 from unnest(p_dest.event_classes) cls where not public.m13_05_actor_can(p_dest.organization_id,p_dest.authority_user_id,case cls when 'access_control' then 'can_view_users' when 'organization' then 'can_view_organization' when 'products' then 'can_view_products' when 'sboms' then 'can_view_sboms' when 'findings' then 'can_view_findings' when 'evidence' then 'can_view_evidence' when 'technical_files' then 'can_view_technical_files' when 'suppliers' then 'can_view_suppliers' when 'frameworks' then 'can_view_frameworks' when 'reporting' then 'can_view_reporting' when 'integrations' then 'can_view_connectors' when 'audit_access' then 'can_view_audit' else 'unknown' end)) and exists(select 1 from public.organizations where id=p_dest.organization_id and audit_dataset_epoch=p_dest.dataset_epoch) and public.m13_04_database_identity()=p_dest.database_identity
$$;

alter table public.siem_destinations add constraint siem_classes_allowlist check(event_classes <@ array['access_control','organization','products','sboms','findings','evidence','technical_files','suppliers','frameworks','reporting','integrations','audit_access']::text[]);
alter table public.siem_destinations add constraint siem_explicit_products check(not event_classes && array['products','sboms','findings','evidence','technical_files','suppliers','reporting']::text[] or cardinality(product_ids)>0);
create function public.m13_05_immutable_attempt() returns trigger language plpgsql set search_path=pg_catalog,public as $$ begin raise exception 'SIEM attempt evidence is append only' using errcode='42501';end $$;
create trigger m13_05_immutable_attempt before update or delete on public.siem_delivery_attempts for each row execute function public.m13_05_immutable_attempt();
create trigger m13_05_immutable_attempt_truncate before truncate on public.siem_delivery_attempts for each statement execute function public.m13_05_immutable_attempt();
create function public.m13_05_immutable_delivery() returns trigger language plpgsql set search_path=pg_catalog,public as $$ begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'SIEM delivery evidence is retained' using errcode='42501';end if;
 if (new.organization_id,new.destination_id,new.event_id,new.destination_revision,new.event_sequence,new.payload,new.replay_of,new.created_at) is distinct from (old.organization_id,old.destination_id,old.event_id,old.destination_revision,old.event_sequence,old.payload,old.replay_of,old.created_at) then raise exception 'SIEM delivery evidence is immutable' using errcode='42501';end if;return new;
end $$;
create trigger m13_05_immutable_delivery before update or delete on public.siem_deliveries for each row execute function public.m13_05_immutable_delivery();
create trigger m13_05_immutable_delivery_truncate before truncate on public.siem_deliveries for each statement execute function public.m13_05_immutable_delivery();
revoke all on function public.m13_05_immutable_attempt(),public.m13_05_immutable_delivery() from public,anon,authenticated,service_role;
