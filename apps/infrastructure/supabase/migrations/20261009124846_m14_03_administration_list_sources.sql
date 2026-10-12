-- Source-owned native list boundaries; presentation filters never authorize.
create function public.m14_03_member_list_rows(p_organization_id uuid,p_q text default null)
returns table(id uuid,role text,created_at timestamptz,users jsonb)
language sql stable security definer set search_path=pg_catalog,public as $$
 with search as(select nullif(regexp_replace(coalesce(p_q,''),'[(),\\"]','','g'),'') term)
 select m.id,m.role::text,m.created_at,jsonb_build_object('id',u.id,'email',u.email,'username',u.username,'first_name',u.first_name,'last_name',u.last_name,'avatar_url',u.avatar_url,'job_title',u.job_title,'is_active',u.is_active)
 from public.organization_members m join public.users u on u.id=m.user_id cross join search q
 where m.organization_id=p_organization_id and(q.term is null or u.email ilike '%'||q.term||'%' or u.first_name ilike '%'||q.term||'%' or u.last_name ilike '%'||q.term||'%' or u.username ilike '%'||q.term||'%')
$$;
create function public.m14_03_role_list_rows(p_organization_id uuid)
returns table(id uuid,name text,description text,color text,base_role text,permissions jsonb,is_system boolean,is_active boolean,created_at timestamptz,user_role_assignments jsonb)
language sql stable security definer set search_path=pg_catalog,public as $$
 select r.id,r.name,r.description,r.color,r.base_role::text,r.permissions,r.is_system,r.is_active,r.created_at,
 jsonb_build_array(jsonb_build_object('count',(select count(*) from public.user_role_assignments a where a.role_id=r.id)))
 from public.custom_roles r where r.organization_id=p_organization_id and not r.is_deleted
$$;
create function public.m14_03_invitation_list_rows(p_organization_id uuid)
returns table(id uuid,email text,role text,status text,expires_at timestamptz,created_at timestamptz)
language sql stable security definer set search_path=pg_catalog,public as $$
 select i.id,i.email,i.role::text,case when i.status='pending' and i.expires_at<clock_timestamp() then 'expired'::text else i.status::text end,i.expires_at,i.created_at
 from public.invitations i where i.organization_id=p_organization_id
$$;
revoke all on function public.m14_03_member_list_rows(uuid,text),public.m14_03_role_list_rows(uuid),public.m14_03_invitation_list_rows(uuid) from public,anon,authenticated;
grant execute on function public.m14_03_member_list_rows(uuid,text),public.m14_03_role_list_rows(uuid),public.m14_03_invitation_list_rows(uuid) to service_role;

alter function public.m14_03_operational_source_rows(uuid,uuid,text,jsonb,jsonb) rename to m14_03_pre_administration_source_rows;
create function public.m14_03_operational_source_rows(p_org uuid,p_actor uuid,p_source text,p_filters jsonb,p_context jsonb)
returns table(source_id text,source_version text,product_id uuid,row_values jsonb)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare permission_name text;
begin
 if p_source not in ('users.members','roles.custom_roles','invitations.pending') then return query select * from public.m14_03_pre_administration_source_rows(p_org,p_actor,p_source,p_filters,p_context);return;end if;
 if not public.m1201_active_member(p_org,p_actor) then raise exception 'export_access_denied' using errcode='42501';end if;
 for permission_name in select jsonb_array_elements_text(public.m14_03_source_policy(p_source)->'permissions') loop
 if not public.m14_03_actor_can(p_org,p_actor,permission_name) then raise exception 'export_access_denied' using errcode='42501';end if;end loop;
 if p_source='users.members' then
 return query select r.users->>'id',r.created_at::text,null::uuid,
 jsonb_build_object('id',r.users->'id','firstName',r.users->'first_name','lastName',r.users->'last_name','email',r.users->'email','role',r.role,'isActive',r.users->'is_active','joinedAt',r.created_at)
 from public.m14_03_member_list_rows(p_org,p_filters->>'q') r
 order by case when p_filters->>'order'='asc' then r.created_at end asc,case when p_filters->>'order' is distinct from 'asc' then r.created_at end desc,r.id limit 100001;
 elsif p_source='roles.custom_roles' then
 return query select r.id::text,r.created_at::text,null::uuid,
 jsonb_build_object('id',r.id,'name',r.name,'baseRole',r.base_role,'isActive',r.is_active,'memberCount',r.user_role_assignments#>'{0,count}')
 from public.m14_03_role_list_rows(p_org) r order by r.created_at,r.id limit 100001;
 else
 return query select r.id::text,r.created_at::text,null::uuid,
 jsonb_build_object('id',r.id,'email',r.email,'role',r.role,'status',r.status,'expiresAt',r.expires_at)
 from public.m14_03_invitation_list_rows(p_org) r order by r.created_at desc,r.id limit 100001;
 end if;
end $$;
revoke all on function public.m14_03_operational_source_rows(uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.m14_03_operational_source_rows(uuid,uuid,text,jsonb,jsonb) to service_role;
-- Current-page scope shares native bounded offsets; all-filtered ignores them.
do $page$ declare v_def text;begin
 v_def:=pg_get_functiondef('public.m14_03_capture_export(uuid,uuid,text,integer)'::regprocedure);
 if position('''products.registry'',''products.releases'') then v_from' in v_def)=0 then raise exception 'member_page_capture_baseline_changed';end if;
 v_def:=replace(v_def,'''products.registry'',''products.releases'') then v_from','''products.registry'',''products.releases'',''users.members'') then v_from');
 v_def:=replace(v_def,'-- Exactly one source statement snapshot.', 'if v_job.source=''users.members'' and v_job.scope=''current_page'' then select greatest(0,(least(coalesce((v_job.filters->>''page'')::integer,1),greatest(1,ceil(count(*)::numeric/v_limit)::integer))-1)*v_limit) into v_from from public.m14_03_member_list_rows(p_organization_id,v_job.filters->>''q'');end if; -- Exactly one source statement snapshot.');
 execute v_def;
end $page$;
-- Frozen administrator artifacts retain current source membership/deletion
-- boundaries even when values changed after their immutable capture.
do $access$ declare v_def text;v_old text;begin
 v_def:=pg_get_functiondef('public.m14_03_operational_snapshot_access(public.export_jobs)'::regprocedure);
 v_old:=$old$when 'organization.legal_entities' then$old$;
 if position(v_old in v_def)=0 then raise exception 'administration_snapshot_access_baseline_changed';end if;
 v_def:=replace(v_def,v_old,$new$
 when 'users.members' then return not exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id and not exists(select 1 from public.organization_members m where m.organization_id=p_job.organization_id and m.user_id::text=r.source_id));
 when 'roles.custom_roles' then return not exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id and not exists(select 1 from public.custom_roles x where x.organization_id=p_job.organization_id and x.id::text=r.source_id and not x.is_deleted));
 when 'invitations.pending' then return not exists(select 1 from public.export_snapshot_rows r where r.organization_id=p_job.organization_id and r.job_id=p_job.id and not exists(select 1 from public.invitations x where x.organization_id=p_job.organization_id and x.id::text=r.source_id));
 when 'organization.legal_entities' then$new$);execute v_def;
end $access$;
