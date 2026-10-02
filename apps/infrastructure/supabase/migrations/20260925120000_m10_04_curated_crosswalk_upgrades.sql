-- M10-04. Curated, exact-version relations and explicitly reviewed tenant upgrades.
-- No proprietary normative text is supplied by this migration.

alter table public.framework_pack_versions
  add column source_kind text not null default 'public_law'
    check (source_kind in ('public_law','licensed_standard','approved_fixture')),
  add column edition_label text,
  add column distribution_rights text,
  add column rights_evidence text,
  add column review_owner text,
  add column approved_at timestamptz;
alter table public.framework_pack_versions
  alter column source_celex drop not null,
  alter column source_eli drop not null;
alter table public.framework_pack_versions add constraint framework_pack_public_law_source_check check (
  source_kind<>'public_law' or
  (source_celex is not null and char_length(source_celex) between 1 and 80
   and source_eli is not null and char_length(source_eli) between 1 and 2048));
alter table public.framework_pack_versions add constraint framework_pack_licensed_rights_check check (
  (pack_key !~ '^(iec-62443|iso-sae-21434)' or source_kind='licensed_standard') and
  source_kind<>'licensed_standard' or
  (edition_label is not null and char_length(btrim(edition_label)) between 1 and 200
   and distribution_rights is not null and char_length(btrim(distribution_rights)) between 20 and 2000
   and rights_evidence is not null and char_length(btrim(rights_evidence)) between 20 and 2000
   and review_owner is not null and char_length(btrim(review_owner)) between 1 and 200
   and approved_at is not null));
create or replace function public.m10_import_framework_pack(p_payload jsonb)
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
        'attribution','reviewEvidence','requirements','sourceKind','editionLabel',
        'distributionRights','rightsEvidence','reviewOwner','approvedAt'))
    or exists(select 1 from jsonb_each(p_payload) field(key,value)
      where key in ('packKey','versionKey','title','editionDate','language','sourceUrl',
        'sourceCelex','sourceEli','sourcePublicationDate','attribution','reviewEvidence',
        'sourceKind','editionLabel','distributionRights','rightsEvidence','reviewOwner','approvedAt')
        and jsonb_typeof(value)<>'string')
    or not (p_payload ?& array['schemaVersion','packKey','versionKey','title','editionDate',
      'language','sourceUrl','sourcePublicationDate',
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
    or (coalesce(p_payload->>'sourceKind','public_law')='public_law' and
      (char_length(coalesce(p_payload->>'sourceCelex','')) not between 1 and 80
       or char_length(coalesce(p_payload->>'sourceEli','')) not between 1 and 2048))
    or (p_payload->>'sourceCelex' is not null and char_length(p_payload->>'sourceCelex')>80)
    or (p_payload->>'sourceEli' is not null and char_length(p_payload->>'sourceEli')>2048)
    or coalesce(p_payload->>'sourceKind','public_law') not in ('public_law','licensed_standard','approved_fixture')
    or ((p_payload->>'packKey') ~ '^(iec-62443|iso-sae-21434)'
      and p_payload->>'sourceKind' is distinct from 'licensed_standard')
    or (coalesce(p_payload->>'sourceKind','public_law')='licensed_standard' and
      (char_length(coalesce(p_payload->>'editionLabel','')) not between 1 and 200
       or char_length(coalesce(p_payload->>'distributionRights','')) not between 20 and 2000
       or char_length(coalesce(p_payload->>'rightsEvidence','')) not between 20 and 2000
       or char_length(coalesce(p_payload->>'reviewOwner','')) not between 1 and 200
       or p_payload->>'approvedAt' is null))
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
    source_eli,source_publication_date,attribution,review_evidence,content_hash,requirement_count,
    source_kind,edition_label,distribution_rights,rights_evidence,review_owner,approved_at
  ) values (
    p_payload->>'packKey',p_payload->>'versionKey',p_payload->>'title',
    (p_payload->>'editionDate')::date,p_payload->>'language',
    p_payload->>'sourceUrl',p_payload->>'sourceCelex',p_payload->>'sourceEli',
    (p_payload->>'sourcePublicationDate')::date,p_payload->>'attribution',
    p_payload->>'reviewEvidence',v_hash,v_count,coalesce(p_payload->>'sourceKind','public_law'),
    p_payload->>'editionLabel',p_payload->>'distributionRights',p_payload->>'rightsEvidence',
    p_payload->>'reviewOwner',(p_payload->>'approvedAt')::timestamptz
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

create table public.framework_curated_crosswalks (
  id uuid primary key default gen_random_uuid(),
  source_pack_key text not null, source_version_key text not null, source_requirement_key text not null,
  target_pack_key text not null, target_version_key text not null, target_requirement_key text not null,
  strength text not null check (strength in ('equivalent','partial','supports','related','uncertain')),
  direction text not null check (direction in ('one_way','bidirectional')),
  rationale text not null check (char_length(btrim(rationale)) between 1 and 2000 and rationale !~ '[[:cntrl:]]|<[[:alpha:]/][^>]*>'),
  provenance text not null check (char_length(btrim(provenance)) between 1 and 2000 and provenance !~ '[[:cntrl:]]|<[[:alpha:]/][^>]*>'),
  reviewer text not null check (char_length(btrim(reviewer)) between 1 and 200 and reviewer !~ '[[:cntrl:]]|<[[:alpha:]/][^>]*>'),
  reviewed_at timestamptz not null,
  retired_at timestamptz,
  retirement_reason text check (retirement_reason is null or (char_length(btrim(retirement_reason)) between 1 and 1000
    and retirement_reason !~ '[[:cntrl:]]|<[[:alpha:]/][^>]*>')),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (source_pack_key,source_version_key,source_requirement_key)
    references public.framework_requirements(pack_key,version_key,requirement_key) on delete restrict,
  foreign key (target_pack_key,target_version_key,target_requirement_key)
    references public.framework_requirements(pack_key,version_key,requirement_key) on delete restrict,
  check ((source_pack_key,source_version_key,source_requirement_key) is distinct from
    (target_pack_key,target_version_key,target_requirement_key)),
  check ((retired_at is null)=(retirement_reason is null))
);
create unique index framework_curated_crosswalks_active_idx on public.framework_curated_crosswalks
  (source_pack_key,source_version_key,source_requirement_key,target_pack_key,target_version_key,target_requirement_key)
  where retired_at is null;
create index framework_curated_crosswalks_target_idx on public.framework_curated_crosswalks
  (target_pack_key,target_version_key,target_requirement_key,source_pack_key,source_version_key) where retired_at is null;

create table public.framework_upgrade_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pack_key text not null,
  source_version_key text not null,
  target_version_key text not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  target_hash text not null check (target_hash ~ '^[a-f0-9]{64}$'),
  selection_revision integer not null check (selection_revision>=1),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  revision integer not null default 1 check (revision>=1),
  status text not null default 'draft' check (status in ('draft','committed')),
  created_by uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  committed_by uuid references public.users(id) on delete restrict,
  committed_at timestamptz,
  commit_idempotency_key uuid,
  commit_digest text check (commit_digest is null or commit_digest ~ '^[a-f0-9]{64}$'),
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,created_by,idempotency_key),
  foreign key (pack_key,source_version_key) references public.framework_pack_versions(pack_key,version_key) on delete restrict,
  foreign key (pack_key,target_version_key) references public.framework_pack_versions(pack_key,version_key) on delete restrict,
  check (source_version_key<>target_version_key),
  check ((status='committed')=(committed_at is not null))
);
create index framework_upgrade_reviews_org_idx on public.framework_upgrade_reviews(organization_id,pack_key,created_at desc,id);
create trigger set_framework_upgrade_reviews_updated_at before update on public.framework_upgrade_reviews
  for each row execute function public.set_updated_at();

