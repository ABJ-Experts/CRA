-- Source-owned positive technical-file workflows, entirely rolled back.
begin;
set local statement_timeout='30s';
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
do $$ declare o uuid;u uuid;p uuid;sn uuid;k text;ver integer;r record;export_id uuid:=gen_random_uuid();begin
 select f.organization_id,m.user_id,f.product_id,s.id into strict o,u,p,sn from public.technical_files f join public.organization_members m on m.organization_id=f.organization_id and m.role='owner' join public.technical_file_snapshots s on s.organization_id=f.organization_id and s.product_id=f.product_id where f.status='active' order by s.created_at desc limit 1;
 select * into r from public.get_technical_file(o,u,p);
 perform pg_temp.assert_export_parity(o,u,'technical_file.sections','{}',jsonb_build_object('productId',p),r.result#>'{technicalFile,sections}');
 select s.section_key,s.version into strict k,ver from public.technical_file_sections s join public.technical_files f on f.organization_id=s.organization_id and f.id=s.technical_file_id join public.technical_file_templates t on t.template_key=f.template_key and t.template_version=f.template_version and t.section_key=s.section_key where f.organization_id=o and f.product_id=p and 'manual_reference'=any(t.allowed_source_kinds) limit 1;
 select * into r from public.add_technical_file_section_source_atomic(o,u,p,k,ver,'manual_reference',null,'Authorized manual Ω','=0001','M14 fixture issuer','https://example.test/fixture','Explicit source fixture',gen_random_uuid());
 if r.outcome<>'created' then raise exception 'source native fixture: %',r.outcome;end if;
 select * into r from public.get_technical_file_section(o,u,p,k);
 perform pg_temp.assert_export_parity(o,u,'technical_file.section_sources','{}',jsonb_build_object('productId',p,'sectionKey',k),r.result#>'{section,sources}');
 update public.technical_file_sections s set narrative=null,applicability='applicable',non_applicability_reason=null from public.technical_files f where f.organization_id=o and f.product_id=p and s.organization_id=f.organization_id and s.technical_file_id=f.id;
 select * into r from public.get_technical_file_readiness(o,u,p);
 perform pg_temp.assert_export_parity(o,u,'technical_file.readiness_gaps','{}',jsonb_build_object('productId',p),r.result#>'{readiness,gaps}');
 select * into r from public.get_technical_file_snapshots(o,u,p);
 perform pg_temp.assert_export_parity(o,u,'technical_file.snapshots','{}',jsonb_build_object('productId',p),r.result->'snapshots');
 select * into r from public.upsert_technical_file_declaration_draft_atomic(o,u,p,sn,null,1,'Manufacturer representative','Berlin Ω','internal_control',null,'[]',gen_random_uuid());
 if r.outcome not in ('saved','drafted','created','updated','blocked') then raise exception 'declaration native fixture: %',r.outcome;end if;
 select * into r from public.get_technical_file_declarations(o,u,p);
 perform pg_temp.assert_export_parity(o,u,'technical_file.declarations','{}',jsonb_build_object('productId',p),r.result->'declarations');
 -- Metadata-only rollback fixture for the already frozen snapshot's ready artifact.
 insert into public.technical_file_snapshot_exports(id,organization_id,snapshot_id,requested_by,idempotency_key,payload_digest,status,pdf_object_path,pdf_sha256,pdf_bytes,archive_object_path,archive_sha256,archive_bytes,manifest_object_path,manifest_sha256,manifest_bytes,completed_at)
 values(export_id,o,sn,u,gen_random_uuid(),repeat('a',64),'ready','m14/fixture.pdf',repeat('b',64),8,'m14/fixture.zip',repeat('c',64),8,'m14/fixture.json',repeat('d',64),8,clock_timestamp());
 select * into r from public.get_technical_file_snapshot_export(o,u,p,sn,export_id);
 perform pg_temp.assert_export_parity(o,u,'technical_file.snapshot_exports','{}',jsonb_build_object('productId',p,'snapshotId',sn,'exportId',export_id),jsonb_build_array(r.result->'export'));
 select * into r from public.create_technical_file_auditor_snapshot_grant_atomic(o,u,p,sn,export_id,gen_random_uuid(),'m14-auditor@example.test','Fixture Ω','Readiness export fixture',clock_timestamp()+interval '1 day',encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex'),gen_random_uuid(),repeat('f',64));
 if r.outcome<>'created' then raise exception 'grant native fixture: %',r.outcome;end if;
 select * into r from public.list_technical_file_auditor_snapshot_grants(o,u,p,sn);
 perform pg_temp.assert_export_parity(o,u,'technical_file.auditor_grants','{}',jsonb_build_object('productId',p,'snapshotId',sn),r.result->'grants');
 raise notice 'M14 technical-file positive parity: sections, source links, canonical gaps, snapshots, declarations, selected export, grants';
end $$;
rollback;
