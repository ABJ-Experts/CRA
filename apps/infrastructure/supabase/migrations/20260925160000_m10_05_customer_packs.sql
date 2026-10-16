-- M10-05. Tenant-authored drafts and immutable published versions.
-- Global reviewed and licensed packs retain null ownership and their prior importer.

alter table public.framework_pack_versions
  add column owner_org_id uuid references public.organizations(id) on delete cascade,
  alter column source_url drop not null,
  alter column source_publication_date drop not null,
  alter column review_evidence drop not null,
  drop constraint framework_pack_versions_source_kind_check,
  add constraint framework_pack_versions_source_kind_check
    check (source_kind in ('public_law','licensed_standard','approved_fixture','customer_defined')),
  add constraint framework_pack_customer_owner_check check (
    (source_kind='customer_defined')=(owner_org_id is not null)
    and (source_kind='customer_defined' or pack_key !~ '^custom[.]')
    and (source_kind<>'customer_defined' or
      (pack_key ~ '^custom[.][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and version_key ~ '^v[1-9][0-9]*$'))),
  add constraint framework_pack_noncustomer_source_check check (
    source_kind='customer_defined' or
    (source_url is not null and source_publication_date is not null and review_evidence is not null));
alter table public.framework_pack_versions
  add constraint framework_pack_versions_owned_unique unique nulls not distinct
  (pack_key,version_key,owner_org_id);

alter table public.framework_requirements
  add column owner_org_id uuid references public.organizations(id) on delete cascade,
  add constraint framework_requirements_customer_owner_check
    check ((pack_key ~ '^custom[.]')=(owner_org_id is not null)),
  add constraint framework_requirements_owner_fkey
    foreign key (pack_key,version_key,owner_org_id)
    references public.framework_pack_versions(pack_key,version_key,owner_org_id) on delete cascade;
create index framework_requirements_owner_idx on public.framework_requirements(owner_org_id,pack_key,version_key)
  where owner_org_id is not null;
create index framework_pack_versions_owner_idx on public.framework_pack_versions(owner_org_id,pack_key,version_key)
  where owner_org_id is not null;

create table public.framework_custom_pack_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pack_key text not null unique,
  document jsonb not null check (jsonb_typeof(document)='object' and pg_column_size(document)<=2097152),
  draft_digest text not null check (draft_digest ~ '^[a-f0-9]{64}$'),
  published_digest text check (published_digest is null or published_digest ~ '^[a-f0-9]{64}$'),
  published_version integer not null default 0 check (published_version>=0),
  status text not null default 'draft' check (status in ('draft','published','update_available','archived')),
  revision integer not null default 1 check (revision>=1),
  archived_at timestamptz,
  created_by uuid not null references public.users(id) on delete restrict,
  updated_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  check (pack_key='custom.'||id::text),
  check ((status='archived')=(archived_at is not null)),
  check ((published_version=0)=(published_digest is null))
);
create index framework_custom_pack_drafts_list_idx on public.framework_custom_pack_drafts
  (organization_id,updated_at desc,id);
create trigger set_framework_custom_pack_drafts_updated_at before update on public.framework_custom_pack_drafts
  for each row execute function public.set_updated_at();
alter table public.framework_custom_pack_drafts enable row level security;
revoke all on public.framework_custom_pack_drafts from public,anon,authenticated,service_role;
grant select on public.framework_custom_pack_drafts to service_role;

-- Customer-owned content disappears only through the authorized tenant purge.
create or replace function public.m10_reject_framework_content_change()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='DELETE' and pg_trigger_depth()>1 and old.owner_org_id is not null
    and not exists(select 1 from public.organizations o where o.id=old.owner_org_id) then
    return old;
  end if;
  raise exception 'Framework pack content is immutable' using errcode='23514';
end $$;

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
        'distributionRights','rightsEvidence','reviewOwner','approvedAt','organizationId'))
    or exists(select 1 from jsonb_each(p_payload) field(key,value)
      where key in ('packKey','versionKey','title','editionDate','language','sourceUrl',
        'sourceCelex','sourceEli','sourcePublicationDate','attribution','reviewEvidence',
        'sourceKind','editionLabel','distributionRights','rightsEvidence','reviewOwner','approvedAt','organizationId')
        and jsonb_typeof(value)<>'string')
    or not (p_payload ?& array['schemaVersion','packKey','versionKey','title','editionDate',
      'language','attribution','requirements'])
    or jsonb_typeof(p_payload->'requirements')<>'array'
    or char_length(p_payload->>'packKey') not between 1 and 120
    or (p_payload->>'packKey') !~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$'
    or char_length(p_payload->>'versionKey') not between 1 and 120
    or (p_payload->>'versionKey') !~ '^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$'
    or char_length(coalesce(p_payload->>'title','')) not between 1 and 300
    or (p_payload->>'language') !~ '^[a-z]{2,3}(-[A-Z]{2})?$'
    or (p_payload->>'sourceUrl' is not null and (p_payload->>'sourceUrl' !~ '^https://[^[:space:]]+$'
      or char_length(p_payload->>'sourceUrl')>2048))
    or (coalesce(p_payload->>'sourceKind','public_law')<>'customer_defined'
      and (p_payload->>'sourceUrl' is null or p_payload->>'sourcePublicationDate' is null
        or p_payload->>'reviewEvidence' is null))
    or (coalesce(p_payload->>'sourceKind','public_law')='public_law' and
      (char_length(coalesce(p_payload->>'sourceCelex','')) not between 1 and 80
       or char_length(coalesce(p_payload->>'sourceEli','')) not between 1 and 2048))
    or (p_payload->>'sourceCelex' is not null and char_length(p_payload->>'sourceCelex')>80)
    or (p_payload->>'sourceEli' is not null and char_length(p_payload->>'sourceEli')>2048)
    or coalesce(p_payload->>'sourceKind','public_law') not in ('public_law','licensed_standard','approved_fixture','customer_defined')
    or (coalesce(p_payload->>'sourceKind','public_law')='customer_defined' and
      (coalesce(p_payload->>'organizationId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (p_payload->>'packKey') !~ '^custom[.][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or (p_payload->>'versionKey') !~ '^v[1-9][0-9]*$'
       or p_payload->>'sourceCelex' is not null or p_payload->>'sourceEli' is not null
       or p_payload->>'reviewEvidence' is not null or p_payload->>'distributionRights' is not null
       or p_payload->>'rightsEvidence' is not null or p_payload->>'approvedAt' is not null))
    or (coalesce(p_payload->>'sourceKind','public_law')<>'customer_defined'
      and p_payload->>'organizationId' is not null)
    or ((p_payload->>'packKey') ~ '^(iec-62443|iso-sae-21434)'
      and p_payload->>'sourceKind' is distinct from 'licensed_standard')
    or (coalesce(p_payload->>'sourceKind','public_law')='licensed_standard' and
      (char_length(coalesce(p_payload->>'editionLabel','')) not between 1 and 200
       or char_length(coalesce(p_payload->>'distributionRights','')) not between 20 and 2000
       or char_length(coalesce(p_payload->>'rightsEvidence','')) not between 20 and 2000
       or char_length(coalesce(p_payload->>'reviewOwner','')) not between 1 and 200
       or p_payload->>'approvedAt' is null))
    or char_length(coalesce(p_payload->>'attribution','')) not between 1 and 1000
    or (coalesce(p_payload->>'sourceKind','public_law')<>'customer_defined' and
      char_length(coalesce(p_payload->>'reviewEvidence','')) not between 1 and 1000)
    or exists(select 1 from jsonb_each_text(p_payload) metadata(field,value)
      where field<>'requirements' and
        (value ~ '<[[:alpha:]/][^>]*>' or value ~ '[[:cntrl:]]'))
    or coalesce(p_payload->>'editionDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or (p_payload->>'sourcePublicationDate' is not null
      and p_payload->>'sourcePublicationDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
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
    source_eli,source_publication_date,attribution,review_evidence,content_hash,requirement_count,owner_org_id,
    source_kind,edition_label,distribution_rights,rights_evidence,review_owner,approved_at
  ) values (
    p_payload->>'packKey',p_payload->>'versionKey',p_payload->>'title',
    (p_payload->>'editionDate')::date,p_payload->>'language',
    p_payload->>'sourceUrl',p_payload->>'sourceCelex',p_payload->>'sourceEli',
    (p_payload->>'sourcePublicationDate')::date,p_payload->>'attribution',
    p_payload->>'reviewEvidence',v_hash,v_count,
    (p_payload->>'organizationId')::uuid,coalesce(p_payload->>'sourceKind','public_law'),
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
    position,tree_order,depth,heading,text,source_reference,owner_org_id
  )
  select p_payload->>'packKey',p_payload->>'versionKey',key,identifier,parent_key,
    position,row_number() over(order by sort_path)::integer,depth,heading,body,source_reference,
    (p_payload->>'organizationId')::uuid
  from reached order by depth,parent_key nulls first,position;

  insert into public.audit_logs(action,entity_type,entity_id,changes)
  values('framework.pack_imported','framework_pack_version',
    (p_payload->>'packKey')||':'||(p_payload->>'versionKey'),
    jsonb_build_object('contentHash',v_hash,'requirementCount',v_count,
      'sourceCelex',p_payload->>'sourceCelex','sourceEli',p_payload->>'sourceEli'));
  return 'imported';
end $$;


-- Reuse the strict importer validator in a rolled-back subtransaction. The
-- reserved validation version cannot be a published draft version (int4 max).
create function public.m10_validate_custom_document(p_organization_id uuid,p_draft_id uuid,p_document jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_organization_id is null or p_draft_id is null or p_document is null
    or jsonb_typeof(p_document)<>'object' or pg_column_size(p_document)>2097152
    or exists(select 1 from jsonb_object_keys(p_document) k
      where k not in ('title','editionDate','language','attribution','sourceUrl','requirements')) then
    return false;
  end if;
  begin
    perform public.m10_import_framework_pack(p_document || jsonb_build_object(
      'schemaVersion',1,'packKey','custom.'||p_draft_id::text,'versionKey','v2147483647',
      'sourceKind','customer_defined','organizationId',p_organization_id));
    raise exception 'Validation completed' using errcode='P5501';
  exception
    when sqlstate 'P5501' then return true;
    when invalid_parameter_value or unique_violation or foreign_key_violation or check_violation
      or invalid_datetime_format or invalid_text_representation then return false;
  end;
end $$;

create function public.m10_custom_pack_summary(p_draft public.framework_custom_pack_drafts)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('draftId',p_draft.id,'packKey',p_draft.pack_key,
    'title',p_draft.document->>'title','status',p_draft.status,'revision',p_draft.revision,
    'latestVersionKey',case when p_draft.published_version=0 then null else 'v'||p_draft.published_version::text end,
    'selectedVersionKey',(select s.version_key from public.organization_framework_selections s
      where s.organization_id=p_draft.organization_id and s.pack_key=p_draft.pack_key),
    'contentHash',(select p.content_hash from public.framework_pack_versions p
      where p.owner_org_id=p_draft.organization_id and p.pack_key=p_draft.pack_key
        and p.version_key='v'||p_draft.published_version::text),
    'archivedAt',p_draft.archived_at,'updatedAt',p_draft.updated_at)
$$;

create function public.m10_custom_pack_command(p_organization_id uuid,p_actor_user_id uuid,
  p_operation text,p_payload jsonb,p_expected_revision integer,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_draft public.framework_custom_pack_drafts%rowtype;
  v_prior jsonb; v_digest text; v_document jsonb; v_doc_digest text;
  v_draft_id uuid; v_next_version text; v_outcome text; v_result jsonb;
begin
  if not public.m10_actor_can_manage_frameworks(p_organization_id,p_actor_user_id) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_operation not in ('create_draft','save_draft','publish_version','archive_draft','restore_draft')
    or p_payload is null or jsonb_typeof(p_payload)<>'object'
    or pg_column_size(p_payload)>2097152 or p_idempotency_key is null
    or (p_operation='create_draft' and p_expected_revision is not null)
    or (p_operation<>'create_draft' and (p_expected_revision is null or p_expected_revision<1)) then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('operation',p_operation,
    'payload',p_payload,'expectedRevision',p_expected_revision)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text
    ||':'||p_idempotency_key::text,0));
  select a.changes into v_prior from public.audit_logs a
    where a.organization_id=p_organization_id and a.user_id=p_actor_user_id
      and a.entity_type='framework_custom_pack_command'
      and a.changes->>'idempotencyKey'=p_idempotency_key::text
    order by a.created_at desc limit 1;
  if found then
    if v_prior->>'requestDigest'<>v_digest then
      return query select 'conflict'::text,null::jsonb; return;
    end if;
    return query select v_prior->>'outcome',v_prior->'result'; return;
  end if;
  if p_operation='create_draft' then
    if exists(select 1 from jsonb_object_keys(p_payload) k where k<>'document') then
      return query select 'invalid_request'::text,null::jsonb; return;
    end if;
    v_draft_id:=gen_random_uuid(); v_document:=p_payload->'document';
    if not public.m10_validate_custom_document(p_organization_id,v_draft_id,v_document) then
      return query select 'invalid_request'::text,null::jsonb; return;
    end if;
    v_doc_digest:=encode(extensions.digest(v_document::text,'sha256'),'hex');
    perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||v_doc_digest,0));
    select * into v_draft from public.framework_custom_pack_drafts d
      where d.organization_id=p_organization_id and d.draft_digest=v_doc_digest
      order by d.created_at,d.id limit 1 for share;
    if found then v_draft_id:=v_draft.id; v_outcome:='unchanged';
    else
      insert into public.framework_custom_pack_drafts(id,organization_id,pack_key,document,
        draft_digest,created_by,updated_by)
      values(v_draft_id,p_organization_id,'custom.'||v_draft_id::text,v_document,
        v_doc_digest,p_actor_user_id,p_actor_user_id) returning * into v_draft;
      v_outcome:='created';
    end if;
  else
    if p_payload->>'draftId' is null or
      p_payload->>'draftId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return query select 'invalid_request'::text,null::jsonb; return;
    end if;
    v_draft_id:=(p_payload->>'draftId')::uuid;
    select * into v_draft from public.framework_custom_pack_drafts d
      where d.organization_id=p_organization_id and d.id=v_draft_id for update;
    if not found then return query select 'not_found'::text,null::jsonb; return; end if;
    if v_draft.revision<>p_expected_revision then
      return query select 'conflict'::text,jsonb_build_object('revision',v_draft.revision); return;
    end if;
    if p_operation='save_draft' then
      if v_draft.status='archived' or
        exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('draftId','document')) then
        return query select 'blocked'::text,jsonb_build_object('reason','draft_unavailable'); return;
      end if;
      v_document:=p_payload->'document';
      if not public.m10_validate_custom_document(p_organization_id,v_draft_id,v_document) then
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
      v_doc_digest:=encode(extensions.digest(v_document::text,'sha256'),'hex');
      if v_draft.draft_digest=v_doc_digest then v_outcome:='unchanged';
      else
        update public.framework_custom_pack_drafts set document=v_document,draft_digest=v_doc_digest,
          status=case when published_version=0 then 'draft'
            when published_digest=v_doc_digest then 'published' else 'update_available' end,
          revision=revision+1,updated_by=p_actor_user_id
        where organization_id=p_organization_id and id=v_draft_id returning * into v_draft;
        v_outcome:='saved';
      end if;
    elsif p_operation='publish_version' then
      if v_draft.status='archived' then
        return query select 'blocked'::text,jsonb_build_object('reason','draft_archived'); return;
      end if;
      if v_draft.published_digest=v_draft.draft_digest then v_outcome:='unchanged';
      else
        v_next_version:='v'||(v_draft.published_version+1)::text;
        perform public.m10_import_framework_pack(v_draft.document || jsonb_build_object(
          'schemaVersion',1,'packKey',v_draft.pack_key,'versionKey',v_next_version,
          'sourceKind','customer_defined','organizationId',p_organization_id));
        update public.framework_custom_pack_drafts set published_version=published_version+1,
          published_digest=draft_digest,status='published',revision=revision+1,
          updated_by=p_actor_user_id
        where organization_id=p_organization_id and id=v_draft_id returning * into v_draft;
        v_outcome:='published';
      end if;
    elsif p_operation='archive_draft' then
      if v_draft.status='archived' then v_outcome:='unchanged';
      else
        update public.framework_custom_pack_drafts set status='archived',archived_at=clock_timestamp(),
          revision=revision+1,updated_by=p_actor_user_id
        where organization_id=p_organization_id and id=v_draft_id returning * into v_draft;
        v_outcome:='archived';
      end if;
    else
      if v_draft.status<>'archived' then v_outcome:='unchanged';
      else
        update public.framework_custom_pack_drafts set archived_at=null,
          status=case when published_version=0 then 'draft'
            when draft_digest=published_digest then 'published' else 'update_available' end,
          revision=revision+1,updated_by=p_actor_user_id
        where organization_id=p_organization_id and id=v_draft_id returning * into v_draft;
        v_outcome:='restored';
      end if;
    end if;
  end if;
  v_result:=public.m10_custom_pack_summary(v_draft);
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'framework.custom_pack_'||v_outcome,
    'framework_custom_pack_command',v_draft_id::text,
    jsonb_build_object('idempotencyKey',p_idempotency_key,'requestDigest',v_digest,
      'operation',p_operation,'outcome',v_outcome,'result',v_result));
  return query select v_outcome,v_result;
