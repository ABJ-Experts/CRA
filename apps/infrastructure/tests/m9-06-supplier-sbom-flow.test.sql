begin;
create temp table m906_ids as select
 gen_random_uuid() m3_request_id,gen_random_uuid() m9_request_id,
 gen_random_uuid() supplier_id,gen_random_uuid() contact_id,
 gen_random_uuid() product_id,gen_random_uuid() release_id,
 '00000000-0000-4000-8000-0000000000ca'::uuid organization_id,
 (select id from public.users where email='owner@cra.test') actor_id,
 (select id from public.organization_legal_entities
   where organization_id='00000000-0000-4000-8000-0000000000ca'::uuid and is_default) legal_entity_id;
insert into public.supplier_organizations(id,organization_id,name,created_by,updated_by)
 select supplier_id,organization_id,'M9-06 SQL fixture '||left(supplier_id::text,8),actor_id,actor_id from m906_ids;
insert into public.supplier_contacts(id,organization_id,supplier_id,name,email,created_by,updated_by)
 select contact_id,organization_id,supplier_id,'M9-06 Contact',
   'm906-'||left(contact_id::text,8)||'@cra.test',actor_id,actor_id from m906_ids;
insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,
 legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
 select product_id,organization_id,legal_entity_id,0,'{}'::jsonb,
   'M9-06 Product','M906-'||product_id::text,'standalone_software',actor_id,actor_id,actor_id from m906_ids;
insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,
 legal_entity_snapshot,label,release_version,lifecycle,created_by,updated_by)
 select release_id,organization_id,product_id,legal_entity_id,0,'{}'::jsonb,
   'M9-06 Release','1.0-'||release_id::text,'development',actor_id,actor_id from m906_ids;
insert into public.sbom_supplier_requests(id,organization_id,product_id,release_id,supplier_display_name,
 allowed_component_ref,status,expires_at,idempotency_key,request_digest,created_by,supplier_id)
select m3_request_id,organization_id,product_id,release_id,'Fixture supplier',
 'pkg:npm/m9-fixture-component@1.0.0','open',clock_timestamp()+interval '2 days',
 gen_random_uuid(),repeat('a',64),actor_id,supplier_id from m906_ids;

