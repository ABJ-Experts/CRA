-- Match the product-view boundary at the database command and narrow the
-- invalidation fanout for sources that already identify the affected scope.
do $$
declare v_definition text;
begin
  select pg_get_functiondef(
    'public.m10_set_framework_applicability(uuid,uuid,uuid,text,text,text,boolean,text,integer,uuid)'::regprocedure)
  into v_definition;
  if position('if not public.m10_actor_can_manage_frameworks(p_organization_id,p_actor_user_id) then' in v_definition)=0 then
    raise exception 'M10 applicability permission anchor missing';
  end if;
  execute replace(v_definition,
    'if not public.m10_actor_can_manage_frameworks(p_organization_id,p_actor_user_id) then',
    'if not public.m10_actor_can_manage_frameworks(p_organization_id,p_actor_user_id)'
      || chr(10) || '    or not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,''can_view_products'') then');
end $$;

create or replace function public.m10_invalidate_coverage_source()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_org uuid;
  v_product uuid;
  v_pack text;
  v_version text;
begin
  v_org:=case when tg_op='DELETE' then old.organization_id else new.organization_id end;
  case tg_table_name
    when 'framework_control_mapping_products' then
      v_product:=case when tg_op='DELETE' then old.product_id else new.product_id end;
      select m.pack_key,m.version_key into v_pack,v_version
      from public.framework_control_requirement_mappings m
      where m.organization_id=v_org
        and m.id=case when tg_op='DELETE' then old.mapping_id else new.mapping_id end;
    when 'framework_control_evidence_links' then
      v_product:=case when tg_op='DELETE' then old.product_id else new.product_id end;
    when 'framework_requirement_applicability' then
      v_product:=case when tg_op='DELETE' then old.product_id else new.product_id end;
      v_pack:=case when tg_op='DELETE' then old.pack_key else new.pack_key end;
      v_version:=case when tg_op='DELETE' then old.version_key else new.version_key end;
    when 'framework_control_requirement_mappings' then
      v_pack:=case when tg_op='DELETE' then old.pack_key else new.pack_key end;
      v_version:=case when tg_op='DELETE' then old.version_key else new.version_key end;
    when 'organization_framework_selections' then
      v_pack:=case when tg_op='DELETE' then old.pack_key else new.pack_key end;
    when 'products' then
      v_product:=case when tg_op='DELETE' then old.id else new.id end;
  end case;
  update public.framework_coverage_scopes s
  set source_revision=source_revision+1,status='pending',lease_owner=null,
    lease_expires_at=null,next_attempt_at=clock_timestamp(),last_error=null,
    updated_at=clock_timestamp()
  where s.organization_id=v_org
    and (v_product is null or s.product_id=v_product)
    and (v_pack is null or s.pack_key=v_pack)
    and (v_version is null or s.version_key=v_version);
  return coalesce(new,old);
end $$;