create table public.framework_upgrade_decisions (
  organization_id uuid not null,
  review_id uuid not null,
  mapping_id uuid not null,
  target_requirement_keys text[] not null,
  decided_by uuid not null references public.users(id) on delete restrict,
  decided_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,review_id,mapping_id),
  foreign key (organization_id,review_id) references public.framework_upgrade_reviews(organization_id,id) on delete restrict,
  foreign key (organization_id,mapping_id) references public.framework_control_requirement_mappings(organization_id,id) on delete restrict,
  check (cardinality(target_requirement_keys)<=100)
);
create index framework_upgrade_decisions_mapping_idx on public.framework_upgrade_decisions(organization_id,mapping_id);
-- Reviews and decisions are durable tenant records. They export with the
-- framework control source and cascade only through authorized tenant purge.
alter table public.framework_upgrade_decisions
  drop constraint framework_upgrade_decisions_organization_id_review_id_fkey,
  drop constraint framework_upgrade_decisions_organization_id_mapping_id_fkey,
  add constraint framework_upgrade_decisions_review_fkey
    foreign key (organization_id,review_id)
    references public.framework_upgrade_reviews(organization_id,id) on delete cascade,
  add constraint framework_upgrade_decisions_mapping_fkey
    foreign key (organization_id,mapping_id)
    references public.framework_control_requirement_mappings(organization_id,id) on delete cascade;
insert into public.organization_export_source_tables(
  source_id,table_name,tenant_key_column,record_order_column,table_sort
) values
  ('framework_controls','framework_upgrade_reviews','organization_id','id',7),
  ('framework_controls','framework_upgrade_decisions','organization_id','review_id',8)
on conflict (source_id,table_name) do update
set tenant_key_column=excluded.tenant_key_column,
  record_order_column=excluded.record_order_column,table_sort=excluded.table_sort;
do $$
declare
  v_definition text;
  v_old text := 'public.framework_requirement_applicability' || chr(10) || '  in share mode';
  v_new text := 'public.framework_requirement_applicability, public.framework_upgrade_reviews, public.framework_upgrade_decisions'
    || chr(10) || '  in share mode';
begin
  select pg_get_functiondef(
    'public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure)
  into v_definition;
  if position(v_old in v_definition)=0 then
    raise exception 'M10 upgrade export lock anchor missing';
  end if;
  execute replace(v_definition,v_old,v_new);
end $$;


alter table public.framework_curated_crosswalks enable row level security;
alter table public.framework_upgrade_reviews enable row level security;
alter table public.framework_upgrade_decisions enable row level security;
revoke all on public.framework_curated_crosswalks,
  public.framework_upgrade_reviews,public.framework_upgrade_decisions from public,anon,authenticated,service_role;
grant select on public.framework_curated_crosswalks,
  public.framework_upgrade_reviews,public.framework_upgrade_decisions to service_role;

create function public.m10_guard_crosswalk_change() returns trigger language plpgsql
set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' then raise exception 'Curated relation history is immutable' using errcode='23514'; end if;
  if old.retired_at is not null or new.retired_at is null or new.retirement_reason is null
    or (to_jsonb(new)-'retired_at'-'retirement_reason') <> (to_jsonb(old)-'retired_at'-'retirement_reason') then
    raise exception 'Only a one-time curated relation retirement is permitted' using errcode='23514';
  end if;
  insert into public.audit_logs(action,entity_type,entity_id,changes)
  values('framework.crosswalk_retired','framework_curated_crosswalk',old.id::text,
    jsonb_build_object('retiredAt',new.retired_at,'reason',new.retirement_reason));
  return new;
end $$;
create trigger framework_curated_crosswalks_immutable before update or delete
  on public.framework_curated_crosswalks for each row execute function public.m10_guard_crosswalk_change();
create function public.m10_upgrade_fingerprint(p_organization_id uuid,p_pack_key text,p_source_version_key text)
returns text language sql stable security definer set search_path=public,pg_temp as $$
  select encode(extensions.digest(coalesce((
    select jsonb_agg(jsonb_build_object('mappingId',m.id,'controlId',m.control_id,
      'controlRevision',c.revision,'requirementKey',m.requirement_key,
      'rationale',m.rationale,'products',coalesce((select jsonb_agg(mp.product_id order by mp.product_id)
        from public.framework_control_mapping_products mp where mp.organization_id=m.organization_id and mp.mapping_id=m.id),'[]'::jsonb),
      'evidence',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'version',l.evidence_version_id,
        'product',l.product_id) order by l.id) from public.framework_control_evidence_links l
        where l.organization_id=m.organization_id and l.control_id=m.control_id and l.ended_at is null),'[]'::jsonb))
      order by m.id)
    from public.framework_control_requirement_mappings m
    join public.framework_controls c on c.organization_id=m.organization_id and c.id=m.control_id
    where m.organization_id=p_organization_id and m.pack_key=p_pack_key
      and m.version_key=p_source_version_key and m.ended_at is null
  )::text,'[]'),'sha256'),'hex')
