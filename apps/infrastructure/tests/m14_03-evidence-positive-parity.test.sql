-- Native M8/M9 workflows and approved-value parity; no binary uploads or persistent changes.
begin;
set local statement_timeout='60s';
create function pg_temp.assert_export_parity(p_org uuid,p_actor uuid,p_source text,p_filters jsonb,p_context jsonb,p_native jsonb)
returns void language plpgsql as $$
declare actual jsonb;expected jsonb;
begin
 if jsonb_typeof(p_native)<>'array' or jsonb_array_length(p_native)=0 then raise exception 'positive native fixture missing: %',p_source;end if;
 select jsonb_agg((select jsonb_object_agg(k.value,r.value#>string_to_array(k.value,'.')) from jsonb_array_elements_text(public.m14_03_source_policy(p_source)->'columns') k) order by r.ordinality)
 into expected from jsonb_array_elements(p_native) with ordinality r;
 select jsonb_agg(e.row_values order by e.ordinality) into actual from public.m14_03_source_rows(p_org,p_actor,p_source,p_filters,p_context) with ordinality e;
 if actual is distinct from expected then raise exception 'native row/filter/order/column parity failed: %',p_source;end if;
end $$;

create function pg_temp.require_outcome(p_outcome text,p_expected text) returns void language plpgsql as $$begin if p_outcome<>p_expected then raise exception 'native workflow expected %, received %',p_expected,p_outcome;end if;end$$;
do $$
declare o uuid:=gen_random_uuid();u uuid;l uuid:=gen_random_uuid();p uuid:=gen_random_uuid();s uuid:=gen_random_uuid();c uuid:=gen_random_uuid();d uuid;v uuid;b uuid;q uuid;i uuid;sub uuid;sv uuid;inv uuid;foreign_org uuid:=gen_random_uuid();r record;pr record;n jsonb;payload jsonb;session_hash text:=repeat('b',64);token_hash text:=repeat('c',64);job jsonb;src text;ctx jsonb;native_row jsonb;
begin
 select id into strict u from public.users where email='owner@cra.test';
 insert into public.organizations(id,name,slug) values(o,'M14 evidence rollback','m14-evidence-'||o);
 insert into public.organization_members(organization_id,user_id,role) values(o,u,'owner');
 insert into public.base_role_permission_overrides(organization_id,base_role,permissions) values(o,'owner','{"can_manage_evidence":true}');
 insert into public.organization_legal_entities(id,organization_id,identifier,display_name,legal_name,registered_address_line_1,registered_address_locality,registered_address_postal_code,registered_address_country,main_establishment_country,manufacturer_contact_name,manufacturer_contact_email,created_by,updated_by) values(l,o,'m14-evidence','M14 fixture','M14 fixture','1 Test','Test','12345','DE','DE','Test','m14@example.test',u,u);
 insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by) values(p,o,l,0,'{}','Evidence product','M14-'||p,'standalone_software',u,u,u);
 select * into r from public.reserve_evidence_document_upload_atomic(o,u,'Expired Ω report','test_report',u,array[p],current_date-10,current_date-1,'Ω.csv',12,o||'/'||gen_random_uuid()||'/'||gen_random_uuid()||'/'||gen_random_uuid(),clock_timestamp()+interval '10 minutes',gen_random_uuid(),repeat('a',64));
 perform pg_temp.require_outcome(r.outcome,'reserved');d:=(r.result->>'documentId')::uuid;v:=(r.result->>'versionId')::uuid;
 select * into r from public.finalize_evidence_document_upload_atomic(o,u,v,12,'text/csv',repeat('a',64),gen_random_uuid(),repeat('d',64));perform pg_temp.require_outcome(r.outcome,'scan_pending');
 perform pg_temp.require_outcome(public.record_evidence_document_scan_atomic(o,v,'fixture','1','1','clean'),'clean');
 select * into r from public.reserve_evidence_document_replacement_atomic(o,u,d,v,'Expired Ω replacement','test_report',u,array[p],current_date-9,current_date-1,'replacement.csv',12,o||'/'||gen_random_uuid()||'/'||gen_random_uuid()||'/'||gen_random_uuid(),clock_timestamp()+interval '10 minutes',gen_random_uuid(),repeat('2',64));
 perform pg_temp.require_outcome(r.outcome,'reserved');v:=(r.result->>'versionId')::uuid;
 select * into r from public.finalize_evidence_document_upload_atomic(o,u,v,12,'text/csv',repeat('2',64),gen_random_uuid(),repeat('3',64));perform pg_temp.require_outcome(r.outcome,'scan_pending');
 perform pg_temp.require_outcome(public.record_evidence_document_scan_atomic(o,v,'fixture','1','1','clean'),'clean');
 -- A different class must be excluded by the same native listing filter.
 select * into r from public.reserve_evidence_document_upload_atomic(o,u,'Current certificate','certificate',u,array[p],current_date,current_date+10,'certificate.csv',12,o||'/'||gen_random_uuid()||'/'||gen_random_uuid()||'/'||gen_random_uuid(),clock_timestamp()+interval '10 minutes',gen_random_uuid(),repeat('4',64));perform pg_temp.require_outcome(r.outcome,'reserved');
 select * into r from public.finalize_evidence_document_upload_atomic(o,u,(r.result->>'versionId')::uuid,12,'text/csv',repeat('4',64),gen_random_uuid(),repeat('5',64));perform pg_temp.require_outcome(r.outcome,'scan_pending');
 perform pg_temp.require_outcome(public.record_evidence_document_scan_atomic(o,(r.result->>'versionId')::uuid,'fixture','1','1','clean'),'clean');
 n:=public.list_evidence_documents(o,u,p,'clean','test_report',null,null,100,'expired');
 select jsonb_agg(jsonb_build_object('id',x#>'{document,id}','title',x#>'{document,currentVersion,title}','documentClass',x#>'{document,currentVersion,documentClass}','status',x#>'{document,currentVersion,status}','validityStatus',x->'validityStatus','validFrom',x#>'{document,currentVersion,validFrom}','validUntil',x#>'{document,currentVersion,validUntil}','createdAt',x#>'{document,createdAt}')) into n from jsonb_array_elements(n->'items')x;
 perform pg_temp.assert_export_parity(o,u,'evidence.documents','{"status":"clean","documentClass":"test_report","validityStatus":"expired"}',jsonb_build_object('productId',p),n);
 n:=public.list_evidence_document_versions(o,u,p,d);if jsonb_array_length(n->'items')<>2 or n#>>'{items,0,versionNumber}'<>'2' then raise exception 'native version order fixture missing';end if;perform pg_temp.assert_export_parity(o,u,'evidence.versions','{}',jsonb_build_object('productId',p,'documentId',d),n->'items');
 select * into r from public.place_evidence_document_legal_hold_atomic(o,u,d,'Rollback-only legal hold',gen_random_uuid());perform pg_temp.require_outcome(r.outcome,'placed');
 select * into r from public.list_evidence_document_legal_holds_atomic(o,u,d);perform pg_temp.assert_export_parity(o,u,'evidence.legal_holds','{}',jsonb_build_object('documentId',d),r.result->'legalHolds');
 select * into r from public.get_evidence_document_retention_review_atomic(o,u,d);perform pg_temp.assert_export_parity(o,u,'evidence.retention_review','{}',jsonb_build_object('documentId',d),r.result->'blockers');
 select * into r from public.create_evidence_bulk_intake_batch_atomic(o,u,p,jsonb_build_array(jsonb_build_object('clientItemId',gen_random_uuid(),'idempotencyKey',gen_random_uuid(),'title','Bulk Ω','ownerUserId',u,'productIds',jsonb_build_array(p),'fileName','bulk.csv','declaredByteSize',12)),gen_random_uuid());
 b:=(r.result#>>'{batch,id}')::uuid;
 perform pg_temp.assert_export_parity(o,u,'evidence.bulk_intake_batch','{}',jsonb_build_object('productId',p,'batchId',b),r.result#>'{batch,items}');
 select row_values into native_row from public.m14_03_source_rows(o,u,'evidence.bulk_intake_batch','{}',jsonb_build_object('productId',p,'batchId',b));
 if coalesce(native_row->>'status',native_row->>'state') is null then raise exception 'bulk status missing from approved export projection; native status=%',r.result#>>'{batch,items,0,status}';end if;
 insert into public.supplier_organizations(id,organization_id,name,created_by,updated_by) values(s,o,'Evidence supplier',u,u);
 insert into public.supplier_contacts(id,organization_id,supplier_id,name,email,created_by,updated_by) values(c,o,s,'Evidence recipient','fixture@example.test',u,u);
 payload:=jsonb_build_object('supplierId',s,'recipientContactId',c,'productId',p,'ownerUserId',u,'title','Supplier Ω evidence','instructions','Submit test evidence','dueAt',to_char(clock_timestamp()+interval '1 day','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'items',jsonb_build_array(jsonb_build_object('title','Test report','kind','evidence','documentClass','test_report'),jsonb_build_object('title','Missing certificate','kind','evidence','documentClass','certificate')));
 select * into pr from public.preview_supplier_evidence_request_atomic(o,u,payload);
 select * into r from public.create_supplier_evidence_request_atomic(o,u,payload,gen_random_uuid());perform pg_temp.require_outcome(r.outcome,'created');q:=(r.result->>'id')::uuid;
 select * into r from public.issue_supplier_evidence_request_atomic(o,u,q,0,pr.result->>'fingerprint',token_hash,clock_timestamp()+interval '1 day',gen_random_uuid());perform pg_temp.require_outcome(r.outcome,'issued');
 select * into r from public.redeem_supplier_evidence_invitation_atomic(token_hash,session_hash,clock_timestamp()+interval '20 minutes');perform pg_temp.require_outcome(r.outcome,'created');
 select id into strict i from public.supplier_evidence_request_items where organization_id=o and title='Test report';
 select id into strict inv from public.supplier_evidence_invitations where organization_id=o;
 select * into r from public.reserve_supplier_evidence_submission_atomic(session_hash,i,'supplier.csv',12,'text/csv',repeat('e',64),o||'/'||gen_random_uuid()||'/'||gen_random_uuid()||'/'||gen_random_uuid(),clock_timestamp()+interval '10 minutes',gen_random_uuid(),repeat('f',64));perform pg_temp.require_outcome(r.outcome,'reserved');sub:=(r.result#>>'{submission,id}')::uuid;sv:=(r.result->>'versionId')::uuid;
 select * into r from public.finalize_supplier_evidence_submission_atomic(session_hash,sv,12,'text/csv',repeat('e',64),gen_random_uuid(),repeat('1',64));perform pg_temp.require_outcome(r.outcome,'queued');
 perform pg_temp.require_outcome(public.record_evidence_document_scan_atomic(o,sv,'fixture','1','1','clean'),'clean');
 select * into pr from public.supplier_evidence_submissions where organization_id=o and id=sub;
 select * into r from public.review_supplier_evidence_submission_atomic(o,u,q,sub,(select version from public.supplier_evidence_requests where id=q),pr.updated_at,sv,repeat('e',64),'accepted',null,'Rollback-only review',gen_random_uuid());perform pg_temp.require_outcome(r.outcome,'accepted');
 select * into r from public.list_supplier_evidence_requests_filtered_atomic(o,u,s,p,'open',100,null);n:=r.result;perform pg_temp.assert_export_parity(o,u,'supplier_evidence.requests',jsonb_build_object('supplierId',s,'productId',p,'state','open'),'{}',n->'requests');
 update public.supplier_evidence_request_revisions set due_at=clock_timestamp()-interval '1 day' where organization_id=o;
 select * into r from public.list_supplier_evidence_overdue_atomic(o,u,p,s,100,null);n:=r.result;perform pg_temp.assert_export_parity(o,u,'supplier_evidence.overdue',jsonb_build_object('supplierId',s,'productId',p),'{}',n->'overdue');
 select * into r from public.get_supplier_evidence_request_review_atomic(o,u,q);
 perform pg_temp.assert_export_parity(o,u,'supplier_evidence.review_items','{}',jsonb_build_object('requestId',q),r.result->'reviewItems');
 perform pg_temp.assert_export_parity(o,u,'supplier_evidence.review_submissions','{}',jsonb_build_object('requestId',q,'checklistItemId',i),r.result->'submissions');
 perform pg_temp.assert_export_parity(o,u,'supplier_evidence.review_history','{}',jsonb_build_object('requestId',q,'submissionId',sub),r.result->'reviews');
 select * into pr from public.supplier_evidence_submissions where organization_id=o and id=sub;
 select * into r from public.add_supplier_document_field_atomic(o,u,p,q,sub,(select version from public.supplier_evidence_requests where id=q),pr.updated_at,sv,repeat('e',64),'scope','Exact Ω corrected value',gen_random_uuid());
 select * into r from public.get_supplier_document_extraction_atomic(o,u,p,sub,null,100);perform pg_temp.assert_export_parity(o,u,'supplier_evidence.extraction_fields','{}',jsonb_build_object('productId',p,'requestId',q,'submissionId',sub),r.result->'suggestions');
 job:=public.m14_03_create_portal_export('supplier_session',session_hash,jsonb_build_object('source','supplier_evidence.portal_submissions','format','csv','scope','all_filtered','filters','{}'::jsonb,'context',jsonb_build_object('checklistItemId',i),'idempotencyKey',gen_random_uuid()));
 n:=public.m9_02_portal_json(o,inv);
 perform pg_temp.assert_export_parity(o,null,'supplier_evidence.portal_submissions','{}',jsonb_build_object('_exportJobId',job->>'id','checklistItemId',i),n->'submissions');
 begin perform * from public.m14_03_source_rows(foreign_org,null,'supplier_evidence.portal_submissions','{}',jsonb_build_object('_exportJobId',job->>'id','checklistItemId',i));raise exception 'forged portal tenant accepted';exception when insufficient_privilege then null;end;
 for src,ctx in select * from (values
 ('evidence.documents',jsonb_build_object('productId',p)),('evidence.versions',jsonb_build_object('productId',p,'documentId',d)),('evidence.legal_holds',jsonb_build_object('documentId',d)),('evidence.retention_review',jsonb_build_object('documentId',d)),('evidence.bulk_intake_batch',jsonb_build_object('productId',p,'batchId',b)),('supplier_evidence.requests','{}'::jsonb),('supplier_evidence.overdue','{}'::jsonb),('supplier_evidence.review_items',jsonb_build_object('requestId',q)),('supplier_evidence.review_submissions',jsonb_build_object('requestId',q,'checklistItemId',i)),('supplier_evidence.review_history',jsonb_build_object('requestId',q,'submissionId',sub)),('supplier_evidence.extraction_fields',jsonb_build_object('productId',p,'requestId',q,'submissionId',sub)))fixtures(source,context) loop
 begin perform * from public.m14_03_source_rows(foreign_org,u,src,'{}',ctx);raise exception 'forged tenant accepted: %',src;exception when insufficient_privilege then null;end;
 end loop;
end $$;
rollback;
