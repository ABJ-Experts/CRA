\set ON_ERROR_STOP on
begin;
create function pg_temp.check(p_label text,p_ok boolean) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'FAIL %',p_label; end if; raise notice 'ok %',p_label; end $$;

do $$
declare v_org uuid:='00000000-0000-4000-8000-0000000000ca'; v_owner uuid; v_admin uuid; v_viewer uuid;
 v_request uuid; v_submission uuid; v_outstanding_request uuid; v_product uuid;
 v_rule record; v_release record; v_obligation uuid:=gen_random_uuid(); v_stage uuid:=gen_random_uuid();
 v_draft uuid:=gen_random_uuid(); v_row record;
 v_finding uuid; v_assessment uuid:=gen_random_uuid();
 v_evidence_product uuid; v_evidence_document uuid:=gen_random_uuid(); v_evidence_version uuid:=gen_random_uuid();
begin
 select id into v_owner from public.users where email='owner@cra.test';
 select id into v_admin from public.users where email='admin@cra.test';
 select id into v_viewer from public.users where email='viewer@cra.test';
 select q.id,sub.id,q.product_id into v_request,v_submission,v_product
 from public.supplier_evidence_requests q join public.supplier_evidence_submissions sub
  on sub.organization_id=q.organization_id and sub.request_id=q.id and sub.revision_id=q.current_revision_id
 where q.organization_id=v_org and q.state='open' and q.review_state='accepted'
  and not public.m9_04_request_has_outstanding_required(q.organization_id,q.current_revision_id)
  and sub.state='accepted'
 limit 1;
 perform pg_temp.check('Accepted supplier fixture exists',v_request is not null);
 select * into v_row from public.m1201_get_task(v_org,v_owner,'supplier_request',v_request);
 perform pg_temp.check('Completed supplier work is absent',v_row.outcome='not_found');
 update public.supplier_evidence_submissions set state='submitted_pending_review'
  where organization_id=v_org and id=v_submission;
 select * into v_row from public.m1201_get_task(v_org,v_owner,'supplier_request',v_request);
 perform pg_temp.check('Current revision pending review projects despite accepted aggregate',
  v_row.outcome='found' and v_row.task->>'sourceId'=v_request::text);
 select q.id into v_outstanding_request from public.supplier_evidence_requests q
  join public.products p on p.organization_id=q.organization_id and p.id=q.product_id
 where q.organization_id=v_org and q.state='open' and q.review_state='accepted' and p.archived_at is null
  and public.m9_04_request_has_outstanding_required(q.organization_id,q.current_revision_id)
 limit 1;
 perform pg_temp.check('Accepted aggregate with missing required work has fixture',v_outstanding_request is not null);
 select * into v_row from public.m1201_get_task(v_org,v_owner,'supplier_request',v_outstanding_request);
 perform pg_temp.check('Outstanding required work projects despite accepted aggregate',v_row.outcome='found');
 select * into v_row from public.m1201_get_task(v_org,v_viewer,'supplier_request',v_request);
 perform pg_temp.check('Viewer cannot read supplier task title',v_row.outcome='not_found' and v_row.task is null);
 select * into v_row from public.m1201_list_tasks(v_org,v_viewer,'all','supplier_request',null,null,null,null,null,50);
 perform pg_temp.check('Viewer supplier counts and rows remain zero',v_row.outcome='found'
  and jsonb_array_length(v_row.tasks)=0 and (v_row.counts->>'mine')::int=0
  and (v_row.counts->>'group')::int=0 and (v_row.counts->>'available')::int=0);
 select f.id into v_finding from public.vulnerability_findings f
  join public.product_releases r on r.organization_id=f.organization_id and r.id=f.release_id
  join public.products p on p.organization_id=r.organization_id and p.id=r.product_id
 where f.organization_id=v_org and f.status='active' and r.archived_at is null and p.archived_at is null
  and not exists(select 1 from public.vulnerability_finding_assessments a
   where a.organization_id=f.organization_id and a.finding_id=f.id and a.is_current)
 order by f.id limit 1;
 perform pg_temp.check('Active finding without a current assessment exists',v_finding is not null);
 insert into public.vulnerability_finding_assessments(id,organization_id,finding_id,revision,vex_status,
  detail,approval_state,approval_required,policy_severity,policy_version,submitted_by,updated_by)
 values(v_assessment,v_org,v_finding,1,'affected','M12 approval projection fixture',
  'awaiting_approval',true,'unknown',0,v_viewer,v_viewer);
 select * into v_row from public.m1201_get_task(v_org,v_owner,'finding_approval',v_assessment);
 perform pg_temp.check('Current M5 assessment awaiting approval projects with source link',
  v_row.outcome='found' and v_row.task->>'sourceId'=v_assessment::text
  and v_row.task->>'sourceUrl'='/findings?findingId='||v_finding||'&assessmentId='||v_assessment);
 perform pg_temp.check('Assessment submitter is not an eligible acting approver',
  not public.m1201_eligible_actor(v_org,v_viewer,'finding_approval',v_assessment));
 perform pg_temp.check('M5 approval fixture uses a distinct authorized actor',v_admin is not null);
 select * into v_row from public.approve_vulnerability_finding_vex_assessment_atomic(
  v_org,v_admin,v_finding,v_assessment,1,null,gen_random_uuid(),repeat('b',64));
 perform pg_temp.check('M5 source approval use case completes',v_row.outcome='approved');
 select * into v_row from public.m1201_get_task(v_org,v_owner,'finding_approval',v_assessment);
 perform pg_temp.check('Source approval completion removes M5 approval task',v_row.outcome='not_found');

 select p.id into v_evidence_product from public.products p
 where p.organization_id=v_org and p.archived_at is null and p.id<>v_product
 order by p.id limit 1;
 perform pg_temp.check('Active evidence product fixture exists',v_evidence_product is not null);
 insert into public.evidence_documents(id,organization_id,created_by)
 values(v_evidence_document,v_org,v_owner);
 insert into public.evidence_document_versions(id,organization_id,document_id,version_number,title,
  document_class,retention_evidence_class,owner_user_id,uploader_user_id,validity_starts_on,
  validity_ends_on,object_key,original_filename,declared_size_bytes,upload_expires_at,
  initialize_idempotency_key,initialize_request_digest)
 values(v_evidence_version,v_org,v_evidence_document,1,'M12 expiry projection fixture',
  'test_report','evidence_document',v_owner,v_owner,current_date-1,current_date+7,
  'm12-projection/'||v_evidence_version,'m12-projection.txt',4,clock_timestamp()+interval '5 minutes',
  gen_random_uuid(),repeat('a',64));
 insert into public.evidence_document_version_products(organization_id,version_id,product_id)
 values(v_org,v_evidence_version,v_evidence_product);
 update public.evidence_document_versions set processing_state='clean',actual_size_bytes=4,
  detected_media_type='text/plain',original_sha256=repeat('a',64),finalized_at=clock_timestamp()
 where organization_id=v_org and id=v_evidence_version;
 update public.evidence_documents set current_version_id=v_evidence_version
 where organization_id=v_org and id=v_evidence_document;
 select * into v_row from public.m1201_get_task(v_org,v_owner,'evidence_expiry',v_evidence_version);
 perform pg_temp.check('Current clean M8 version nearing expiry projects with source link',
  v_row.outcome='found' and v_row.task->>'sourceId'=v_evidence_version::text
  and v_row.task->>'sourceUrl'='/products/'||v_evidence_product||'/evidence?documentId='||v_evidence_document||'&versionId='||v_evidence_version
  and v_row.task->>'dueAt'=to_char((current_date+8)::timestamp,'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
 update public.evidence_documents set lifecycle_state='queued_cleanup',deletion_requested_at=clock_timestamp()
 where organization_id=v_org and id=v_evidence_document;
 select * into v_row from public.m1201_get_task(v_org,v_owner,'evidence_expiry',v_evidence_version);
 perform pg_temp.check('Retired evidence source removes M8 expiry task',v_row.outcome='not_found');
 update public.products set archived_at=clock_timestamp() where organization_id=v_org and id=v_product;
 select * into v_row from public.m1201_get_task(v_org,v_owner,'supplier_request',v_request);
 perform pg_temp.check('Archived product hides supplier task',v_row.outcome='not_found');
 select id,version,rules into v_rule from public.reporting_rule_sets where jurisdiction='EU-CRA' order by version desc limit 1;
 select r.id,r.product_id into v_release from public.product_releases r join public.products p
  on p.organization_id=r.organization_id and p.id=r.product_id
  where r.organization_id=v_org and p.archived_at is null and p.id<>v_product order by r.id limit 1;
 perform pg_temp.check('Reporting fixture prerequisites exist',v_rule.id is not null and v_release.id is not null);
 insert into public.reporting_obligations(id,organization_id,obligation_type,awareness_at,awareness_basis,
  rule_set_id,rule_set_version,rule_snapshot,created_by_user_id,created_by_display_name)
 values(v_obligation,v_org,'severe_incident',date_trunc('second',clock_timestamp()),'M12 projection test',
  v_rule.id,v_rule.version,v_rule.rules,v_owner,'M12 test owner');
 insert into public.reporting_obligation_stages(id,organization_id,obligation_id,stage_kind,anchor_kind,duration,state,due_at)
 values(v_stage,v_org,v_obligation,'early_warning','awareness','PT24H','running',clock_timestamp()+interval '1 day');
 insert into public.reporting_stage_drafts(id,organization_id,obligation_id,stage_id,release_id,content,
  field_provenance,member_states,created_by_user_id)
 values(v_draft,v_org,v_obligation,v_stage,v_release.id,'{"summary":"Fixture summary","impact":"Fixture impact"}'::jsonb,
  '{"summary":{"origin":"human"},"impact":{"origin":"human"}}'::jsonb,'["DE"]'::jsonb,v_viewer);
 select * into v_row from public.m1201_get_task(v_org,v_owner,'report_approval',v_stage);
 perform pg_temp.check('Ready unapproved reporting stage projects',v_row.outcome='found' and v_row.task->>'sourceId'=v_stage::text);
 insert into public.reporting_stage_approvals(organization_id,obligation_id,stage_id,draft_id,draft_revision,
  draft_hash,approved_by_user_id)
 values(v_org,v_obligation,v_stage,v_draft,1,repeat('a',64),v_owner);
 select * into v_row from public.m1201_get_task(v_org,v_owner,'report_approval',v_stage);
 perform pg_temp.check('Approved reporting stage has no inbox task',v_row.outcome='not_found');
 update public.reporting_stage_drafts set content=jsonb_set(content,'{summary}','"Edited after approval"'::jsonb)
  where organization_id=v_org and id=v_draft;
 select * into v_row from public.m1201_get_task(v_org,v_owner,'report_approval',v_stage);
 perform pg_temp.check('Post-approval edit does not create impossible approval task',v_row.outcome='not_found');
end $$;
rollback;
