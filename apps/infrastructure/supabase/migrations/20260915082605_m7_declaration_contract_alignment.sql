-- M7-05 contract alignment.  The original lifecycle RPCs remain the durable
-- transaction boundary; these projections make their wire representation
-- match the feature-first Zod contracts without relaxing issued immutability.

create or replace function public.m7_declaration_template_contract(p_template_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
   'id',t.id,
   'key',t.template_key,
   'version',t.template_version,
   'legalAct',t.regulation_reference,
   'annex','Annex V',
   'language','en',
   'mandatoryContentKeys',t.mandatory_field_keys,
   'isActive',true,
   'createdAt',to_char(t.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 ) from public.technical_file_declaration_templates t where t.id=p_template_id
$$;

create or replace function public.m7_declaration_missing_facts_contract(p_missing jsonb)
returns jsonb language sql immutable security definer set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(
   case when jsonb_typeof(value)='object' then value else jsonb_build_object(
     'key',value #>> '{}',
     'label',case value #>> '{}'
       when 'technicalFileReadiness' then 'Technical-file readiness'
       when 'productIdentity' then 'Product identity'
       when 'manufacturer' then 'Manufacturer identity'
       when 'signatory' then 'Responsible signatory'
       when 'assessmentRoute' then 'Assessment route'
       when 'notifiedBodyCertificate' then 'Notified body and certificate'
       else 'Declaration fact' end,
     'reason',case value #>> '{}'
       when 'technicalFileReadiness' then 'The selected immutable snapshot is not complete and current.'
       when 'productIdentity' then 'Approved product identity facts are incomplete.'
       when 'manufacturer' then 'Approved manufacturer legal-entity facts are incomplete.'
       when 'signatory' then 'The responsible signatory capacity and place of issue are required.'
       when 'assessmentRoute' then 'The selected assessment-route fields are inconsistent.'
       when 'notifiedBodyCertificate' then 'This route requires a notified-body identifier and certificate evidence.'
       else 'A required declaration fact is unavailable.' end
   ) end order by ordinal), '[]'::jsonb)
 from jsonb_array_elements(coalesce(p_missing,'[]'::jsonb)) with ordinality as e(value,ordinal)
$$;