$$;

create function public.m10_upgrade_diff(p_pack_key text,p_source_version_key text,p_target_version_key text)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with old_req as (select * from public.framework_requirements
    where pack_key=p_pack_key and version_key=p_source_version_key),
  new_req as (select * from public.framework_requirements
    where pack_key=p_pack_key and version_key=p_target_version_key),
  edges as (select source_requirement_key,target_requirement_key
    from public.framework_curated_crosswalks where source_pack_key=p_pack_key
      and source_version_key=p_source_version_key and target_pack_key=p_pack_key
      and target_version_key=p_target_version_key and retired_at is null
      and strength in ('equivalent','partial','supports')),
  splits as (select source_requirement_key from edges group by source_requirement_key having count(distinct target_requirement_key)>1),
  merges as (select target_requirement_key from edges group by target_requirement_key having count(distinct source_requirement_key)>1)
  select jsonb_build_object(
    'added',coalesce((select jsonb_agg(n.requirement_key order by n.requirement_key)
      from new_req n where not exists(select 1 from old_req o where o.requirement_key=n.requirement_key)),'[]'::jsonb),
    'removed',coalesce((select jsonb_agg(o.requirement_key order by o.requirement_key)
      from old_req o where not exists(select 1 from new_req n where n.requirement_key=o.requirement_key)),'[]'::jsonb),
    'changed',coalesce((select jsonb_agg(n.requirement_key order by n.requirement_key)
      from new_req n join old_req o using(requirement_key)
      where (n.identifier,n.parent_requirement_key,n.position,n.heading,n.text,n.source_reference)
        is distinct from (o.identifier,o.parent_requirement_key,o.position,o.heading,o.text,o.source_reference)),'[]'::jsonb),
    'split',coalesce((select jsonb_agg(source_requirement_key order by source_requirement_key) from splits),'[]'::jsonb),
    'merged',coalesce((select jsonb_agg(target_requirement_key order by target_requirement_key) from merges),'[]'::jsonb))
$$;

create function public.m10_crosswalk_page(p_organization_id uuid,p_actor_user_id uuid,
  p_pack_key text,p_version_key text,p_limit integer,p_offset integer)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_total integer;
begin
  if not public.m10_actor_has_framework_permission(p_organization_id,p_actor_user_id,'can_view_frameworks') then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_pack_key is null or p_version_key is null or p_limit not between 1 and 100
    or p_offset not between 0 and 100000 then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  select count(*) into v_total from public.framework_curated_crosswalks c where c.retired_at is null
    and ((c.source_pack_key=p_pack_key and c.source_version_key=p_version_key)
      or (c.target_pack_key=p_pack_key and c.target_version_key=p_version_key));
  return query select 'listed'::text,jsonb_build_object('relations',coalesce((
    select jsonb_agg(public.m10_curated_relation_json(x) order by x.id)
    from (select * from public.framework_curated_crosswalks c
      where c.retired_at is null and ((c.source_pack_key=p_pack_key and c.source_version_key=p_version_key)
        or (c.target_pack_key=p_pack_key and c.target_version_key=p_version_key))
      order by c.id limit p_limit offset p_offset) x),'[]'::jsonb),
    'nextCursor',case when p_offset+p_limit<v_total then
      rtrim(translate(encode(convert_to((p_offset+p_limit)::text,'UTF8'),'base64'),'+/','-_'),'=')
      else null end);
end $$;

create function public.m10_upgrade_preview(p_organization_id uuid,p_actor_user_id uuid,
  p_pack_key text,p_target_version_key text,p_limit integer,p_cursor uuid)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_selection public.organization_framework_selections%rowtype;
  v_source_hash text; v_target_hash text; v_total integer; v_next uuid; v_impacts jsonb;
begin
  if not public.m10_actor_can_manage_frameworks(p_organization_id,p_actor_user_id)
    or not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_products')
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence') then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_pack_key is null or p_target_version_key is null or p_limit not between 1 and 100 then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  select * into v_selection from public.organization_framework_selections s
    where s.organization_id=p_organization_id and s.pack_key=p_pack_key;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_selection.version_key=p_target_version_key then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  select content_hash into v_source_hash from public.framework_pack_versions
    where pack_key=p_pack_key and version_key=v_selection.version_key;
  select content_hash into v_target_hash from public.framework_pack_versions
    where pack_key=p_pack_key and version_key=p_target_version_key;
  if v_target_hash is null or (p_pack_key ~ '^(iec-62443|iso-sae-21434)'
    and not exists(select 1 from public.framework_pack_versions a
      where a.pack_key=p_pack_key and a.version_key=p_target_version_key
        and a.source_kind='licensed_standard' and a.approved_at is not null)) then
    return query select 'blocked'::text,jsonb_build_object('reason','pack_not_authorized'); return;
  end if;
  select count(*) into v_total from public.framework_control_requirement_mappings m
    where m.organization_id=p_organization_id and m.pack_key=p_pack_key
      and m.version_key=v_selection.version_key and m.ended_at is null;
  with page as (select m.*,c.revision control_revision from public.framework_control_requirement_mappings m
    join public.framework_controls c on c.organization_id=m.organization_id and c.id=m.control_id
    where m.organization_id=p_organization_id and m.pack_key=p_pack_key
      and m.version_key=v_selection.version_key and m.ended_at is null
      and (p_cursor is null or m.id>p_cursor) order by m.id limit p_limit)
  select coalesce(jsonb_agg(jsonb_build_object('mappingId',x.id,'controlId',x.control_id,
      'controlRevision',x.control_revision,'sourceRequirementKey',x.requirement_key,
      'productIds',coalesce((select jsonb_agg(mp.product_id order by mp.product_id)
        from public.framework_control_mapping_products mp where mp.organization_id=p_organization_id and mp.mapping_id=x.id),'[]'::jsonb),
      'evidenceVersionIds',coalesce((select jsonb_agg(distinct l.evidence_version_id)
        from public.framework_control_evidence_links l
        join public.framework_control_mapping_products mp on mp.organization_id=l.organization_id
          and mp.mapping_id=x.id and mp.product_id=l.product_id
        where l.organization_id=p_organization_id and l.control_id=x.control_id
          and l.ended_at is null),'[]'::jsonb),
      'suggestedTargetKeys',coalesce((select jsonb_agg(distinct w.target_requirement_key)
        from public.framework_curated_crosswalks w where w.source_pack_key=p_pack_key
          and w.source_version_key=v_selection.version_key and w.source_requirement_key=x.requirement_key
          and w.target_pack_key=p_pack_key and w.target_version_key=p_target_version_key
          and w.retired_at is null
          and w.strength in ('equivalent','partial','supports')),'[]'::jsonb)) order by x.id),'[]'::jsonb),(array_agg(x.id order by x.id desc))[1]
    into v_impacts,v_next from page x;
  if (select count(*) from public.framework_control_requirement_mappings m where m.organization_id=p_organization_id
    and m.pack_key=p_pack_key and m.version_key=v_selection.version_key and m.ended_at is null
    and m.id>v_next)>0 then null; else v_next:=null; end if;
  return query select 'previewed'::text,jsonb_build_object('packKey',p_pack_key,
    'sourceVersionKey',v_selection.version_key,'targetVersionKey',p_target_version_key,
    'selectionRevision',v_selection.revision,'sourceHash',v_source_hash,'targetHash',v_target_hash,
    'fingerprint',public.m10_upgrade_fingerprint(p_organization_id,p_pack_key,v_selection.version_key),
    'diff',public.m10_upgrade_diff(p_pack_key,v_selection.version_key,p_target_version_key),
    'impacts',v_impacts,'nextCursor',v_next,'totalImpacts',v_total);