create temp table m906_payload as
select jsonb_build_object('supplierId',supplier_id,'recipientContactId',contact_id,
 'productId',product_id,'ownerUserId',actor_id,'title','SBOM request fixture',
 'instructions','Submit the SBOM for the assigned component.',
 'dueAt',to_char(clock_timestamp()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'items',jsonb_build_array(jsonb_build_object('title','Component SBOM','kind','sbom',
 'documentClass','sbom','supplierSbomRequestId',m3_request_id))) payload from m906_ids;

do $$
declare preview_result record; create_result record; issue_result record;
 item_id uuid; grant_record public.sbom_supplier_invitations%rowtype;
 session_result record; portal jsonb; reserve_result record; reserved_source_id uuid; reserve_key uuid:=gen_random_uuid();
 current_revision uuid; override_id uuid;
begin
 if public.m9_06_validate_link(gen_random_uuid(),(select actor_id from m906_ids),
   (select supplier_id from m906_ids),(select product_id from m906_ids),(select m3_request_id from m906_ids))
   or public.m9_06_validate_link((select organization_id from m906_ids),(select actor_id from m906_ids),
     (select supplier_id from m906_ids),gen_random_uuid(),(select m3_request_id from m906_ids))
 then raise exception 'cross-tenant or product substitution validated'; end if;
 if public.m9_02_validate_draft((select organization_id from m906_ids),
   (select actor_id from m906_ids),
   jsonb_set((select payload from m906_payload),'{items}',
     '[{"title":"Legacy evidence","kind":"evidence","documentClass":"certificate","supplierSbomRequestId":null}]'::jsonb))
   is null then raise exception 'parsed legacy evidence item with null link was rejected'; end if;
 select * into preview_result from public.preview_supplier_evidence_request_atomic(
   (select organization_id from m906_ids),(select actor_id from m906_ids),(select payload from m906_payload));
 if preview_result.outcome<>'previewed' then raise exception 'preview failed: %',preview_result.outcome; end if;
 if preview_result.result#>>'{portalPayload,items,0,allowedComponentRef}'<>'pkg:npm/m9-fixture-component@1.0.0'
   or preview_result.result#>'{portalPayload,items,0}' ? 'supplierSbomRequestId'
 then raise exception 'preview leaked request id or lost component'; end if;
 select * into create_result from public.create_supplier_evidence_request_atomic(
   (select organization_id from m906_ids),(select actor_id from m906_ids),
   (select payload from m906_payload),gen_random_uuid());
 if create_result.outcome<>'created' then raise exception 'create failed: %',create_result.outcome; end if;
 update m906_ids set m9_request_id=(create_result.result->>'id')::uuid;
 select * into create_result from public.revise_supplier_evidence_request_atomic(
   (select organization_id from m906_ids),(select actor_id from m906_ids),
   (select m9_request_id from m906_ids),(select payload from m906_payload),0,
   preview_result.result->>'fingerprint',gen_random_uuid());
 if create_result.outcome<>'revised' then raise exception 'own linked draft revision failed: %',create_result.outcome; end if;
 select * into issue_result from public.issue_supplier_evidence_request_atomic(
   (select organization_id from m906_ids),(select actor_id from m906_ids),
   (select m9_request_id from m906_ids),1,preview_result.result->>'fingerprint',repeat('b',64),
   clock_timestamp()+interval '1 day',gen_random_uuid());
 if issue_result.outcome<>'issued' then raise exception 'issue failed: %',issue_result.outcome; end if;
 select * into create_result from public.create_supplier_evidence_request_atomic(
   (select organization_id from m906_ids),(select actor_id from m906_ids),
   (select payload from m906_payload),gen_random_uuid());
 if create_result.outcome<>'created' then raise exception 'competing draft create failed: %',create_result.outcome; end if;
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions)
   values((select organization_id from m906_ids),'owner','{"can_review_sboms":false}'::jsonb)
   returning id into override_id;
 select * into issue_result from public.issue_supplier_evidence_request_atomic(
   (select organization_id from m906_ids),(select actor_id from m906_ids),
   (create_result.result->>'id')::uuid,0,preview_result.result->>'fingerprint',repeat('8',64),
   clock_timestamp()+interval '1 day',gen_random_uuid());
 if issue_result.outcome<>'forbidden' then raise exception 'revoked reviewer still issued: %',issue_result.outcome; end if;
 update public.base_role_permission_overrides set permissions='{"can_review_sboms":true}'::jsonb
   where id=override_id;
 select * into issue_result from public.issue_supplier_evidence_request_atomic(
   (select organization_id from m906_ids),(select actor_id from m906_ids),
   (create_result.result->>'id')::uuid,0,preview_result.result->>'fingerprint',repeat('9',64),
   clock_timestamp()+interval '1 day',gen_random_uuid());
 if issue_result.outcome<>'conflict' then raise exception 'competing issue did not return safe conflict: %',issue_result.outcome; end if;
 select id into item_id from public.supplier_evidence_request_items
   where organization_id=(select organization_id from m906_ids)
     and sbom_supplier_request_id=(select m3_request_id from m906_ids)
     and revision_id=(select current_revision_id from public.supplier_evidence_requests
       where id=(select m9_request_id from m906_ids));
 select * into grant_record from public.sbom_supplier_invitations
   where organization_id=(select organization_id from m906_ids) and m9_request_item_id=item_id;
 if not found then raise exception 'M3 grant missing'; end if;
 select * into session_result from public.redeem_supplier_evidence_invitation_atomic(
   repeat('b',64),repeat('c',64),clock_timestamp()+interval '20 minutes');
 if session_result.outcome<>'created' then raise exception 'M9 redeem failed: %',session_result.outcome; end if;
 select * into session_result from public.activate_supplier_evidence_sbom_session_atomic(
   repeat('c',64),item_id,repeat('d',64));
 if session_result.outcome<>'created' then raise exception 'M3 activation failed: %',session_result.outcome; end if;
 if (select outcome from public.activate_supplier_evidence_sbom_session_atomic(
   repeat('c',64),gen_random_uuid(),repeat('d',64)))<>'not_found'
 then raise exception 'sibling item activated M3 grant'; end if;
 select * into reserve_result from public.reserve_supplier_sbom_submission_atomic(
   repeat('d',64),gen_random_uuid(),gen_random_uuid(),reserve_key,repeat('e',64),
   'fixture.json','application/json',128,repeat('a',64),gen_random_uuid(),'cyclonedx','1.5');
 if reserve_result.outcome<>'created' then raise exception 'linked M3 reserve failed: %',reserve_result.outcome; end if;
 reserved_source_id:=(reserve_result.source->>'id')::uuid;
 select result into portal from public.get_supplier_evidence_portal_request_atomic(repeat('c',64));
 if portal#>>'{items,0,sbom,allowedComponentRef}'<>'pkg:npm/m9-fixture-component@1.0.0'
   or portal#>'{items,0}' ? 'supplierSbomRequestId' then raise exception 'portal projection unsafe'; end if;
 if (select outcome from public.reserve_supplier_evidence_submission_atomic(repeat('c',64),item_id,
   'fake.pdf',1,'application/pdf',repeat('0',64),
   gen_random_uuid()::text||'/'||gen_random_uuid()::text||'/'||gen_random_uuid()::text||'/'||gen_random_uuid()::text,
   clock_timestamp()+interval '10 minutes',gen_random_uuid(),repeat('0',64)))<>'not_found'
 then raise exception 'legacy evidence upload accepted SBOM item'; end if;
 update public.sbom_supplier_submissions set status='awaiting_review'
   where source_id=reserved_source_id;
 if (select status from public.sbom_supplier_submissions where source_id=reserved_source_id)<>'validation_failed'
   or (select validation_message from public.sbom_supplier_submissions where source_id=reserved_source_id)
     <>'The SBOM does not contain the requested component. Check the file and submit a corrected version.'
 then raise exception 'missing normalized component became reviewable or lacked safe guidance'; end if;
 select current_revision_id into current_revision from public.supplier_evidence_requests
   where id=(select m9_request_id from m906_ids);
 update public.supplier_evidence_requests
   set current_revision_id=(select id from public.supplier_evidence_request_revisions
     where request_id=(select m9_request_id from m906_ids) and revision_number=1)
   where id=(select m9_request_id from m906_ids);
 if public.m9_06_link_active(repeat('d',64))
   or (select outcome from public.activate_supplier_evidence_sbom_session_atomic(
     repeat('c',64),item_id,repeat('d',64)))<>'not_found'
 then raise exception 'stale M9 revision left linked M3 session active'; end if;
 update public.supplier_evidence_requests set current_revision_id=current_revision
   where id=(select m9_request_id from m906_ids);
 update public.supplier_evidence_invitations set state='revoked',revoked_at=clock_timestamp(),
   revoked_by_user_id=(select actor_id from m906_ids)
   where organization_id=(select organization_id from m906_ids) and token_hash=repeat('b',64);
 if (select outcome from public.activate_supplier_evidence_sbom_session_atomic(repeat('c',64),item_id,repeat('d',64)))<>'not_found'
   or public.m9_06_link_active(repeat('d',64)) then raise exception 'revocation left linked M3 session active'; end if;
 if (select outcome from public.get_supplier_sbom_submission_upload(repeat('d',64),reserved_source_id,reserve_key))<>'not_found'
   or (select outcome from public.finalize_supplier_sbom_submission_atomic(
     repeat('d',64),reserved_source_id,reserve_key,repeat('a',64),128,'application/json',gen_random_uuid()))<>'not_found'
 then raise exception 'revoked M9 grant still permitted M3 source access'; end if;
end $$;
rollback;
