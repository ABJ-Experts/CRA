-- Isolated transaction; existing source records are never modified.
begin;
set local statement_timeout = '30s';
do $$
begin
  if to_regprocedure('public.m14_03_additional_source_rows(uuid,uuid,text,jsonb,jsonb)') is null then
    raise exception 'M14 SBOM and portal source adapter is missing';
  end if;
  if has_function_privilege('authenticated', 'public.m14_03_additional_source_rows(uuid,uuid,text,jsonb,jsonb)', 'execute') then
    raise exception 'Browser role can call the private export source adapter';
  end if;
end
$$;
rollback;

begin;
set local statement_timeout='30s';
do $$
declare v_org uuid:=gen_random_uuid();v_actor uuid;v_legal uuid:=gen_random_uuid();v_product uuid:=gen_random_uuid();v_release uuid:=gen_random_uuid();v_source uuid;v_count integer;v_native jsonb;v_export jsonb;v_cursor text;v_read record;v_rows jsonb:='[]';v_other uuid:=gen_random_uuid();
begin
 select id into strict v_actor from public.users where email='owner@cra.test';
 insert into public.organizations(id,name,slug) values(v_org,'M14 SBOM rollback fixture','m14-sbom-'||v_org::text);
 insert into public.organization_members(organization_id,user_id,role) values(v_org,v_actor,'owner');
 insert into public.organization_legal_entities(id,organization_id,identifier,display_name,completion_status,status,created_by,updated_by) values(v_legal,v_org,'test','M14 SBOM fixture','needs_completion','inactive',v_actor,v_actor);
 insert into public.products(id,organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,responsible_owner_id,created_by,updated_by) values(v_product,v_org,v_legal,0,'{}','M14 SBOM','M14-SBOM','standalone_software',v_actor,v_actor,v_actor);
 insert into public.product_releases(id,organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,created_by,updated_by) values(v_release,v_org,v_product,v_legal,0,'{}','M14 release','1.0.0',v_actor,v_actor);
 for v_count in 1..115 loop
  v_source:=gen_random_uuid();
  insert into public.sbom_sources(id,organization_id,product_id,release_id,actor_user_id,source_kind,idempotency_key,request_digest,original_filename,declared_media_type,declared_byte_size,declared_sha256,staging_storage_key,status,upload_expires_at,correlation_id,created_at)
  values(v_source,v_org,v_product,v_release,v_actor,'manual_upload',gen_random_uuid(),repeat('a',64),'source-'||v_count||'.json','application/json',20,repeat('a',64),v_org||'/'||v_source||'/'||repeat('a',64),'upload_pending',clock_timestamp()+interval '1 hour',gen_random_uuid(),'2026-10-09T00:00:00Z');
 end loop;
 select count(*) into v_count from public.m14_03_additional_source_rows(v_org,v_actor,'sboms.source_history','{}',jsonb_build_object('productId',v_product,'releaseId',v_release));
 if v_count<>115 then raise exception 'SBOM all-filtered export dropped second page: %',v_count;end if;
 loop
  select * into v_read from public.list_sbom_sources_for_release(v_org,v_actor,v_product,v_release,100,v_cursor);
  v_rows:=v_rows||v_read.sources;v_cursor:=v_read.next_cursor;exit when v_cursor is null;
 end loop;
 select jsonb_agg(item->'source'->>'id' order by n) into v_native from jsonb_array_elements(v_rows) with ordinality x(item,n);
 select jsonb_agg(source_id order by n) into v_export from public.m14_03_additional_source_rows(v_org,v_actor,'sboms.source_history','{}',jsonb_build_object('productId',v_product,'releaseId',v_release)) with ordinality x(source_id,source_version,product_id,row_values,n);
 if v_native<>v_export then raise exception 'SBOM list ordering diverges';end if;
 if exists(select 1 from public.m14_03_additional_source_rows(v_org,v_actor,'sboms.source_history','{}',jsonb_build_object('productId',v_product,'releaseId',v_release)) x where x.product_id<>v_product or x.row_values ? 'stagingStorageKey' or x.row_values ? 'sha256') then raise exception 'SBOM export projection leaked hidden columns or product scope';end if;
 begin perform * from public.m14_03_additional_source_rows(v_other,v_actor,'sboms.source_history','{}',jsonb_build_object('productId',v_product,'releaseId',v_release));raise exception 'forged tenant accepted';exception when insufficient_privilege then null;end;
 if exists(select 1 from public.m14_03_additional_source_rows(v_org,v_actor,'sboms.ci_credentials','{}','{}')) then raise exception 'empty credentials not empty';end if;
 update public.organization_members set role='admin' where organization_id=v_org and user_id=v_actor;
 begin perform * from public.m14_03_additional_source_rows(v_org,v_actor,'sboms.ci_credentials','{}','{}');raise exception 'nonowner exported credentials';exception when insufficient_privilege then null;end;
end $$;
rollback;