create or replace function public.m7_declaration_json(p_organization_id uuid,p_declaration_id uuid,p_include_payload boolean default false)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
   'id',d.id,'organizationId',d.organization_id,'productId',d.product_id,
   'snapshotId',d.snapshot_id,'templateId',d.template_id,
   'version',d.declaration_version,'draftVersion',d.draft_version,
   'status',case when d.status in ('issued','superseded') then d.status else 'draft' end,
   'signatory',jsonb_build_object('userId',d.signatory_user_id,'name',d.signatory_name,'capacity',d.signatory_capacity,'place',d.issue_place),
   'assessmentRoute',d.assessment_route,
   'notifiedBody',case when d.notified_body_identifier is null then null else jsonb_build_object('identifier',d.notified_body_identifier) end,
   'certificateReferences',d.certificate_references,
   'sourceProvenance',case when jsonb_typeof(d.source_provenance)='array' then d.source_provenance else '[]'::jsonb end,
   'missingFacts',public.m7_declaration_missing_facts_contract(d.missing_facts),
   'previewDigest',coalesce(d.preview_digest,repeat('0',64)),
   'snapshotSha256',coalesce(d.snapshot_sha256,s.payload_sha256),
   'issuedPayload',case when d.status in ('issued','superseded') then jsonb_build_object(
     'schemaVersion','m7_05_v1','declarationVersion',d.declaration_version,
     'template',public.m7_declaration_template_contract(d.template_id),
     'snapshotId',d.snapshot_id,'snapshotSha256',d.snapshot_sha256,
     'signatory',jsonb_build_object('userId',d.signatory_user_id,'name',d.signatory_name,'capacity',d.signatory_capacity,'place',d.issue_place),
     'assessmentRoute',d.assessment_route,
     'notifiedBody',case when d.notified_body_identifier is null then null else jsonb_build_object('identifier',d.notified_body_identifier) end,
     'certificateReferences',d.certificate_references,
     'sourceProvenance',case when jsonb_array_length(coalesce(d.source_provenance,'[]'::jsonb))>0 then d.source_provenance else jsonb_build_array(jsonb_build_object('key','snapshot','label','Immutable technical-file snapshot','sourceKind','snapshot','sourceId',d.snapshot_id,'observedRevision',d.snapshot_sha256,'value',d.snapshot_sha256,'status','current')) end,
     'issuedAt',to_char(d.issued_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
     'signatureNotice','This declaration identifies a responsible signatory and is not a cryptographic or qualified electronic signature.'
   ) else null end,
   'issuedArtifact',case when d.status in ('issued','superseded') then jsonb_build_object('fileName','eu-declaration-of-conformity-v'||d.declaration_version||'.pdf','mimeType','application/pdf','byteLength',d.pdf_bytes,'sha256',d.pdf_sha256) else null end,
   'issuedAt',case when d.issued_at is null then null else to_char(d.issued_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
   'supersededByDeclarationId',d.superseded_by_declaration_id,'supersedesDeclarationId',d.supersedes_declaration_id,'reissueReason',d.reissue_reason,
   'createdAt',to_char(d.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updatedAt',to_char(d.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 )
 from public.technical_file_declarations d
 join public.technical_file_snapshots s on s.organization_id=d.organization_id and s.id=d.snapshot_id
 where d.organization_id=p_organization_id and d.id=p_declaration_id
$$;

create or replace function public.get_technical_file_declaration_preview_contract(
 p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,
 p_signatory_capacity text default '',p_issue_place text default '',p_assessment_route text default null,
 p_notified_body_identifier text default null,p_certificate_references jsonb default '[]'::jsonb
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare raw record; s public.technical_file_snapshots%rowtype; u public.users%rowtype; t public.technical_file_declaration_templates%rowtype; missing jsonb; provenance jsonb;
begin
 select * into raw from public.get_technical_file_declaration_preview(p_organization_id,p_actor_user_id,p_product_id,p_snapshot_id,p_signatory_capacity,p_issue_place,p_assessment_route,p_notified_body_identifier,p_certificate_references);
 if raw.outcome in ('not_found','forbidden') then return query select raw.outcome,null::jsonb; return; end if;
 select * into s from public.technical_file_snapshots where organization_id=p_organization_id and id=p_snapshot_id and product_id=p_product_id;
 select * into u from public.users where id=p_actor_user_id and is_active;
 select * into t from public.technical_file_declaration_templates where template_key='cra-annex-v-eu-declaration-of-conformity' and template_version='2024-11-20';
 if not found or s.id is null or u.id is null then return query select 'not_found',null::jsonb; return; end if;
 missing:=public.m7_declaration_missing_facts_contract(coalesce(raw.result->'missingFacts','[]'::jsonb));
 provenance:=jsonb_build_array(
   jsonb_build_object('key','snapshot','label','Immutable technical-file snapshot','sourceKind','snapshot','sourceId',s.id,'observedRevision',s.payload_sha256,'value',s.payload_sha256,'status',case when s.readiness_status='complete' then 'current' else 'stale' end),
   jsonb_build_object('key','product','label','Approved product record','sourceKind','product','sourceId',p_product_id,'observedRevision',null,'value',null,'status','current')
 );
 return query select 'found',jsonb_build_object(
   'template',public.m7_declaration_template_contract(t.id),'snapshotId',s.id,'snapshotSha256',s.payload_sha256,
   'expectedVersion',(select coalesce(max(d.draft_version),0)+1 from public.technical_file_declarations d where d.organization_id=p_organization_id and d.product_id=p_product_id and d.status='draft'),
   'signatory',jsonb_build_object('userId',u.id,'name',coalesce(nullif(btrim(concat_ws(' ',u.first_name,u.last_name)),''),u.email)),
   'assessmentRoute',p_assessment_route,'notifiedBody',case when p_notified_body_identifier is null then null else jsonb_build_object('identifier',p_notified_body_identifier) end,
   'certificateReferences',coalesce(p_certificate_references,'[]'::jsonb),'sourceProvenance',provenance,'missingFacts',missing,
   'readinessStatus',s.readiness_status,'canIssue',raw.outcome='ready','previewDigest',raw.result->>'previewDigest'
 );
end $$;

create or replace function public.upsert_technical_file_declaration_draft_contract_atomic(
 p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_declaration_id uuid,p_expected_draft_version integer,
 p_signatory_capacity text,p_issue_place text,p_assessment_route text,p_notified_body_identifier text,p_certificate_references jsonb,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare raw record; preview record; declaration_id uuid;
begin
 select * into raw from public.upsert_technical_file_declaration_draft_atomic(p_organization_id,p_actor_user_id,p_product_id,p_snapshot_id,p_declaration_id,p_expected_draft_version,p_signatory_capacity,p_issue_place,p_assessment_route,p_notified_body_identifier,p_certificate_references,p_idempotency_key);
 if raw.outcome not in ('saved','replayed') then return query select raw.outcome,raw.result; return; end if;
 declaration_id:=(raw.result->>'id')::uuid;
 select * into preview from public.get_technical_file_declaration_preview_contract(p_organization_id,p_actor_user_id,p_product_id,p_snapshot_id,p_signatory_capacity,p_issue_place,p_assessment_route,p_notified_body_identifier,p_certificate_references);
 update public.technical_file_declarations set preview_digest=preview.result->>'previewDigest',snapshot_sha256=preview.result->>'snapshotSha256',source_provenance=preview.result->'sourceProvenance',missing_facts=preview.result->'missingFacts',updated_at=clock_timestamp() where organization_id=p_organization_id and id=declaration_id and status='draft';
 return query select raw.outcome,public.m7_declaration_json(p_organization_id,declaration_id);
end $$;

create or replace function public.reissue_technical_file_declaration_contract_atomic(
 p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_current_declaration_id uuid,p_snapshot_id uuid,p_expected_declaration_version integer,
 p_signatory_capacity text,p_issue_place text,p_assessment_route text,p_notified_body_identifier text,p_certificate_references jsonb,p_reason text,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare raw record; preview record; declaration_id uuid;
begin
 select * into raw from public.reissue_technical_file_declaration_atomic(p_organization_id,p_actor_user_id,p_product_id,p_current_declaration_id,p_expected_declaration_version,p_snapshot_id,p_reason,p_signatory_capacity,p_issue_place,p_assessment_route,p_notified_body_identifier,p_certificate_references,p_idempotency_key);
 if raw.outcome not in ('created','replayed') then return query select raw.outcome,raw.result; return; end if;
 declaration_id:=(raw.result->>'id')::uuid;
 select * into preview from public.get_technical_file_declaration_preview_contract(p_organization_id,p_actor_user_id,p_product_id,p_snapshot_id,p_signatory_capacity,p_issue_place,p_assessment_route,p_notified_body_identifier,p_certificate_references);
 update public.technical_file_declarations set preview_digest=preview.result->>'previewDigest',snapshot_sha256=preview.result->>'snapshotSha256',source_provenance=preview.result->'sourceProvenance',missing_facts=preview.result->'missingFacts',updated_at=clock_timestamp() where organization_id=p_organization_id and id=declaration_id and status='draft';
 return query select raw.outcome,public.m7_declaration_json(p_organization_id,declaration_id);
end $$;

revoke all on function public.m7_declaration_template_contract(uuid),public.m7_declaration_missing_facts_contract(jsonb),public.get_technical_file_declaration_preview_contract(uuid,uuid,uuid,uuid,text,text,text,text,jsonb),public.upsert_technical_file_declaration_draft_contract_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,jsonb,uuid),public.reissue_technical_file_declaration_contract_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.get_technical_file_declaration_preview_contract(uuid,uuid,uuid,uuid,text,text,text,text,jsonb),public.upsert_technical_file_declaration_draft_contract_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,jsonb,uuid),public.reissue_technical_file_declaration_contract_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,jsonb,text,uuid) to service_role;
alter function public.m7_declaration_template_contract(uuid) owner to postgres;
alter function public.m7_declaration_missing_facts_contract(jsonb) owner to postgres;
alter function public.get_technical_file_declaration_preview_contract(uuid,uuid,uuid,uuid,text,text,text,text,jsonb) owner to postgres;
alter function public.upsert_technical_file_declaration_draft_contract_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,jsonb,uuid) owner to postgres;
alter function public.reissue_technical_file_declaration_contract_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,jsonb,text,uuid) owner to postgres;
