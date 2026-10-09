begin;
create extension if not exists pgtap;
select no_plan();

select ok(to_regclass('public.framework_requirement_applicability') is not null,
  'approved product applicability is persisted');
select ok(to_regclass('public.framework_coverage_scopes') is not null,
  'coverage recalculation state is durable');
select ok(to_regclass('public.framework_coverage_rows') is not null,
  'requirement results are durable');
select ok(to_regprocedure('public.m10_set_framework_applicability(uuid,uuid,uuid,text,text,text,boolean,text,integer,uuid)') is not null,
  'applicability command is atomic');
select ok(to_regprocedure('public.m10_request_coverage(uuid,uuid,text,text)') is not null,
  'scoped coverage requests notice date expiry');
select ok(to_regprocedure('public.m10_claim_coverage_scope(uuid)') is not null,
  'worker lease is durable');
select ok(to_regprocedure('public.m10_recalculate_coverage_scope(uuid,uuid,uuid,text,text)') is not null,
  'worker recalculation is durable');
select ok(to_regprocedure('public.m10_coverage_summary(uuid,uuid,text,text)') is not null,
  'coverage summary is bounded and consistent with projected rows');
select ok(to_regprocedure('public.m10_fail_coverage_scope(uuid,uuid,uuid,text,text,text)') is not null,
  'worker failures have a retryable error state');
select ok(not has_table_privilege('authenticated','public.framework_coverage_rows','select'),
  'browser roles cannot infer coverage rows directly');
select ok(not has_function_privilege('authenticated',
  'public.m10_set_framework_applicability(uuid,uuid,uuid,text,text,text,boolean,text,integer,uuid)','execute'),
  'browser roles cannot approve applicability');
select ok(has_function_privilege('service_role',
  'public.m10_set_framework_applicability(uuid,uuid,uuid,text,text,text,boolean,text,integer,uuid)','execute'),
  'service role may call scoped command');
select is((select count(*)::integer from public.organization_export_source_tables
  where source_id='framework_controls' and table_name='framework_requirement_applicability'),1,
  'approved applicability participates in tenant export');

create temp table m10_03_context on commit drop as
select m.organization_id,u.id actor_user_id,p.id product_id
from public.users u
join public.organization_members m on m.user_id=u.id and m.role='owner'
join public.products p on p.organization_id=m.organization_id and p.archived_at is null
where u.email='owner@cra.test' and u.is_active limit 1;
select is((select count(*)::integer from m10_03_context),1,'local owner fixture exists');
select is((select x.outcome from m10_03_context c cross join lateral
  public.m10_select_framework_version(c.organization_id,c.actor_user_id,
    'cra-annex-i','oj-2024-11-20-en',true,null,gen_random_uuid()) x),
  'selected','fixture selects the current pack');
select is((select x.status from m10_03_context c cross join lateral
  public.m10_request_coverage(c.organization_id,c.product_id,
    'cra-annex-i','oj-2024-11-20-en') x),
  'pending','first read schedules an uncomputed scope');
update public.framework_coverage_scopes s set next_attempt_at='1970-01-01'::timestamptz
from m10_03_context c where s.organization_id=c.organization_id
  and s.product_id=c.product_id and s.pack_key='cra-annex-i'
  and s.version_key='oj-2024-11-20-en';
create temp table m10_03_claim on commit drop as
select x.* from public.m10_claim_coverage_scope(gen_random_uuid()) x;
select is((select count(*)::integer from m10_03_claim),1,'worker claims pending scope');
select is((select public.m10_recalculate_coverage_scope(s.lease_owner,c.organization_id,
  c.product_id,'cra-annex-i','oj-2024-11-20-en') from m10_03_context c
  join public.framework_coverage_scopes s on s.organization_id=c.organization_id
    and s.product_id=c.product_id and s.pack_key='cra-annex-i'
    and s.version_key='oj-2024-11-20-en'),
  'current','leased worker computes coverage');
select is((select count(*)::integer from public.framework_coverage_rows r
  join m10_03_context c on c.organization_id=r.organization_id and c.product_id=r.product_id
  where r.pack_key='cra-annex-i' and r.version_key='oj-2024-11-20-en'),25,
  'all 25 requirement nodes project atomically');
