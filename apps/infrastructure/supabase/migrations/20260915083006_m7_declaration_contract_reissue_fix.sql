-- Correct the wrapper's call order to the established reissue RPC.  Kept
-- separate because the prior alignment migration may already exist locally.
create or replace function public.reissue_technical_file_declaration_contract_atomic(
 p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_current_declaration_id uuid,p_snapshot_id uuid,p_expected_declaration_version integer,
 p_signatory_capacity text,p_issue_place text,p_assessment_route text,p_notified_body_identifier text,p_certificate_references jsonb,p_reason text,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare raw record; preview record; declaration_id uuid;
begin
 select * into raw from public.reissue_technical_file_declaration_atomic(
   p_organization_id,p_actor_user_id,p_product_id,p_current_declaration_id,
   p_expected_declaration_version,p_snapshot_id,p_reason,p_signatory_capacity,
   p_issue_place,p_assessment_route,p_notified_body_identifier,p_certificate_references,p_idempotency_key
 );
 if raw.outcome not in ('created','replayed') then return query select raw.outcome,raw.result; return; end if;
 declaration_id:=(raw.result->>'id')::uuid;
 select * into preview from public.get_technical_file_declaration_preview_contract(
   p_organization_id,p_actor_user_id,p_product_id,p_snapshot_id,p_signatory_capacity,
   p_issue_place,p_assessment_route,p_notified_body_identifier,p_certificate_references
 );
 update public.technical_file_declarations
    set preview_digest=preview.result->>'previewDigest',
        snapshot_sha256=preview.result->>'snapshotSha256',
        source_provenance=preview.result->'sourceProvenance',
        missing_facts=preview.result->'missingFacts',updated_at=clock_timestamp()
  where organization_id=p_organization_id and id=declaration_id and status='draft';
 return query select raw.outcome,public.m7_declaration_json(p_organization_id,declaration_id);
end $$;

revoke all on function public.reissue_technical_file_declaration_contract_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.reissue_technical_file_declaration_contract_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,jsonb,text,uuid) to service_role;
alter function public.reissue_technical_file_declaration_contract_atomic(uuid,uuid,uuid,uuid,uuid,integer,text,text,text,text,jsonb,text,uuid) owner to postgres;
