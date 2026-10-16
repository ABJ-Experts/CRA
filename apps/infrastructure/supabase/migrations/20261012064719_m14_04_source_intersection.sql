-- Source-owned background projections. No session or interactive token authority.
create function public.m14_04_source_actor_access(p_organization_id uuid,p_actor_user_id uuid,p_source text,p_context jsonb)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_policy jsonb:=public.m14_03_source_policy(p_source);v_permission text;v_role text;
begin
 if v_policy is null or coalesce(v_policy->>'subjectKind','member')<>'member' then return false;end if;
 select m.role into v_role from public.organization_members m join public.users u on u.id=m.user_id
 where m.organization_id=p_organization_id and m.user_id=p_actor_user_id and u.is_active and u.email_verified_at is not null;
 if not found or not public.m2_active_member(p_organization_id,p_actor_user_id) then return false;end if;
 if v_policy->>'requiredRole'='owner' and v_role<>'owner' then return false;end if;
 if v_policy->>'requiredRole'='admin' and v_role not in ('owner','admin') then return false;end if;
 for v_permission in select jsonb_array_elements_text(v_policy->'permissions') loop
 if not public.m14_03_actor_can(p_organization_id,p_actor_user_id,v_permission) then return false;end if;end loop;
 if p_context ? 'productId' and not exists(select 1 from public.products where organization_id=p_organization_id and id=(p_context->>'productId')::uuid) then return false;end if;
 return true;
exception when invalid_text_representation then return false;
end $$;