select is((select count(*)::integer from public.framework_coverage_rows r
  join m10_03_context c on c.organization_id=r.organization_id and c.product_id=r.product_id
  where r.status='structural'),2,'two Part headings are outside denominator');
select is((select count(*)::integer from public.framework_coverage_rows r
  join m10_03_context c on c.organization_id=r.organization_id and c.product_id=r.product_id
  where r.status='no_mapping'),23,'numbered clauses begin as actionable gaps');
select is((select (public.m10_coverage_summary(c.organization_id,c.product_id,
  'cra-annex-i','oj-2024-11-20-en')->>'gapRequirements')::integer
  from m10_03_context c),23,'summary matches detail gaps');
create temp table m10_03_applicability on commit drop as
select x.* from m10_03_context c cross join lateral
  public.m10_set_framework_applicability(c.organization_id,c.actor_user_id,
    c.product_id,'cra-annex-i','oj-2024-11-20-en','annex-i-part-i-1',
    true,'Reviewed as not applicable to this product',null,gen_random_uuid()) x;
select is((select outcome from m10_03_applicability),'updated',
  'owner may approve a numbered clause with reason');
select is((select s.status from public.framework_coverage_scopes s
  join m10_03_context c on c.organization_id=s.organization_id and c.product_id=s.product_id
  where s.pack_key='cra-annex-i' and s.version_key='oj-2024-11-20-en'),
  'pending','applicability mutation invalidates prior green results');
select ok((select public.m10_coverage_summary(c.organization_id,c.product_id,
  'cra-annex-i','oj-2024-11-20-en') is null from m10_03_context c),
  'stale rows cannot produce green summary');
select is((select x.outcome from m10_03_context c cross join lateral
  public.m10_set_framework_applicability(c.organization_id,c.actor_user_id,
    c.product_id,'cra-annex-i','oj-2024-11-20-en','annex-i-part-i-1',
    false,null,1,gen_random_uuid()) x),
  'updated','expected revision updates applicability');
select is((select x.outcome from m10_03_context c cross join lateral
  public.m10_set_framework_applicability(c.organization_id,c.actor_user_id,
    c.product_id,'cra-annex-i','oj-2024-11-20-en','annex-i-part-i-1',
    true,'Stale change',1,gen_random_uuid()) x),
  'conflict','stale revision is rejected');
select is((select x.outcome from m10_03_context c cross join lateral
  public.m10_set_framework_applicability(gen_random_uuid(),c.actor_user_id,
    c.product_id,'cra-annex-i','oj-2024-11-20-en','annex-i-part-i-1',
    true,'Cross tenant',null,gen_random_uuid()) x),
  'forbidden','tenant substitution cannot approve applicability');
select is((select x.outcome from m10_03_context c cross join lateral
  public.m10_set_framework_applicability(c.organization_id,c.actor_user_id,
    c.product_id,'cra-annex-i','oj-2024-11-20-en','annex-i-part-i-2',
    true,'Partially applicable product',0,gen_random_uuid()) x),
  'updated','expected revision zero creates a new approval');
create temp table m10_03_retry_key on commit drop as select gen_random_uuid() key;
select is((select x.outcome from m10_03_context c cross join m10_03_retry_key k
  cross join lateral public.m10_set_framework_applicability(c.organization_id,c.actor_user_id,
    c.product_id,'cra-annex-i','oj-2024-11-20-en','annex-i-part-ii-1',
    false,null,0,k.key) x),
  'updated','first applicability command with stable key is applied');
select is((select x.outcome from m10_03_context c cross join m10_03_retry_key k
  cross join lateral public.m10_set_framework_applicability(c.organization_id,c.actor_user_id,
    c.product_id,'cra-annex-i','oj-2024-11-20-en','annex-i-part-ii-1',
    false,null,0,k.key) x),
  'updated','identical retry returns stored result without another revision');
select is((select a.revision from public.framework_requirement_applicability a
  join m10_03_context c on c.organization_id=a.organization_id and c.product_id=a.product_id
  where a.requirement_key='annex-i-part-ii-1'),1,
  'identical retry does not change revision');