end $$;

create function public.m10_create_upgrade_review(p_organization_id uuid,p_actor_user_id uuid,
  p_pack_key text,p_target_version_key text,p_expected_selection_revision integer,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_selection public.organization_framework_selections%rowtype;
  v_prior public.framework_upgrade_reviews%rowtype; v_review public.framework_upgrade_reviews%rowtype;
  v_preview jsonb; v_preview_outcome text; v_digest text;
begin
  if not public.m10_actor_can_manage_frameworks(p_organization_id,p_actor_user_id)
    or not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_products')
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence') then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_pack_key is null or p_target_version_key is null or p_expected_selection_revision is null
    or p_expected_selection_revision<1 or p_idempotency_key is null then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('pack',p_pack_key,
    'target',p_target_version_key,'expected',p_expected_selection_revision)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_pack_key,0));
  select * into v_prior from public.framework_upgrade_reviews r where r.organization_id=p_organization_id
    and r.created_by=p_actor_user_id and r.idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_digest<>v_digest then return query select 'invalid_request'::text,null::jsonb; return; end if;
    return query select 'created'::text,jsonb_build_object('reviewId',v_prior.id,'revision',1,
      'packKey',v_prior.pack_key,'sourceVersionKey',v_prior.source_version_key,
      'targetVersionKey',v_prior.target_version_key,'status','draft'); return;
  end if;
  select * into v_selection from public.organization_framework_selections s
    where s.organization_id=p_organization_id and s.pack_key=p_pack_key for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_selection.revision<>p_expected_selection_revision then
    return query select 'conflict'::text,jsonb_build_object('selectionRevision',v_selection.revision); return;
  end if;
  select x.outcome,x.result into v_preview_outcome,v_preview from public.m10_upgrade_preview(
    p_organization_id,p_actor_user_id,p_pack_key,p_target_version_key,1,null) x;
  if v_preview_outcome<>'previewed' then return query select v_preview_outcome,v_preview; return; end if;
  insert into public.framework_upgrade_reviews(organization_id,pack_key,source_version_key,
    target_version_key,source_hash,target_hash,selection_revision,fingerprint,created_by,
    idempotency_key,request_digest)
  values(p_organization_id,p_pack_key,v_selection.version_key,p_target_version_key,
    v_preview->>'sourceHash',v_preview->>'targetHash',v_selection.revision,
    v_preview->>'fingerprint',p_actor_user_id,p_idempotency_key,v_digest)
  returning * into v_review;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'framework.upgrade_review_created',
    'framework_upgrade_review',v_review.id::text,
    jsonb_build_object('packKey',p_pack_key,'sourceVersionKey',v_review.source_version_key,
      'targetVersionKey',p_target_version_key,'selectionRevision',v_selection.revision,
      'sourceHash',v_review.source_hash,'targetHash',v_review.target_hash));
  return query select 'created'::text,jsonb_build_object('reviewId',v_review.id,'revision',v_review.revision,
    'packKey',v_review.pack_key,'sourceVersionKey',v_review.source_version_key,
    'targetVersionKey',v_review.target_version_key,'status',v_review.status);
end $$;

create function public.m10_upgrade_review_page(p_organization_id uuid,p_actor_user_id uuid,
  p_review_id uuid,p_limit integer,p_offset integer)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_review public.framework_upgrade_reviews%rowtype; v_total integer;
begin
  if not public.m10_actor_can_manage_frameworks(p_organization_id,p_actor_user_id)
    or not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_products')
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence') then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_review_id is null or p_limit not between 1 and 100 or p_offset not between 0 and 100000 then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  select * into v_review from public.framework_upgrade_reviews r
    where r.organization_id=p_organization_id and r.id=p_review_id;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  select count(*) into v_total from public.framework_upgrade_decisions d
    where d.organization_id=p_organization_id and d.review_id=p_review_id;
  return query select 'listed'::text,jsonb_build_object('reviewId',v_review.id,
    'packKey',v_review.pack_key,'sourceVersionKey',v_review.source_version_key,
    'targetVersionKey',v_review.target_version_key,'revision',v_review.revision,'status',v_review.status,
    'decisions',coalesce((select jsonb_agg(jsonb_build_object('mappingId',d.mapping_id,
      'action',case when cardinality(d.target_requirement_keys)=0 then 'leave_gap' else 'map' end,
      'targetRequirementKeys',d.target_requirement_keys) order by d.mapping_id)
      from (select * from public.framework_upgrade_decisions d
        where d.organization_id=p_organization_id and d.review_id=p_review_id
        order by d.mapping_id limit p_limit offset p_offset) d),'[]'::jsonb),
    'nextCursor',case when p_offset+p_limit<v_total then
      rtrim(translate(encode(convert_to((p_offset+p_limit)::text,'UTF8'),'base64'),'+/','-_'),'=')
      else null end);
