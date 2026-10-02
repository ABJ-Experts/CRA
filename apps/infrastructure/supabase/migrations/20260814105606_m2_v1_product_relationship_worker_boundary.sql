-- Product-owned worker boundary. Finding code can lease and describe a graph
-- event but never reads the product outbox or graph tables directly.

create or replace function public.list_due_product_relationship_graph_event_organizations()
returns table(organization_id uuid)
language sql security definer set search_path = public, pg_temp as $$
  select distinct e.organization_id
    from public.product_regulatory_outbox_events e
   where e.event_type = 'product_relationship.graph_changed'
     and ((e.delivery_state in ('scheduled','retrying') and coalesce(e.due_at,e.occurred_at) <= clock_timestamp())
       or (e.delivery_state='leased' and e.lease_expires_at <= clock_timestamp()))
   order by e.organization_id
$$;

create or replace function public.describe_product_relationship_graph_event_atomic(
  p_organization_id uuid,p_event_id uuid,p_lease_owner uuid,p_expected_checkpoint_version integer
) returns table(outcome text,event jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_event public.product_regulatory_outbox_events%rowtype; v_scopes jsonb := '[]'::jsonb;
  v_relationship public.product_relationships%rowtype; v_membership public.software_baseline_release_memberships%rowtype;
begin
  if p_organization_id is null or p_event_id is null or p_lease_owner is null or p_expected_checkpoint_version is null then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  select * into v_event from public.product_regulatory_outbox_events e
   where e.organization_id=p_organization_id and e.id=p_event_id and e.event_type='product_relationship.graph_changed' for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_event.delivery_state <> 'leased' or v_event.lease_owner is distinct from p_lease_owner
     or v_event.checkpoint_version <> p_expected_checkpoint_version or v_event.lease_expires_at <= clock_timestamp() then
    return query select 'conflict'::text,null::jsonb; return;
  end if;
  if v_event.payload->>'subjectKind' = 'component_link' or v_event.payload->>'subjectKind' = 'variant_relationship' then
    select * into v_relationship from public.product_relationships r where r.organization_id=p_organization_id and r.id=(v_event.payload->>'subjectId')::uuid;
    if found then
      if v_relationship.relationship_type='embedded' then
        v_scopes := jsonb_build_array(jsonb_build_object('sourceProductId',v_relationship.target_product_id,'sourceReleaseId',v_relationship.target_release_id,'sourceBaselineRevisionId',null));
      elsif v_relationship.source_release_id is not null then
        v_scopes := jsonb_build_array(jsonb_build_object('sourceProductId',v_relationship.source_product_id,'sourceReleaseId',v_relationship.source_release_id,'sourceBaselineRevisionId',null));
      else
        v_scopes := jsonb_build_array(jsonb_build_object('sourceProductId',v_relationship.target_product_id,'sourceReleaseId',null,'sourceBaselineRevisionId',v_relationship.baseline_revision_id));
      end if;
    end if;
  elsif v_event.payload->>'subjectKind' = 'baseline_membership' then
    select * into v_membership from public.software_baseline_release_memberships m where m.organization_id=p_organization_id and m.id=(v_event.payload->>'subjectId')::uuid;
    if found then
      v_scopes := jsonb_build_array(
        jsonb_build_object('sourceProductId',v_membership.product_id,'sourceReleaseId',v_membership.release_id,'sourceBaselineRevisionId',null),
        jsonb_build_object('sourceProductId',v_membership.product_id,'sourceReleaseId',null,'sourceBaselineRevisionId',v_membership.baseline_revision_id)
      );
    end if;
  end if;
  if jsonb_array_length(v_scopes)=0 then
    v_scopes := jsonb_build_array(jsonb_build_object('sourceProductId',v_event.product_id,'sourceReleaseId',null,'sourceBaselineRevisionId',null));
  end if;
  return query select 'found'::text,jsonb_build_object('eventId',v_event.id,'organizationId',v_event.organization_id,'graphVersion',v_event.graph_version,'eventKey',v_event.event_key,'occurredAt',public.m2_utc_z(v_event.occurred_at),'sourceScopes',v_scopes);
exception when invalid_text_representation then return query select 'not_found'::text,null::jsonb;
end;
$$;

create or replace function public.get_product_relationship_propagation_candidates_system(
  p_organization_id uuid,p_source_release_id uuid,p_source_baseline_revision_id uuid,
  p_graph_version integer,p_as_of timestamptz,p_page_size integer,p_cursor text
) returns table(outcome text,candidates jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_as_of timestamptz:=coalesce(p_as_of,clock_timestamp()); v_current_graph integer; v_page_size integer:=coalesce(p_page_size,25);
begin
  if (p_source_release_id is null)=(p_source_baseline_revision_id is null) or v_page_size<1 or v_page_size>100
     or (p_cursor is not null and p_cursor !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}:([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})?$') then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  select product_relationship_graph_version into v_current_graph from public.organization_settings where organization_id=p_organization_id;
  if v_current_graph is null or p_graph_version<>v_current_graph then return query select 'conflict'::text,null::jsonb; return; end if;
  if (p_source_release_id is not null and not exists(select 1 from public.product_releases where organization_id=p_organization_id and id=p_source_release_id)) or (p_source_baseline_revision_id is not null and not exists(select 1 from public.software_baselines where organization_id=p_organization_id and id=p_source_baseline_revision_id)) then return query select 'not_found'::text,null::jsonb; return; end if;
  return query with recursive active_edges as (
    select r.* from public.product_relationships r where r.organization_id=p_organization_id and r.relationship_type='embedded' and r.ended_at is null and r.effective_starts_at<=v_as_of and (r.effective_ends_at is null or r.effective_ends_at>v_as_of)
  ), seed as (
    select r.product_id,r.id as release_id,array[]::uuid[] as relationship_path from public.product_releases r where p_source_release_id is not null and r.organization_id=p_organization_id and r.id=p_source_release_id
    union select m.product_id,m.release_id,array[]::uuid[] from public.software_baseline_release_memberships m where p_source_baseline_revision_id is not null and m.organization_id=p_organization_id and m.baseline_revision_id=p_source_baseline_revision_id and m.ended_at is null and m.effective_starts_at<=v_as_of and (m.effective_ends_at is null or m.effective_ends_at>v_as_of)
    union select r.target_product_id,r.target_release_id,array[r.id]::uuid[] from public.product_relationships r where r.organization_id=p_organization_id and r.relationship_type='variant' and r.ended_at is null and ((p_source_release_id is not null and r.source_release_id=p_source_release_id) or (p_source_baseline_revision_id is not null and r.baseline_revision_id=p_source_baseline_revision_id)) and r.effective_starts_at<=v_as_of and (r.effective_ends_at is null or r.effective_ends_at>v_as_of)
  ), walk as (
    select seed.product_id,seed.release_id,seed.relationship_path,array[seed.product_id]::uuid[] as product_path,0 as depth from seed
    union all select edge.source_product_id,edge.source_release_id,walk.relationship_path||edge.id,walk.product_path||edge.source_product_id,walk.depth+1
      from walk join active_edges edge on edge.target_product_id=walk.product_id and (edge.target_release_id is null or walk.release_id is null or edge.target_release_id=walk.release_id)
     where walk.depth<64 and not edge.source_product_id=any(walk.product_path)
  ), canonical as (
    select distinct on(product_id,coalesce(release_id,'00000000-0000-0000-0000-000000000000'::uuid)) product_id,release_id,relationship_path from walk order by product_id,coalesce(release_id,'00000000-0000-0000-0000-000000000000'::uuid),array_length(relationship_path,1) nulls first,relationship_path::text
  ), paged as (
    select * from canonical where p_cursor is null or (product_id::text||':'||coalesce(release_id::text,''))>p_cursor order by product_id,release_id nulls first limit v_page_size+1
  ), selected as (select * from paged limit v_page_size), next_row as (select * from paged offset v_page_size limit 1), last_selected as (select * from selected order by product_id desc,release_id desc nulls last limit 1)
  select 'found'::text,jsonb_build_object('candidates',coalesce((select jsonb_agg(jsonb_build_object('productId',s.product_id,'releaseId',s.release_id,'relationshipPathIds',to_jsonb(s.relationship_path),'graphVersion',v_current_graph,'evaluatedAt',public.m2_utc_z(v_as_of)) order by s.product_id,s.release_id) from selected s),'[]'::jsonb),'nextCursor',case when exists(select 1 from next_row) then (select s.product_id::text||':'||coalesce(s.release_id::text,'') from last_selected s) else null end,'graphVersion',v_current_graph,'evaluatedAt',public.m2_utc_z(v_as_of));
end;
$$;

alter function public.list_due_product_relationship_graph_event_organizations() owner to postgres;
alter function public.describe_product_relationship_graph_event_atomic(uuid,uuid,uuid,integer) owner to postgres;
alter function public.get_product_relationship_propagation_candidates_system(uuid,uuid,uuid,integer,timestamptz,integer,text) owner to postgres;
revoke all on function public.list_due_product_relationship_graph_event_organizations(),public.describe_product_relationship_graph_event_atomic(uuid,uuid,uuid,integer),public.get_product_relationship_propagation_candidates_system(uuid,uuid,uuid,integer,timestamptz,integer,text) from public, anon, authenticated;
grant execute on function public.list_due_product_relationship_graph_event_organizations(),public.describe_product_relationship_graph_event_atomic(uuid,uuid,uuid,integer),public.get_product_relationship_propagation_candidates_system(uuid,uuid,uuid,integer,timestamptz,integer,text) to service_role;