create temp table m10_03_claim_second on commit drop as
select gen_random_uuid() worker_id;
update public.framework_coverage_scopes s set next_attempt_at='1970-01-01'::timestamptz
from m10_03_context c where s.organization_id=c.organization_id
  and s.product_id=c.product_id and s.pack_key='cra-annex-i'
  and s.version_key='oj-2024-11-20-en';
select is((select count(*)::integer from m10_03_claim_second w
  cross join lateral public.m10_claim_coverage_scope(w.worker_id) x),1,
  'invalidated scope can be reclaimed');
select is((select public.m10_recalculate_coverage_scope(w.worker_id,c.organization_id,
  c.product_id,'cra-annex-i','oj-2024-11-20-en')
  from m10_03_context c cross join m10_03_claim_second w),
  'current','new approval recalculates coverage');
select is((select (public.m10_coverage_summary(c.organization_id,c.product_id,
  'cra-annex-i','oj-2024-11-20-en')->>'excludedRequirements')::integer
  from m10_03_context c),1,'approved non-applicability is separate from denominator');
select is((select (public.m10_coverage_summary(c.organization_id,c.product_id,
  'cra-annex-i','oj-2024-11-20-en')->>'applicableRequirements')::integer
  from m10_03_context c),22,'structural and excluded nodes are outside denominator');
update public.framework_coverage_scopes s
set next_boundary_on=(clock_timestamp() at time zone 'UTC')::date
from m10_03_context c where s.organization_id=c.organization_id
  and s.product_id=c.product_id and s.pack_key='cra-annex-i'
  and s.version_key='oj-2024-11-20-en';
select is((select x.status from m10_03_context c cross join lateral
  public.m10_request_coverage(c.organization_id,c.product_id,
    'cra-annex-i','oj-2024-11-20-en') x),
  'pending','clock boundary expires current coverage before presentation');
select ok((select public.m10_coverage_summary(c.organization_id,c.product_id,
  'cra-annex-i','oj-2024-11-20-en') is null from m10_03_context c),
  'clock-expired summary cannot present green results');

create function pg_temp.m10_03_recompute() returns text language plpgsql as $$
declare v_worker uuid:=gen_random_uuid(); v_claim record;
begin
  update public.framework_coverage_scopes s set next_attempt_at='1970-01-01'::timestamptz
  from m10_03_context c where s.organization_id=c.organization_id
    and s.product_id=c.product_id and s.pack_key='cra-annex-i'
    and s.version_key='oj-2024-11-20-en' and s.status in ('pending','error');
  select * into v_claim from public.m10_claim_coverage_scope(v_worker);
  if not found then return 'no_claim'; end if;
  return public.m10_recalculate_coverage_scope(v_worker,v_claim.organization_id,
    v_claim.product_id,v_claim.pack_key,v_claim.version_key);
end $$;
select is(pg_temp.m10_03_recompute(),'current','expired scope recalculates');

create temp table m10_03_control on commit drop as
with created as (
  insert into public.framework_controls(organization_id,title,description,
    owner_user_id,implementation_status,created_by,updated_by)
  select c.organization_id,'M10-03 rollback-only control','Coverage SQL fixture',
    c.actor_user_id,'implemented',c.actor_user_id,c.actor_user_id
  from m10_03_context c returning *
) select * from created;
insert into public.framework_control_revisions(organization_id,control_id,revision,
  title,description,owner_user_id,implementation_status,actor_user_id)
select organization_id,id,revision,title,description,owner_user_id,
  implementation_status,created_by from m10_03_control;
create temp table m10_03_mapping on commit drop as
with created as (
  insert into public.framework_control_requirement_mappings(organization_id,control_id,
    pack_key,version_key,requirement_key,rationale,source_control_revision,created_by)
  select c.organization_id,c.id,'cra-annex-i','oj-2024-11-20-en',
    'annex-i-part-i-1','Product-specific fixture rationale',c.revision,c.created_by
  from m10_03_control c returning *
) select * from created;
insert into public.framework_control_mapping_products(organization_id,mapping_id,product_id)
select m.organization_id,m.id,c.product_id from m10_03_mapping m join m10_03_context c using(organization_id);

