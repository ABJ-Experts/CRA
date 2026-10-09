-- Authorized M1 tenant purge removes an organization and its rows after
-- retention/legal-hold checks. Runtime roles have no table DELETE grants.
-- Cascading within this feature keeps that existing offboarding path usable.
create or replace function public.m10_reject_control_history_change()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' and pg_trigger_depth()>1
    and not exists(select 1 from public.organizations o where o.id=old.organization_id)
  then return old; end if;
  raise exception 'Control history is immutable' using errcode='55000';
end $$;

alter table public.framework_control_revisions
  drop constraint framework_control_revisions_organization_id_control_id_fkey,
  add constraint m10_control_revisions_control_fkey
    foreign key (organization_id,control_id)
    references public.framework_controls(organization_id,id) on delete cascade;

alter table public.framework_control_evidence_links
  drop constraint framework_control_evidence_link_organization_id_control_id_fkey,
  drop constraint framework_control_evidence_li_organization_id_control_id_s_fkey,
  add constraint m10_control_evidence_control_fkey
    foreign key (organization_id,control_id)
    references public.framework_controls(organization_id,id) on delete cascade,
  add constraint m10_control_evidence_revision_fkey
    foreign key (organization_id,control_id,source_control_revision)
    references public.framework_control_revisions(organization_id,control_id,revision)
    on delete cascade;

alter table public.framework_control_requirement_mappings
  drop constraint framework_control_requirement_m_organization_id_control_id_fkey,
  drop constraint framework_control_requirement_organization_id_control_id_s_fkey,
  add constraint m10_control_mapping_control_fkey
    foreign key (organization_id,control_id)
    references public.framework_controls(organization_id,id) on delete cascade,
  add constraint m10_control_mapping_revision_fkey
    foreign key (organization_id,control_id,source_control_revision)
    references public.framework_control_revisions(organization_id,control_id,revision)
    on delete cascade;

alter table public.framework_control_mapping_products
  drop constraint framework_control_mapping_produ_organization_id_mapping_id_fkey,
  add constraint m10_control_mapping_product_mapping_fkey
    foreign key (organization_id,mapping_id)
    references public.framework_control_requirement_mappings(organization_id,id)
    on delete cascade;

-- M1 export includes durable control facts, not retry keys or command digests.
insert into public.organization_export_sources(source_id,enabled,sort_order)
values('framework_controls',true,50)
on conflict (source_id) do update
set enabled=excluded.enabled,sort_order=excluded.sort_order;

insert into public.organization_export_source_tables(
  source_id,table_name,tenant_key_column,record_order_column,table_sort
) values
  ('framework_controls','framework_controls','organization_id','id',1),
  ('framework_controls','framework_control_revisions','organization_id','control_id',2),
  ('framework_controls','framework_control_evidence_links','organization_id','id',3),
  ('framework_controls','framework_control_requirement_mappings','organization_id','id',4),
  ('framework_controls','framework_control_mapping_products','organization_id','mapping_id',5)
on conflict (source_id,table_name) do update
set tenant_key_column=excluded.tenant_key_column,
  record_order_column=excluded.record_order_column,
  table_sort=excluded.table_sort;

do $$
declare
  v_definition text;
  v_old_lock text := 'public.organization_framework_selections' || chr(10) || '  in share mode';
  v_new_lock text := 'public.organization_framework_selections, public.framework_controls, public.framework_control_revisions, public.framework_control_evidence_links, public.framework_control_requirement_mappings, public.framework_control_mapping_products' || chr(10) || '  in share mode';
begin
  select pg_get_functiondef(
    'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure
  ) into v_definition;
  if position(v_old_lock in v_definition)=0 then
    raise exception 'M10 control export lock anchor is missing';
  end if;
  execute replace(v_definition,v_old_lock,v_new_lock);
end $$;
