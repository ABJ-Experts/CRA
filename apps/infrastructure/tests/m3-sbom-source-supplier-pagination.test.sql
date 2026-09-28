-- Equal timestamps, bounded lookahead, exact sets, scope and wire fields.
begin;
create function pg_temp.assert_sbom_page_walk(p_kind text,p_org uuid,p_actor uuid,p_product uuid,p_release uuid,p_limit integer,p_state text)
returns void language plpgsql as $$
declare v_expected uuid[]; v_actual uuid[]:=array[]::uuid[]; v_cursor text; v_page record; v_item jsonb; v_pages integer:=0;
begin
  if p_kind='sources' then select array_agg(id order by created_at desc,id desc) into v_expected from public.sbom_sources where organization_id=p_org and product_id=p_product and release_id=p_release;
  elsif p_kind='requests' then select array_agg(id order by created_at desc,id asc) into v_expected from public.sbom_supplier_requests where organization_id=p_org and(p_state is null or status=p_state);
  else select array_agg(id order by created_at desc,id asc) into v_expected from public.sbom_supplier_submissions where organization_id=p_org and(p_state is null or status=p_state); end if;
  loop
    if p_kind='sources' then select outcome,sources rows,next_cursor into v_page from public.list_sbom_sources_for_release(p_org,p_actor,p_product,p_release,p_limit,v_cursor);
    elsif p_kind='requests' then select outcome,requests rows,next_cursor into v_page from public.list_supplier_sbom_requests(p_org,p_actor,p_product,p_release,p_state,p_limit,v_cursor);
    else select outcome,submissions rows,next_cursor into v_page from public.list_supplier_sbom_submissions(p_org,p_actor,null,p_state,p_limit,v_cursor); end if;
    if v_page.outcome<>'found' or jsonb_array_length(v_page.rows)>p_limit then raise exception 'Invalid % page response',p_kind; end if;
    for v_item in select * from jsonb_array_elements(v_page.rows) loop
      v_actual:=array_append(v_actual,case when p_kind='sources' then(v_item->'source'->>'id')::uuid when p_kind='requests' then(v_item->'request'->>'id')::uuid else(v_item->>'id')::uuid end);
    end loop;
    v_cursor:=v_page.next_cursor; v_pages:=v_pages+1;
    if v_pages>150 then raise exception '% paging did not terminate',p_kind; end if;
    exit when v_cursor is null;
  end loop;
  if v_actual is distinct from v_expected then raise exception '% limit % omitted/duplicated/reordered rows (% actual, % expected)',p_kind,p_limit,cardinality(v_actual),cardinality(v_expected); end if;
end $$;
select set_config('m3_test.fixture_org',gen_random_uuid()::text,true);
insert into public.organizations(id,name,slug) values(current_setting('m3_test.fixture_org')::uuid,'M3 paging fixture','m3-paging-'||current_setting('m3_test.fixture_org'));
-- Every fixture row is private to this transaction and rolls back.
do $$
declare
  v_org uuid := current_setting('m3_test.fixture_org')::uuid;
  v_actor uuid;
  v_entity uuid := gen_random_uuid();
  v_product uuid;
  v_release uuid;
  v_hash text := repeat('d', 64);
  v_source_one uuid := gen_random_uuid();
  v_source_two uuid := gen_random_uuid();
  v_key_one uuid := gen_random_uuid();
  v_key_two uuid := gen_random_uuid();
  v_report jsonb;
  v_job_one record;
  v_job_two record;
  v_claim record;
  v_begin record;
  v_persist record;
  v_finalize record;
  v_index integer;
  v_source uuid;
  v_request uuid;
  v_invitation uuid;
  v_primary uuid := gen_random_uuid();
  v_limit integer;
  v_kind text;
  v_failures text[] := array[]::text[];
  v_read record;
  v_bad text;
  v_secondary_release uuid := gen_random_uuid();
  v_document uuid;
  v_component uuid;