create temp table m10_03_document on commit drop as
with created as (
  insert into public.evidence_documents(organization_id,created_by)
  select organization_id,actor_user_id from m10_03_context returning organization_id,id
) select * from created;
create temp table m10_03_version on commit drop as
with created as (
  insert into public.evidence_document_versions(organization_id,document_id,
    version_number,title,document_class,retention_evidence_class,owner_user_id,
    uploader_user_id,object_key,original_filename,declared_size_bytes,
    validity_starts_on,validity_ends_on,upload_expires_at,
    initialize_idempotency_key,initialize_request_digest)
  select c.organization_id,d.id,1,'Coverage test evidence','test_report',
    'evidence_document',c.actor_user_id,c.actor_user_id,
    'm10-03-test/'||gen_random_uuid()::text,'coverage.txt',4,
    current_date-interval '2 days',current_date+interval '2 days',
    clock_timestamp()+interval '5 minutes',gen_random_uuid(),repeat('a',64)
  from m10_03_context c join m10_03_document d using(organization_id)
  returning organization_id,id,document_id
) select * from created;
insert into public.evidence_document_version_products(organization_id,version_id,product_id)
select v.organization_id,v.id,c.product_id from m10_03_version v join m10_03_context c using(organization_id);
update public.evidence_document_versions set processing_state='clean',
  actual_size_bytes=4,detected_media_type='text/plain',
  original_sha256=repeat('a',64),finalized_at=clock_timestamp()
where id=(select id from m10_03_version);
update public.evidence_documents set current_version_id=(select id from m10_03_version)
where id=(select id from m10_03_document);
create temp table m10_03_link on commit drop as
with created as (
  insert into public.framework_control_evidence_links(organization_id,control_id,
    evidence_version_id,product_id,source_control_revision,created_by)
  select c.organization_id,c.id,v.id,x.product_id,c.revision,c.created_by
  from m10_03_control c join m10_03_version v using(organization_id)
  join m10_03_context x using(organization_id) returning id,organization_id
) select * from created;
select is(pg_temp.m10_03_recompute(),'current','mapped evidence recalculates');
select is((select r.status from public.framework_coverage_rows r
  join m10_03_context c on c.organization_id=r.organization_id and c.product_id=r.product_id
  where r.requirement_key='annex-i-part-i-1'),
  'evidence_backed','implemented control and clean valid version resolve the gap');
update public.evidence_document_versions set processing_state='quarantined'
where id=(select id from m10_03_version);
select is(pg_temp.m10_03_recompute(),'current','quarantine invalidates and recalculates');
select is((select r.status from public.framework_coverage_rows r
  join m10_03_context c on c.organization_id=r.organization_id and c.product_id=r.product_id
  where r.requirement_key='annex-i-part-i-1'),
  'quarantined_evidence','quarantined evidence becomes a specific gap');
update public.framework_control_evidence_links set ended_at=clock_timestamp()
where id=(select id from m10_03_link);
select is(pg_temp.m10_03_recompute(),'current','unlink invalidates and recalculates');
select is((select r.status from public.framework_coverage_rows r
  join m10_03_context c on c.organization_id=r.organization_id and c.product_id=r.product_id
  where r.requirement_key='annex-i-part-i-1'),
  'missing_evidence','unlink exposes missing evidence without deleting history');

-- A linked but unfinished control remains visible without changing the gap
-- reason for the implemented path that has no active evidence.
create temp table m10_03_unfinished_control on commit drop as
with created as (
  insert into public.framework_controls(organization_id,title,description,
    owner_user_id,implementation_status,created_by,updated_by)
  select organization_id,'Unfinished evidence path','Mixed-control regression',
    actor_user_id,'in_progress',actor_user_id,actor_user_id
  from m10_03_context returning *
) select * from created;
insert into public.framework_control_revisions(organization_id,control_id,revision,
  title,description,owner_user_id,implementation_status,actor_user_id)
select organization_id,id,revision,title,description,owner_user_id,
  implementation_status,created_by from m10_03_unfinished_control;