end $$;

create function public.m10_custom_pack_page(p_organization_id uuid,p_actor_user_id uuid,
  p_limit integer,p_offset integer)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_total integer;
begin
  if not public.m10_actor_has_framework_permission(p_organization_id,p_actor_user_id,'can_view_frameworks') then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_limit not between 1 and 100 or p_offset not between 0 and 100000 then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  select count(*) into v_total from public.framework_custom_pack_drafts d
    where d.organization_id=p_organization_id;
  return query select 'listed'::text,jsonb_build_object('items',coalesce((
    select jsonb_agg(public.m10_custom_pack_summary(d) order by d.updated_at desc,d.id)
    from (select * from public.framework_custom_pack_drafts x
      where x.organization_id=p_organization_id order by x.updated_at desc,x.id
      limit p_limit offset p_offset) d),'[]'::jsonb),
    'nextOffset',case when p_offset+p_limit<v_total then p_offset+p_limit else null end);
end $$;

create function public.m10_custom_pack_detail(p_organization_id uuid,p_actor_user_id uuid,p_draft_id uuid)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_draft public.framework_custom_pack_drafts%rowtype;
begin
  if not public.m10_actor_has_framework_permission(p_organization_id,p_actor_user_id,'can_view_frameworks') then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if p_draft_id is null then return query select 'invalid_request'::text,null::jsonb; return; end if;
  select * into v_draft from public.framework_custom_pack_drafts d
    where d.organization_id=p_organization_id and d.id=p_draft_id;
  if not found then return query select 'not_found'::text,null::jsonb; return; end if;
  return query select 'found'::text,public.m10_custom_pack_summary(v_draft)
    || jsonb_build_object('content',v_draft.document);
