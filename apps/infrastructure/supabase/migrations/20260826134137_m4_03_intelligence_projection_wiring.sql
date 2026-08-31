-- Keep the previous contract envelope as a private baseline and replace only
-- its derived intelligence with the authoritative immutable-source projection.
alter function public.list_vulnerability_enriched_findings_for_document_page(uuid,uuid,uuid,boolean,integer,integer,text)
  rename to list_vulnerability_enriched_findings_for_document_page_baseline;

create or replace function public.m4_03_intelligence_with_provenance_json(p_vulnerability_id uuid,p_assessed_at timestamptz)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with base as (select public.m4_03_intelligence_json(p_vulnerability_id,p_assessed_at) j),
 aliases as (select jsonb_agg(jsonb_build_object('value',a.alias,'provenance',jsonb_build_object('sourceFeed',r.feed_key,'sourceRecordId',r.id,'sourceRecordVersionId',v.id,'observedAt',coalesce(r.source_updated_at,v.source_updated_at),'retrievedAt',v.promoted_at)) order by a.alias,a.source_record_version_id) j
  from public.vulnerability_aliases a join public.vulnerability_source_record_versions v on v.id=a.source_record_version_id join public.vulnerability_source_records r on r.id=v.source_record_id and r.current_version_id=v.id where a.vulnerability_id=p_vulnerability_id),
 refs as (select jsonb_agg(jsonb_build_object('url',x.reference_url,'provenance',jsonb_build_object('sourceFeed',r.feed_key,'sourceRecordId',r.id,'sourceRecordVersionId',v.id,'observedAt',coalesce(r.source_updated_at,v.source_updated_at),'retrievedAt',v.promoted_at)) order by x.reference_url,x.source_record_version_id) j
  from public.vulnerability_references x join public.vulnerability_source_record_versions v on v.id=x.source_record_version_id join public.vulnerability_source_records r on r.id=v.source_record_id and r.current_version_id=v.id where x.vulnerability_id=p_vulnerability_id)
 select base.j || jsonb_build_object('aliases',coalesce(aliases.j,'[]'::jsonb),'references',coalesce(refs.j,'[]'::jsonb)) from base,aliases,refs;
$$;

create or replace function public.list_vulnerability_enriched_findings_for_document_page(
  p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid,p_include_low_confidence boolean,
  p_page integer default 1,p_page_size integer default 50,p_q text default null
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare raw record; v_rows jsonb;
begin
 select * into raw from public.list_vulnerability_enriched_findings_for_document_page_baseline(p_organization_id,p_actor_user_id,p_document_id,p_include_low_confidence,p_page,p_page_size,p_q);
 if raw.outcome <> 'found' then return query select raw.outcome,raw.result;return;end if;
 select coalesce(jsonb_agg(row_item || jsonb_build_object('intelligence',public.m4_03_intelligence_with_provenance_json((select vulnerability_id from public.vulnerability_findings where id=(row_item->'finding'->>'id')::uuid),coalesce((row_item->'finding'->>'lastEvaluatedAt')::timestamptz,clock_timestamp())))),'[]'::jsonb) into v_rows
 from jsonb_array_elements(raw.result->'rows') row_item;
 return query select 'found'::text,jsonb_set(raw.result,'{rows}',v_rows);
end;$$;

alter function public.m4_03_intelligence_with_provenance_json(uuid,timestamptz) owner to postgres;
alter function public.list_vulnerability_enriched_findings_for_document_page_baseline(uuid,uuid,uuid,boolean,integer,integer,text) owner to postgres;
alter function public.list_vulnerability_enriched_findings_for_document_page(uuid,uuid,uuid,boolean,integer,integer,text) owner to postgres;
revoke all on function public.m4_03_intelligence_with_provenance_json(uuid,timestamptz),public.list_vulnerability_enriched_findings_for_document_page_baseline(uuid,uuid,uuid,boolean,integer,integer,text),public.list_vulnerability_enriched_findings_for_document_page(uuid,uuid,uuid,boolean,integer,integer,text) from public,anon,authenticated;
grant execute on function public.list_vulnerability_enriched_findings_for_document_page(uuid,uuid,uuid,boolean,integer,integer,text) to service_role;
