-- Roll forward the graph preview query after the first local application.
-- Both depth CTEs must be consumed in the same statement because a CTE's
-- visibility ends at that statement boundary.
create or replace function public.m2_component_link_preview(
  p_organization_id uuid,
  p_parent_product_id uuid,
  p_component_product_id uuid,
  p_effective_at timestamptz,
  p_graph_version integer,
  p_excluding_relationship_id uuid default null
) returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare
  v_current_graph_version integer;
  v_cycle_products uuid[];
  v_cycle_links uuid[];
  v_upstream_depth integer := 0;
  v_downstream_depth integer := 0;
  v_candidate_depth integer;
begin
  select product_relationship_graph_version into v_current_graph_version
   from public.organization_settings where organization_id=p_organization_id;
  if v_current_graph_version is null then return jsonb_build_object('outcome','not_found'); end if;
  if p_graph_version is null or p_graph_version<>v_current_graph_version then
    return jsonb_build_object('outcome','conflict','graphVersion',v_current_graph_version);
  end if;
  if p_parent_product_id=p_component_product_id then
    return jsonb_build_object('outcome','cycle_detected','graphVersion',v_current_graph_version,
      'candidateDepth',1,'productPathIds',jsonb_build_array(p_parent_product_id,p_component_product_id),'relationshipPathIds','[]'::jsonb);
  end if;
  with recursive active_edges as (
    select r.* from public.product_relationships r
     where r.organization_id=p_organization_id and r.relationship_type='embedded'
       and r.ended_at is null and r.effective_starts_at<=p_effective_at
       and (r.effective_ends_at is null or r.effective_ends_at>p_effective_at)
       and (p_excluding_relationship_id is null or r.id<>p_excluding_relationship_id)
  ), walk as (
    select p_component_product_id as node, array[p_component_product_id]::uuid[] as products,
      array[]::uuid[] as links, 0 as depth
    union all
    select edge.target_product_id, walk.products||edge.target_product_id, walk.links||edge.id, walk.depth+1
      from walk join active_edges edge on edge.source_product_id=walk.node
     where walk.depth<64 and not edge.target_product_id=any(walk.products)
  )
  select products, links into v_cycle_products, v_cycle_links from walk
   where node=p_parent_product_id order by depth, links::text limit 1;
  if v_cycle_products is not null then
    return jsonb_build_object('outcome','cycle_detected','graphVersion',v_current_graph_version,
      'candidateDepth',cardinality(v_cycle_links)+1,
      'productPathIds',to_jsonb(v_cycle_products||p_component_product_id),
      'relationshipPathIds',to_jsonb(v_cycle_links));
  end if;
  with recursive active_edges as (
    select r.* from public.product_relationships r
     where r.organization_id=p_organization_id and r.relationship_type='embedded'
       and r.ended_at is null and r.effective_starts_at<=p_effective_at
       and (r.effective_ends_at is null or r.effective_ends_at>p_effective_at)
       and (p_excluding_relationship_id is null or r.id<>p_excluding_relationship_id)
  ), ancestors as (
    select p_parent_product_id as node, array[p_parent_product_id]::uuid[] as path, 0 as depth
    union all
    select edge.source_product_id, ancestors.path||edge.source_product_id, ancestors.depth+1
      from ancestors join active_edges edge on edge.target_product_id=ancestors.node
     where ancestors.depth<64 and not edge.source_product_id=any(ancestors.path)
  ), descendants as (
    select p_component_product_id as node, array[p_component_product_id]::uuid[] as path, 0 as depth
    union all
    select edge.target_product_id, descendants.path||edge.target_product_id, descendants.depth+1
      from descendants join active_edges edge on edge.source_product_id=descendants.node
     where descendants.depth<64 and not edge.target_product_id=any(descendants.path)
  )
  select
    coalesce((select max(depth) from ancestors),0),
    coalesce((select max(depth) from descendants),0)
  into v_upstream_depth, v_downstream_depth;
  v_candidate_depth := v_upstream_depth+1+v_downstream_depth;
  if v_candidate_depth>64 then
    return jsonb_build_object('outcome','depth_exceeded','graphVersion',v_current_graph_version,
      'candidateDepth',v_candidate_depth,'productPathIds','[]'::jsonb,'relationshipPathIds','[]'::jsonb);
  end if;
  return jsonb_build_object('outcome','allowed','graphVersion',v_current_graph_version,
    'candidateDepth',v_candidate_depth,'productPathIds','[]'::jsonb,'relationshipPathIds','[]'::jsonb);
end;
$$;

alter function public.m2_component_link_preview(uuid, uuid, uuid, timestamptz, integer, uuid) owner to postgres;
revoke all on function public.m2_component_link_preview(uuid, uuid, uuid, timestamptz, integer, uuid)
from public, anon, authenticated;
