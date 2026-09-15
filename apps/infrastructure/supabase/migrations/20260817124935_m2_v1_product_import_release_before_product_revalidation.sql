-- A release may precede its product row in the CSV. Its reference is valid
-- when the same immutable plan contains a valid product create for that code.
create or replace function public.product_import_commit_references_valid(
  p_organization_id uuid,p_import_id uuid
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.product_import_rows%rowtype; v_product public.products%rowtype;
  v_owner uuid; v_entity uuid;
begin
  for v_row in select * from public.product_import_rows rows
    where rows.organization_id=p_organization_id and rows.import_id=p_import_id
      and rows.proposed_action not in ('failed','skipped') order by rows.source_row_number
  loop
    if v_row.row_type='product' and v_row.proposed_action='create' then
      begin
        v_owner:=(v_row.proposed->>'responsibleOwnerId')::uuid;
        v_entity:=(v_row.proposed->>'legalEntityId')::uuid;
      exception when invalid_text_representation then return false; end;
      perform 1 from public.organization_members members join public.users users on users.id=members.user_id
       where members.organization_id=p_organization_id and members.user_id=v_owner and users.is_active
       for key share of members,users;
      if not found then return false; end if;
      perform 1 from public.organization_legal_entities entities
       where entities.organization_id=p_organization_id and entities.id=v_entity
         and entities.status='active' and entities.completion_status='complete' for key share;
      if not found then return false; end if;
    else
      v_product:=null;
      if v_row.product_id is not null then
        select * into v_product from public.products products
         where products.organization_id=p_organization_id and products.id=v_row.product_id
           and products.archived_at is null for key share;
      elsif v_row.product_internal_code_normalized is not null then
        select * into v_product from public.products products
         where products.organization_id=p_organization_id
           and products.internal_code_normalized=v_row.product_internal_code_normalized
           and products.archived_at is null for key share;
      end if;
      if v_product.id is null and v_row.row_type='release' and exists(
        select 1 from public.product_import_rows product_rows
        where product_rows.organization_id=p_organization_id and product_rows.import_id=p_import_id
          and product_rows.row_type='product' and product_rows.proposed_action='create'
          and product_rows.result='planned'
          and product_rows.product_internal_code_normalized=v_row.product_internal_code_normalized
      ) then continue; end if;
      if v_product.id is null then return false; end if;
      v_owner:=case when v_row.row_type='product' and v_row.proposed?'responsibleOwnerId'
        then (v_row.proposed->>'responsibleOwnerId')::uuid else v_product.responsible_owner_id end;
      perform 1 from public.organization_members members join public.users users on users.id=members.user_id
       where members.organization_id=p_organization_id and members.user_id=v_owner and users.is_active
       for key share of members,users;
      if not found then return false; end if;
      perform 1 from public.organization_legal_entities entities
       where entities.organization_id=p_organization_id and entities.id=v_product.legal_entity_id
         and entities.status='active' and entities.completion_status='complete' for key share;
      if not found then return false; end if;
    end if;
  end loop;
  return true;
exception when invalid_text_representation then return false;
end;
$$;
alter function public.product_import_commit_references_valid(uuid,uuid) owner to postgres;
