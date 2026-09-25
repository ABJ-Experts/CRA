-- Align already-applied local M8-05 RPCs with the strict shared wire contracts.
-- This is additive and idempotent; it creates no intents and deletes no evidence.

create or replace function public.m8_05_legal_hold_json(
  p_hold public.evidence_document_legal_holds
) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'id',p_hold.id,'documentId',p_hold.document_id,'reason',p_hold.reason,
    'status',case when p_hold.released_at is null then 'active' else 'released' end,
    'placedByUserId',p_hold.placed_by_user_id,
    'placedAt',to_char(p_hold.placed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'releasedByUserId',p_hold.released_by_user_id,
    'releasedAt',case when p_hold.released_at is null then null else to_char(p_hold.released_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
    'releaseReason',p_hold.release_reason
  )
$$;

create or replace function public.m8_05_deletion_intent_json(
  p_intent public.evidence_document_deletion_intents
) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'id',p_intent.id,'documentId',p_intent.document_id,
    'expectedCurrentVersionId',p_intent.expected_current_version_id,
    'reviewFingerprint',p_intent.review_fingerprint,
    'status',case p_intent.state when 'failed' then 'cleanup_failed' else p_intent.state end,
    'requestedByUserId',p_intent.requested_by_user_id,
    'requestedAt',to_char(p_intent.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'claimedAt',case when p_intent.state='claimed' then to_char(p_intent.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') else null end,
    'completedAt',case when p_intent.completed_at is null then null else to_char(p_intent.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
    'failureCode',case when p_intent.state='failed' then 'cleanup_failed' else null end
  )
$$;

create or replace function public.place_evidence_document_legal_hold_atomic(p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid,p_reason text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.evidence_documents%rowtype; h public.evidence_document_legal_holds%rowtype; v_digest text;
begin
  if not public.m8_05_actor_can_manage_evidence(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_reason is null or p_reason<>btrim(p_reason) or char_length(p_reason) not between 1 and 2000 or p_reason~'[[:cntrl:]]' then return query select 'invalid_request',null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('documentId',p_document_id,'reason',p_reason)::text,'sha256'),'hex');
  select * into h from public.evidence_document_legal_holds where organization_id=p_organization_id and placed_by_user_id=p_actor_user_id and place_idempotency_key=p_idempotency_key;
  if found then return query select case when h.place_payload_digest=v_digest then 'replayed' else 'idempotency_conflict' end,public.m8_05_legal_hold_json(h); return; end if;
  select * into d from public.evidence_documents where organization_id=p_organization_id and id=p_document_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if d.lifecycle_state in ('cleanup_claimed','deleted') then return query select 'conflict',jsonb_build_object('lifecycleState',d.lifecycle_state); return; end if;
  insert into public.evidence_document_legal_holds(organization_id,document_id,reason,placed_by_user_id,place_idempotency_key,place_payload_digest) values(p_organization_id,p_document_id,p_reason,p_actor_user_id,p_idempotency_key,v_digest) returning * into h;
  if d.lifecycle_state in ('queued_cleanup','cleanup_failed') then
    update public.evidence_document_deletion_intents set state='cancelled',lease_owner=null,lease_expires_at=null,last_error='cancelled by legal hold' where organization_id=p_organization_id and document_id=p_document_id and state in ('queued','failed');
    update public.evidence_documents set lifecycle_state='active',deletion_requested_at=null where organization_id=p_organization_id and id=p_document_id;
  end if;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.legal_hold_placed','evidence_document_legal_hold',h.id::text,jsonb_build_object('documentId',p_document_id,'reason',p_reason,'idempotencyKey',p_idempotency_key));
  return query select 'placed',public.m8_05_legal_hold_json(h);
end $$;

create or replace function public.release_evidence_document_legal_hold_atomic(p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid,p_hold_id uuid,p_reason text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare h public.evidence_document_legal_holds%rowtype; v_digest text;
begin
  if not public.m8_05_actor_can_manage_evidence(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_reason is null or p_reason<>btrim(p_reason) or char_length(p_reason) not between 1 and 2000 or p_reason~'[[:cntrl:]]' then return query select 'invalid_request',null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('documentId',p_document_id,'holdId',p_hold_id,'reason',p_reason)::text,'sha256'),'hex');
  select * into h from public.evidence_document_legal_holds where organization_id=p_organization_id and id=p_hold_id and document_id=p_document_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if h.released_at is not null then return query select case when h.release_idempotency_key=p_idempotency_key and h.release_payload_digest=v_digest then 'replayed' else 'conflict' end,public.m8_05_legal_hold_json(h); return; end if;
  update public.evidence_document_legal_holds set released_at=clock_timestamp(),released_by_user_id=p_actor_user_id,release_reason=p_reason,release_idempotency_key=p_idempotency_key,release_payload_digest=v_digest where organization_id=p_organization_id and id=p_hold_id returning * into h;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.legal_hold_released','evidence_document_legal_hold',h.id::text,jsonb_build_object('documentId',p_document_id,'reason',p_reason,'idempotencyKey',p_idempotency_key));
  return query select 'released',public.m8_05_legal_hold_json(h);
end $$;

create or replace function public.confirm_evidence_document_deletion_atomic(p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid,p_expected_current_version_id uuid,p_review_fingerprint text,p_reason text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.evidence_documents%rowtype; i public.evidence_document_deletion_intents%rowtype; v_review jsonb; v_digest text; v_fingerprint text;
begin
  if not public.m8_05_actor_can_manage_evidence(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_expected_current_version_id is null or p_review_fingerprint !~ '^[a-f0-9]{64}$' or p_reason is null or p_reason<>btrim(p_reason) or char_length(p_reason) not between 1 and 2000 or p_reason~'[[:cntrl:]]' then return query select 'invalid_request',null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('documentId',p_document_id,'expectedCurrentVersionId',p_expected_current_version_id,'reviewFingerprint',p_review_fingerprint,'reason',p_reason)::text,'sha256'),'hex');
  select * into i from public.evidence_document_deletion_intents where organization_id=p_organization_id and requested_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then return query select case when i.payload_digest=v_digest then 'replayed' else 'idempotency_conflict' end,public.m8_05_deletion_intent_json(i); return; end if;
  select * into d from public.evidence_documents where organization_id=p_organization_id and id=p_document_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if d.lifecycle_state<>'active' or d.current_version_id<>p_expected_current_version_id then return query select 'conflict',jsonb_build_object('documentId',d.id,'currentVersionId',d.current_version_id,'lifecycleState',d.lifecycle_state); return; end if;
  perform 1 from public.evidence_document_versions where organization_id=p_organization_id and document_id=p_document_id for update;
  perform 1 from public.evidence_document_version_retention_protections pr join public.evidence_document_versions v on v.organization_id=pr.organization_id and v.id=pr.version_id where pr.organization_id=p_organization_id and v.document_id=p_document_id for update;
  perform 1 from public.evidence_document_legal_holds where organization_id=p_organization_id and document_id=p_document_id for update;
  v_review:=public.m8_05_retention_review_json(p_organization_id,p_actor_user_id,p_document_id);
  v_fingerprint:=encode(extensions.digest(v_review::text,'sha256'),'hex');
  if v_fingerprint<>p_review_fingerprint then return query select 'conflict',v_review || jsonb_build_object('reviewFingerprint',v_fingerprint); return; end if;
  if jsonb_array_length(coalesce(v_review->'blockingReasons','[]'::jsonb))>0 then return query select 'blocked',v_review || jsonb_build_object('reviewFingerprint',v_fingerprint); return; end if;
  insert into public.evidence_document_deletion_intents(organization_id,document_id,expected_current_version_id,review_fingerprint,reason,requested_by_user_id,idempotency_key,payload_digest) values(p_organization_id,p_document_id,p_expected_current_version_id,p_review_fingerprint,p_reason,p_actor_user_id,p_idempotency_key,v_digest) returning * into i;
  insert into public.evidence_document_deletion_cleanup_items(organization_id,intent_id,version_id,object_bucket,object_key) select p_organization_id,i.id,v.id,v.object_bucket,v.object_key from public.evidence_document_versions v where v.organization_id=p_organization_id and v.document_id=p_document_id;
  update public.evidence_document_access_grants set expires_at=least(expires_at,clock_timestamp()),terminal_outcome='revoked' where organization_id=p_organization_id and document_id=p_document_id and terminal_outcome is null;
  update public.evidence_documents set lifecycle_state='queued_cleanup',deletion_requested_at=clock_timestamp(),updated_at=clock_timestamp() where organization_id=p_organization_id and id=p_document_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.access_revoked_for_deletion','evidence_document',p_document_id::text,jsonb_build_object('intentId',i.id,'reason',p_reason,'idempotencyKey',p_idempotency_key));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.deletion_confirmed','evidence_document_deletion_intent',i.id::text,jsonb_build_object('documentId',p_document_id,'reviewFingerprint',p_review_fingerprint,'reason',p_reason,'idempotencyKey',p_idempotency_key));
  return query select 'queued',public.m8_05_deletion_intent_json(i);
end $$;

-- Ensure local databases that applied the first development version also have
-- the read-only hold history RPC and lifecycle guard.
create or replace function public.list_evidence_document_legal_holds_atomic(p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id) or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence') then return query select 'forbidden',null::jsonb; return; end if;
 if not exists(select 1 from public.evidence_documents d where d.organization_id=p_organization_id and d.id=p_document_id) then return query select 'not_found',null::jsonb; return; end if;
 return query select 'found',jsonb_build_object('legalHolds',coalesce((select jsonb_agg(public.m8_05_legal_hold_json(h) order by h.placed_at desc,h.id) from public.evidence_document_legal_holds h where h.organization_id=p_organization_id and h.document_id=p_document_id),'[]'::jsonb));
end $$;

create or replace function public.redeem_evidence_document_access_atomic(p_organization_id uuid,p_actor_user_id uuid,p_token_sha256 text,p_request_correlation_id uuid,p_range_start bigint default null,p_range_end bigint default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.evidence_document_access_grants%rowtype; v_version public.evidence_document_versions%rowtype;
begin
 if p_token_sha256 is null or p_token_sha256 !~ '^[a-f0-9]{64}$' or p_request_correlation_id is null or ((p_range_start is null)<>(p_range_end is null)) or (p_range_start is not null and (p_range_start<0 or p_range_end<p_range_start)) or not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
 select * into g from public.evidence_document_access_grants where organization_id=p_organization_id and token_sha256=p_token_sha256 for update;
 if not found or g.actor_user_id<>p_actor_user_id or g.terminal_outcome='revoked' then return query select 'forbidden',null::jsonb; return; end if;
 if g.expires_at<clock_timestamp() then update public.evidence_document_access_grants set terminal_outcome='expired' where id=g.id; return query select 'expired',null::jsonb; return; end if;
 select ev.* into v_version from public.evidence_document_versions ev join public.evidence_documents d on d.organization_id=ev.organization_id and d.id=ev.document_id and d.lifecycle_state='active' where ev.organization_id=p_organization_id and ev.id=g.version_id and ev.document_id=g.document_id;
 if not found or v_version.processing_state<>'clean' or (v_version.validity_ends_on is not null and v_version.validity_ends_on<current_date) or not exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=g.product_id and p.archived_at is null) or not exists(select 1 from public.evidence_document_version_products vp where vp.organization_id=p_organization_id and vp.version_id=v_version.id and vp.product_id=g.product_id) then return query select 'unavailable',null::jsonb; return; end if;
 if p_range_start is not null and p_range_end>=v_version.actual_size_bytes then return query select 'invalid_range',null::jsonb; return; end if;
 update public.evidence_document_access_grants set first_redeemed_at=coalesce(first_redeemed_at,clock_timestamp()),last_redeemed_at=clock_timestamp(),redemption_count=redemption_count+1,first_range_start=coalesce(first_range_start,p_range_start),first_range_end=coalesce(first_range_end,p_range_end),last_range_start=p_range_start,last_range_end=p_range_end,terminal_outcome='delivered' where id=g.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.byte_delivery_started','evidence_document_version',v_version.id::text,jsonb_build_object('grantId',g.id,'documentId',g.document_id,'mode',g.access_mode,'purpose',g.purpose,'correlationId',p_request_correlation_id,'rangeStart',p_range_start,'rangeEnd',p_range_end));
 return query select 'redeemed',jsonb_build_object('grantId',g.id,'documentId',g.document_id,'versionId',v_version.id,'objectBucket',v_version.object_bucket,'objectKey',v_version.object_key,'filename',v_version.original_filename,'mediaType',v_version.detected_media_type,'byteSize',v_version.actual_size_bytes,'sha256',v_version.original_sha256,'mode',g.access_mode,'expiresAt',g.expires_at);
end $$;

revoke all on function public.m8_05_legal_hold_json(public.evidence_document_legal_holds),public.m8_05_deletion_intent_json(public.evidence_document_deletion_intents) from public,anon,authenticated;
revoke all on function public.place_evidence_document_legal_hold_atomic(uuid,uuid,uuid,text,uuid),public.release_evidence_document_legal_hold_atomic(uuid,uuid,uuid,uuid,text,uuid),public.confirm_evidence_document_deletion_atomic(uuid,uuid,uuid,uuid,text,text,uuid),public.list_evidence_document_legal_holds_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.place_evidence_document_legal_hold_atomic(uuid,uuid,uuid,text,uuid),public.release_evidence_document_legal_hold_atomic(uuid,uuid,uuid,uuid,text,uuid),public.confirm_evidence_document_deletion_atomic(uuid,uuid,uuid,uuid,text,text,uuid),public.list_evidence_document_legal_holds_atomic(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