end $$;

create function public.m10_set_upgrade_decision(p_organization_id uuid,p_actor_user_id uuid,
  p_review_id uuid,p_mapping_id uuid,p_target_keys text[],p_expected_review_revision integer,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_review public.framework_upgrade_reviews%rowtype; v_prior jsonb; v_digest text;
begin
  if not public.m10_actor_can_manage_frameworks(p_organization_id,p_actor_user_id)
    or not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_products')
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence') then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_review_id is null or p_mapping_id is null or p_target_keys is null
    or cardinality(p_target_keys)>100 or array_position(p_target_keys,null) is not null
    or p_expected_review_revision is null or p_expected_review_revision<1 or p_idempotency_key is null
    or exists(select 1 from unnest(p_target_keys) k group by k having count(*)>1) then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('mapping',p_mapping_id,
    'targets',p_target_keys,'expected',p_expected_review_revision)::text,'sha256'),'hex');
  select * into v_review from public.framework_upgrade_reviews r
    where r.organization_id=p_organization_id and r.id=p_review_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  select a.changes into v_prior from public.audit_logs a where a.organization_id=p_organization_id
    and a.entity_type='framework_upgrade_review' and a.entity_id=p_review_id::text
    and a.changes->>'idempotencyKey'=p_idempotency_key::text order by a.created_at desc limit 1;
  if found then
    if v_prior->>'requestDigest'<>v_digest then return query select 'invalid_request'::text,null::jsonb; return; end if;
    return query select 'recorded'::text,v_prior->'result'; return;
  end if;
  if v_review.status<>'draft' or v_review.revision<>p_expected_review_revision then
    return query select 'conflict'::text,jsonb_build_object('reviewRevision',v_review.revision,'status',v_review.status); return;
  end if;
  if not exists(select 1 from public.framework_control_requirement_mappings m
    where m.organization_id=p_organization_id and m.id=p_mapping_id and m.pack_key=v_review.pack_key
      and m.version_key=v_review.source_version_key and m.ended_at is null)
    or exists(select 1 from unnest(p_target_keys) k left join public.framework_requirements req
      on req.pack_key=v_review.pack_key and req.version_key=v_review.target_version_key
        and req.requirement_key=k where req.requirement_key is null) then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  insert into public.framework_upgrade_decisions(organization_id,review_id,mapping_id,target_requirement_keys,decided_by)
  values(p_organization_id,p_review_id,p_mapping_id,p_target_keys,p_actor_user_id)
  on conflict (organization_id,review_id,mapping_id) do update set
    target_requirement_keys=excluded.target_requirement_keys,decided_by=excluded.decided_by,
    decided_at=clock_timestamp();
  update public.framework_upgrade_reviews set revision=revision+1,updated_at=clock_timestamp()
    where organization_id=p_organization_id and id=p_review_id returning * into v_review;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'framework.upgrade_decision_recorded',
    'framework_upgrade_review',p_review_id::text,
    jsonb_build_object('idempotencyKey',p_idempotency_key,'requestDigest',v_digest,
      'mappingId',p_mapping_id,'targetRequirementKeys',p_target_keys,
      'result',jsonb_build_object('reviewId',p_review_id,'revision',v_review.revision)));
  return query select 'recorded'::text,jsonb_build_object('reviewId',p_review_id,'revision',v_review.revision);
end $$;

-- The shared transaction lock serializes upgrade commit with control and
-- mapping writes. A mapping insert rechecks the selected version after lock.
create function public.m10_guard_upgrade_write() returns trigger language plpgsql
set search_path=public,pg_temp as $$
declare v_org uuid;
begin
  v_org:=case when tg_op='DELETE' then old.organization_id else new.organization_id end;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text||':framework-upgrade',0));
  if tg_table_name='framework_control_requirement_mappings' and tg_op='INSERT' then
    if not exists(select 1 from public.organization_framework_selections s
      where s.organization_id=new.organization_id and s.pack_key=new.pack_key
        and s.version_key=new.version_key
        and (s.enabled or current_setting('cra.framework_upgrade',true)='on')) then
      raise exception 'Selected framework version changed' using errcode='40001';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger m10_upgrade_control_lock before insert or update or delete on public.framework_controls
  for each row execute function public.m10_guard_upgrade_write();
create trigger m10_upgrade_mapping_lock before insert or update or delete on public.framework_control_requirement_mappings
  for each row execute function public.m10_guard_upgrade_write();
create trigger m10_upgrade_evidence_lock before insert or update or delete on public.framework_control_evidence_links
  for each row execute function public.m10_guard_upgrade_write();

