-- Correctness follow-up for M2: aggregate entity projection snapshots and
-- distinguish an omitted description from an explicit null clear.

create or replace function public.m2_reconcile_product_entity(
  p_organization_id uuid,
  p_legal_entity_id uuid,
  p_actor_user_id uuid
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_facts jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('recordId', p.id, 'count', 1)), '[]'::jsonb)
    into v_facts
    from public.products p
   where p.organization_id = p_organization_id
     and p.legal_entity_id = p_legal_entity_id
     and p.archived_at is null;
  perform public.reconcile_organization_legal_entity_dependencies_atomic(
    p_organization_id, p_legal_entity_id, p_actor_user_id, 'product', true, v_facts
  );
end;
$$;

create or replace function public.create_product_atomic(
  p_organization_id uuid, p_actor_user_id uuid, p_idempotency_key uuid,
  p_name text, p_internal_code text, p_product_type text, p_description text,
  p_responsible_owner_id uuid, p_legal_entity_id uuid
) returns table(outcome text, product jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype; v_context jsonb; v_digest text; v_existing public.product_create_idempotencies%rowtype;
begin
 if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
 if not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id where m.organization_id=p_organization_id and m.user_id=p_responsible_owner_id and u.is_active) then return query select 'not_found'::text,null::jsonb; return; end if;
 select context into v_context from public.resolve_active_organization_legal_entity_context(p_organization_id,p_legal_entity_id) where outcome='found'; if v_context is null then return query select 'not_found'::text,null::jsonb; return; end if;
 v_digest:=encode(digest(jsonb_build_object('name',p_name,'internalCode',p_internal_code,'productType',p_product_type,'description',p_description,'responsibleOwnerId',p_responsible_owner_id,'legalEntityId',p_legal_entity_id)::text,'sha256'),'hex');
 select * into v_existing from public.product_create_idempotencies where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key for update;
 if found then if v_existing.payload_digest<>v_digest then return query select 'idempotency_mismatch'::text,null::jsonb; else return query select 'replayed'::text,public.m2_product_json(p_organization_id,v_existing.product_id); end if; return; end if;
 insert into public.products(organization_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,name,internal_code,product_type,description,responsible_owner_id,created_by,updated_by) values(p_organization_id,p_legal_entity_id,(v_context->>'legalEntityVersion')::integer,v_context->'legalEntitySnapshot',btrim(p_name),btrim(p_internal_code),p_product_type,nullif(btrim(p_description),''),p_responsible_owner_id,p_actor_user_id,p_actor_user_id) returning * into v_product;
 insert into public.product_legal_entity_assignments(organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,assigned_by,reason) values(p_organization_id,v_product.id,p_legal_entity_id,v_product.legal_entity_version,v_product.legal_entity_snapshot,p_actor_user_id,'initial_assignment');
 insert into public.product_create_idempotencies(organization_id,actor_user_id,idempotency_key,payload_digest,product_id) values(p_organization_id,p_actor_user_id,p_idempotency_key,v_digest,v_product.id);
 perform public.record_organization_onboarding_evidence_atomic(p_organization_id,'first_product',v_product.id,p_actor_user_id,true);
 perform public.m2_reconcile_product_entity(p_organization_id,p_legal_entity_id,p_actor_user_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.created','product',v_product.id::text,jsonb_build_object('after',public.m2_product_json(p_organization_id,v_product.id)));
 return query select 'created'::text,public.m2_product_json(p_organization_id,v_product.id);
exception when unique_violation then return query select 'conflict'::text,null::jsonb; end; $$;

create or replace function public.assign_product_legal_entity_atomic(p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid,p_expected_version integer,p_legal_entity_id uuid,p_reason text)
returns table(outcome text, product jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype; v_context jsonb; v_before jsonb;
begin
 if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
 select * into v_product from public.products where organization_id=p_organization_id and id=p_product_id for update; if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 if v_product.version<>p_expected_version then return query select 'conflict'::text,public.m2_product_json(p_organization_id,p_product_id); return; end if;
 if v_product.archived_at is not null then return query select 'invalid_state'::text,null::jsonb; return; end if;
 select context into v_context from public.resolve_active_organization_legal_entity_context(p_organization_id,p_legal_entity_id) where outcome='found'; if v_context is null then return query select 'not_found'::text,null::jsonb; return; end if;
 v_before:=public.m2_product_json(p_organization_id,p_product_id);
 update public.products set legal_entity_id=p_legal_entity_id,legal_entity_version=(v_context->>'legalEntityVersion')::integer,legal_entity_snapshot=v_context->'legalEntitySnapshot',version=version+1,updated_by=p_actor_user_id where organization_id=p_organization_id and id=p_product_id;
 insert into public.product_legal_entity_assignments(organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,assigned_by,reason) values(p_organization_id,p_product_id,p_legal_entity_id,(v_context->>'legalEntityVersion')::integer,v_context->'legalEntitySnapshot',p_actor_user_id,btrim(p_reason));
 perform public.m2_reconcile_product_entity(p_organization_id,v_product.legal_entity_id,p_actor_user_id);
 perform public.m2_reconcile_product_entity(p_organization_id,p_legal_entity_id,p_actor_user_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.legal_entity_assigned','product',p_product_id::text,jsonb_build_object('before',v_before,'after',public.m2_product_json(p_organization_id,p_product_id),'reason',p_reason));
 return query select 'updated'::text,public.m2_product_json(p_organization_id,p_product_id); end; $$;

create or replace function public.archive_product_atomic(p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid,p_expected_version integer,p_reason text)
returns table(outcome text, product jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype; v_before jsonb;
begin
 if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
 select * into v_product from public.products where organization_id=p_organization_id and id=p_product_id for update; if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 if v_product.version<>p_expected_version then return query select 'conflict'::text,public.m2_product_json(p_organization_id,p_product_id); return; end if;
 if v_product.archived_at is not null then return query select 'invalid_state'::text,null::jsonb; return; end if;
 if exists(select 1 from public.product_releases where organization_id=p_organization_id and product_id=p_product_id and archived_at is null) or exists(select 1 from public.product_lifecycle_dependency_facts where organization_id=p_organization_id and product_id=p_product_id and active) then return query select 'blocked'::text,null::jsonb; return; end if;
 v_before:=public.m2_product_json(p_organization_id,p_product_id);
 update public.products set archived_at=now(),archived_by=p_actor_user_id,version=version+1,updated_by=p_actor_user_id where organization_id=p_organization_id and id=p_product_id;
 perform public.m2_reconcile_product_entity(p_organization_id,v_product.legal_entity_id,p_actor_user_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.archived','product',p_product_id::text,jsonb_build_object('before',v_before,'after',public.m2_product_json(p_organization_id,p_product_id),'reason',p_reason));
 return query select 'archived'::text,public.m2_product_json(p_organization_id,p_product_id); end; $$;

drop function public.update_product_atomic(uuid,uuid,uuid,integer,text,text,text,text,uuid);
create function public.update_product_atomic(p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid,p_expected_version integer,p_name text,p_internal_code text,p_product_type text,p_description text,p_description_provided boolean,p_responsible_owner_id uuid)
returns table(outcome text, product jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype; v_before jsonb;
begin
 if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
 select * into v_product from public.products where organization_id=p_organization_id and id=p_product_id for update; if not found then return query select 'not_found'::text,null::jsonb; return; end if;
 if v_product.version<>p_expected_version then return query select 'conflict'::text,public.m2_product_json(p_organization_id,p_product_id); return; end if;
 if v_product.archived_at is not null then return query select 'invalid_state'::text,null::jsonb; return; end if;
 if p_responsible_owner_id is not null and not exists(select 1 from public.organization_members m join public.users u on u.id=m.user_id where m.organization_id=p_organization_id and m.user_id=p_responsible_owner_id and u.is_active) then return query select 'not_found'::text,null::jsonb; return; end if;
 v_before:=public.m2_product_json(p_organization_id,p_product_id);
 update public.products set name=coalesce(btrim(p_name),name),internal_code=coalesce(btrim(p_internal_code),internal_code),product_type=coalesce(p_product_type,product_type),description=case when p_description_provided then nullif(btrim(p_description),'') else description end,responsible_owner_id=coalesce(p_responsible_owner_id,responsible_owner_id),version=version+1,updated_by=p_actor_user_id where organization_id=p_organization_id and id=p_product_id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.updated','product',p_product_id::text,jsonb_build_object('before',v_before,'after',public.m2_product_json(p_organization_id,p_product_id)));
 return query select 'updated'::text,public.m2_product_json(p_organization_id,p_product_id);
exception when unique_violation then return query select 'conflict'::text,null::jsonb; end; $$;

drop function public.update_product_release_atomic(uuid,uuid,uuid,uuid,integer,text,text,text,text);
create function public.update_product_release_atomic(p_organization_id uuid,p_product_id uuid,p_release_id uuid,p_actor_user_id uuid,p_expected_version integer,p_label text,p_release_version text,p_description text,p_description_provided boolean,p_lifecycle text)
returns table(outcome text, release jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_release public.product_releases%rowtype; v_before jsonb;
begin
 if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if; select * into v_release from public.product_releases where organization_id=p_organization_id and product_id=p_product_id and id=p_release_id for update; if not found then return query select 'not_found'::text,null::jsonb; return; end if; if v_release.version<>p_expected_version then return query select 'conflict'::text,public.m2_release_json(p_organization_id,p_release_id); return; end if; if v_release.archived_at is not null then return query select 'invalid_state'::text,null::jsonb; return; end if;
 if p_lifecycle is not null and ((v_release.lifecycle='draft' and p_lifecycle not in ('draft','released')) or (v_release.lifecycle='released' and p_lifecycle not in ('released','retired')) or (v_release.lifecycle='retired' and p_lifecycle<>'retired')) then return query select 'invalid_state'::text,null::jsonb; return; end if;
 v_before:=public.m2_release_json(p_organization_id,p_release_id);
 update public.product_releases set label=coalesce(btrim(p_label),label),release_version=coalesce(btrim(p_release_version),release_version),description=case when p_description_provided then nullif(btrim(p_description),'') else description end,lifecycle=coalesce(p_lifecycle,lifecycle),version=version+1,updated_by=p_actor_user_id where organization_id=p_organization_id and id=p_release_id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.release_updated','product_release',p_release_id::text,jsonb_build_object('before',v_before,'after',public.m2_release_json(p_organization_id,p_release_id))); return query select 'updated'::text,public.m2_release_json(p_organization_id,p_release_id);
exception when unique_violation then return query select 'conflict'::text,null::jsonb; end; $$;

create or replace function public.list_products(p_organization_id uuid,p_actor_user_id uuid,p_q text,p_archived boolean,p_product_type text,p_responsible_owner_id uuid,p_page integer,p_page_size integer)
returns table(outcome text, products jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total integer; v_rows jsonb;
begin if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
select count(*) into v_total from public.products p where p.organization_id=p_organization_id and (p_archived is null or (p.archived_at is not null)=p_archived) and (p_product_type is null or p.product_type=p_product_type) and (p_responsible_owner_id is null or p.responsible_owner_id=p_responsible_owner_id) and (p_q is null or p.name ilike '%'||p_q||'%' or p.internal_code ilike '%'||p_q||'%');
select coalesce(jsonb_agg(public.m2_product_json(p_organization_id,p.id) order by p.updated_at desc,p.id desc),'[]'::jsonb) into v_rows from (select id,updated_at from public.products p where p.organization_id=p_organization_id and (p_archived is null or (p.archived_at is not null)=p_archived) and (p_product_type is null or p.product_type=p_product_type) and (p_responsible_owner_id is null or p.responsible_owner_id=p_responsible_owner_id) and (p_q is null or p.name ilike '%'||p_q||'%' or p.internal_code ilike '%'||p_q||'%') order by updated_at desc,id desc limit p_page_size offset ((p_page-1)*p_page_size)) p;
return query select 'found'::text,jsonb_build_object('rows',v_rows,'total',v_total,'page',p_page,'pageSize',p_page_size,'pageCount',greatest(1,ceil(v_total::numeric/p_page_size)::integer)); end; $$;

create or replace function public.list_product_releases(p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid,p_archived boolean,p_lifecycle text,p_page integer,p_page_size integer)
returns table(outcome text, releases jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_total integer; v_rows jsonb;
begin if not public.m2_active_member(p_organization_id,p_actor_user_id) or not exists(select 1 from public.products where organization_id=p_organization_id and id=p_product_id) then return query select 'not_found'::text,null::jsonb; return; end if;
select count(*) into v_total from public.product_releases r where r.organization_id=p_organization_id and r.product_id=p_product_id and (p_archived is null or (r.archived_at is not null)=p_archived) and (p_lifecycle is null or r.lifecycle=p_lifecycle);
select coalesce(jsonb_agg(public.m2_release_json(p_organization_id,r.id) order by r.created_at desc,r.id desc),'[]'::jsonb) into v_rows from (select id,created_at from public.product_releases r where r.organization_id=p_organization_id and r.product_id=p_product_id and (p_archived is null or (r.archived_at is not null)=p_archived) and (p_lifecycle is null or r.lifecycle=p_lifecycle) order by created_at desc,id desc limit p_page_size offset ((p_page-1)*p_page_size)) r;
return query select 'found'::text,jsonb_build_object('rows',v_rows,'total',v_total,'page',p_page,'pageSize',p_page_size,'pageCount',greatest(1,ceil(v_total::numeric/p_page_size)::integer)); end; $$;

revoke all on function public.update_product_atomic(uuid,uuid,uuid,integer,text,text,text,text,boolean,uuid), public.update_product_release_atomic(uuid,uuid,uuid,uuid,integer,text,text,text,boolean,text) from public, anon, authenticated;
grant execute on function public.update_product_atomic(uuid,uuid,uuid,integer,text,text,text,text,boolean,uuid), public.update_product_release_atomic(uuid,uuid,uuid,uuid,integer,text,text,text,boolean,text) to service_role;