end $$;

-- Tenant selection cannot import or select a peer's immutable content.
create or replace function public.m10_custom_pack_visible(p_organization_id uuid,p_pack_key text,p_version_key text)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.framework_pack_versions p
    where p.pack_key=p_pack_key and p.version_key=p_version_key
      and (p.owner_org_id is null or p.owner_org_id=p_organization_id))
$$;

-- Keep all M10 read and mutation paths on the same owner check. Existing
-- selection RPC remains unchanged except for this guard, preserving toggles.
create function public.m10_reject_foreign_custom_selection() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if not public.m10_custom_pack_visible(new.organization_id,new.pack_key,new.version_key) then
    raise exception 'Framework pack is not visible to organization' using errcode='42501';
  end if;
  return new;
end $$;
create trigger framework_selection_owner_guard before insert or update on public.organization_framework_selections
  for each row execute function public.m10_reject_foreign_custom_selection();

-- Every organization-scoped writer must reject a peer-owned pack even when
-- service_role bypasses RLS and the requirement key is otherwise valid.
create function public.m10_guard_framework_owner() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_table_name='framework_upgrade_reviews' then
    if not public.m10_custom_pack_visible(new.organization_id,new.pack_key,new.source_version_key)
      or not public.m10_custom_pack_visible(new.organization_id,new.pack_key,new.target_version_key) then
      raise exception 'Framework pack is not visible to organization' using errcode='42501';
    end if;
  elsif not public.m10_custom_pack_visible(new.organization_id,new.pack_key,new.version_key) then
    raise exception 'Framework pack is not visible to organization' using errcode='42501';
  end if;
  return new;