create function public.m10_commit_upgrade(p_organization_id uuid,p_actor_user_id uuid,
  p_review_id uuid,p_expected_review_revision integer,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_review public.framework_upgrade_reviews%rowtype;
  v_selection public.organization_framework_selections%rowtype;
  v_digest text; v_result jsonb; v_control record; v_mapping record; v_target text;
  v_new_revision integer; v_new_mapping uuid; v_now timestamptz:=clock_timestamp();
  v_migrated_count integer; v_gap_count integer;
begin
  if not public.m10_actor_can_manage_frameworks(p_organization_id,p_actor_user_id)
    or not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_products')
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence') then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_review_id is null or p_expected_review_revision is null
    or p_expected_review_revision<1 or p_idempotency_key is null then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('review',p_review_id,
    'expected',p_expected_review_revision)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':framework-upgrade',0));
  select * into v_review from public.framework_upgrade_reviews r
    where r.organization_id=p_organization_id and r.id=p_review_id for update;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  if v_review.status='committed' then
    if v_review.commit_idempotency_key=p_idempotency_key and v_review.commit_digest=v_digest then
      return query select 'upgraded'::text,v_review.result; return;
    end if;
    return query select 'conflict'::text,jsonb_build_object('reviewRevision',v_review.revision,'status',v_review.status); return;
  end if;
  if v_review.revision<>p_expected_review_revision then
    return query select 'conflict'::text,jsonb_build_object('reviewRevision',v_review.revision); return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_review.pack_key,0));
  select * into v_selection from public.organization_framework_selections s
    where s.organization_id=p_organization_id and s.pack_key=v_review.pack_key for update;
  if not found or v_selection.revision<>v_review.selection_revision
    or v_selection.version_key<>v_review.source_version_key
    or (select content_hash from public.framework_pack_versions p where p.pack_key=v_review.pack_key
      and p.version_key=v_review.source_version_key)<>v_review.source_hash
    or (select content_hash from public.framework_pack_versions p where p.pack_key=v_review.pack_key
      and p.version_key=v_review.target_version_key)<>v_review.target_hash
    or public.m10_upgrade_fingerprint(p_organization_id,v_review.pack_key,v_review.source_version_key)<>v_review.fingerprint then
    return query select 'conflict'::text,jsonb_build_object('reason','source_changed'); return;
  end if;
  if (select count(*) from public.framework_control_requirement_mappings m where m.organization_id=p_organization_id
    and m.pack_key=v_review.pack_key and m.version_key=v_review.source_version_key and m.ended_at is null)
    <>(select count(*) from public.framework_upgrade_decisions d
      join public.framework_control_requirement_mappings m on m.organization_id=d.organization_id and m.id=d.mapping_id
      where d.organization_id=p_organization_id and d.review_id=p_review_id
        and m.pack_key=v_review.pack_key and m.version_key=v_review.source_version_key and m.ended_at is null) then
    return query select 'blocked'::text,jsonb_build_object('reason','missing_decisions'); return;
  end if;
  if exists(select 1 from public.framework_upgrade_decisions d
      join public.framework_control_requirement_mappings m on m.organization_id=d.organization_id and m.id=d.mapping_id
      cross join lateral unnest(d.target_requirement_keys) target(requirement_key)
      join public.framework_control_requirement_mappings existing on existing.organization_id=p_organization_id
        and existing.control_id=m.control_id and existing.pack_key=v_review.pack_key
        and existing.version_key=v_review.target_version_key and existing.requirement_key=target.requirement_key
        and existing.ended_at is null
      where d.organization_id=p_organization_id and d.review_id=p_review_id)
  then return query select 'conflict'::text,jsonb_build_object('reason','duplicate_target_mapping'); return; end if;
  select count(distinct (m.control_id,target.requirement_key)) into v_migrated_count
    from public.framework_upgrade_decisions d
    join public.framework_control_requirement_mappings m on m.organization_id=d.organization_id and m.id=d.mapping_id
    cross join lateral unnest(d.target_requirement_keys) target(requirement_key)
    where d.organization_id=p_organization_id and d.review_id=p_review_id;
  select count(*) into v_gap_count from public.framework_upgrade_decisions d
    where d.organization_id=p_organization_id and d.review_id=p_review_id
      and cardinality(d.target_requirement_keys)=0;
  -- Switch selection first so the mapping insert guard accepts only target
  -- versions. The transaction rolls this back with every later write on error.
  perform set_config('cra.framework_upgrade','on',true);
  update public.organization_framework_selections set version_key=v_review.target_version_key,
    revision=revision+1,updated_by=p_actor_user_id,updated_at=v_now
  where organization_id=p_organization_id and pack_key=v_review.pack_key;
  for v_control in select distinct c.id from public.framework_controls c
    join public.framework_control_requirement_mappings m on m.organization_id=c.organization_id and m.control_id=c.id
    where c.organization_id=p_organization_id and m.pack_key=v_review.pack_key
      and m.version_key=v_review.source_version_key and m.ended_at is null order by c.id
  loop
    update public.framework_controls c set revision=revision+1,updated_by=p_actor_user_id,updated_at=v_now
      where c.organization_id=p_organization_id and c.id=v_control.id returning c.revision into v_new_revision;
    insert into public.framework_control_revisions(organization_id,control_id,revision,title,description,
      owner_user_id,implementation_status,archived_at,transition_reason,actor_user_id)
    select p_organization_id,c.id,c.revision,c.title,c.description,c.owner_user_id,
      c.implementation_status,c.archived_at,'Reviewed framework upgrade',p_actor_user_id
    from public.framework_controls c where c.organization_id=p_organization_id and c.id=v_control.id;
  end loop;
  for v_mapping in select m.*,c.revision current_control_revision,d.target_requirement_keys
    from public.framework_control_requirement_mappings m
    join public.framework_upgrade_decisions d on d.organization_id=m.organization_id
      and d.mapping_id=m.id and d.review_id=p_review_id
    join public.framework_controls c on c.organization_id=m.organization_id and c.id=m.control_id
    where m.organization_id=p_organization_id and m.pack_key=v_review.pack_key
      and m.version_key=v_review.source_version_key and m.ended_at is null order by m.id
  loop
    update public.framework_control_requirement_mappings set ended_at=v_now,ended_by=p_actor_user_id
      where organization_id=p_organization_id and id=v_mapping.id;
    foreach v_target in array v_mapping.target_requirement_keys loop
      select m.id into v_new_mapping from public.framework_control_requirement_mappings m
        where m.organization_id=p_organization_id and m.control_id=v_mapping.control_id
          and m.pack_key=v_review.pack_key and m.version_key=v_review.target_version_key
          and m.requirement_key=v_target and m.ended_at is null;
      if not found then
        insert into public.framework_control_requirement_mappings(organization_id,control_id,pack_key,
          version_key,requirement_key,rationale,source_control_revision,created_by)
        values(p_organization_id,v_mapping.control_id,v_review.pack_key,v_review.target_version_key,
          v_target,v_mapping.rationale,v_mapping.current_control_revision,p_actor_user_id)
        returning id into v_new_mapping;
      end if;
      insert into public.framework_control_mapping_products(organization_id,mapping_id,product_id)
      select p_organization_id,v_new_mapping,mp.product_id from public.framework_control_mapping_products mp
        where mp.organization_id=p_organization_id and mp.mapping_id=v_mapping.id
      on conflict (organization_id,mapping_id,product_id) do nothing;
    end loop;
  end loop;
  -- Existing selection and mapping triggers invalidate every affected scope.
  v_result:=jsonb_build_object('reviewId',v_review.id,
    'selection',jsonb_build_object('packKey',v_review.pack_key,
      'versionKey',v_review.target_version_key,'enabled',v_selection.enabled,
      'revision',v_selection.revision+1),
    'migratedCount',v_migrated_count,'gapCount',v_gap_count);
  update public.framework_upgrade_reviews r set status='committed',revision=revision+1,
    committed_by=p_actor_user_id,committed_at=v_now,commit_idempotency_key=p_idempotency_key,
    commit_digest=v_digest,result=v_result,updated_at=v_now
  where r.organization_id=p_organization_id and r.id=p_review_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'framework.upgrade_committed',
    'framework_upgrade_review',p_review_id::text,
    jsonb_build_object('packKey',v_review.pack_key,'sourceVersionKey',v_review.source_version_key,
      'targetVersionKey',v_review.target_version_key,'sourceHash',v_review.source_hash,
      'targetHash',v_review.target_hash,'selectionRevision',v_selection.revision+1,
      'fingerprint',v_review.fingerprint,'idempotencyKey',p_idempotency_key));
  return query select 'upgraded'::text,v_result;