create temp table m10_03_unfinished_mapping on commit drop as
with created as (
  insert into public.framework_control_requirement_mappings(organization_id,control_id,
    pack_key,version_key,requirement_key,rationale,source_control_revision,created_by)
  select c.organization_id,c.id,'cra-annex-i','oj-2024-11-20-en',
    'annex-i-part-i-1','Unfinished alternate path',c.revision,c.created_by
  from m10_03_unfinished_control c returning *
) select * from created;
insert into public.framework_control_mapping_products(organization_id,mapping_id,product_id)
select m.organization_id,m.id,c.product_id
from m10_03_unfinished_mapping m join m10_03_context c using(organization_id);
insert into public.framework_control_evidence_links(organization_id,control_id,
  evidence_version_id,product_id,source_control_revision,created_by)
select c.organization_id,c.id,v.id,x.product_id,c.revision,c.created_by
from m10_03_unfinished_control c join m10_03_version v using(organization_id)
join m10_03_context x using(organization_id);
select is(pg_temp.m10_03_recompute(),'current','mixed controls recalculate');
select is((select r.status from public.framework_coverage_rows r
  join m10_03_context c on c.organization_id=r.organization_id and c.product_id=r.product_id
  where r.requirement_key='annex-i-part-i-1'),
  'missing_evidence','unfinished control quarantine does not mask implemented missing evidence');

create temp table m10_03_expired_version on commit drop as
with created as (
  insert into public.evidence_document_versions(organization_id,document_id,
    version_number,title,document_class,retention_evidence_class,owner_user_id,
    uploader_user_id,object_key,original_filename,declared_size_bytes,
    validity_starts_on,validity_ends_on,upload_expires_at,
    initialize_idempotency_key,initialize_request_digest)
  select c.organization_id,d.id,2,'Expired coverage evidence','test_report',
    'evidence_document',c.actor_user_id,c.actor_user_id,
    'm10-03-test/'||gen_random_uuid()::text,'expired.txt',4,
    current_date-interval '4 days',current_date-interval '1 day',
    clock_timestamp()+interval '5 minutes',gen_random_uuid(),repeat('b',64)
  from m10_03_context c join m10_03_document d using(organization_id)
  returning organization_id,id
) select * from created;
insert into public.evidence_document_version_products(organization_id,version_id,product_id)
select v.organization_id,v.id,c.product_id from m10_03_expired_version v join m10_03_context c using(organization_id);
update public.evidence_document_versions set processing_state='clean',
  actual_size_bytes=4,detected_media_type='text/plain',
  original_sha256=repeat('b',64),finalized_at=clock_timestamp()
where id=(select id from m10_03_expired_version);
insert into public.framework_control_evidence_links(organization_id,control_id,
  evidence_version_id,product_id,source_control_revision,created_by)
select c.organization_id,c.id,v.id,x.product_id,c.revision,c.created_by
from m10_03_control c join m10_03_expired_version v using(organization_id)
join m10_03_context x using(organization_id);
select is(pg_temp.m10_03_recompute(),'current','expired evidence invalidates and recalculates');
select is((select r.status from public.framework_coverage_rows r
  join m10_03_context c on c.organization_id=r.organization_id and c.product_id=r.product_id
  where r.requirement_key='annex-i-part-i-1'),
  'expired_evidence','retained but expired evidence is not counted valid');
select is((select (public.m10_coverage_summary(c.organization_id,c.product_id,
  'cra-annex-i','oj-2024-11-20-en')->>'gapRequirements')::integer
  from m10_03_context c),22,'summary and detail agree after one exclusion');