end $$;
create trigger framework_mapping_owner_guard before insert or update
  on public.framework_control_requirement_mappings for each row execute function public.m10_guard_framework_owner();
create trigger framework_applicability_owner_guard before insert or update
  on public.framework_requirement_applicability for each row execute function public.m10_guard_framework_owner();
create trigger framework_coverage_scope_owner_guard before insert or update
  on public.framework_coverage_scopes for each row execute function public.m10_guard_framework_owner();
create trigger framework_coverage_row_owner_guard before insert or update
  on public.framework_coverage_rows for each row execute function public.m10_guard_framework_owner();
create trigger framework_upgrade_review_owner_guard before insert or update
  on public.framework_upgrade_reviews for each row execute function public.m10_guard_framework_owner();
revoke all on function public.m10_guard_framework_owner() from public,anon,authenticated,service_role;

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
  v_custom_status text;
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
  if not public.m10_custom_pack_visible(p_organization_id,p_pack_key,p_version_key) then
    return query select 'not_found'::text,null::jsonb; return;
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
  select d.status into v_custom_status from public.framework_custom_pack_drafts d
    where d.organization_id=p_organization_id and d.pack_key=p_pack_key for share;
  if v_custom_status='archived'
    and (v_existing.organization_id is null or v_existing.version_key<>p_version_key) then
    return query select 'blocked'::text,jsonb_build_object('reason','pack_archived'); return;
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