end $$;

create function public.m10_guard_framework_selection_upgrade() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if old.version_key is distinct from new.version_key
    and current_setting('cra.framework_upgrade',true) is distinct from 'on' then
    raise exception 'Explicit reviewed framework upgrade required' using errcode='23514';
  end if;
  return new;
end $$;
create trigger framework_selection_upgrade_only before update on public.organization_framework_selections
  for each row execute function public.m10_guard_framework_selection_upgrade();

create or replace function public.m10_select_framework_version(
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
  if p_pack_key ~ '^(iec-62443|iso-sae-21434)' and not exists(select 1
    from public.framework_pack_versions p where p.pack_key=p_pack_key and p.version_key=p_version_key
      and p.source_kind='licensed_standard' and p.approved_at is not null) then
    return query select 'blocked'::text,jsonb_build_object('reason','pack_not_authorized'); return;
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
  if v_existing.organization_id is not null and v_existing.version_key<>p_version_key then
    return query select 'upgrade_required'::text,jsonb_build_object('packKey',p_pack_key,
      'sourceVersionKey',v_existing.version_key,'targetVersionKey',p_version_key,
      'selectionRevision',v_existing.revision); return;
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


create function public.m10_curated_relation_json(p_relation public.framework_curated_crosswalks)
returns jsonb language sql immutable set search_path=public,pg_temp as $$
  select jsonb_build_object('id',p_relation.id,
    'source',jsonb_build_object('packKey',p_relation.source_pack_key,
      'versionKey',p_relation.source_version_key,'requirementKey',p_relation.source_requirement_key),
    'target',jsonb_build_object('packKey',p_relation.target_pack_key,
      'versionKey',p_relation.target_version_key,'requirementKey',p_relation.target_requirement_key),
    'relationship',p_relation.strength,'direction',p_relation.direction,
    'rationale',p_relation.rationale,'provenance',p_relation.provenance,
    'reviewer',p_relation.reviewer,'reviewedAt',p_relation.reviewed_at,'curated',true)
$$;

create function public.m10_crosswalk_evidence_reuse(p_organization_id uuid,p_actor_user_id uuid,
  p_evidence_version_id uuid,p_product_id uuid,p_limit integer,p_offset integer)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_valid boolean; v_total integer;
begin
  if not public.m10_actor_has_framework_permission(p_organization_id,p_actor_user_id,'can_view_frameworks')
    or not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_products')
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence') then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_evidence_version_id is null or p_product_id is null
    or p_limit not between 1 and 100 or p_offset not between 0 and 100000 then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  if not exists(select 1 from public.evidence_document_version_products vp
    join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id
      and p.archived_at is null
    where vp.organization_id=p_organization_id and vp.version_id=p_evidence_version_id
      and vp.product_id=p_product_id) then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  select exists(select 1 from public.evidence_document_versions v
    join public.evidence_documents d on d.organization_id=v.organization_id and d.id=v.document_id
    where v.organization_id=p_organization_id and v.id=p_evidence_version_id
      and v.processing_state='clean' and d.lifecycle_state='active'
      and (v.validity_starts_on is null or v.validity_starts_on<=current_date)
      and (v.validity_ends_on is null or v.validity_ends_on>=current_date)
      and not exists(select 1 from public.evidence_document_deletion_intents di
        where di.organization_id=p_organization_id and di.document_id=d.id
          and di.state in ('queued','claimed','failed','completed'))) into v_valid;
  if not v_valid then
    return query select 'listed'::text,jsonb_build_object('relations','[]'::jsonb,
      'evidenceValid',false,'nextCursor',null); return;
  end if;
  with candidates as (
    select distinct w.id from public.framework_control_evidence_links l
    join public.framework_controls c on c.organization_id=l.organization_id and c.id=l.control_id
      and c.archived_at is null
    join public.framework_control_requirement_mappings m on m.organization_id=l.organization_id
      and m.control_id=l.control_id and m.ended_at is null
    join public.framework_control_mapping_products mp on mp.organization_id=m.organization_id
      and mp.mapping_id=m.id and mp.product_id=p_product_id
    join public.organization_framework_selections source_selection
      on source_selection.organization_id=m.organization_id and source_selection.pack_key=m.pack_key
      and source_selection.version_key=m.version_key and source_selection.enabled
    join public.framework_curated_crosswalks w on w.retired_at is null and
      ((w.source_pack_key=m.pack_key and w.source_version_key=m.version_key
        and w.source_requirement_key=m.requirement_key)
       or (w.direction='bidirectional' and w.target_pack_key=m.pack_key
        and w.target_version_key=m.version_key and w.target_requirement_key=m.requirement_key))
    join public.organization_framework_selections target_selection
      on target_selection.organization_id=p_organization_id and target_selection.enabled
      and target_selection.pack_key=case when w.source_pack_key=m.pack_key
        and w.source_version_key=m.version_key and w.source_requirement_key=m.requirement_key
        then w.target_pack_key else w.source_pack_key end
      and target_selection.version_key=case when w.source_pack_key=m.pack_key
        and w.source_version_key=m.version_key and w.source_requirement_key=m.requirement_key
        then w.target_version_key else w.source_version_key end
    left join public.framework_requirement_applicability source_applicability
      on source_applicability.organization_id=p_organization_id and source_applicability.product_id=p_product_id
      and source_applicability.pack_key=m.pack_key and source_applicability.version_key=m.version_key
      and source_applicability.requirement_key=m.requirement_key
    left join public.framework_requirement_applicability applicability
      on applicability.organization_id=p_organization_id and applicability.product_id=p_product_id
      and applicability.pack_key=target_selection.pack_key
      and applicability.version_key=target_selection.version_key
      and applicability.requirement_key=case when w.source_pack_key=m.pack_key
        and w.source_version_key=m.version_key and w.source_requirement_key=m.requirement_key
        then w.target_requirement_key else w.source_requirement_key end
    where l.organization_id=p_organization_id and l.evidence_version_id=p_evidence_version_id
      and l.product_id=p_product_id and l.ended_at is null
      and not coalesce(source_applicability.approved_non_applicable,false)
      and not coalesce(applicability.approved_non_applicable,false)
  ) select count(*) into v_total from candidates;
  return query select 'listed'::text,jsonb_build_object('relations',coalesce((
    with candidates as (
      select distinct w.id from public.framework_control_evidence_links l
      join public.framework_controls c on c.organization_id=l.organization_id and c.id=l.control_id
        and c.archived_at is null
      join public.framework_control_requirement_mappings m on m.organization_id=l.organization_id
        and m.control_id=l.control_id and m.ended_at is null
      join public.framework_control_mapping_products mp on mp.organization_id=m.organization_id
        and mp.mapping_id=m.id and mp.product_id=p_product_id
      join public.organization_framework_selections source_selection
        on source_selection.organization_id=m.organization_id and source_selection.pack_key=m.pack_key
        and source_selection.version_key=m.version_key and source_selection.enabled
      join public.framework_curated_crosswalks w on w.retired_at is null and
        ((w.source_pack_key=m.pack_key and w.source_version_key=m.version_key
          and w.source_requirement_key=m.requirement_key)
         or (w.direction='bidirectional' and w.target_pack_key=m.pack_key
          and w.target_version_key=m.version_key and w.target_requirement_key=m.requirement_key))
      join public.organization_framework_selections target_selection
        on target_selection.organization_id=p_organization_id and target_selection.enabled
        and target_selection.pack_key=case when w.source_pack_key=m.pack_key
          and w.source_version_key=m.version_key and w.source_requirement_key=m.requirement_key
          then w.target_pack_key else w.source_pack_key end
        and target_selection.version_key=case when w.source_pack_key=m.pack_key
          and w.source_version_key=m.version_key and w.source_requirement_key=m.requirement_key
          then w.target_version_key else w.source_version_key end
      left join public.framework_requirement_applicability source_applicability
        on source_applicability.organization_id=p_organization_id and source_applicability.product_id=p_product_id
        and source_applicability.pack_key=m.pack_key and source_applicability.version_key=m.version_key
        and source_applicability.requirement_key=m.requirement_key
      left join public.framework_requirement_applicability applicability
        on applicability.organization_id=p_organization_id and applicability.product_id=p_product_id
        and applicability.pack_key=target_selection.pack_key
        and applicability.version_key=target_selection.version_key
        and applicability.requirement_key=case when w.source_pack_key=m.pack_key
          and w.source_version_key=m.version_key and w.source_requirement_key=m.requirement_key
          then w.target_requirement_key else w.source_requirement_key end
      where l.organization_id=p_organization_id and l.evidence_version_id=p_evidence_version_id
        and l.product_id=p_product_id and l.ended_at is null
        and not coalesce(source_applicability.approved_non_applicable,false)
        and not coalesce(applicability.approved_non_applicable,false)
    ) select jsonb_agg(public.m10_curated_relation_json(w) order by w.id)
      from (select id from candidates order by id limit p_limit offset p_offset) page
      join public.framework_curated_crosswalks w on w.id=page.id),'[]'::jsonb),
    'evidenceValid',true,
    'nextCursor',case when p_offset+p_limit<v_total then
      rtrim(translate(encode(convert_to((p_offset+p_limit)::text,'UTF8'),'base64'),'+/','-_'),'=')
      else null end);
end $$;

revoke all on function public.m10_upgrade_fingerprint(uuid,text,text),
  public.m10_upgrade_diff(text,text,text),
  public.m10_crosswalk_page(uuid,uuid,text,text,integer,integer),
  public.m10_upgrade_preview(uuid,uuid,text,text,integer,uuid),
  public.m10_create_upgrade_review(uuid,uuid,text,text,integer,uuid),
  public.m10_upgrade_review_page(uuid,uuid,uuid,integer,integer),
  public.m10_set_upgrade_decision(uuid,uuid,uuid,uuid,text[],integer,uuid),
  public.m10_commit_upgrade(uuid,uuid,uuid,integer,uuid),
  public.m10_curated_relation_json(public.framework_curated_crosswalks),
  public.m10_crosswalk_evidence_reuse(uuid,uuid,uuid,uuid,integer,integer),
  public.m10_guard_upgrade_write(),public.m10_guard_framework_selection_upgrade()
  from public,anon,authenticated,service_role;
grant execute on function public.m10_crosswalk_page(uuid,uuid,text,text,integer,integer),
  public.m10_upgrade_preview(uuid,uuid,text,text,integer,uuid),
  public.m10_create_upgrade_review(uuid,uuid,text,text,integer,uuid),
  public.m10_upgrade_review_page(uuid,uuid,uuid,integer,integer),
  public.m10_set_upgrade_decision(uuid,uuid,uuid,uuid,text[],integer,uuid),
  public.m10_commit_upgrade(uuid,uuid,uuid,integer,uuid),
  public.m10_crosswalk_evidence_reuse(uuid,uuid,uuid,uuid,integer,integer)
  to service_role;
