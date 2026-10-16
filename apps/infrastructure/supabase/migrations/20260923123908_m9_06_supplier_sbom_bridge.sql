-- M9-06 links one explicitly assigned M3 supplier request to an M9 checklist
-- item. Existing unlinked M3 invitations and submissions retain their policy.
alter table public.supplier_evidence_request_items
  add column sbom_supplier_request_id uuid,
  add constraint supplier_evidence_item_sbom_kind_check
    check ((document_class='sbom')=(sbom_supplier_request_id is not null)),
  add constraint supplier_evidence_item_sbom_request_fk
    foreign key (organization_id,sbom_supplier_request_id)
    references public.sbom_supplier_requests(organization_id,id) on delete restrict;
alter table public.supplier_evidence_request_items drop constraint supplier_evidence_request_items_document_class_check;
alter table public.supplier_evidence_request_items add constraint supplier_evidence_request_items_document_class_check
  check (document_class in ('risk_assessment','test_report','policy','procedure','supplier_attestation','certificate','architecture_document','other','sbom'));

alter table public.sbom_supplier_invitations
  add column m9_invitation_id uuid,
  add column m9_request_item_id uuid,
  add constraint sbom_supplier_invitation_m9_pair_check
    check ((m9_invitation_id is null)=(m9_request_item_id is null)),
  add constraint sbom_supplier_invitation_m9_invitation_fk
    foreign key (organization_id,m9_invitation_id)
    references public.supplier_evidence_invitations(organization_id,id) on delete restrict,
  add constraint sbom_supplier_invitation_m9_item_fk
    foreign key (organization_id,m9_request_item_id)
    references public.supplier_evidence_request_items(organization_id,id) on delete restrict;
create unique index sbom_supplier_invitation_m9_link_ux
  on public.sbom_supplier_invitations(organization_id,m9_invitation_id,m9_request_item_id)
  where m9_invitation_id is not null;
alter table public.sbom_supplier_submissions
  add column validation_message text
  check (validation_message is null or
    (validation_message=btrim(validation_message) and char_length(validation_message) between 1 and 500));
create index supplier_evidence_item_sbom_request_idx
  on public.supplier_evidence_request_items(organization_id,sbom_supplier_request_id)
  where sbom_supplier_request_id is not null;

create or replace function public.m9_06_preserve_linked_request_scope()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if (old.organization_id,old.supplier_id,old.product_id,old.release_id,old.allowed_component_ref)
   is distinct from
   (new.organization_id,new.supplier_id,new.product_id,new.release_id,new.allowed_component_ref)
   and exists(select 1 from public.supplier_evidence_request_items
     where organization_id=old.organization_id and sbom_supplier_request_id=old.id)
 then raise exception 'linked supplier SBOM scope is immutable' using errcode='23514'; end if;
 return new;
end $$;
create trigger m9_06_preserve_linked_request_scope_before_update
 before update of organization_id,supplier_id,product_id,release_id,allowed_component_ref
 on public.sbom_supplier_requests for each row
 execute function public.m9_06_preserve_linked_request_scope();

create or replace function public.m9_06_validate_link(
  p_organization_id uuid,p_actor_user_id uuid,p_supplier_id uuid,p_product_id uuid,p_sbom_request_id uuid
) returns boolean language plpgsql stable security definer set search_path=public,pg_temp as $$
declare linked_request public.sbom_supplier_requests%rowtype;
begin
  if not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_review_sboms') then return false; end if;
  select * into linked_request from public.sbom_supplier_requests
   where organization_id=p_organization_id and id=p_sbom_request_id
     and supplier_id=p_supplier_id and product_id=p_product_id
     and status='open' and expires_at>now();
  if not found or linked_request.allowed_component_ref='' then return false; end if;
  if not exists(select 1 from public.product_releases
      where organization_id=p_organization_id and product_id=p_product_id and id=linked_request.release_id)
  then return false; end if;
  -- Preview and draft revision may reuse an existing assignment. The issue
  -- trigger serializes on the M3 request and rejects a second active owner.
  return true;
end $$;

