-- Feed epochs are independent: lexicographic ordering can hide unfinished
-- incomparable snapshots. All active work blocks readiness; failed work is
-- superseded only by a completed component-wise dominating (or equal) vector.
-- No immutable historical report, job or finding is rewritten. The existing
-- match-job schema has no matcher-engine-version field; no version is invented.
-- Exact-source live finding projection; existing history and M5 readiness facts are retained.
create or replace function public.get_sbom_diff_findings(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_report_id uuid,
  p_limit integer,
  p_cursor text
) returns table(outcome text, result jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_report public.sbom_diff_reports%rowtype;
  v_cursor uuid;
  v_rows jsonb;
begin
  if p_limit not between 1 and 100
     or p_cursor is not null and char_length(p_cursor) > 512
     or not public.sbom_actor_can_view(p_organization_id, p_actor_user_id)
     or not public.m5_triage_actor_has_permission(p_organization_id, p_actor_user_id, 'can_view_findings') then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;
  if p_cursor is not null then
    begin v_cursor := p_cursor::uuid;
    exception when invalid_text_representation then
      return query select 'not_found'::text, null::jsonb;
      return;
    end;
  end if;
  select * into v_report from public.sbom_diff_reports reports
  where reports.organization_id = p_organization_id and reports.id = p_report_id;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  -- A canonical document can be shared by aliases in other releases. The
  -- compared source pair, not the document hash, authorizes the release scope.
  if not exists(select 1 from public.sbom_sources current_source
    join public.sbom_sources baseline_source on baseline_source.organization_id=current_source.organization_id
      and baseline_source.id=v_report.baseline_source_id
    join public.product_releases release on release.organization_id=current_source.organization_id
      and release.id=v_report.release_id and release.product_id=current_source.product_id
    where current_source.organization_id=p_organization_id and current_source.id=v_report.source_id
      and current_source.release_id=v_report.release_id and baseline_source.release_id=v_report.release_id
      and baseline_source.product_id=current_source.product_id) then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  -- This is a live advisory reevaluation, never a fabricated historical finding
  -- snapshot. Missing, failed or in-flight matching is visibly unavailable.
  if v_report.state <> 'completed' or exists(
    select 1 from (values(v_report.document_id),(v_report.baseline_document_id)) sides(document_id)
    where not exists(select 1 from public.vulnerability_match_jobs completed
      where completed.organization_id=p_organization_id and completed.document_id=sides.document_id
        and completed.release_id=v_report.release_id and completed.status='completed')
    or exists(select 1 from public.vulnerability_match_jobs active
      where active.organization_id=p_organization_id and active.document_id=sides.document_id
        and active.release_id=v_report.release_id and active.status in ('queued','leased','retrying'))
    or exists(select 1 from public.vulnerability_match_jobs failed
      where failed.organization_id=p_organization_id and failed.document_id=sides.document_id
        and failed.release_id=v_report.release_id and failed.status='dead_letter'
        and not exists(select 1 from public.vulnerability_match_jobs completed
          where completed.organization_id=failed.organization_id and completed.document_id=failed.document_id
            and completed.release_id=failed.release_id and completed.status='completed'
            and completed.osv_promotion_sequence >= failed.osv_promotion_sequence
            and completed.nvd_promotion_sequence >= failed.nvd_promotion_sequence
            and completed.vendor_csaf_promotion_sequence >= failed.vendor_csaf_promotion_sequence))
  ) then
    return query select 'found'::text,jsonb_build_object('state','partial_integration_unavailable','items','[]'::jsonb,'nextCursor',null); return;
  end if;

  with scoped as (
    select findings.id,
      bool_or(occurrences.document_id = v_report.document_id) as in_current,
      bool_or(occurrences.document_id = v_report.baseline_document_id) as in_baseline
    from public.vulnerability_findings findings
    join public.vulnerability_finding_component_occurrences links
      on links.finding_id = findings.id and links.organization_id = findings.organization_id
      and links.state = 'active'
    join public.vulnerability_component_occurrences occurrences
      on occurrences.id = links.occurrence_id and occurrences.organization_id = p_organization_id
    where findings.organization_id = p_organization_id and findings.status = 'active'
      and findings.release_id = v_report.release_id and occurrences.release_id = v_report.release_id
      and occurrences.document_id in (v_report.document_id, v_report.baseline_document_id)
    group by findings.id
  ), deltas as (
    select id,
      case when in_current and not in_baseline then 'new'
           when in_baseline and not in_current then 'removed'
           else 'unchanged' end as change
    from scoped
    where in_current or in_baseline
  ), page as (
    select * from deltas where v_cursor is null or id > v_cursor
    order by id limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'findingId', page.id, 'change', page.change,
    'origin', 'advisory_reevaluation',
    'explanation', case page.change
      when 'new' then 'The finding applies to the current SBOM document only.'
      when 'removed' then 'The finding applies to the baseline SBOM document only.'
      else 'The finding applies to both compared SBOM documents.' end
  ) order by page.id), '[]'::jsonb) into v_rows from page;

  return query select 'found'::text, jsonb_build_object(
    'state', 'ready', 'items', v_rows,
    'nextCursor', case when jsonb_array_length(v_rows) = p_limit
      then v_rows -> (p_limit - 1) ->> 'findingId' else null end
  );
end;
$$;

-- Keep the older callable signature under the same scope, permission and
-- readiness checks; no alternative unscoped projection remains.
create or replace function public.get_sbom_diff_findings(p_organization_id uuid,p_actor_user_id uuid,p_report_id uuid)
returns table(outcome text,result jsonb) language sql security definer set search_path=public,pg_temp as $$
  select * from public.get_sbom_diff_findings(p_organization_id,p_actor_user_id,p_report_id,100,null::text);
$$;
alter function public.get_sbom_diff_findings(uuid,uuid,uuid,integer,text) owner to postgres;
alter function public.get_sbom_diff_findings(uuid,uuid,uuid) owner to postgres;
revoke all on function public.get_sbom_diff_findings(uuid,uuid,uuid,integer,text),public.get_sbom_diff_findings(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_sbom_diff_findings(uuid,uuid,uuid,integer,text),public.get_sbom_diff_findings(uuid,uuid,uuid) to service_role;