create function public.m14_04_both_can(p_organization_id uuid,p_owner_user_id uuid,p_recipient_user_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select public.m14_03_actor_can(p_organization_id,p_owner_user_id,p_permission) and public.m14_03_actor_can(p_organization_id,p_recipient_user_id,p_permission)
$$;

-- Extend the canonical readiness projection at its permission decision points.
-- Restricted sources are suppressed before the canonical aggregate is requested.
do $readiness$ declare d text;begin
 d:=pg_get_functiondef('public.m14_03_readiness_report(uuid,uuid,uuid)'::regprocedure);
 if position('public.m14_03_actor_can(p_organization_id, p_actor_user_id' in d)>0 then raise exception 'readiness_source_baseline_changed';end if;
 if position('public.m14_03_actor_can(p_organization_id,p_actor_user_id,' in d)=0 then raise exception 'readiness_source_baseline_changed';end if;
 d:=replace(d,'FUNCTION public.m14_03_readiness_report(p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid)','FUNCTION public.m14_04_readiness_report(p_organization_id uuid, p_actor_user_id uuid, p_product_id uuid, p_owner_user_id uuid)');
 d:=replace(d,'public.m14_03_actor_can(p_organization_id,p_actor_user_id,','public.m14_04_both_can(p_organization_id,p_owner_user_id,p_actor_user_id,');
 execute d;
end $readiness$;

create function public.m14_04_source_rows(p_organization_id uuid,p_owner_user_id uuid,p_recipient_user_id uuid,p_source text,p_filters jsonb,p_context jsonb)
returns table(source_id text,source_version text,product_id uuid,row_values jsonb)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_context jsonb:=p_context;v_access jsonb;v_permissions jsonb;v_owner_permissions jsonb;v_row record;v_count integer:=0;
begin
 if not public.m14_04_source_actor_access(p_organization_id,p_owner_user_id,p_source,p_context)
 or not public.m14_04_source_actor_access(p_organization_id,p_recipient_user_id,p_source,p_context)
 then raise exception 'report_access_denied' using errcode='42501';end if;
 if p_source='technical_files.readiness_report' then
 return query select p.id::text,p.version::text,p.id,jsonb_build_object('report',public.m14_04_readiness_report(p_organization_id,p_recipient_user_id,p.id,p_owner_user_id)::text)
 from public.products p where p.organization_id=p_organization_id and p.id=(p_context->>'productId')::uuid;return;
 elsif p_source='dashboard.trends' then
 -- Never trust a previously prepared sourceAccess to expand current grants.
 v_access:=jsonb_build_object('products',public.m14_04_both_can(p_organization_id,p_owner_user_id,p_recipient_user_id,'can_view_products'),
 'findings',public.m14_04_both_can(p_organization_id,p_owner_user_id,p_recipient_user_id,'can_view_products') and public.m14_04_both_can(p_organization_id,p_owner_user_id,p_recipient_user_id,'can_view_findings'),
 'sbomCoverage',public.m14_04_both_can(p_organization_id,p_owner_user_id,p_recipient_user_id,'can_view_products') and public.m14_04_both_can(p_organization_id,p_owner_user_id,p_recipient_user_id,'can_view_sboms'),
 'readiness',public.m14_04_both_can(p_organization_id,p_owner_user_id,p_recipient_user_id,'can_view_products') and public.m14_04_both_can(p_organization_id,p_owner_user_id,p_recipient_user_id,'can_view_technical_files'));
 if not p_context ? '_datasetSnapshot' or not p_context ? '_datasetRevision' then raise exception 'report_dataset_pin_required' using errcode='40001';end if;
 v_context:=p_context||jsonb_build_object('_sourceAccess',v_access);
 return query select * from public.m14_03_dashboard_trend_rows(p_organization_id,p_recipient_user_id,p_filters,v_context);return;
 elsif p_source='audit.events' then
 -- The durable receipt belongs to the recipient. Each event also passes the
 -- owner's current canonical event policy before becoming a captured row.
 v_owner_permissions:=public.m13_03_permission_snapshot(p_organization_id,p_owner_user_id);
 return query select r.source_id,r.source_version,r.product_id,r.row_values
 from public.m14_03_audit_source_rows(p_organization_id,p_recipient_user_id,p_filters,p_context) r
 join public.audit_logs a on a.organization_id=p_organization_id and a.id::text=r.source_id
 where public.m13_03_event_visible_cached(p_organization_id,p_owner_user_id,a,v_owner_permissions);return;
 end if;
 -- Compare canonical source identity AND version. Native notification group
 -- versions hash every authorized underlying member before aggregation, so
 -- groups with unequal authority cannot leak counts through an identity match.
 for v_row in
 with owner_rows as materialized(select * from public.m14_03_source_rows(p_organization_id,p_owner_user_id,p_source,p_filters,v_context) limit 100001),
 recipient_rows as materialized(select * from public.m14_03_source_rows(p_organization_id,p_recipient_user_id,p_source,p_filters,v_context) limit 100001)
 select r.* from recipient_rows r where exists(select 1 from owner_rows o where o.source_id=r.source_id and o.source_version=r.source_version and o.product_id is not distinct from r.product_id)
 loop
 v_count:=v_count+1;if v_count>100000 then raise exception 'report_capture_limit' using errcode='54000';end if;
 return query select v_row.source_id,v_row.source_version,v_row.product_id,v_row.row_values;
 end loop;
end $$;

create function public.m14_04_source_snapshot_access(p_job public.export_jobs,p_owner uuid,p_recipient uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_owner_job public.export_jobs:=p_job;v_recipient_job public.export_jobs:=p_job;
begin
 if not public.m14_04_source_actor_access(p_job.organization_id,p_owner,p_job.source,p_job.context)
 or not public.m14_04_source_actor_access(p_job.organization_id,p_recipient,p_job.source,p_job.context) then return false;end if;
 if p_job.row_count is null then return true;end if;
 -- Any permission revision invalidates aggregates and frozen source grants.
 if coalesce((select v.version from public.organization_permissions_version v where v.organization_id=p_job.organization_id),0) is distinct from p_job.permission_version then return false;end if;
 if exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id and r.product_id is not null
 and not exists(select 1 from public.products p where p.organization_id=p_job.organization_id and p.id=r.product_id)) then return false;end if;
 if p_job.source in ('products','products.registry') then
 return not exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id
 and not exists(select 1 from public.products p where p.organization_id=p_job.organization_id and p.id=r.product_id and p.id::text=r.source_id));end if;
 -- Source snapshot policies use current identities, not mutable list filters.
 -- These are projection inputs only; no session binding or token is fabricated.
 v_owner_job.requester_id:=p_owner;v_recipient_job.requester_id:=p_recipient;
 return public.m14_03_pre_portal_snapshot_access(v_owner_job) and public.m14_03_pre_portal_snapshot_access(v_recipient_job);
exception when insufficient_privilege or invalid_text_representation then return false;
end $$;

do $$ declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace
 and proname in ('m14_04_source_actor_access','m14_04_both_can','m14_04_readiness_report','m14_04_source_rows','m14_04_source_snapshot_access') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
