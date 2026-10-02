-- Preserve the KEV observation emitted by the original list projection while
-- replacing the other derived intelligence from immutable source versions.
-- The previous wrapper first replaced KEV with its temporary absent baseline,
-- then preserved that replacement instead of the authoritative observation.
create or replace function public.list_vulnerability_enriched_findings_for_document_page(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_document_id uuid,
  p_include_low_confidence boolean,
  p_page integer default 1,
  p_page_size integer default 50,
  p_q text default null
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  raw record;
  rows jsonb;
begin
  select * into raw from public.list_vulnerability_enriched_findings_for_document_page_baseline(
    p_organization_id, p_actor_user_id, p_document_id, p_include_low_confidence,
    p_page, p_page_size, p_q
  );
  if raw.outcome <> 'found' then
    return query select raw.outcome, raw.result;
    return;
  end if;

  select coalesce(jsonb_agg(
    item || jsonb_build_object(
      'intelligence',
      public.m4_03_intelligence_with_provenance_json(
        (select vulnerability_id from public.vulnerability_findings
          where id = (item -> 'finding' ->> 'id')::uuid),
        (item -> 'finding' ->> 'lastEvaluatedAt')::timestamptz
      ) || jsonb_build_object('kev', item -> 'intelligence' -> 'kev')
    )
  ), '[]'::jsonb)
  into rows
  from jsonb_array_elements(raw.result -> 'rows') item;

  return query select 'found'::text, jsonb_set(raw.result, '{rows}', rows);
end;
$$;

alter function public.list_vulnerability_enriched_findings_for_document_page(
  uuid, uuid, uuid, boolean, integer, integer, text
) owner to postgres;
revoke all on function public.list_vulnerability_enriched_findings_for_document_page(
  uuid, uuid, uuid, boolean, integer, integer, text
) from public, anon, authenticated;
grant execute on function public.list_vulnerability_enriched_findings_for_document_page(
  uuid, uuid, uuid, boolean, integer, integer, text
) to service_role;
