-- A historical KEV alert can remain in the ledger after a release falls back
-- to a non-triggering lifecycle (for example through fixture import or an
-- interrupted local reconciliation). The ledger stays auditable, but the
-- prominent response alert list must never imitate an in-support legal trigger
-- when the current release lifecycle is development/end-of-support/withdrawn.
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
  alerts jsonb;
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

  with eligible_releases as (
    select distinct item -> 'finding' ->> 'releaseId' as release_id
    from jsonb_array_elements(rows) item
    where item #>> '{release,lifecycleState}' in ('placed_on_market', 'in_support')
  )
  select coalesce(jsonb_agg(alert.value order by alert.ordinality), '[]'::jsonb)
  into alerts
  from jsonb_array_elements(raw.result -> 'alerts') with ordinality alert(value, ordinality)
  where alert.value ->> 'status' <> 'resolved'
    and exists (
      select 1 from eligible_releases
      where eligible_releases.release_id = alert.value ->> 'releaseId'
    );

  return query select 'found'::text,
    jsonb_set(jsonb_set(raw.result, '{rows}', rows), '{alerts}', alerts);
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