begin
  select id into v_actor from public.users where email = 'owner@cra.test';
  insert into public.organization_members(organization_id,user_id,role) values(v_org,v_actor,'owner');
  insert into public.organization_legal_entities(id,organization_id,identifier,display_name,completion_status,status,created_by,updated_by)
  values(v_entity,v_org,'test','Graph concurrency fixture','needs_completion','inactive',v_actor,v_actor);
  insert into public.products(organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by)
  values(v_org,v_entity,0,'{}','Graph concurrency fixture','TEST','standalone_software',v_actor,v_actor,v_actor) returning id into v_product;
  insert into public.product_releases(organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,created_by,updated_by)
  values(v_org,v_product,v_entity,0,'{}','Test','1.0.0',v_actor,v_actor) returning id into v_release;
  v_report := jsonb_build_object(
    'status', 'valid',
    'detected', jsonb_build_object('format', 'cyclonedx', 'serialization', 'json', 'specificationVersion', '1.6'),
    'validator', jsonb_build_object('name', 'CRA streaming SBOM normalizer', 'version', 'm3-test', 'schemaAssetSha256', repeat('a', 64)),
    'diagnostics', '[]'::jsonb,
    'errorCount', 0,
    'warningCount', 0,
    'omittedDiagnosticCount', 0,
    'completedAt', '2026-08-24T00:00:00.000Z'
  );

  perform * from public.reserve_sbom_source_atomic(
    v_org, v_product, v_release, v_actor, null, v_source_one, 'manual_upload', v_key_one,
    encode(extensions.digest('normalizer-replay-one', 'sha256'), 'hex'), 'normalizer-replay-one.json', 'application/json', 42,
    v_hash, v_org::text || '/' || v_source_one::text || '/' || v_hash,
    now() + interval '10 minutes', gen_random_uuid()
  );
  select * into v_job_one from public.finalize_sbom_source_atomic(
    v_org, v_source_one, v_actor, null, v_hash, 42, 'application/json', v_key_one, gen_random_uuid()
  );
  update public.sbom_ingest_jobs
     set next_attempt_at = now() + interval '1 day'
   where organization_id = v_org
     and source_id <> v_source_one
     and status in ('queued', 'failed');
  select * into v_claim from public.claim_sbom_ingest_job(v_org, 'normalizer-replay-worker-one', 60);
  if v_claim.outcome <> 'claimed' or (v_claim.work ->> 'sourceId')::uuid <> v_source_one then
    raise exception 'first immutable-hash job was not claimable';
  end if;
  select * into v_begin from public.begin_sbom_document_normalization_atomic(
    v_org, (v_job_one.job ->> 'id')::uuid, 'normalizer-replay-worker-one',
    'CRA streaming SBOM parser', 'm3-test', 'CRA SBOM normalizer', 'm3-03.1',
    'cyclonedx', 'json', '1.6', v_report
  );
  if v_begin.outcome <> 'created' then
    raise exception 'first immutable-hash document was not created: %', v_begin.outcome;
  end if;
  for v_index in 1..113 loop
    v_source:=case when v_index=1 then v_source_one else gen_random_uuid() end;
    if v_index>1 then
      perform * from public.reserve_sbom_source_atomic(v_org,v_product,v_release,v_actor,null,v_source,'manual_upload',gen_random_uuid(),
        encode(extensions.digest('paging-'||v_index,'sha256'),'hex'),'paging-'||v_index||'.json','application/json',42,
        v_hash,v_org::text||'/'||v_source::text||'/'||v_hash,now()+interval '10 minutes',gen_random_uuid());
    end if;
    if v_index<=13 then
      v_request:=case when v_index=1 then v_primary else gen_random_uuid() end;
      v_invitation:=gen_random_uuid();
      insert into public.sbom_supplier_requests(id,organization_id,product_id,release_id,supplier_display_name,allowed_component_ref,
        status,closed_at,closed_by,expires_at,idempotency_key,request_digest,created_by)
      values(v_request,v_org,v_product,v_release,'Supplier '||v_index,'component-'||v_index,
        case when v_index<=8 then 'open' else 'closed' end,case when v_index<=8 then null else now() end,
        case when v_index<=8 then null else v_actor end,now()+interval '1 day',gen_random_uuid(),repeat('a',64),v_actor);
      insert into public.sbom_supplier_invitations(id,organization_id,request_id,token_prefix,token_hash,expires_at,created_by,idempotency_key,request_digest)
      values(v_invitation,v_org,v_primary,'cra_sup_'||substr(replace(gen_random_uuid()::text,'-',''),1,8),
        encode(extensions.digest(v_invitation::text,'sha256'),'hex'),now()+interval '1 day',v_actor,gen_random_uuid(),repeat('b',64));
      insert into public.sbom_supplier_submissions(id,organization_id,request_id,invitation_id,source_id,idempotency_key,request_digest,status)
      values(gen_random_uuid(),v_org,v_primary,v_invitation,v_source,gen_random_uuid(),repeat('c',64),
        case when v_index<=8 then 'pending' else 'processing' end);
    end if;
  end loop;
  insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,created_by,updated_by)
    values(v_secondary_release,v_org,v_product,v_entity,0,'{}','Paging other release','2.0.0',v_actor,v_actor);
  for v_index in 1..13 loop
    v_source:=gen_random_uuid();
    perform * from public.reserve_sbom_source_atomic(v_org,v_product,v_secondary_release,v_actor,null,v_source,'manual_upload',gen_random_uuid(),
      encode(extensions.digest('other-release-paging-'||v_index,'sha256'),'hex'),'other-release-paging-'||v_index||'.json','application/json',42,
      v_hash,v_org::text||'/'||v_source::text||'/'||v_hash,now()+interval '10 minutes',gen_random_uuid());
  end loop;
  set local role service_role;
  foreach v_kind in array array['sources','requests','submissions'] loop
    foreach v_limit in array array[1,10,100] loop
      begin perform pg_temp.assert_sbom_page_walk(v_kind,v_org,v_actor,v_product,v_release,v_limit,null);
      exception when others then v_failures:=array_append(v_failures,sqlerrm); end;
    end loop;
  end loop;
  begin perform pg_temp.assert_sbom_page_walk('requests',v_org,v_actor,v_product,v_release,1,'open'); exception when others then v_failures:=array_append(v_failures,sqlerrm); end;
  begin perform pg_temp.assert_sbom_page_walk('requests',v_org,v_actor,v_product,v_release,10,'closed'); exception when others then v_failures:=array_append(v_failures,sqlerrm); end;
  begin perform pg_temp.assert_sbom_page_walk('submissions',v_org,v_actor,v_product,v_release,1,'pending'); exception when others then v_failures:=array_append(v_failures,sqlerrm); end;
  begin perform pg_temp.assert_sbom_page_walk('submissions',v_org,v_actor,v_product,v_release,10,'processing'); exception when others then v_failures:=array_append(v_failures,sqlerrm); end;
  foreach v_limit in array array[1,10,100] loop
    begin perform pg_temp.assert_sbom_page_walk('sources',v_org,v_actor,v_product,v_secondary_release,v_limit,null);
    exception when others then v_failures:=array_append(v_failures,sqlerrm); end;
  end loop;
  foreach v_bad in array array['bad','2026-09-28T00:00:00Z|not-uuid','2026-09-28T00:00:00Z|'||gen_random_uuid()::text||'|extra','infinity|'||gen_random_uuid()::text] loop
    select * into v_read from public.list_sbom_sources_for_release(v_org,v_actor,v_product,v_release,10,v_bad);
    if v_read.outcome<>'invalid_request' then v_failures:=array_append(v_failures,'Malformed source cursor accepted'); end if;
    select * into v_read from public.list_supplier_sbom_requests(v_org,v_actor,v_product,v_release,null,10,v_bad);
    if v_read.outcome<>'invalid_request' then v_failures:=array_append(v_failures,'Malformed supplier request cursor accepted'); end if;
    select * into v_read from public.list_supplier_sbom_submissions(v_org,v_actor,null,null,10,v_bad);
    if v_read.outcome<>'invalid_request' then v_failures:=array_append(v_failures,'Malformed supplier submission cursor accepted'); end if;
  end loop;
  select * into v_read from public.list_sbom_sources_for_release(gen_random_uuid(),v_actor,v_product,v_release,10,null);
  if v_read.outcome<>'not_found' then raise exception 'Tenant substitution allowed source reads'; end if;
  select * into v_read from public.list_sbom_sources_for_release(v_org,v_actor,v_product,gen_random_uuid(),10,null);
  if v_read.outcome<>'not_found' then raise exception 'Release substitution allowed source reads'; end if;
  select * into v_read from public.list_supplier_sbom_requests(gen_random_uuid(),v_actor,null,null,null,10,null);
  if v_read.outcome<>'not_found' then raise exception 'Tenant substitution allowed supplier reads'; end if;
  select * into v_read from public.list_supplier_sbom_requests(v_org,v_actor,gen_random_uuid(),gen_random_uuid(),null,10,null);
  if v_read.outcome<>'found' or v_read.requests<>'[]'::jsonb then raise exception 'Product/release filter returned foreign supplier requests'; end if;
  select * into v_read from public.list_supplier_sbom_submissions(gen_random_uuid(),v_actor,null,null,10,null);
  if v_read.outcome<>'not_found' then raise exception 'Tenant substitution allowed submission reads'; end if;
  select * into v_read from public.list_supplier_sbom_submissions(v_org,v_actor,gen_random_uuid(),null,10,null);
  if v_read.outcome<>'found' or v_read.submissions<>'[]'::jsonb then raise exception 'Request filter returned foreign submissions'; end if;
  select * into v_read from public.list_supplier_sbom_requests(v_org,v_actor,v_product,v_release,null,100,null);
  if not exists(select 1 from jsonb_array_elements(v_read.requests) r where r->'request'->>'id'=v_primary::text
    and jsonb_array_length(r->'invitations')=13 and jsonb_array_length(r->'submissions')=13) then
    raise exception 'Embedded supplier arrays were truncated';
  end if;
  if cardinality(v_failures)>0 then raise exception 'Pagination failures: %',v_failures; end if;
end $$;
rollback;
