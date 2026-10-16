-- M14 dashboard-only permission input snapshot. This read does not replace the
-- global resolver or guards, persist a cache, or change version triggers.
create or replace function public.get_dashboard_permission_context(
 p_organization_id uuid,p_actor_user_id uuid,p_expected_role text
)returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with scope as materialized(
 select m.role,v.version
 from public.organization_members m
 join public.users u on u.id=m.user_id and u.is_active
 join public.organizations o on o.id=m.organization_id and o.is_active
 left join public.organization_permissions_version v on v.organization_id=m.organization_id
 where m.organization_id=p_organization_id and m.user_id=p_actor_user_id
 and m.role=p_expected_role and p_expected_role in('owner','admin','member','viewer')
 )
 select coalesce((select case
 when s.version is null or s.version<1 or s.version>9007199254740991
 then jsonb_build_object('outcome','unavailable')
 else jsonb_build_object('outcome','available','context',jsonb_build_object(
 'organizationId',p_organization_id,'userId',p_actor_user_id,'role',s.role,
 'permissionVersion',s.version,
 'customRoles',coalesce((select jsonb_agg(jsonb_build_object(
 'id',r.id,'name',r.name,'base_role',r.base_role,'permissions',r.permissions,
 'is_active',r.is_active,'is_deleted',r.is_deleted)order by r.id)
 from public.user_role_assignments a join public.custom_roles r
 on r.organization_id=p_organization_id and r.id=a.role_id
 where a.organization_id=p_organization_id and a.user_id=p_actor_user_id),'[]'::jsonb),
 'baseRoleOverrides',coalesce((select b.permissions
 from public.base_role_permission_overrides b
 where b.organization_id=p_organization_id and b.base_role=s.role),'{}'::jsonb)))
 end from scope s),jsonb_build_object('outcome','not_found'))
$$;
alter function public.get_dashboard_permission_context(uuid,uuid,text)owner to postgres;
revoke all on function public.get_dashboard_permission_context(uuid,uuid,text)from public,anon,authenticated,service_role;
grant execute on function public.get_dashboard_permission_context(uuid,uuid,text)to service_role;