create temp table m10_03_future_version on commit drop as
with created as (
  insert into public.evidence_document_versions(organization_id,document_id,
    version_number,title,document_class,retention_evidence_class,owner_user_id,
    uploader_user_id,object_key,original_filename,declared_size_bytes,
    validity_starts_on,validity_ends_on,upload_expires_at,
    initialize_idempotency_key,initialize_request_digest)
  select c.organization_id,d.id,3,'Future coverage evidence','test_report',
    'evidence_document',c.actor_user_id,c.actor_user_id,
    'm10-03-test/'||gen_random_uuid()::text,'future.txt',4,
    current_date+interval '2 days',current_date+interval '4 days',
    clock_timestamp()+interval '5 minutes',gen_random_uuid(),repeat('c',64)
  from m10_03_context c join m10_03_document d using(organization_id)
  returning organization_id,id
) select * from created;
insert into public.evidence_document_version_products(organization_id,version_id,product_id)
select v.organization_id,v.id,c.product_id from m10_03_future_version v join m10_03_context c using(organization_id);
update public.evidence_document_versions set processing_state='clean',
  actual_size_bytes=4,detected_media_type='text/plain',
  original_sha256=repeat('c',64),finalized_at=clock_timestamp()
where id=(select id from m10_03_future_version);
insert into public.framework_control_evidence_links(organization_id,control_id,
  evidence_version_id,product_id,source_control_revision,created_by)
select c.organization_id,c.id,v.id,x.product_id,c.revision,c.created_by
from m10_03_control c join m10_03_future_version v using(organization_id)
join m10_03_context x using(organization_id);
select is(pg_temp.m10_03_recompute(),'current','future evidence invalidates and recalculates');
select is((select r.status from public.framework_coverage_rows r
  join m10_03_context c on c.organization_id=r.organization_id and c.product_id=r.product_id
  where r.requirement_key='annex-i-part-i-1'),
  'not_yet_valid_evidence','future-start evidence is an explicit gap');

update public.evidence_document_versions set processing_state='clean'
where id=(select id from m10_03_version);
create temp table m10_03_failed_worker on commit drop as select gen_random_uuid() worker_id;
update public.framework_coverage_scopes s set next_attempt_at='1970-01-01'::timestamptz
from m10_03_context c where s.organization_id=c.organization_id
  and s.product_id=c.product_id and s.pack_key='cra-annex-i'
  and s.version_key='oj-2024-11-20-en';
select is((select count(*)::integer from m10_03_failed_worker w
  cross join lateral public.m10_claim_coverage_scope(w.worker_id)),1,
  'worker leases invalidated source after quarantine clears');
select is((select public.m10_fail_coverage_scope(w.worker_id,c.organization_id,
  c.product_id,'cra-annex-i','oj-2024-11-20-en','injected worker outage')
  from m10_03_context c cross join m10_03_failed_worker w),
  'retry','failed worker records bounded retry state');
select ok((select public.m10_coverage_summary(c.organization_id,c.product_id,
  'cra-annex-i','oj-2024-11-20-en') is null from m10_03_context c),
  'worker failure never presents stale green');
update public.framework_coverage_scopes s set next_attempt_at=clock_timestamp()-interval '1 second'
from m10_03_context c where s.organization_id=c.organization_id and s.product_id=c.product_id
  and s.pack_key='cra-annex-i' and s.version_key='oj-2024-11-20-en';
select is(pg_temp.m10_03_recompute(),'current',
  'a new worker reclaims the failed scope and recalculates');
select is((select x.outcome from m10_03_context c
  join public.organization_framework_selections s on s.organization_id=c.organization_id
    and s.pack_key='cra-annex-i'
  cross join lateral public.m10_select_framework_version(c.organization_id,c.actor_user_id,
    'cra-annex-i','oj-2024-11-20-en',false,s.revision,gen_random_uuid()) x),
  'selected','fixture disables the pack after a saved command');
select is((select x.outcome from m10_03_context c cross join m10_03_retry_key k
  cross join lateral public.m10_set_framework_applicability(c.organization_id,c.actor_user_id,
    c.product_id,'cra-annex-i','oj-2024-11-20-en','annex-i-part-ii-1',
    false,null,0,k.key) x),
  'updated','same idempotency key replays after selection changes');
select is((select x.outcome from m10_03_context c cross join lateral
  public.m10_set_framework_applicability(c.organization_id,c.actor_user_id,
    c.product_id,'cra-annex-i','oj-2024-11-20-en','annex-i-part-ii-1',
    true,'New approval after disable',1,gen_random_uuid()) x),
  'not_found','new approval cannot change a disabled version');

select * from finish();
rollback;