-- Preserve the frozen M9 validation contract while adding one new item kind.
alter function public.m9_02_validate_draft(uuid,uuid,jsonb) rename to m9_02_validate_draft_before_m906;
create function public.m9_02_validate_draft(p_organization_id uuid,p_actor_user_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare clean_payload jsonb; normalized jsonb; item_record jsonb; linked_id uuid; normalized_items jsonb; seen_ids uuid[] := array[]::uuid[];
begin
  if jsonb_typeof(p_payload->'items')<>'array' then return null; end if;
  clean_payload:=jsonb_set(p_payload,'{items}',
    (select jsonb_agg(case when value->>'documentClass'='sbom'
      then value||'{"documentClass":"other"}'::jsonb else value end order by ord)
     from jsonb_array_elements(p_payload->'items') with ordinality as entry(value,ord)));
  normalized:=public.m9_02_validate_draft_before_m906(p_organization_id,p_actor_user_id,clean_payload);
  if normalized is null then return null; end if;
  for item_record in select value from jsonb_array_elements(p_payload->'items') loop
    if item_record->>'documentClass'='sbom' then
      if item_record->>'kind'<>'sbom' then return null; end if;
      begin linked_id:=(item_record->>'supplierSbomRequestId')::uuid;
      exception when others then return null; end;
      if linked_id is null or linked_id=any(seen_ids) or not public.m9_06_validate_link(
        p_organization_id,p_actor_user_id,(normalized->>'supplierId')::uuid,
        (normalized->>'productId')::uuid,linked_id) then return null; end if;
      seen_ids:=array_append(seen_ids,linked_id);
    elsif (item_record ? 'supplierSbomRequestId' and item_record->'supplierSbomRequestId'<>'null'::jsonb)
       or (item_record ? 'kind' and item_record->>'kind'<>'evidence') then return null;
    end if;
  end loop;
  select jsonb_agg(case when source_item->>'documentClass'='sbom'
    then normalized_item||jsonb_build_object('documentClass','sbom',
      'supplierSbomRequestId',source_item->>'supplierSbomRequestId',
      'allowedComponentRef',(select allowed_component_ref from public.sbom_supplier_requests
        where organization_id=p_organization_id and id=(source_item->>'supplierSbomRequestId')::uuid))
    else normalized_item end order by ord) into normalized_items
    from jsonb_array_elements(normalized->'items') with ordinality as clean_item(normalized_item,ord)
    join lateral jsonb_array_elements(p_payload->'items') with ordinality as input_item(source_item,input_ord) on input_ord=ord;
  return jsonb_set(normalized,'{items}',normalized_items);
end $$;

alter function public.preview_supplier_evidence_request_atomic(uuid,uuid,jsonb)
  rename to preview_supplier_evidence_request_before_m906;
create function public.preview_supplier_evidence_request_atomic(
 p_organization_id uuid,p_actor_user_id uuid,p_payload jsonb
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare base_result record; preview_items jsonb; clean_draft jsonb;
begin
 select * into base_result from public.preview_supplier_evidence_request_before_m906(
   p_organization_id,p_actor_user_id,p_payload);
 if base_result.outcome<>'previewed' then
   return query select base_result.outcome,base_result.result; return; end if;
 clean_draft:=public.m9_02_validate_draft(p_organization_id,p_actor_user_id,p_payload);
 select jsonb_agg(preview_item.value||jsonb_build_object(
   'kind',case when draft_item.value->>'documentClass'='sbom' then 'sbom' else 'evidence' end,
   'documentClass',draft_item.value->>'documentClass',
   'allowedComponentRef',draft_item.value->>'allowedComponentRef') order by preview_item.ordinality) into preview_items
   from jsonb_array_elements(base_result.result#>'{portalPayload,items}') with ordinality preview_item(value,ordinality)
   join lateral jsonb_array_elements(clean_draft->'items') with ordinality draft_item(value,ordinality)
     on draft_item.ordinality=preview_item.ordinality;
 return query select 'previewed'::text,jsonb_set(base_result.result,'{portalPayload,items}',preview_items);
end $$;

alter function public.m9_02_insert_revision(uuid,uuid,uuid,jsonb) rename to m9_02_insert_revision_before_m906;
create function public.m9_02_insert_revision(p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_draft jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_revision_id uuid;
begin
  v_revision_id:=public.m9_02_insert_revision_before_m906(p_organization_id,p_actor_user_id,p_request_id,
    jsonb_set(p_draft,'{items}',(select jsonb_agg(case when value->>'documentClass'='sbom'
      then value||'{"documentClass":"other"}'::jsonb else value end order by ord)
      from jsonb_array_elements(p_draft->'items') with ordinality as entry(value,ord))));
  update public.supplier_evidence_request_items item_record
    set document_class='sbom',sbom_supplier_request_id=(source_item.value->>'supplierSbomRequestId')::uuid
    from jsonb_array_elements(p_draft->'items') with ordinality as source_item(value,ord)
    where item_record.organization_id=p_organization_id and item_record.revision_id=v_revision_id
      and item_record.ordinal=source_item.ord and source_item.value->>'documentClass'='sbom';
  return v_revision_id;
end $$;

create or replace function public.m9_02_current_draft(p_organization_id uuid,p_request_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('supplierId',q.supplier_id,'recipientContactId',q.recipient_contact_id,
  'productId',q.product_id,'ownerUserId',q.internal_owner_user_id,'title',r.portal_title,
  'instructions',r.instructions,'dueAt',to_char(r.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'disclosurePayload',r.disclosure_payload,
  'items',coalesce((select jsonb_agg(jsonb_build_object('title',item_record.title,'instructions',coalesce(item_record.instructions,''),
      'documentClass',item_record.document_class) || case when item_record.sbom_supplier_request_id is null then '{}'::jsonb
      else jsonb_build_object('supplierSbomRequestId',item_record.sbom_supplier_request_id,
        'allowedComponentRef',(select allowed_component_ref from public.sbom_supplier_requests
          where organization_id=item_record.organization_id and id=item_record.sbom_supplier_request_id)) end order by item_record.ordinal)
    from public.supplier_evidence_request_items item_record
    where item_record.organization_id=q.organization_id and item_record.revision_id=r.id),'[]'::jsonb))
 from public.supplier_evidence_requests q join public.supplier_evidence_request_revisions r
  on r.organization_id=q.organization_id and r.id=q.current_revision_id
 where q.organization_id=p_organization_id and q.id=p_request_id
$$;

create or replace function public.m9_02_revision_json(p_organization_id uuid,p_revision_id uuid,p_portal boolean default false)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',r.id,'revisionNumber',r.revision_number,'title',r.portal_title,
  'instructions',nullif(r.instructions,''),'dueAt',to_char(r.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'disclosureContent',case when p_portal then null else r.disclosure_payload->>'content' end,
  'disclosureFingerprint',r.disclosure_digest,
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'title',i.title,'instructions',i.instructions,
    'documentClass',i.document_class,'kind',case when i.sbom_supplier_request_id is null then 'evidence' else 'sbom' end,
    'supplierSbomRequestId',i.sbom_supplier_request_id,'position',i.ordinal-1) order by i.ordinal)
    from public.supplier_evidence_request_items i where i.organization_id=r.organization_id and i.revision_id=r.id),'[]'::jsonb),
  'createdAt',to_char(r.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'createdBy',r.created_by_user_id)
 from public.supplier_evidence_request_revisions r where r.organization_id=p_organization_id and r.id=p_revision_id
$$;

-- The issue RPC still owns optimistic concurrency and command replay. This
-- wrapper adds the M3 reviewer grant before delegating to its original path.
alter function public.m9_02_issue_invitation(uuid,uuid,uuid,integer,text,text,timestamptz,uuid,text)
  rename to m9_02_issue_invitation_before_m906;
create function public.m9_02_issue_invitation(
 p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_expected_version integer,
 p_preview_fingerprint text,p_token_hash text,p_expires_at timestamptz,p_idempotency_key uuid,p_operation text
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare linked_id uuid;
begin
 if exists(select 1 from public.supplier_evidence_requests q
   join public.supplier_evidence_request_items item_record
     on item_record.organization_id=q.organization_id and item_record.revision_id=q.current_revision_id
   where q.organization_id=p_organization_id and q.id=p_request_id
     and item_record.sbom_supplier_request_id is not null)
   and not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_review_sboms')
 then return query select 'forbidden'::text,null::jsonb; return; end if;
 for linked_id in select item_record.sbom_supplier_request_id
   from public.supplier_evidence_requests q
   join public.supplier_evidence_request_items item_record
     on item_record.organization_id=q.organization_id and item_record.revision_id=q.current_revision_id
   where q.organization_id=p_organization_id and q.id=p_request_id
     and item_record.sbom_supplier_request_id is not null
   order by item_record.sbom_supplier_request_id loop
   perform 1 from public.sbom_supplier_requests
     where organization_id=p_organization_id and id=linked_id for update;
   if exists(select 1 from public.supplier_evidence_request_items other_item
     join public.supplier_evidence_request_revisions other_revision
       on other_revision.organization_id=other_item.organization_id and other_revision.id=other_item.revision_id
     join public.supplier_evidence_requests other_request
       on other_request.organization_id=other_revision.organization_id and other_request.id=other_revision.request_id
     where other_item.organization_id=p_organization_id and other_item.sbom_supplier_request_id=linked_id
       and other_request.id<>p_request_id and other_request.state='open'
       and other_request.current_revision_id=other_revision.id)
   then return query select 'conflict'::text,jsonb_build_object('previewFingerprint',p_preview_fingerprint); return; end if;
 end loop;
 return query select * from public.m9_02_issue_invitation_before_m906(
   p_organization_id,p_actor_user_id,p_request_id,p_expected_version,p_preview_fingerprint,
   p_token_hash,p_expires_at,p_idempotency_key,p_operation);
exception when check_violation then
 return query select 'conflict'::text,jsonb_build_object('previewFingerprint',p_preview_fingerprint);
end $$;

create or replace function public.m9_06_bind_grants()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare item_record record; linked_request public.sbom_supplier_requests%rowtype; request_record public.supplier_evidence_requests%rowtype;
begin
 select * into request_record from public.supplier_evidence_requests
  where organization_id=new.organization_id and id=new.request_id for update;
 for item_record in select * from public.supplier_evidence_request_items
    where organization_id=new.organization_id and revision_id=new.revision_id
      and sbom_supplier_request_id is not null order by ordinal loop
   select * into linked_request from public.sbom_supplier_requests
    where organization_id=new.organization_id and id=item_record.sbom_supplier_request_id for update;
   if not found or linked_request.status<>'open' or linked_request.expires_at<=clock_timestamp()
     or linked_request.supplier_id<>request_record.supplier_id
     or linked_request.product_id<>request_record.product_id
     or not exists(select 1 from public.product_releases
       where organization_id=new.organization_id and product_id=request_record.product_id
         and id=linked_request.release_id)
     or exists(select 1 from public.supplier_evidence_request_items other_item
       join public.supplier_evidence_request_revisions other_revision
         on other_revision.organization_id=other_item.organization_id and other_revision.id=other_item.revision_id
       join public.supplier_evidence_requests other_request
         on other_request.organization_id=other_revision.organization_id and other_request.id=other_revision.request_id
       where other_item.organization_id=new.organization_id
         and other_item.sbom_supplier_request_id=item_record.sbom_supplier_request_id
         and other_request.id<>new.request_id and other_request.state='open'
         and other_request.current_revision_id=other_revision.id)
   then raise exception 'linked supplier SBOM request is no longer eligible' using errcode='23514'; end if;
   insert into public.sbom_supplier_invitations(
      id,organization_id,request_id,token_prefix,token_hash,status,expires_at,created_by,
      idempotency_key,request_digest,m9_invitation_id,m9_request_item_id)
    values(gen_random_uuid(),new.organization_id,linked_request.id,
      'cra_sup_'||substr(encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),1,8),
      encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),'active',
      least(new.expires_at,linked_request.expires_at),new.created_by_user_id,gen_random_uuid(),
      encode(extensions.digest(new.id::text||':'||item_record.id::text,'sha256'),'hex'),new.id,item_record.id);
 end loop;
 return new;
end $$;
create trigger m9_06_bind_grants_after_issue after insert on public.supplier_evidence_invitations
 for each row execute function public.m9_06_bind_grants();

create or replace function public.m9_06_revoke_grants()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if old.state in ('active','used') and new.state in ('revoked','expired') then
  update public.sbom_supplier_invitations set status='revoked',revoked_at=clock_timestamp(),
    consumed_at=null,session_token_hash=null,session_expires_at=null
   where organization_id=new.organization_id and m9_invitation_id=new.id and status in ('active','used');
 end if;
 return new;
end $$;
create trigger m9_06_revoke_grants_after_m9 after update of state on public.supplier_evidence_invitations
 for each row execute function public.m9_06_revoke_grants();

create or replace function public.m9_06_link_active(p_session_token_hash text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare grant_record public.sbom_supplier_invitations%rowtype; evidence_invitation public.supplier_evidence_invitations%rowtype;
begin
 select * into grant_record from public.sbom_supplier_invitations
   where session_token_hash=p_session_token_hash and status='used' and session_expires_at>clock_timestamp();
 if not found then return false; end if;
 if grant_record.m9_invitation_id is null then return true; end if;
 select * into evidence_invitation from public.supplier_evidence_invitations
   where organization_id=grant_record.organization_id and id=grant_record.m9_invitation_id
     and state='used' and session_expires_at>clock_timestamp() for share;
 if not found then return false; end if;
 select * into grant_record from public.sbom_supplier_invitations
   where id=grant_record.id and status='used' and session_token_hash=p_session_token_hash
     and session_expires_at>clock_timestamp() for share;
 if not found or not exists(select 1 from public.supplier_evidence_requests
      where organization_id=evidence_invitation.organization_id and id=evidence_invitation.request_id
        and state='open' and current_revision_id=evidence_invitation.revision_id)
   or not exists(select 1 from public.supplier_evidence_request_items
      where organization_id=grant_record.organization_id and id=grant_record.m9_request_item_id
        and revision_id=evidence_invitation.revision_id and sbom_supplier_request_id=grant_record.request_id)
   or not exists(select 1 from public.sbom_supplier_requests
      where organization_id=grant_record.organization_id and id=grant_record.request_id
        and status='open' and expires_at>clock_timestamp()) then return false; end if;
 return true;
end $$;

create or replace function public.activate_supplier_evidence_sbom_session_atomic(
 p_session_token_hash text,p_request_item_id uuid,p_sbom_session_token_hash text
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare evidence_invitation public.supplier_evidence_invitations%rowtype;
 grant_record public.sbom_supplier_invitations%rowtype; linked_request public.sbom_supplier_requests%rowtype;
begin
 if p_session_token_hash !~ '^[a-f0-9]{64}$' or p_sbom_session_token_hash !~ '^[a-f0-9]{64}$'
   or p_request_item_id is null then return query select 'not_found'::text,null::jsonb; return; end if;
 select * into evidence_invitation from public.supplier_evidence_invitations
   where session_token_hash=p_session_token_hash and state='used' and session_expires_at>clock_timestamp() for share;
 if not found or not exists(select 1 from public.supplier_evidence_requests
    where organization_id=evidence_invitation.organization_id and id=evidence_invitation.request_id
      and state='open' and current_revision_id=evidence_invitation.revision_id)
 then return query select 'not_found'::text,null::jsonb; return; end if;
 select grant_row.* into grant_record from public.sbom_supplier_invitations grant_row
   join public.supplier_evidence_request_items item_record
     on item_record.organization_id=grant_row.organization_id and item_record.id=grant_row.m9_request_item_id
   where grant_row.organization_id=evidence_invitation.organization_id
     and grant_row.m9_invitation_id=evidence_invitation.id
     and grant_row.m9_request_item_id=p_request_item_id
     and item_record.revision_id=evidence_invitation.revision_id
     and item_record.sbom_supplier_request_id=grant_row.request_id for update of grant_row;
 if not found or grant_record.status not in ('active','used') or grant_record.expires_at<=clock_timestamp()
 then return query select 'not_found'::text,null::jsonb; return; end if;
 select * into linked_request from public.sbom_supplier_requests
   where organization_id=grant_record.organization_id and id=grant_record.request_id
     and status='open' and expires_at>clock_timestamp() for share;
 if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 if grant_record.status='active' then
   update public.sbom_supplier_invitations set status='used',consumed_at=clock_timestamp(),
     session_token_hash=p_sbom_session_token_hash,
     session_expires_at=least(evidence_invitation.session_expires_at,
       clock_timestamp()+interval '30 minutes',grant_record.expires_at,linked_request.expires_at)
    where organization_id=grant_record.organization_id and id=grant_record.id;
 elsif grant_record.session_token_hash<>p_sbom_session_token_hash then
   return query select 'not_found'::text,null::jsonb; return;
 elsif grant_record.session_expires_at<=clock_timestamp() then
   update public.sbom_supplier_invitations set session_expires_at=least(
     evidence_invitation.session_expires_at,clock_timestamp()+interval '30 minutes',
     grant_record.expires_at,linked_request.expires_at)
     where organization_id=grant_record.organization_id and id=grant_record.id;
 end if;
 return query select case when grant_record.status='used' then 'replayed' else 'created' end,
   jsonb_build_object('requestReference',linked_request.id::text,
     'allowedComponentRef',linked_request.allowed_component_ref,
     'expiresAt',to_char(least(evidence_invitation.session_expires_at,grant_record.expires_at,linked_request.expires_at)
       at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end $$;

create or replace function public.list_eligible_supplier_evidence_sbom_requests(
 p_organization_id uuid,p_actor_user_id uuid,p_supplier_id uuid,p_product_id uuid,p_limit integer,p_cursor text
) returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare listed jsonb; cursor_id uuid;
begin
 if not public.m9_02_internal_can(p_organization_id,p_actor_user_id,true)
   or not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_review_sboms')
 then return query select 'forbidden'::text,null::jsonb; return; end if;
 if p_limit not between 1 and 100 or p_supplier_id is null or p_product_id is null
   or not exists(select 1 from public.supplier_organizations
     where organization_id=p_organization_id and id=p_supplier_id and archived_at is null)
   or not exists(select 1 from public.products
     where organization_id=p_organization_id and id=p_product_id and archived_at is null)
 then return query select 'invalid_request'::text,null::jsonb; return; end if;
 if p_cursor is not null then
   begin cursor_id:=p_cursor::uuid;
   exception when others then return query select 'invalid_request'::text,null::jsonb; return; end;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',candidate.id,'releaseId',candidate.release_id,
   'allowedComponentRef',candidate.allowed_component_ref,'supplierDisplayName',candidate.supplier_display_name,
   'expiresAt',to_char(candidate.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by candidate.id),'[]'::jsonb)
 into listed from (select request_record.* from public.sbom_supplier_requests request_record
   where request_record.organization_id=p_organization_id and request_record.supplier_id=p_supplier_id
     and request_record.product_id=p_product_id and request_record.status='open'
     and request_record.expires_at>now() and (cursor_id is null or request_record.id>cursor_id)
     and exists(select 1 from public.product_releases release_record
       where release_record.organization_id=p_organization_id and release_record.product_id=p_product_id
         and release_record.id=request_record.release_id)
     and not exists(select 1 from public.supplier_evidence_request_items item_record
       join public.supplier_evidence_request_revisions revision_record
         on revision_record.organization_id=item_record.organization_id and revision_record.id=item_record.revision_id
       join public.supplier_evidence_requests evidence_request
         on evidence_request.organization_id=revision_record.organization_id and evidence_request.id=revision_record.request_id
       where item_record.organization_id=p_organization_id
         and item_record.sbom_supplier_request_id=request_record.id
         and evidence_request.state='open' and evidence_request.current_revision_id=revision_record.id)
   order by request_record.id limit p_limit) candidate;
 return query select 'found'::text,jsonb_build_object('requests',listed,
   'nextCursor',case when jsonb_array_length(listed)=p_limit then listed->(p_limit-1)->>'id' else null end);
end $$;

-- M3 read/write RPCs keep their original implementation for legacy grants.
-- The extra guard locks the M9 invitation first, so an in-flight upload and
-- revocation serialize without a stale authorization window.
alter function public.reserve_supplier_sbom_submission_atomic(text,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text)
  rename to reserve_supplier_sbom_submission_before_m906;
create function public.reserve_supplier_sbom_submission_atomic(
 p_session_token_hash text,p_submission_id uuid,p_source_id uuid,p_idempotency_key uuid,p_request_digest text,
 p_original_filename text,p_declared_media_type text,p_declared_byte_size bigint,p_declared_sha256 text,p_correlation_id uuid,
 p_declared_format text default null,p_declared_spec_version text default null
) returns table(outcome text,submission jsonb,source jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.m9_06_link_active(p_session_token_hash) then
   return query select 'not_found'::text,null::jsonb,null::jsonb; return; end if;
 return query select * from public.reserve_supplier_sbom_submission_before_m906(
   p_session_token_hash,p_submission_id,p_source_id,p_idempotency_key,p_request_digest,
   p_original_filename,p_declared_media_type,p_declared_byte_size,p_declared_sha256,p_correlation_id,
   p_declared_format,p_declared_spec_version);
end $$;

alter function public.get_supplier_sbom_submission_upload_atomic(text,uuid)
  rename to get_supplier_sbom_submission_upload_before_m906;
create function public.get_supplier_sbom_submission_upload_atomic(p_session_token_hash text,p_source_id uuid)
returns table(outcome text,reservation jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.m9_06_link_active(p_session_token_hash) then
  return query select 'not_found'::text,null::jsonb; return; end if;
 return query select * from public.get_supplier_sbom_submission_upload_before_m906(p_session_token_hash,p_source_id);
end $$;

alter function public.get_supplier_sbom_submission_upload(text,uuid,uuid)
  rename to get_supplier_sbom_submission_upload_with_key_before_m906;
create function public.get_supplier_sbom_submission_upload(p_session_token_hash text,p_source_id uuid,p_idempotency_key uuid)
returns table(outcome text,source jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.m9_06_link_active(p_session_token_hash) then
  return query select 'not_found'::text,null::jsonb; return; end if;
 return query select * from public.get_supplier_sbom_submission_upload_with_key_before_m906(
   p_session_token_hash,p_source_id,p_idempotency_key);
end $$;

alter function public.finalize_supplier_sbom_submission_atomic(text,uuid,uuid,text,bigint,text,uuid)
  rename to finalize_supplier_sbom_submission_before_m906;
create function public.finalize_supplier_sbom_submission_atomic(
 p_session_token_hash text,p_source_id uuid,p_idempotency_key uuid,p_actual_sha256 text,
 p_actual_byte_size bigint,p_actual_media_type text,p_correlation_id uuid
) returns table(outcome text,submission jsonb,source jsonb,job jsonb)
 language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.m9_06_link_active(p_session_token_hash) then
  return query select 'not_found'::text,null::jsonb,null::jsonb,null::jsonb; return; end if;
 return query select * from public.finalize_supplier_sbom_submission_before_m906(
   p_session_token_hash,p_source_id,p_idempotency_key,p_actual_sha256,
   p_actual_byte_size,p_actual_media_type,p_correlation_id);
end $$;

-- Never allow the legacy evidence-document path to accept an SBOM item.
alter function public.reserve_supplier_evidence_submission_atomic(text,uuid,text,bigint,text,text,text,timestamptz,uuid,text)
  rename to reserve_supplier_evidence_submission_before_m906;
create function public.reserve_supplier_evidence_submission_atomic(
 p_session_token_hash text,p_request_item_id uuid,p_original_filename text,p_declared_size_bytes bigint,
 p_declared_media_type text,p_declared_sha256 text,p_object_key text,p_upload_expires_at timestamptz,
 p_idempotency_key uuid,p_request_digest text
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.supplier_evidence_request_items
   where id=p_request_item_id and document_class='sbom') then
   return query select 'not_found'::text,null::jsonb; return; end if;
 return query select * from public.reserve_supplier_evidence_submission_before_m906(
   p_session_token_hash,p_request_item_id,p_original_filename,p_declared_size_bytes,
   p_declared_media_type,p_declared_sha256,p_object_key,p_upload_expires_at,
   p_idempotency_key,p_request_digest);
end $$;

-- Keep evidence uploads in their existing array. The separate SBOM projection
-- prevents the M9 document-review workflow from treating parsed SBOMs as
-- accepted evidence or disclosing findings to a supplier.
create or replace function public.sbom_supplier_submission_json(p_organization_id uuid,p_submission_id uuid)
returns jsonb language sql stable set search_path=public,pg_temp as $$
 select jsonb_build_object('id',s.id,'requestId',s.request_id,'sourceId',s.source_id,
   'state',s.status,'fileName',source.original_filename,'mediaType',source.declared_media_type,
   'byteSize',source.declared_byte_size,'sha256',source.declared_sha256,
   'validationMessage',case when s.status='validation_failed' then
     coalesce(s.validation_message,case when grant_record.m9_invitation_id is null then document.error_message end,
       'Supplier SBOM validation failed. Check the file and submit a corrected version.') else null end,
   'reviewReason',s.decision_reason,'reviewedAt',s.reviewed_at,'reviewedBy',s.reviewed_by,
   'supersededBySubmissionId',s.superseded_by_id,'createdAt',s.created_at,'updatedAt',s.updated_at)
 from public.sbom_supplier_submissions s
 join public.sbom_sources source on source.organization_id=s.organization_id and source.id=s.source_id
 join public.sbom_supplier_invitations grant_record
   on grant_record.organization_id=s.organization_id and grant_record.id=s.invitation_id
 left join lateral (select d.error_message from public.sbom_document_sources ds
   join public.sbom_documents d on d.organization_id=ds.organization_id and d.id=ds.document_id
   where ds.organization_id=s.organization_id and ds.source_id=s.source_id
   order by d.created_at desc limit 1) document on true
 where s.organization_id=p_organization_id and s.id=p_submission_id
$$;
create or replace function public.m9_02_portal_json(p_organization_id uuid,p_invitation_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
   'requestReference','request-'||left(replace(invitation_row.request_id::text,'-',''),12),
   'title',revision_row.portal_title,'instructions',nullif(revision_row.instructions,''),
   'disclosureContent',revision_row.disclosure_payload->>'content',
   'dueAt',to_char(revision_row.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
   'items',coalesce((select jsonb_agg(jsonb_build_object('id',item_record.id,'title',item_record.title,
     'instructions',item_record.instructions,'documentClass',item_record.document_class,
     'kind',case when item_record.sbom_supplier_request_id is null then 'evidence' else 'sbom' end,
     'position',item_record.ordinal-1,'reRequestReason',item_record.re_request_reason)
     || case when item_record.sbom_supplier_request_id is null then jsonb_build_object('sbom',null) else
       jsonb_build_object('sbom',jsonb_build_object(
         'allowedComponentRef',request_record.allowed_component_ref,
         'submission',(select jsonb_build_object('id',submission_record.id,
           'state',submission_record.status,'fileName',source_record.original_filename,
           'validationMessage',case when submission_record.status='validation_failed'
             then coalesce(submission_record.validation_message,
               'The SBOM could not be validated. Check the file and submit a corrected version.')
             else null end,
           'createdAt',to_char(submission_record.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'updatedAt',to_char(submission_record.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
           from public.sbom_supplier_submissions submission_record
           join public.sbom_supplier_invitations grant_record
             on grant_record.organization_id=submission_record.organization_id and grant_record.id=submission_record.invitation_id
           join public.sbom_sources source_record
             on source_record.organization_id=submission_record.organization_id and source_record.id=submission_record.source_id
           where grant_record.organization_id=invitation_row.organization_id
             and grant_record.m9_invitation_id=invitation_row.id
             and grant_record.m9_request_item_id=item_record.id
           order by submission_record.created_at desc,submission_record.id desc limit 1))) end
     order by item_record.ordinal)
     from public.supplier_evidence_request_items item_record
     left join public.sbom_supplier_requests request_record
       on request_record.organization_id=item_record.organization_id and request_record.id=item_record.sbom_supplier_request_id
     where item_record.organization_id=invitation_row.organization_id
       and item_record.revision_id=invitation_row.revision_id),'[]'::jsonb),
   'submissions',coalesce((select jsonb_agg(jsonb_build_object(
     'id',submission_row.id,'checklistItemId',submission_row.request_item_id,
     'state',submission_row.state,'fileName',submission_row.original_filename,
     'mediaType',submission_row.declared_media_type,'byteSize',submission_row.declared_size_bytes,
     'sha256',submission_row.declared_sha256,'rejectionReason',submission_row.supplier_visible_reason,
     'createdAt',to_char(submission_row.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
     'updatedAt',to_char(submission_row.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
     order by submission_row.created_at,submission_row.id)
     from public.supplier_evidence_submissions submission_row
     where submission_row.organization_id=invitation_row.organization_id
       and submission_row.invitation_id=invitation_row.id),'[]'::jsonb))
 from public.supplier_evidence_invitations invitation_row
 join public.supplier_evidence_request_revisions revision_row
   on revision_row.organization_id=invitation_row.organization_id and revision_row.id=invitation_row.revision_id
 where invitation_row.organization_id=p_organization_id and invitation_row.id=p_invitation_id
$$;

-- A deduplicated source can attach to an already terminal document. No worker
-- transition follows that attachment, so synchronize its supplier status now.
create or replace function public.m9_06_sync_deduplicated_submission()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare document_state text;
begin
 select state into document_state from public.sbom_documents
   where organization_id=new.organization_id and id=new.document_id;
 if document_state in ('completed','failed') then
   update public.sbom_supplier_submissions
     set status=case when document_state='completed' then 'awaiting_review' else 'validation_failed' end,
       updated_at=clock_timestamp()
    where organization_id=new.organization_id and source_id=new.source_id and status='processing';
 end if;
 return new;
end $$;
create trigger m9_06_sync_deduplicated_submission_after_attach
 after insert on public.sbom_document_sources for each row
 execute function public.m9_06_sync_deduplicated_submission();

create or replace function public.m9_06_sync_completed_alias_on_processing()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.status='processing' and old.status is distinct from new.status then
   update public.sbom_supplier_submissions set status=case
     when exists(select 1 from public.sbom_document_sources ds
       join public.sbom_documents d on d.organization_id=ds.organization_id and d.id=ds.document_id
       where ds.organization_id=new.organization_id and ds.source_id=new.source_id and d.state='completed')
       then 'awaiting_review' else 'validation_failed' end,updated_at=clock_timestamp()
   where organization_id=new.organization_id and id=new.id
     and exists(select 1 from public.sbom_document_sources ds
       join public.sbom_documents d on d.organization_id=ds.organization_id and d.id=ds.document_id
       where ds.organization_id=new.organization_id and ds.source_id=new.source_id
         and d.state in ('completed','failed'));
 end if;
 return new;
end $$;
create trigger m9_06_sync_completed_alias_after_processing
 after update of status on public.sbom_supplier_submissions for each row
 when (new.status='processing' and old.status is distinct from new.status)
 execute function public.m9_06_sync_completed_alias_on_processing();

-- M9-linked submissions require a concrete normalized match before M3 review;
-- the existing unlinked M3 behavior remains unchanged.
create or replace function public.m9_06_guard_component_match()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare allowed_ref text; matched boolean;
begin
 if new.status<>'awaiting_review' or old.status='awaiting_review' then return new; end if;
 select request_record.allowed_component_ref into allowed_ref
  from public.sbom_supplier_invitations grant_record
  join public.sbom_supplier_requests request_record
    on request_record.organization_id=grant_record.organization_id and request_record.id=grant_record.request_id
  where grant_record.organization_id=new.organization_id and grant_record.id=new.invitation_id
    and grant_record.m9_invitation_id is not null;
 if allowed_ref is null then return new; end if;
 select exists(select 1 from public.sbom_document_sources document_source
   join public.sbom_documents document_record
     on document_record.organization_id=document_source.organization_id
       and document_record.id=document_source.document_id and document_record.state='completed'
   join public.sbom_components component_record
     on component_record.organization_id=document_record.organization_id
       and component_record.document_id=document_record.id
   where document_source.organization_id=new.organization_id
     and document_source.source_id=new.source_id
     and (component_record.document_local_ref=allowed_ref
       or component_record.canonical_purl=allowed_ref)) into matched;
 if not matched then
   new.status:='validation_failed';
   new.validation_message:='The SBOM does not contain the requested component. Check the file and submit a corrected version.';
 end if;
 return new;
end $$;
create trigger m9_06_guard_component_match_before_review
 before update of status on public.sbom_supplier_submissions for each row
 execute function public.m9_06_guard_component_match();

alter function public.m9_03_review_item_json(uuid,uuid) rename to m9_03_review_item_json_before_m906;
create function public.m9_03_review_item_json(p_organization_id uuid,p_request_item_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare item_record public.supplier_evidence_request_items%rowtype; base jsonb; m3_state text;
begin
 base:=public.m9_03_review_item_json_before_m906(p_organization_id,p_request_item_id);
 select * into item_record from public.supplier_evidence_request_items
   where organization_id=p_organization_id and id=p_request_item_id;
 if not found then return base; end if;
 if item_record.sbom_supplier_request_id is null then
   return base||jsonb_build_object('kind','evidence','supplierSbomRequestId',null);
 end if;
 select status into m3_state from public.sbom_supplier_submissions
   where organization_id=p_organization_id and request_id=item_record.sbom_supplier_request_id
   order by (status='accepted') desc,created_at desc,id desc limit 1;
 return base||jsonb_build_object('kind','sbom','supplierSbomRequestId',item_record.sbom_supplier_request_id,
   'state',case m3_state when 'accepted' then 'accepted' when 'awaiting_review' then 'awaiting_review'
     when 'pending' then 'uploading' when 'processing' then 'pending_processing'
     when 'validation_failed' then 'rejected' when 'rejected' then 'rejected'
     when 'superseded' then 'accepted' else 'missing' end);
end $$;

create or replace function public.m9_03_refresh_request_review_state(
 p_organization_id uuid,p_request_id uuid,p_preserve_rerequest boolean default false
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare request_record public.supplier_evidence_requests%rowtype;
 required_count integer; accepted_count integer; next_state text;
begin
 select * into request_record from public.supplier_evidence_requests
   where organization_id=p_organization_id and id=p_request_id for update;
 if not found then return null; end if;
 if p_preserve_rerequest and request_record.review_state='re_requested' then return request_record.review_state; end if;
 select count(*) into required_count from public.supplier_evidence_request_items item_record
   where item_record.organization_id=p_organization_id
     and item_record.revision_id=request_record.current_revision_id and item_record.required;
 select count(*) into accepted_count from public.supplier_evidence_request_items item_record
   where item_record.organization_id=p_organization_id
     and item_record.revision_id=request_record.current_revision_id and item_record.required
     and (item_record.sbom_supplier_request_id is not null and exists(
       select 1 from public.sbom_supplier_submissions s
         where s.organization_id=p_organization_id
           and s.request_id=item_record.sbom_supplier_request_id and s.status='accepted')
       or item_record.sbom_supplier_request_id is null and exists(
         select 1 from public.supplier_evidence_submissions submission_record
         join public.supplier_evidence_submission_reviews review_record
           on review_record.organization_id=submission_record.organization_id
             and review_record.submission_id=submission_record.id and review_record.decision='accepted'
         where submission_record.organization_id=p_organization_id
           and submission_record.request_id=p_request_id
           and submission_record.revision_id=request_record.current_revision_id
           and submission_record.request_item_id=item_record.id));
 if required_count>0 and accepted_count=required_count then next_state:='accepted';
 elsif exists(select 1 from public.supplier_evidence_submissions s
   where s.organization_id=p_organization_id and s.request_id=p_request_id
     and s.revision_id=request_record.current_revision_id and s.state in ('uploading','scan_pending'))
   or exists(select 1 from public.supplier_evidence_request_items item_record
     join public.sbom_supplier_submissions s
       on s.organization_id=item_record.organization_id and s.request_id=item_record.sbom_supplier_request_id
     where item_record.organization_id=p_organization_id
       and item_record.revision_id=request_record.current_revision_id and s.status in ('pending','processing'))
 then next_state:='pending_processing';
 elsif exists(select 1 from public.supplier_evidence_submissions s
   where s.organization_id=p_organization_id and s.request_id=p_request_id
     and s.revision_id=request_record.current_revision_id and s.state='submitted_pending_review')
   or exists(select 1 from public.supplier_evidence_request_items item_record
     join public.sbom_supplier_submissions s
       on s.organization_id=item_record.organization_id and s.request_id=item_record.sbom_supplier_request_id
     where item_record.organization_id=p_organization_id
       and item_record.revision_id=request_record.current_revision_id and s.status='awaiting_review')
 then next_state:='awaiting_review';
 elsif exists(select 1 from public.supplier_evidence_submissions s
   where s.organization_id=p_organization_id and s.request_id=p_request_id
     and s.revision_id=request_record.current_revision_id and s.state in ('rejected','failed','cancelled'))
   or exists(select 1 from public.supplier_evidence_request_items item_record
     join public.sbom_supplier_submissions s
       on s.organization_id=item_record.organization_id and s.request_id=item_record.sbom_supplier_request_id
     where item_record.organization_id=p_organization_id
       and item_record.revision_id=request_record.current_revision_id and s.status in ('validation_failed','rejected'))
 then next_state:='rejected';
 elsif exists(select 1 from public.supplier_evidence_submissions s
   where s.organization_id=p_organization_id and s.request_id=p_request_id
     and s.revision_id=request_record.current_revision_id)
   or exists(select 1 from public.supplier_evidence_request_items item_record
     join public.sbom_supplier_submissions s
       on s.organization_id=item_record.organization_id and s.request_id=item_record.sbom_supplier_request_id
     where item_record.organization_id=p_organization_id
       and item_record.revision_id=request_record.current_revision_id)
 then next_state:='partial_response';
 else next_state:='pending_response'; end if;
 update public.supplier_evidence_requests set review_state=next_state,updated_at=clock_timestamp()
   where organization_id=p_organization_id and id=p_request_id;
 return next_state;
end $$;

create or replace function public.m9_06_refresh_request_from_sbom()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare evidence_request_id uuid;
begin
 select request_record.id into evidence_request_id
 from public.sbom_supplier_invitations grant_record
 join public.supplier_evidence_invitations evidence_invitation
   on evidence_invitation.organization_id=grant_record.organization_id
     and evidence_invitation.id=grant_record.m9_invitation_id
 join public.supplier_evidence_requests request_record
   on request_record.organization_id=evidence_invitation.organization_id
     and request_record.id=evidence_invitation.request_id
 where grant_record.organization_id=new.organization_id and grant_record.id=new.invitation_id;
 if evidence_request_id is not null then
   perform public.m9_03_refresh_request_review_state(new.organization_id,evidence_request_id);
 end if;
 return new;
end $$;
create trigger m9_06_refresh_request_from_sbom_after_insert
 after insert on public.sbom_supplier_submissions for each row
 execute function public.m9_06_refresh_request_from_sbom();
create trigger m9_06_refresh_request_from_sbom_after_status
 after update of status on public.sbom_supplier_submissions for each row
 when (old.status is distinct from new.status)
 execute function public.m9_06_refresh_request_from_sbom();

alter function public.m9_06_validate_link(uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function public.m9_06_preserve_linked_request_scope() owner to postgres;
alter function public.m9_02_validate_draft(uuid,uuid,jsonb) owner to postgres;
alter function public.preview_supplier_evidence_request_atomic(uuid,uuid,jsonb) owner to postgres;
alter function public.m9_02_insert_revision(uuid,uuid,uuid,jsonb) owner to postgres;
alter function public.m9_02_current_draft(uuid,uuid) owner to postgres;
alter function public.m9_02_revision_json(uuid,uuid,boolean) owner to postgres;
alter function public.m9_02_issue_invitation(uuid,uuid,uuid,integer,text,text,timestamptz,uuid,text) owner to postgres;
alter function public.m9_06_bind_grants() owner to postgres;
alter function public.m9_06_revoke_grants() owner to postgres;
alter function public.m9_06_link_active(text) owner to postgres;
alter function public.activate_supplier_evidence_sbom_session_atomic(text,uuid,text) owner to postgres;
alter function public.list_eligible_supplier_evidence_sbom_requests(uuid,uuid,uuid,uuid,integer,text) owner to postgres;
alter function public.reserve_supplier_sbom_submission_atomic(text,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text) owner to postgres;
alter function public.get_supplier_sbom_submission_upload_atomic(text,uuid) owner to postgres;
alter function public.get_supplier_sbom_submission_upload(text,uuid,uuid) owner to postgres;
alter function public.finalize_supplier_sbom_submission_atomic(text,uuid,uuid,text,bigint,text,uuid) owner to postgres;
alter function public.reserve_supplier_evidence_submission_atomic(text,uuid,text,bigint,text,text,text,timestamptz,uuid,text) owner to postgres;
alter function public.m9_02_portal_json(uuid,uuid) owner to postgres;
alter function public.m9_06_sync_deduplicated_submission() owner to postgres;
alter function public.m9_06_sync_completed_alias_on_processing() owner to postgres;
alter function public.m9_06_guard_component_match() owner to postgres;
alter function public.m9_03_review_item_json(uuid,uuid) owner to postgres;
alter function public.m9_03_refresh_request_review_state(uuid,uuid,boolean) owner to postgres;
alter function public.m9_06_refresh_request_from_sbom() owner to postgres;

revoke all on function public.activate_supplier_evidence_sbom_session_atomic(text,uuid,text),
 public.list_eligible_supplier_evidence_sbom_requests(uuid,uuid,uuid,uuid,integer,text),
 public.m9_06_validate_link(uuid,uuid,uuid,uuid,uuid),public.m9_06_link_active(text),
 public.m9_02_validate_draft_before_m906(uuid,uuid,jsonb),
 public.preview_supplier_evidence_request_before_m906(uuid,uuid,jsonb),
 public.m9_02_insert_revision_before_m906(uuid,uuid,uuid,jsonb),
 public.m9_02_issue_invitation_before_m906(uuid,uuid,uuid,integer,text,text,timestamptz,uuid,text),
 public.reserve_supplier_sbom_submission_before_m906(text,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text),
 public.get_supplier_sbom_submission_upload_before_m906(text,uuid),
 public.get_supplier_sbom_submission_upload_with_key_before_m906(text,uuid,uuid),
 public.finalize_supplier_sbom_submission_before_m906(text,uuid,uuid,text,bigint,text,uuid),
 public.reserve_supplier_evidence_submission_before_m906(text,uuid,text,bigint,text,text,text,timestamptz,uuid,text)
 from public,anon,authenticated,service_role;
revoke all on function public.m9_02_validate_draft(uuid,uuid,jsonb),
 public.preview_supplier_evidence_request_atomic(uuid,uuid,jsonb),
 public.m9_02_insert_revision(uuid,uuid,uuid,jsonb),
 public.m9_02_issue_invitation(uuid,uuid,uuid,integer,text,text,timestamptz,uuid,text),
 public.m9_06_bind_grants(),public.m9_06_revoke_grants(),
 public.reserve_supplier_sbom_submission_atomic(text,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text),
 public.get_supplier_sbom_submission_upload_atomic(text,uuid),
 public.get_supplier_sbom_submission_upload(text,uuid,uuid),
 public.finalize_supplier_sbom_submission_atomic(text,uuid,uuid,text,bigint,text,uuid),
 public.reserve_supplier_evidence_submission_atomic(text,uuid,text,bigint,text,text,text,timestamptz,uuid,text),
 public.m9_06_sync_deduplicated_submission(),public.m9_06_sync_completed_alias_on_processing(),
 public.m9_06_guard_component_match(),public.m9_06_preserve_linked_request_scope()
 ,public.m9_03_review_item_json(uuid,uuid),public.m9_06_refresh_request_from_sbom(),
 public.m9_03_review_item_json_before_m906(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.activate_supplier_evidence_sbom_session_atomic(text,uuid,text),
 public.list_eligible_supplier_evidence_sbom_requests(uuid,uuid,uuid,uuid,integer,text),
 public.preview_supplier_evidence_request_atomic(uuid,uuid,jsonb),
 public.reserve_supplier_sbom_submission_atomic(text,uuid,uuid,uuid,text,text,text,bigint,text,uuid,text,text),
 public.get_supplier_sbom_submission_upload_atomic(text,uuid),
 public.get_supplier_sbom_submission_upload(text,uuid,uuid),
 public.finalize_supplier_sbom_submission_atomic(text,uuid,uuid,text,bigint,text,uuid),
 public.reserve_supplier_evidence_submission_atomic(text,uuid,text,bigint,text,text,text,timestamptz,uuid,text)
 to service_role;
notify pgrst,'reload schema';

-- Composite validation accepts an explicitly reviewed supplier alias. The
-- source remains distinct, retaining its own hash and supplier attribution.
CREATE OR REPLACE FUNCTION public.m9_supplier_actor_can(p_organization_id uuid, p_actor_user_id uuid, p_permission_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with membership as (
    select member.role
    from public.organization_members member
    join public.users user_record on user_record.id = member.user_id and user_record.is_active
    join public.organizations organization on organization.id = member.organization_id and organization.is_active
    where member.organization_id = p_organization_id and member.user_id = p_actor_user_id
  ), base_permissions as (
    select role, case p_permission_key
      when 'can_view_suppliers' then role in ('owner','admin')
      when 'can_manage_suppliers' then role in ('owner','admin')
      when 'can_view_products' then true
      when 'can_review_sboms' then role in ('owner','admin')
      else false end as granted from membership
  ), custom_permissions as (
    select bool_or((custom_role.permissions ->> p_permission_key)::boolean) as granted
    from membership join public.user_role_assignments assignment
      on assignment.organization_id=p_organization_id and assignment.user_id=p_actor_user_id
    join public.custom_roles custom_role
      on custom_role.organization_id=p_organization_id and custom_role.id=assignment.role_id
    where custom_role.is_active and not custom_role.is_deleted
      and jsonb_typeof(custom_role.permissions -> p_permission_key)='boolean'
      and (custom_role.permissions ->> p_permission_key)::boolean
  ), override_permissions as (
    select case when jsonb_typeof(permission_override.permissions -> p_permission_key)='boolean'
      then (permission_override.permissions ->> p_permission_key)::boolean end as granted
    from base_permissions base_permission left join public.base_role_permission_overrides permission_override
      on permission_override.organization_id=p_organization_id and permission_override.base_role=base_permission.role
  ) select coalesce((select granted from override_permissions where granted is not null limit 1),
    (select coalesce(base_permissions.granted,false) or coalesce(custom_permissions.granted,false)
      from base_permissions cross join custom_permissions), false)
$function$;
CREATE OR REPLACE FUNCTION public.validate_sbom_composite_scope(p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid, p_release_id uuid, p_source_ids jsonb)
 RETURNS TABLE(outcome text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_cycle boolean; v_requested integer; v_owned integer; v_eligible integer;
begin
  if jsonb_typeof(p_source_ids)<>'array' or jsonb_array_length(p_source_ids)<1 or jsonb_array_length(p_source_ids)>100 or not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.product_releases r where r.organization_id=p_organization_id and r.product_id=p_product_id and r.id=p_release_id) then return query select 'not_found'::text;return;end if;
  select count(*) into v_requested from (select distinct (value#>>'{}')::uuid id from jsonb_array_elements(p_source_ids)) requested;
  select count(*) into v_owned from public.sbom_sources s join (select distinct (value#>>'{}')::uuid id from jsonb_array_elements(p_source_ids)) requested on requested.id=s.id where s.organization_id=p_organization_id;
  if v_owned<>v_requested then return query select 'not_found'::text;return;end if;
  with recursive structure(release_id,path,cycle) as (
    select p_release_id,array[p_release_id],false union all
    select relation.source_release_id,structure.path||relation.source_release_id,relation.source_release_id=any(structure.path)
    from structure join public.product_relationships relation on relation.organization_id=p_organization_id and relation.relationship_type='embedded' and relation.ended_at is null and relation.target_release_id=structure.release_id where not structure.cycle
  ) select coalesce(bool_or(cycle),false) into v_cycle from structure;
  if v_cycle then return query select 'conflict'::text;return;end if;
  with recursive structure(release_id,path,cycle) as (
    select p_release_id,array[p_release_id],false union all
    select relation.source_release_id,structure.path||relation.source_release_id,relation.source_release_id=any(structure.path)
    from structure join public.product_relationships relation on relation.organization_id=p_organization_id and relation.relationship_type='embedded' and relation.ended_at is null and relation.target_release_id=structure.release_id where not structure.cycle
  ) select count(*) into v_eligible from public.sbom_sources s join (select distinct (value#>>'{}')::uuid id from jsonb_array_elements(p_source_ids)) requested on requested.id=s.id join (select distinct release_id from structure where not cycle) scope on scope.release_id=s.release_id where s.organization_id=p_organization_id and s.status='verified' and (s.deduplicated_from_source_id is null or (s.source_kind='supplier' and exists(select 1 from public.sbom_supplier_submissions accepted_submission where accepted_submission.organization_id=s.organization_id and accepted_submission.source_id=s.id and accepted_submission.status='accepted'))) and exists(select 1 from public.sbom_document_sources ds join public.sbom_documents d on d.organization_id=ds.organization_id and d.id=ds.document_id and d.state='completed' where ds.organization_id=s.organization_id and ds.source_id=s.id) and (s.source_kind<>'supplier' or exists(select 1 from public.sbom_supplier_submissions ss where ss.organization_id=s.organization_id and ss.source_id=s.id and ss.status='accepted'));
  return query select case when v_eligible=v_requested then 'compatible' else 'conflict' end;
end;
$function$;
CREATE OR REPLACE FUNCTION public.create_sbom_composite_review_atomic(p_organization_id uuid, p_actor_user_id uuid, p_review_id uuid, p_product_id uuid, p_release_id uuid, p_merge_rules_version text, p_input_set_digest text, p_inputs jsonb, p_correlation_id uuid)
 RETURNS TABLE(outcome text, review jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_review public.sbom_composite_reviews%rowtype; v_input jsonb; v_source public.sbom_sources%rowtype; v_document uuid; v_scope text; v_canonical_input_digest text;
begin
  if p_review_id is null or p_correlation_id is null or p_input_set_digest !~ '^[a-f0-9]{64}$' or char_length(btrim(coalesce(p_merge_rules_version,''))) not between 1 and 80 or jsonb_typeof(p_inputs)<>'array' or jsonb_array_length(p_inputs)<1 or jsonb_array_length(p_inputs)>1000 or not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.product_releases r where r.organization_id=p_organization_id and r.product_id=p_product_id and r.id=p_release_id) then return query select 'not_found'::text,null::jsonb;return;end if;
  select r.* into v_review from public.sbom_composite_reviews r
  where r.organization_id=p_organization_id and r.release_id=p_release_id and r.merge_rules_version=btrim(p_merge_rules_version)
    and not exists (select existing.source_id from public.sbom_composite_review_inputs existing where existing.organization_id=r.organization_id and existing.review_id=r.id except select (value->>'sourceId')::uuid from jsonb_array_elements(p_inputs))
    and not exists (select (requested.value->>'sourceId')::uuid from jsonb_array_elements(p_inputs) requested except select existing.source_id from public.sbom_composite_review_inputs existing where existing.organization_id=r.organization_id and existing.review_id=r.id)
  for update;
  if found then return query select 'replayed'::text,public.sbom_composite_review_json(p_organization_id,v_review.id);return;end if;
  select scope_result.outcome into v_scope
  from public.validate_sbom_composite_scope(p_organization_id,p_actor_user_id,p_product_id,p_release_id,(select jsonb_agg(value->>'sourceId') from jsonb_array_elements(p_inputs))) scope_result;
  if v_scope='conflict' then return query select 'conflict'::text,null::jsonb;return;end if;
  if v_scope<>'compatible' then return query select 'not_found'::text,null::jsonb;return;end if;
  insert into public.sbom_composite_reviews(id,organization_id,product_id,release_id,merge_rules_version,input_set_digest,created_by,status) values(p_review_id,p_organization_id,p_product_id,p_release_id,btrim(p_merge_rules_version),p_input_set_digest,p_actor_user_id,'awaiting_review');
  for v_input in select value from jsonb_array_elements(p_inputs) loop
    select * into v_source from public.sbom_sources s where s.organization_id=p_organization_id and s.id=(v_input->>'sourceId')::uuid and s.status='verified' and (s.deduplicated_from_source_id is null or (s.source_kind='supplier' and exists(select 1 from public.sbom_supplier_submissions accepted_submission where accepted_submission.organization_id=s.organization_id and accepted_submission.source_id=s.id and accepted_submission.status='accepted')));
    if not found or (v_source.source_kind='supplier' and not exists(select 1 from public.sbom_supplier_submissions ss where ss.organization_id=p_organization_id and ss.source_id=v_source.id and ss.status='accepted')) then raise exception using errcode='P0002',message='composite input not found';end if;
    select ds.document_id into v_document from public.sbom_document_sources ds join public.sbom_documents d on d.organization_id=ds.organization_id and d.id=ds.document_id and d.state='completed' where ds.organization_id=p_organization_id and ds.source_id=v_source.id order by d.completed_at desc,d.id desc limit 1;
    if v_document is null then raise exception using errcode='P0002',message='composite input not found';end if;
    insert into public.sbom_composite_review_inputs(organization_id,review_id,source_id,document_id,source_sha256,release_id,supplier_submission_id) select p_organization_id,p_review_id,v_source.id,v_document,v_source.declared_sha256,v_source.release_id,ss.id from public.sbom_sources s left join public.sbom_supplier_submissions ss on ss.organization_id=s.organization_id and ss.source_id=s.id where s.organization_id=p_organization_id and s.id=v_source.id;
  end loop;
  select encode(extensions.digest(jsonb_build_object('mergeRulesVersion',btrim(p_merge_rules_version),'inputs',jsonb_agg(jsonb_build_object('sourceId',i.source_id,'documentId',i.document_id,'documentSha256',i.source_sha256) order by i.source_id,i.document_id))::text,'sha256'),'hex') into v_canonical_input_digest
  from public.sbom_composite_review_inputs i where i.organization_id=p_organization_id and i.review_id=p_review_id;
  update public.sbom_composite_reviews set input_set_digest=v_canonical_input_digest where organization_id=p_organization_id and id=p_review_id;
  insert into public.sbom_composite_conflicts(organization_id,review_id,identity_key,conflict_type,field_name,candidates)
  select p_organization_id,p_review_id,x.identity,'incompatible_version','version',x.candidates from (
    select coalesce(public.sbom_purl_package_identity(c.canonical_purl),'cpe:'||c.cpe) identity,jsonb_agg(jsonb_build_object('component',jsonb_build_object('componentId',c.id,'sourceId',i.source_id,'documentId',i.document_id,'documentSha256',i.source_sha256,'sourceComponentRef',c.document_local_ref,'name',c.normalized_name,'version',c.normalized_version,'canonicalPurl',c.canonical_purl,'canonicalCpe',c.cpe,'supplierSubmissionId',i.supplier_submission_id),'value',c.normalized_version) order by i.source_id,c.source_offset,c.id) candidates
    from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id where i.organization_id=p_organization_id and i.review_id=p_review_id and (c.canonical_purl is not null or c.cpe is not null) group by coalesce(public.sbom_purl_package_identity(c.canonical_purl),'cpe:'||c.cpe) having count(distinct coalesce(c.normalized_version,''))>1
  ) x;
  insert into public.sbom_composite_component_provenance(organization_id,review_id,composite_component_ref,field_name,source_id,source_document_id,source_component_id,source_component_ref,supplier_submission_id)
  select p_organization_id,p_review_id,i.document_id::text||':'||c.document_local_ref,null,i.source_id,i.document_id,c.id,c.document_local_ref,i.supplier_submission_id from public.sbom_composite_review_inputs i join public.sbom_components c on c.organization_id=i.organization_id and c.document_id=i.document_id where i.organization_id=p_organization_id and i.review_id=p_review_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'sbom.composite_review_created','sbom_composite_review',p_review_id::text,jsonb_build_object('correlationId',p_correlation_id,'inputSetDigest',p_input_set_digest));
  return query select 'created'::text,public.sbom_composite_review_json(p_organization_id,p_review_id);
exception when unique_violation then return query select 'conflict'::text,null::jsonb;
end;
$function$;
