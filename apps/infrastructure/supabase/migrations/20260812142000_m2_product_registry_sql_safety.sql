-- Repair M2 function bodies after live SQL lint: qualify output columns and
-- cryptographic functions under the pinned, security-definer search path.

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
 select le.context into v_context from public.resolve_active_organization_legal_entity_context(p_organization_id,p_legal_entity_id) le where le.outcome='found'; if v_context is null then return query select 'not_found'::text,null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('name',p_name,'internalCode',p_internal_code,'productType',p_product_type,'description',p_description,'responsibleOwnerId',p_responsible_owner_id,'legalEntityId',p_legal_entity_id)::text,'sha256'),'hex');
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
 select le.context into v_context from public.resolve_active_organization_legal_entity_context(p_organization_id,p_legal_entity_id) le where le.outcome='found'; if v_context is null then return query select 'not_found'::text,null::jsonb; return; end if;
 v_before:=public.m2_product_json(p_organization_id,p_product_id);
 update public.products set legal_entity_id=p_legal_entity_id,legal_entity_version=(v_context->>'legalEntityVersion')::integer,legal_entity_snapshot=v_context->'legalEntitySnapshot',version=version+1,updated_by=p_actor_user_id where organization_id=p_organization_id and id=p_product_id;
 insert into public.product_legal_entity_assignments(organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,assigned_by,reason) values(p_organization_id,p_product_id,p_legal_entity_id,(v_context->>'legalEntityVersion')::integer,v_context->'legalEntitySnapshot',p_actor_user_id,btrim(p_reason));
 perform public.m2_reconcile_product_entity(p_organization_id,v_product.legal_entity_id,p_actor_user_id);
 perform public.m2_reconcile_product_entity(p_organization_id,p_legal_entity_id,p_actor_user_id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.legal_entity_assigned','product',p_product_id::text,jsonb_build_object('before',v_before,'after',public.m2_product_json(p_organization_id,p_product_id),'reason',p_reason));
 return query select 'updated'::text,public.m2_product_json(p_organization_id,p_product_id); end; $$;

create or replace function public.create_product_release_atomic(p_organization_id uuid,p_product_id uuid,p_actor_user_id uuid,p_idempotency_key uuid,p_label text,p_release_version text,p_description text,p_lifecycle text)
returns table(outcome text, release jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_product public.products%rowtype; v_release public.product_releases%rowtype; v_digest text; v_existing public.product_release_create_idempotencies%rowtype;
begin
 if not public.m2_active_member(p_organization_id,p_actor_user_id) then return query select 'not_found'::text,null::jsonb; return; end if;
 select * into v_product from public.products where organization_id=p_organization_id and id=p_product_id for update; if not found or v_product.archived_at is not null then return query select 'not_found'::text,null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('productId',p_product_id,'label',p_label,'version',p_release_version,'description',p_description,'lifecycle',p_lifecycle)::text,'sha256'),'hex');
 select * into v_existing from public.product_release_create_idempotencies where organization_id=p_organization_id and actor_user_id=p_actor_user_id and idempotency_key=p_idempotency_key for update;
 if found then if v_existing.payload_digest<>v_digest then return query select 'idempotency_mismatch'::text,null::jsonb; else return query select 'replayed'::text,public.m2_release_json(p_organization_id,v_existing.release_id); end if; return; end if;
 insert into public.product_releases(organization_id,product_id,legal_entity_id,legal_entity_version,legal_entity_snapshot,label,release_version,description,lifecycle,created_by,updated_by) values(p_organization_id,p_product_id,v_product.legal_entity_id,v_product.legal_entity_version,v_product.legal_entity_snapshot,btrim(p_label),btrim(p_release_version),nullif(btrim(p_description),''),p_lifecycle,p_actor_user_id,p_actor_user_id) returning * into v_release;
 insert into public.product_release_create_idempotencies(organization_id,actor_user_id,idempotency_key,payload_digest,release_id) values(p_organization_id,p_actor_user_id,p_idempotency_key,v_digest,v_release.id);
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'product.release_created','product_release',v_release.id::text,jsonb_build_object('productId',p_product_id));
 return query select 'created'::text,public.m2_release_json(p_organization_id,v_release.id);
exception when unique_violation then return query select 'conflict'::text,null::jsonb; end; $$;
