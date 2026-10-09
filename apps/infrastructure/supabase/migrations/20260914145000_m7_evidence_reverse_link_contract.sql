-- M8-04 consumes only relationship state. Do not disclose product or document
-- metadata from this cross-feature projection.
create or replace function public.get_technical_file_evidence_reverse_links(p_organization_id uuid,p_actor_user_id uuid,p_source_kind text,p_record_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_view_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
  return query select 'found',jsonb_build_object('links',coalesce((select jsonb_agg(jsonb_build_object('technicalFileId',f.id,'sectionId',s.id,'sectionKey',s.section_key,'sourceId',x.id,'sourceFingerprint',x.source_fingerprint,'availability',public.m7_evidence_section_source_state(p_organization_id,f.product_id,x.id)) order by f.id,s.sort_order,x.id) from public.technical_file_section_sources x join public.technical_file_sections s on s.organization_id=x.organization_id and s.id=x.section_id join public.technical_files f on f.organization_id=s.organization_id and f.id=s.technical_file_id where x.organization_id=p_organization_id and x.source_kind=p_source_kind and x.record_id=p_record_id),'[]'::jsonb));
end $$;

revoke all on function public.get_technical_file_evidence_reverse_links(uuid,uuid,text,uuid) from public,anon,authenticated;
alter function public.get_technical_file_evidence_reverse_links(uuid,uuid,text,uuid) owner to postgres;
grant execute on function public.get_technical_file_evidence_reverse_links(uuid,uuid,text,uuid) to service_role;
notify pgrst, 'reload schema';
