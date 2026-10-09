-- Preserve the existing durable export body, authority checks and grants.
-- Later source migrations can replace its earlier lock list; ensure the final
-- migration chain captures these append-only ledgers in the same SHARE window.
do $$
declare
  v_definition text;
  v_anchor text;
  v_new_lock text;
begin
  v_definition := pg_get_functiondef(
    'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure
  );
  v_anchor := substring(v_definition from '(?is)lock\s+table\s+.*?\s+in\s+share\s+mode\s*;');
  if v_anchor is null then
    raise exception 'M14-02 expected durable export SHARE lock is missing';
  end if;
  v_new_lock := v_anchor;
  if v_anchor not like '%public.vulnerability_finding_lifecycle_facts%' then
    v_new_lock := regexp_replace(v_new_lock, '(?is)\s+in\s+share\s+mode\s*;$',
      ', public.vulnerability_finding_lifecycle_facts' || chr(10) || '  in share mode;');
  end if;
  if v_anchor not like '%public.sbom_release_coverage_facts%' then
    v_new_lock := regexp_replace(v_new_lock, '(?is)\s+in\s+share\s+mode\s*;$',
      ', public.sbom_release_coverage_facts' || chr(10) || '  in share mode;');
  end if;
  if v_new_lock <> v_anchor then
    execute replace(v_definition, v_anchor, v_new_lock);
  end if;
end $$;
