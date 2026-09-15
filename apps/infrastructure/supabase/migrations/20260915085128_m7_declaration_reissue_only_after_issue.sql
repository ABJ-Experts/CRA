-- A product with an issued declaration can only receive a successor through
-- the reissue transaction, which records the immutable supersession link.
create or replace function public.upsert_technical_file_declaration_draft_contract_atomic(
 p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_declaration_id uuid,p_expected_draft_version integer,
 p_signatory_capacity text,p_issue_place text,p_assessment_route text,p_notified_body_identifier text,p_certificate_references jsonb,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare raw record; preview record; declaration_id uuid;
begin
 if p_declaration_id is null and exists (
   select 1 from public.technical_file_declarations d
   where d.organization_id=p_organization_id and d.product_id=p_product_id and d.status='issued'
 ) then
   return query select 'conflict',null::jsonb;
   return;
 end if;
 select * into raw from public.upsert_technical_file_declaration_draft_atomic(p_organization_id,p_actor_user_id,p_product_id,p_snapshot_id,p_declaration_id,p_expected_draft_version,p_signatory_capacity,p_issue_place,p_assessment_route,p_notified_body_identifier,p_certificate_references,p_idempotency_key);
 if raw.outcome not in ('saved','replayed') then return query select raw.outcome,raw.result; return; end if;
 declaration_id:=(raw.result->>'id')::uuid;
 select * into preview from public.get_technical_file_declaration_preview_contract(p_organization_id,p_actor_user_id,p_product_id,p_snapshot_id,p_signatory_capacity,p_issue_place,p_assessment_route,p_notified_body_identifier,p_certificate_references);
 update public.technical_file_declarations set preview_digest=preview.result->>'previewDigest',snapshot_sha256=preview.result->>'snapshotSha256',source_provenance=preview.result->'sourceProvenance',missing_facts=preview.result->'missingFacts',updated_at=clock_timestamp() where organization_id=p_organization_id and id=declaration_id and status='draft';
 return query select raw.outcome,public.m7_declaration_json(p_organization_id,declaration_id);
end $$;

revoke all on function public.upsert_technical_file_declaration_draft_contract_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.upsert_technical_file_declaration_draft_contract_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,jsonb,uuid) to service_role;
alter function public.upsert_technical_file_declaration_draft_contract_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,jsonb,uuid) owner to postgres;
