-- M10-01. Global, reviewed legal text and tenant-local explicit selection.
-- The importer is deployment-only. Runtime writes go through the scoped RPC.

create table public.framework_pack_versions (
  pack_key text not null check (pack_key ~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$' and char_length(pack_key) <= 120),
  version_key text not null check (version_key ~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$' and char_length(version_key) <= 120),
  title text not null check (char_length(title) between 1 and 300),
  edition_date date not null,
  language text not null check (language ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  source_url text not null check (source_url ~ '^https://[^[:space:]]+$' and char_length(source_url) <= 2048),
  source_celex text not null check (char_length(source_celex) between 1 and 80),
  source_eli text not null check (char_length(source_eli) between 1 and 2048),
  source_publication_date date not null,
  attribution text not null check (char_length(attribution) between 1 and 1000),
  review_evidence text not null check (char_length(review_evidence) between 1 and 1000),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  requirement_count integer not null check (requirement_count between 1 and 1000),
  imported_at timestamptz not null default clock_timestamp(),
  primary key (pack_key,version_key)
);

create table public.framework_requirements (
  pack_key text not null,
  version_key text not null,
  requirement_key text not null check (requirement_key ~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$' and char_length(requirement_key) <= 120),
  identifier text not null check (char_length(identifier) between 1 and 120),
  parent_requirement_key text,
  position integer not null check (position between 1 and 10000),
  tree_order integer not null check (tree_order between 1 and 1000),
  depth integer not null check (depth between 0 and 9),
  heading text check (heading is null or char_length(heading) between 1 and 500),
  text text not null check (char_length(text) between 1 and 20000),
  source_reference text not null check (char_length(source_reference) between 1 and 500),
  primary key (pack_key,version_key,requirement_key),
  unique (pack_key,version_key,identifier),
  unique (pack_key,version_key,tree_order),
  unique nulls not distinct (pack_key,version_key,parent_requirement_key,position),
  foreign key (pack_key,version_key)
    references public.framework_pack_versions(pack_key,version_key) on delete restrict,
  foreign key (pack_key,version_key,parent_requirement_key)
    references public.framework_requirements(pack_key,version_key,requirement_key) on delete restrict,
  check (parent_requirement_key is distinct from requirement_key)
);
create index framework_requirements_tree_idx
  on public.framework_requirements(pack_key,version_key,tree_order);

create table public.organization_framework_selections (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pack_key text not null,
  version_key text not null,
  enabled boolean not null,
  revision integer not null check (revision >= 1),
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,pack_key),
  foreign key (pack_key,version_key)
    references public.framework_pack_versions(pack_key,version_key) on delete restrict
);
create index organization_framework_selections_version_idx
  on public.organization_framework_selections(pack_key,version_key,organization_id);

create function public.m10_reject_framework_content_change()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'Framework pack content is immutable' using errcode='23514';
end $$;
create trigger framework_pack_versions_immutable
  before update or delete on public.framework_pack_versions
  for each row execute function public.m10_reject_framework_content_change();
create trigger framework_requirements_immutable
  before update or delete on public.framework_requirements
  for each row execute function public.m10_reject_framework_content_change();

alter table public.framework_pack_versions enable row level security;
alter table public.framework_requirements enable row level security;
alter table public.organization_framework_selections enable row level security;
revoke all on public.framework_pack_versions,public.framework_requirements,
  public.organization_framework_selections from public,anon,authenticated,service_role;
grant select on public.framework_pack_versions,public.framework_requirements,
  public.organization_framework_selections to service_role;

create function public.m10_import_framework_pack(p_payload jsonb)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_hash text;
  v_count integer;
  v_reached integer;
  v_max_depth integer;
  v_existing text;
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object'
    or pg_column_size(p_payload)>2097152
    or p_payload->>'schemaVersion'<>'1'
    or exists(select 1 from jsonb_object_keys(p_payload) field
      where field not in ('schemaVersion','packKey','versionKey','title','editionDate',
        'language','sourceUrl','sourceCelex','sourceEli','sourcePublicationDate',
        'attribution','reviewEvidence','requirements'))
    or exists(select 1 from jsonb_each(p_payload) field(key,value)
      where key in ('packKey','versionKey','title','editionDate','language','sourceUrl',
        'sourceCelex','sourceEli','sourcePublicationDate','attribution','reviewEvidence')
        and jsonb_typeof(value)<>'string')
    or not (p_payload ?& array['schemaVersion','packKey','versionKey','title','editionDate',
      'language','sourceUrl','sourceCelex','sourceEli','sourcePublicationDate',
      'attribution','reviewEvidence','requirements'])
    or jsonb_typeof(p_payload->'requirements')<>'array'
    or char_length(p_payload->>'packKey') not between 1 and 120
    or (p_payload->>'packKey') !~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$'
    or char_length(p_payload->>'versionKey') not between 1 and 120
    or (p_payload->>'versionKey') !~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$'
    or char_length(coalesce(p_payload->>'title','')) not between 1 and 300
    or (p_payload->>'language') !~ '^[a-z]{2,3}(-[A-Z]{2})?$'
    or coalesce(p_payload->>'sourceUrl','') !~ '^https://[^[:space:]]+$'
    or char_length(coalesce(p_payload->>'sourceUrl',''))>2048
    or char_length(coalesce(p_payload->>'sourceCelex','')) not between 1 and 80
    or char_length(coalesce(p_payload->>'sourceEli','')) not between 1 and 2048
    or char_length(coalesce(p_payload->>'attribution','')) not between 1 and 1000
    or char_length(coalesce(p_payload->>'reviewEvidence','')) not between 1 and 1000
    or exists(select 1 from jsonb_each_text(p_payload) metadata(field,value)
      where field<>'requirements' and
        (value ~ '<[[:alpha:]/][^>]*>' or value ~ '[[:cntrl:]]'))
    or coalesce(p_payload->>'editionDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or coalesce(p_payload->>'sourcePublicationDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  then raise exception 'Invalid framework pack metadata' using errcode='22023'; end if;

  v_count:=jsonb_array_length(p_payload->'requirements');
  if v_count not between 1 and 1000 then
    raise exception 'Invalid framework requirement count' using errcode='22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_payload->'requirements') item
    where jsonb_typeof(item)<>'object'
      or exists(select 1 from jsonb_object_keys(item) field
        where field not in ('requirementKey','identifier','parentKey','position',
          'heading','text','sourceReference'))
      or not (item ?& array['requirementKey','identifier','parentKey','position',
        'heading','text','sourceReference'])
      or jsonb_typeof(item->'requirementKey')<>'string'
      or jsonb_typeof(item->'identifier')<>'string'
      or jsonb_typeof(item->'text')<>'string'
      or jsonb_typeof(item->'sourceReference')<>'string'
      or jsonb_typeof(item->'heading') not in ('string','null')
      or coalesce(item->>'requirementKey','') !~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$' or char_length(coalesce(item->>'requirementKey',''))>120
      or char_length(coalesce(item->>'identifier','')) not between 1 and 120
      or (item->>'heading' is not null and char_length(item->>'heading') not between 1 and 500)
      or char_length(coalesce(item->>'text','')) not between 1 and 20000
      or char_length(coalesce(item->>'sourceReference','')) not between 1 and 500
      or jsonb_typeof(item->'position')<>'number'
      or coalesce(item->>'position','') !~ '^[0-9]{1,5}$'
      or (item->>'position')::integer not between 1 and 10000
      or (item ? 'parentKey' and jsonb_typeof(item->'parentKey') not in ('null','string'))
      or exists(select 1 from jsonb_each_text(item) display(field,value)
        where field in ('identifier','heading','text','sourceReference')
          and (value ~ '<[[:alpha:]/][^>]*>' or value ~ '[[:cntrl:]]'))
  ) then raise exception 'Invalid framework requirement' using errcode='22023'; end if;

  if exists (
    select 1 from (
      select item->>'requirementKey' key from jsonb_array_elements(p_payload->'requirements') item
    ) keys group by key having count(*)>1
  ) or exists (
    select 1 from (
      select item->>'identifier' identifier from jsonb_array_elements(p_payload->'requirements') item
    ) labels group by identifier having count(*)>1
  ) or exists (
    select 1 from (
      select item->>'parentKey' parent_key,(item->>'position')::integer position
      from jsonb_array_elements(p_payload->'requirements') item
    ) siblings group by parent_key,position having count(*)>1
  ) then raise exception 'Duplicate framework requirement identity or position' using errcode='23505'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_payload->'requirements') item
    where item->>'parentKey' is not null
      and not exists (
        select 1 from jsonb_array_elements(p_payload->'requirements') parent
        where parent->>'requirementKey'=item->>'parentKey'
      )
  ) then raise exception 'Framework parent does not exist' using errcode='23503'; end if;

  with recursive nodes as (
    select item->>'requirementKey' key,item->>'parentKey' parent_key
    from jsonb_array_elements(p_payload->'requirements') item
  ), reached as (
    select key,parent_key,0 depth,array[key] path from nodes where parent_key is null
    union all
    select child.key,child.parent_key,parent.depth+1,parent.path||child.key
    from nodes child join reached parent on child.parent_key=parent.key
    where not child.key=any(parent.path) and parent.depth<10
  )
  select count(*),coalesce(max(depth),0) into v_reached,v_max_depth from reached;
  if v_reached<>v_count or v_max_depth>9 then
    raise exception 'Framework tree contains a cycle or exceeds ten levels' using errcode='22023';
  end if;

  -- JSONB normalizes object key order, but not array order. Canonicalize
  -- requirements by tree position so a reordered import remains identical.
  with recursive nodes as (
    select item,item->>'requirementKey' key,item->>'parentKey' parent_key,
      (item->>'position')::integer position
    from jsonb_array_elements(p_payload->'requirements') item
  ), reached as (
    select nodes.*,lpad(nodes.position::text,5,'0') sort_path
    from nodes where parent_key is null
    union all
    select child.*,parent.sort_path||'.'||lpad(child.position::text,5,'0')
    from nodes child join reached parent on child.parent_key=parent.key
  )
  select encode(extensions.digest(
    jsonb_set(p_payload,'{requirements}',jsonb_agg(item order by sort_path))::text,
    'sha256'),'hex') into v_hash from reached;
  perform pg_advisory_xact_lock(hashtextextended((p_payload->>'packKey')||':'||(p_payload->>'versionKey'),0));
  select content_hash into v_existing from public.framework_pack_versions
  where pack_key=p_payload->>'packKey' and version_key=p_payload->>'versionKey';
  if found then
    if v_existing=v_hash then return 'unchanged'; end if;
    raise exception 'Framework pack version already has different content' using errcode='23505';
  end if;

  insert into public.framework_pack_versions(
    pack_key,version_key,title,edition_date,language,source_url,source_celex,
    source_eli,source_publication_date,attribution,review_evidence,content_hash,requirement_count
  ) values (
    p_payload->>'packKey',p_payload->>'versionKey',p_payload->>'title',
    (p_payload->>'editionDate')::date,p_payload->>'language',
    p_payload->>'sourceUrl',p_payload->>'sourceCelex',p_payload->>'sourceEli',
    (p_payload->>'sourcePublicationDate')::date,p_payload->>'attribution',
    p_payload->>'reviewEvidence',v_hash,v_count
  );
  with recursive nodes as (
    select item->>'requirementKey' key,item->>'parentKey' parent_key,
      item->>'identifier' identifier,(item->>'position')::integer position,
      item->>'heading' heading,item->>'text' body,item->>'sourceReference' source_reference
    from jsonb_array_elements(p_payload->'requirements') item
  ), reached as (
    select nodes.*,0 depth,lpad(nodes.position::text,5,'0') sort_path
    from nodes where parent_key is null
    union all
    select child.*,parent.depth+1,parent.sort_path||'.'||lpad(child.position::text,5,'0')
    from nodes child join reached parent on child.parent_key=parent.key
  )
  insert into public.framework_requirements(
    pack_key,version_key,requirement_key,identifier,parent_requirement_key,
    position,tree_order,depth,heading,text,source_reference
  )
  select p_payload->>'packKey',p_payload->>'versionKey',key,identifier,parent_key,
    position,row_number() over(order by sort_path)::integer,depth,heading,body,source_reference
  from reached order by depth,parent_key nulls first,position;

  insert into public.audit_logs(action,entity_type,entity_id,changes)
  values('framework.pack_imported','framework_pack_version',
    (p_payload->>'packKey')||':'||(p_payload->>'versionKey'),
    jsonb_build_object('contentHash',v_hash,'requirementCount',v_count,
      'sourceCelex',p_payload->>'sourceCelex','sourceEli',p_payload->>'sourceEli'));
  return 'imported';
end $$;


-- Keep the DB's server-side authorization in the same merge order as
-- @repo/contracts: base role, additive custom role, hard organization override.
create function public.m10_actor_has_framework_permission(
  p_organization_id uuid,p_actor_user_id uuid,p_permission_key text
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  with membership as (
    select m.role from public.organization_members m
    join public.users u on u.id=m.user_id and u.is_active
    join public.organizations o on o.id=m.organization_id and o.is_active
    where m.organization_id=p_organization_id and m.user_id=p_actor_user_id
  ), custom_grant as (
    select bool_or((r.permissions->>p_permission_key)::boolean) granted
    from membership m join public.user_role_assignments a
      on a.organization_id=p_organization_id and a.user_id=p_actor_user_id
    join public.custom_roles r on r.organization_id=p_organization_id and r.id=a.role_id
    where r.is_active and not r.is_deleted
      and jsonb_typeof(r.permissions->p_permission_key)='boolean'
      and (r.permissions->>p_permission_key)::boolean
  )
  select case when p_permission_key not in ('can_view_frameworks','can_manage_frameworks')
    then false else coalesce(
    (select (o.permissions->>p_permission_key)::boolean
      from membership m join public.base_role_permission_overrides o
        on o.organization_id=p_organization_id and o.base_role=m.role
      where jsonb_typeof(o.permissions->p_permission_key)='boolean' limit 1),
    (select (case when p_permission_key='can_view_frameworks' then true
      else m.role in ('owner','admin') end) or coalesce(c.granted,false)
      from membership m cross join custom_grant c),false) end
$$;

create function public.m10_actor_can_manage_frameworks(p_organization_id uuid,p_actor_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.m10_actor_has_framework_permission(
      p_organization_id,p_actor_user_id,'can_manage_frameworks')
    and public.m10_actor_has_framework_permission(
      p_organization_id,p_actor_user_id,'can_view_frameworks')
$$;

create function public.m10_select_framework_version(
  p_organization_id uuid,p_actor_user_id uuid,p_pack_key text,p_version_key text,
  p_enabled boolean,p_expected_revision integer,p_idempotency_key uuid
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_existing public.organization_framework_selections%rowtype;
  v_prior jsonb;
  v_digest text;
  v_result jsonb;
  v_next_revision integer;
begin
  if p_organization_id is null or p_actor_user_id is null or p_pack_key is null
    or p_version_key is null or p_enabled is null or p_idempotency_key is null
    or (p_expected_revision is not null and p_expected_revision<1)
    or p_pack_key !~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$' or char_length(p_pack_key)>120
    or p_version_key !~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$' or char_length(p_version_key)>120
  then return query select 'invalid_request'::text,null::jsonb; return; end if;
  if not public.m10_actor_can_manage_frameworks(p_organization_id,p_actor_user_id) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if not exists(select 1 from public.framework_pack_versions p
    where p.pack_key=p_pack_key and p.version_key=p_version_key) then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  v_digest:=encode(extensions.digest(jsonb_build_object(
    'actor',p_actor_user_id,'packKey',p_pack_key,'versionKey',p_version_key,
    'enabled',p_enabled,'expectedRevision',p_expected_revision)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_pack_key,0));
  select a.changes into v_prior from public.audit_logs a
  where a.organization_id=p_organization_id and a.entity_type='framework_selection'
    and a.entity_id=p_pack_key and a.changes->>'idempotencyKey'=p_idempotency_key::text
  order by a.created_at desc limit 1;
  if found then
    if v_prior->>'requestDigest'<>v_digest then
      return query select 'invalid_request'::text,null::jsonb; return;
    end if;
    return query select v_prior->>'outcome',v_prior->'result'; return;
  end if;
  select * into v_existing from public.organization_framework_selections
  where organization_id=p_organization_id and pack_key=p_pack_key for update;
  if (found and p_expected_revision is distinct from v_existing.revision)
    or (not found and p_expected_revision is not null) then
    return query select 'conflict'::text,
      case when v_existing.organization_id is null then null::jsonb
      else jsonb_build_object('packKey',v_existing.pack_key,
        'versionKey',v_existing.version_key,'enabled',v_existing.enabled,
        'revision',v_existing.revision) end;
    return;
  end if;
  v_next_revision:=coalesce(v_existing.revision,0)+1;
  if v_existing.organization_id is null then
    insert into public.organization_framework_selections(
      organization_id,pack_key,version_key,enabled,revision,updated_by)
    values(p_organization_id,p_pack_key,p_version_key,p_enabled,1,p_actor_user_id);
  elsif v_existing.version_key is distinct from p_version_key or v_existing.enabled is distinct from p_enabled then
    update public.organization_framework_selections
      set version_key=p_version_key,enabled=p_enabled,revision=v_next_revision,
        updated_by=p_actor_user_id,updated_at=clock_timestamp()
      where organization_id=p_organization_id and pack_key=p_pack_key;
  else
    v_next_revision:=v_existing.revision;
  end if;
  v_result:=jsonb_build_object('packKey',p_pack_key,'versionKey',p_version_key,
    'enabled',p_enabled,'revision',v_next_revision);
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,
    case when v_existing.organization_id is not null and
      v_existing.version_key=p_version_key and v_existing.enabled=p_enabled
      then 'framework.selection_unchanged' else 'framework.selection_changed' end,
    'framework_selection',p_pack_key,jsonb_build_object(
      'idempotencyKey',p_idempotency_key,'requestDigest',v_digest,
      'oldVersionKey',v_existing.version_key,'oldEnabled',v_existing.enabled,
      'oldRevision',v_existing.revision,'outcome',
      case when v_next_revision=coalesce(v_existing.revision,0) then 'unchanged' else 'selected' end,
      'result',v_result));
  return query select
    case when v_next_revision=coalesce(v_existing.revision,0) then 'unchanged' else 'selected' end,
    v_result;
end $$;

revoke all on function public.m10_reject_framework_content_change(),
  public.m10_import_framework_pack(jsonb),
  public.m10_actor_has_framework_permission(uuid,uuid,text),
  public.m10_actor_can_manage_frameworks(uuid,uuid),
  public.m10_select_framework_version(uuid,uuid,text,text,boolean,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.m10_select_framework_version(uuid,uuid,text,text,boolean,integer,uuid)
  to service_role;
