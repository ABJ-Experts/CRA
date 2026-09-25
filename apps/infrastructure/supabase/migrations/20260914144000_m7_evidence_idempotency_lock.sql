-- Serialize a command key before the audit-ledger replay lookup. The prior
-- implementation is retained as the inward implementation to avoid changing
-- command behavior or its result contract.
alter function public.mark_technical_file_section_source_material_change_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,text,uuid)
  rename to m7_mark_technical_file_section_source_material_change_impl;
alter function public.review_technical_file_section_source_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,uuid)
  rename to m7_review_technical_file_section_source_impl;

create function public.mark_technical_file_section_source_material_change_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_section_key text,p_source_id uuid,p_expected_version integer,p_reason text,p_current_observed_revision text,p_current_fingerprint text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_idempotency_key is not null then perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0)); end if;
  return query select * from public.m7_mark_technical_file_section_source_material_change_impl(p_organization_id,p_actor_user_id,p_product_id,p_section_key,p_source_id,p_expected_version,p_reason,p_current_observed_revision,p_current_fingerprint,p_idempotency_key);
end $$;

create function public.review_technical_file_section_source_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_section_key text,p_source_id uuid,p_expected_version integer,p_decision text,p_rationale text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_idempotency_key is not null then perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0)); end if;
  return query select * from public.m7_review_technical_file_section_source_impl(p_organization_id,p_actor_user_id,p_product_id,p_section_key,p_source_id,p_expected_version,p_decision,p_rationale,p_idempotency_key);
end $$;

revoke all on function public.mark_technical_file_section_source_material_change_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,text,uuid),public.review_technical_file_section_source_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,uuid),public.m7_mark_technical_file_section_source_material_change_impl(uuid,uuid,uuid,text,uuid,integer,text,text,text,uuid),public.m7_review_technical_file_section_source_impl(uuid,uuid,uuid,text,uuid,integer,text,text,uuid) from public,anon,authenticated;
alter function public.mark_technical_file_section_source_material_change_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,text,uuid) owner to postgres;
alter function public.review_technical_file_section_source_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,uuid) owner to postgres;
grant execute on function public.mark_technical_file_section_source_material_change_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,text,uuid),public.review_technical_file_section_source_atomic(uuid,uuid,uuid,text,uuid,integer,text,text,uuid) to service_role;
notify pgrst, 'reload schema';
