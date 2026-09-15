-- M2 V1 relationship correctness: preview transport normalization and
-- release-aware, canonical-cursor propagation traversal.

create or replace function public.preview_product_component_link(
  p_organization_id uuid,p_parent_product_id uuid,p_component_product_id uuid,p_actor_user_id uuid,
  p_expected_graph_version integer,p_parent_release_id uuid,p_component_release_id uuid,p_quantity integer,
  p_source text,p_provenance text,p_reason text,p_effective_starts_at timestamptz,p_effective_ends_at timestamptz
) returns table(outcome text,preview jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_preview jsonb;
begin
  if not public.m2_active_member(p_organization_id,p_actor_user_id) then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  if p_quantity is null or p_quantity<1 or p_quantity>1000000 or p_effective_starts_at is null or (p_effective_ends_at is not null and p_effective_ends_at<=p_effective_starts_at) or char_length(btrim(coalesce(p_source,'')))=0 or char_length(btrim(coalesce(p_provenance,'')))=0 or char_length(btrim(coalesce(p_reason,'')))=0 then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  if not exists(select 1 from public.products where organization_id=p_organization_id and id=p_parent_product_id and archived_at is null)
    or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_component_product_id and archived_at is null)
    or (p_parent_release_id is not null and not exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=p_parent_product_id and id=p_parent_release_id and archived_at is null))
    or (p_component_release_id is not null and not exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=p_component_product_id and id=p_component_release_id and archived_at is null)) then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  v_preview:=public.m2_component_link_preview(p_organization_id,p_parent_product_id,p_component_product_id,p_effective_starts_at,p_expected_graph_version);
  if v_preview->>'outcome'='allowed' then
    return query select 'found'::text,v_preview; return;
  end if;
  return query select (v_preview->>'outcome')::text,v_preview;
end;
$$;

create or replace function public.get_product_relationship_propagation_candidates(
  p_organization_id uuid,p_source_release_id uuid,p_source_baseline_revision_id uuid,p_actor_user_id uuid,
  p_graph_version integer,p_as_of timestamptz,p_page_size integer,p_cursor text
) returns table(outcome text,candidates jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_as_of timestamptz:=coalesce(p_as_of,now()); v_current_graph integer; v_page_size integer:=coalesce(p_page_size,25);
begin
  if (p_source_release_id is null)=(p_source_baseline_revision_id is null) or v_page_size<1 or v_page_size>100 then return query select 'invalid_request'::text,null::jsonb; return; end if;
  if p_cursor is not null and p_cursor !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}:([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})?$' then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
  select product_relationship_graph_version into v_current_graph from public.organization_settings where organization_id=p_organization_id;
  if p_graph_version<>v_current_graph then return query select 'conflict'::text,null::jsonb; return; end if;
  if (p_source_release_id is not null and not exists(select 1 from public.product_releases where organization_id=p_organization_id and id=p_source_release_id)) or (p_source_baseline_revision_id is not null and not exists(select 1 from public.software_baselines where organization_id=p_organization_id and id=p_source_baseline_revision_id)) then return query select 'not_found'::text,null::jsonb; return; end if;
  return query with recursive active_edges as (
    select r.* from public.product_relationships r where r.organization_id=p_organization_id and r.relationship_type='embedded' and r.ended_at is null and r.effective_starts_at<=v_as_of and (r.effective_ends_at is null or r.effective_ends_at>v_as_of)
  ), seed as (
    select r.product_id,r.id as release_id,array[]::uuid[] as relationship_path from public.product_releases r where p_source_release_id is not null and r.organization_id=p_organization_id and r.id=p_source_release_id
    union
    select m.product_id,m.release_id,array[]::uuid[] from public.software_baseline_release_memberships m where p_source_baseline_revision_id is not null and m.organization_id=p_organization_id and m.baseline_revision_id=p_source_baseline_revision_id and m.ended_at is null and m.effective_starts_at<=v_as_of and (m.effective_ends_at is null or m.effective_ends_at>v_as_of)
    union
    select r.target_product_id,r.target_release_id,array[r.id]::uuid[] from public.product_relationships r where r.organization_id=p_organization_id and r.relationship_type='variant' and r.ended_at is null and ((p_source_release_id is not null and r.source_release_id=p_source_release_id) or (p_source_baseline_revision_id is not null and r.baseline_revision_id=p_source_baseline_revision_id)) and r.effective_starts_at<=v_as_of and (r.effective_ends_at is null or r.effective_ends_at>v_as_of)
  ), walk as (
    select seed.product_id,seed.release_id,seed.relationship_path,array[seed.product_id]::uuid[] as product_path,0 as depth from seed
    union all
    select edge.source_product_id,edge.source_release_id,walk.relationship_path||edge.id,walk.product_path||edge.source_product_id,walk.depth+1
    from walk join active_edges edge on edge.target_product_id=walk.product_id
      and (edge.target_release_id is null or walk.release_id is null or edge.target_release_id=walk.release_id)
    where walk.depth<64 and not edge.source_product_id=any(walk.product_path)
  ), canonical as (
    select distinct on(product_id,coalesce(release_id,'00000000-0000-0000-0000-000000000000'::uuid)) product_id,release_id,relationship_path
    from walk order by product_id,coalesce(release_id,'00000000-0000-0000-0000-000000000000'::uuid),array_length(relationship_path,1) nulls first,relationship_path::text
  ), paged as (
    select * from canonical where p_cursor is null or (product_id::text||':'||coalesce(release_id::text,''))>p_cursor order by product_id,release_id nulls first limit v_page_size+1
  ), selected as (select * from paged limit v_page_size), next_row as (select * from paged offset v_page_size limit 1), last_selected as (
    select * from selected order by product_id desc,release_id desc nulls last limit 1
  )
  select 'found'::text,jsonb_build_object('candidates',coalesce((select jsonb_agg(jsonb_build_object('productId',s.product_id,'releaseId',s.release_id,'relationshipPathIds',to_jsonb(s.relationship_path),'graphVersion',v_current_graph,'evaluatedAt',public.m2_utc_z(v_as_of)) order by s.product_id,s.release_id) from selected s),'[]'::jsonb),'nextCursor',case when exists(select 1 from next_row) then (select s.product_id::text||':'||coalesce(s.release_id::text,'') from last_selected s) else null end,'graphVersion',v_current_graph,'evaluatedAt',public.m2_utc_z(v_as_of));
end;
$$;

revoke all on function
  public.preview_product_component_link(uuid,uuid,uuid,uuid,integer,uuid,uuid,integer,text,text,text,timestamptz,timestamptz),
  public.get_product_relationship_propagation_candidates(uuid,uuid,uuid,uuid,integer,timestamptz,integer,text)
from public, anon, authenticated;
grant execute on function
  public.preview_product_component_link(uuid,uuid,uuid,uuid,integer,uuid,uuid,integer,text,text,text,timestamptz,timestamptz),
  public.get_product_relationship_propagation_candidates(uuid,uuid,uuid,uuid,integer,timestamptz,integer,text)
to service_role;