create or replace function public.m10_upgrade_preview(p_organization_id uuid,p_actor_user_id uuid,
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
  if not public.m10_custom_pack_visible(p_organization_id,p_pack_key,v_selection.version_key)
    or not public.m10_custom_pack_visible(p_organization_id,p_pack_key,p_target_version_key) then
    return query select 'not_found'::text,null::jsonb; return;
  end if;
  if exists(select 1 from public.framework_custom_pack_drafts d
    where d.organization_id=p_organization_id and d.pack_key=p_pack_key
      and d.status='archived') then
    return query select 'blocked'::text,jsonb_build_object('reason','pack_archived'); return;
  end if;
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

create or replace function public.m10_crosswalk_page(p_organization_id uuid,p_actor_user_id uuid,
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
    and public.m10_custom_pack_visible(p_organization_id,c.source_pack_key,c.source_version_key)
    and public.m10_custom_pack_visible(p_organization_id,c.target_pack_key,c.target_version_key)
    and ((c.source_pack_key=p_pack_key and c.source_version_key=p_version_key)
      or (c.target_pack_key=p_pack_key and c.target_version_key=p_version_key));
  return query select 'listed'::text,jsonb_build_object('relations',coalesce((
    select jsonb_agg(public.m10_curated_relation_json(x) order by x.id)
    from (select * from public.framework_curated_crosswalks c
      where c.retired_at is null
        and public.m10_custom_pack_visible(p_organization_id,c.source_pack_key,c.source_version_key)
        and public.m10_custom_pack_visible(p_organization_id,c.target_pack_key,c.target_version_key)
        and ((c.source_pack_key=p_pack_key and c.source_version_key=p_version_key)
        or (c.target_pack_key=p_pack_key and c.target_version_key=p_version_key))
      order by c.id limit p_limit offset p_offset) x),'[]'::jsonb),
    'nextCursor',case when p_offset+p_limit<v_total then
      rtrim(translate(encode(convert_to((p_offset+p_limit)::text,'UTF8'),'base64'),'+/','-_'),'=')
      else null end);
end $$;

revoke all on function public.m10_validate_custom_document(uuid,uuid,jsonb),
  public.m10_custom_pack_summary(public.framework_custom_pack_drafts),
  public.m10_custom_pack_command(uuid,uuid,text,jsonb,integer,uuid),
  public.m10_custom_pack_page(uuid,uuid,integer,integer),
  public.m10_custom_pack_detail(uuid,uuid,uuid),
  public.m10_custom_pack_visible(uuid,text,text),
  public.m10_reject_foreign_custom_selection()
  from public,anon,authenticated,service_role;
grant execute on function public.m10_custom_pack_command(uuid,uuid,text,jsonb,integer,uuid),
  public.m10_custom_pack_page(uuid,uuid,integer,integer),
  public.m10_custom_pack_detail(uuid,uuid,uuid) to service_role;

-- Tenant exports include drafts and their immutable published content.
alter table public.organization_export_source_tables
  drop constraint organization_export_source_tables_tenant_key_column_check,
  add constraint organization_export_source_tables_tenant_key_column_check
    check (tenant_key_column in ('id','organization_id','owner_org_id'));
insert into public.organization_export_source_tables(
  source_id,table_name,tenant_key_column,record_order_column,table_sort
) values
  ('framework_controls','framework_custom_pack_drafts','organization_id','id',9),
  ('framework_controls','framework_pack_versions','owner_org_id','pack_key',10),
  ('framework_controls','framework_requirements','owner_org_id','requirement_key',11)
on conflict (source_id,table_name) do update set
  tenant_key_column=excluded.tenant_key_column,
  record_order_column=excluded.record_order_column,table_sort=excluded.table_sort;
do $$
declare v_definition text;
  v_old text := 'public.framework_requirement_applicability, public.framework_upgrade_reviews, public.framework_upgrade_decisions' || chr(10) || '  in share mode';
  v_new text := 'public.framework_requirement_applicability, public.framework_upgrade_reviews, public.framework_upgrade_decisions, public.framework_custom_pack_drafts, public.framework_pack_versions, public.framework_requirements' || chr(10) || '  in share mode';
begin
  select pg_get_functiondef('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)'::regprocedure)
    into v_definition;
  if position(v_old in v_definition)=0 then raise exception 'M10 custom export lock anchor missing'; end if;
  execute replace(v_definition,v_old,v_new);
end $$;
