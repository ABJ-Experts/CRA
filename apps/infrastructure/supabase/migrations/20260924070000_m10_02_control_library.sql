-- M10-02: organization controls, immutable revisions, exact version links and
-- product-explicit requirement mappings. All writes use one scoped transaction.

create table public.framework_controls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (title=btrim(title) and char_length(title) between 1 and 200 and title !~ '[[:cntrl:]]' and title !~ '<[[:alpha:]/][^>]*>'),
  description text not null check (description=btrim(description) and char_length(description) between 1 and 4000 and description !~ '[[:cntrl:]]' and description !~ '<[[:alpha:]/][^>]*>'),
  owner_user_id uuid not null references public.users(id) on delete restrict,
  implementation_status text not null default 'not_started'
    check (implementation_status in ('not_started','in_progress','implemented')),
  revision integer not null default 1 check (revision >= 1),
  archived_at timestamptz,
  created_by uuid not null references public.users(id) on delete restrict,
  updated_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id)
);
create index framework_controls_list_idx
  on public.framework_controls(organization_id,archived_at,updated_at desc,id);
create index framework_controls_owner_idx
  on public.framework_controls(organization_id,owner_user_id);

create table public.framework_control_revisions (
  organization_id uuid not null,
  control_id uuid not null,
  revision integer not null check (revision >= 1),
  title text not null,
  description text,
  owner_user_id uuid not null references public.users(id) on delete restrict,
  implementation_status text not null,
  archived_at timestamptz,
  transition_reason text,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,control_id,revision),
  foreign key (organization_id,control_id)
    references public.framework_controls(organization_id,id) on delete restrict,
  check (transition_reason is null or
    (transition_reason=btrim(transition_reason) and char_length(transition_reason) between 1 and 1000
      and transition_reason !~ '[[:cntrl:]]' and transition_reason !~ '<[[:alpha:]/][^>]*>'))
);

create table public.framework_control_evidence_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  control_id uuid not null,
  evidence_version_id uuid not null,
  product_id uuid not null,
  source_control_revision integer not null,
  ended_at timestamptz,
  created_by uuid not null references public.users(id) on delete restrict,
  ended_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  foreign key (organization_id,control_id)
    references public.framework_controls(organization_id,id) on delete restrict,
  foreign key (organization_id,control_id,source_control_revision)
    references public.framework_control_revisions(organization_id,control_id,revision) on delete restrict,
  foreign key (organization_id,evidence_version_id,product_id)
    references public.evidence_document_version_products(organization_id,version_id,product_id) on delete restrict
);
create unique index framework_control_evidence_active_once_idx
  on public.framework_control_evidence_links(organization_id,control_id,evidence_version_id,product_id)
  where ended_at is null;
create index framework_control_evidence_reverse_idx
  on public.framework_control_evidence_links(organization_id,evidence_version_id,product_id,control_id)
  where ended_at is null;
create index framework_control_evidence_product_fk_idx
  on public.framework_control_evidence_links(organization_id,evidence_version_id,product_id);

create table public.framework_control_requirement_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  control_id uuid not null,
  pack_key text not null,
  version_key text not null,
  requirement_key text not null,
  rationale text not null check (rationale=btrim(rationale) and char_length(rationale) between 1 and 2000
    and rationale !~ '[[:cntrl:]]' and rationale !~ '<[[:alpha:]/][^>]*>'),
  source_control_revision integer not null,
  ended_at timestamptz,
  created_by uuid not null references public.users(id) on delete restrict,
  ended_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  foreign key (organization_id,control_id)
    references public.framework_controls(organization_id,id) on delete restrict,
  foreign key (organization_id,control_id,source_control_revision)
    references public.framework_control_revisions(organization_id,control_id,revision) on delete restrict,
  foreign key (pack_key,version_key,requirement_key)
    references public.framework_requirements(pack_key,version_key,requirement_key) on delete restrict
);
create unique index framework_control_mapping_active_once_idx
  on public.framework_control_requirement_mappings
    (organization_id,control_id,pack_key,version_key,requirement_key)
  where ended_at is null;
create index framework_control_mapping_requirement_idx
  on public.framework_control_requirement_mappings
    (organization_id,pack_key,version_key,requirement_key,control_id)
  where ended_at is null;
create index framework_control_mapping_control_idx
  on public.framework_control_requirement_mappings(organization_id,control_id,created_at desc,id);

create table public.framework_control_mapping_products (
  organization_id uuid not null,
  mapping_id uuid not null,
  product_id uuid not null,
  primary key (organization_id,mapping_id,product_id),
  foreign key (organization_id,mapping_id)
    references public.framework_control_requirement_mappings(organization_id,id) on delete restrict,
  foreign key (organization_id,product_id)
    references public.products(organization_id,id) on delete restrict
);
create index framework_control_mapping_products_product_idx
  on public.framework_control_mapping_products(organization_id,product_id,mapping_id);

create table public.framework_control_commands (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  outcome text not null,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,actor_user_id,idempotency_key)
);

create function public.m10_reject_control_history_change()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'Control history is immutable' using errcode='55000';
end $$;
create trigger framework_control_revisions_immutable
  before update or delete on public.framework_control_revisions
  for each row execute function public.m10_reject_control_history_change();
create trigger framework_control_mapping_products_immutable
  before update or delete on public.framework_control_mapping_products
  for each row execute function public.m10_reject_control_history_change();

alter table public.framework_controls enable row level security;
alter table public.framework_control_revisions enable row level security;
alter table public.framework_control_evidence_links enable row level security;
alter table public.framework_control_requirement_mappings enable row level security;
alter table public.framework_control_mapping_products enable row level security;
alter table public.framework_control_commands enable row level security;
revoke all on public.framework_controls,public.framework_control_revisions,
  public.framework_control_evidence_links,public.framework_control_requirement_mappings,
  public.framework_control_mapping_products,public.framework_control_commands
  from public,anon,authenticated,service_role;
grant select on public.framework_controls,public.framework_control_revisions,
  public.framework_control_evidence_links,public.framework_control_requirement_mappings,
  public.framework_control_mapping_products to service_role;

create function public.m10_control_uuid(p_value text)
returns uuid language plpgsql immutable set search_path=public,pg_temp as $$
begin
  return p_value::uuid;
exception when invalid_text_representation then return null;
end $$;

create function public.m10_control_command(
  p_organization_id uuid,p_actor_user_id uuid,p_operation text,p_payload jsonb,
  p_expected_revision integer,p_idempotency_key uuid
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_control public.framework_controls%rowtype;
  v_prior public.framework_control_commands%rowtype;
  v_link public.framework_control_evidence_links%rowtype;
  v_mapping public.framework_control_requirement_mappings%rowtype;
  v_current_mapping public.framework_control_requirement_mappings%rowtype;
  v_digest text;
  v_outcome text;
  v_result jsonb;
  v_control_id uuid;
  v_owner_id uuid;
  v_version_id uuid;
  v_product_id uuid;
  v_link_id uuid;
  v_mapping_id uuid;
  v_title text;
  v_description text;
  v_status text;
  v_reason text;
  v_pack_key text;
  v_version_key text;
  v_requirement_key text;
  v_rationale text;
  v_products uuid[];
  v_prior_products uuid[];
  v_count integer;
  v_now timestamptz;
begin
  if p_organization_id is null or p_actor_user_id is null or p_idempotency_key is null
    or p_operation is null or p_operation not in ('create_control','update_control','archive_control',
      'link_evidence','unlink_evidence','upsert_mapping','end_mapping')
    or p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or (p_expected_revision is not null and p_expected_revision < 1)
    or pg_column_size(p_payload) > 16384 then
    return query select 'invalid_request'::text,null::jsonb; return;
  end if;
  if not public.m10_actor_can_manage_frameworks(p_organization_id,p_actor_user_id) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  v_digest:=encode(extensions.digest(jsonb_build_object(
    'operation',p_operation,'payload',p_payload,'expectedRevision',p_expected_revision)::text,
    'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0));
  select * into v_prior from public.framework_control_commands c
  where c.organization_id=p_organization_id and c.actor_user_id=p_actor_user_id
    and c.idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_digest <> v_digest then
      return query select 'invalid_request'::text,null::jsonb; return;
    end if;
    return query select v_prior.outcome,v_prior.result; return;
  end if;
  if p_operation='create_control' then
    if p_expected_revision is not null then
      return query select 'conflict'::text,null::jsonb; return;
    end if;
    v_title:=p_payload->>'title';
    v_description:=p_payload->>'description';
    v_owner_id:=public.m10_control_uuid(p_payload->>'ownerUserId');
    v_status:=coalesce(p_payload->>'implementationStatus','not_started');
    if v_title is null or v_title<>btrim(v_title) or char_length(v_title) not between 1 and 200
      or v_title ~ '[[:cntrl:]]|<[[:alpha:]/][^>]*>'
      or v_description is null or v_description<>btrim(v_description)
      or char_length(v_description) not between 1 and 4000
      or v_description ~ '[[:cntrl:]]|<[[:alpha:]/][^>]*>'
      or v_status<>'not_started'
      or v_owner_id is null or not public.m8_evidence_actor_active(p_organization_id,v_owner_id)
    then return query select 'invalid_request'::text,null::jsonb; return; end if;
    insert into public.framework_controls(organization_id,title,description,owner_user_id,
      implementation_status,created_by,updated_by)
    values(p_organization_id,v_title,v_description,v_owner_id,v_status,p_actor_user_id,p_actor_user_id)
    returning * into v_control;
    v_control_id:=v_control.id;
    v_outcome:='created';
  else
    v_control_id:=public.m10_control_uuid(p_payload->>'controlId');
    if v_control_id is null then
      return query select 'invalid_request'::text,null::jsonb; return;
    end if;
    select * into v_control from public.framework_controls c
    where c.organization_id=p_organization_id and c.id=v_control_id for update;
    if not found then return query select 'not_found'::text,null::jsonb; return; end if;
    if p_expected_revision is distinct from v_control.revision then
      return query select 'conflict'::text,
        jsonb_build_object('controlId',v_control_id,'revision',v_control.revision); return;
    end if;
    if v_control.archived_at is not null then
      return query select 'blocked'::text,
        jsonb_build_object('controlId',v_control_id,'revision',v_control.revision,
          'reason','Control is archived'); return;
    end if;
    v_now:=clock_timestamp();
    if p_operation='update_control' then
      v_title:=coalesce(p_payload->>'title',v_control.title);
      v_description:=case when p_payload ? 'description' then p_payload->>'description'
        else v_control.description end;
      v_owner_id:=coalesce(public.m10_control_uuid(p_payload->>'ownerUserId'),v_control.owner_user_id);
      v_status:=coalesce(p_payload->>'implementationStatus',v_control.implementation_status);
      v_reason:=p_payload->>'transitionReason';
      if v_title<>btrim(v_title) or char_length(v_title) not between 1 and 200
        or v_title ~ '[[:cntrl:]]|<[[:alpha:]/][^>]*>'
        or v_description is null or v_description<>btrim(v_description)
        or char_length(v_description) not between 1 and 4000
        or v_description ~ '[[:cntrl:]]|<[[:alpha:]/][^>]*>'
        or v_status not in ('not_started','in_progress','implemented')
        or (p_payload ? 'ownerUserId' and public.m10_control_uuid(p_payload->>'ownerUserId') is null)
        or (v_owner_id is distinct from v_control.owner_user_id
          and not public.m8_evidence_actor_active(p_organization_id,v_owner_id))
        or (v_reason is not null and (v_reason<>btrim(v_reason)
          or char_length(v_reason) not between 1 and 1000
          or v_reason ~ '[[:cntrl:]]|<[[:alpha:]/][^>]*>'))
      then return query select 'invalid_request'::text,null::jsonb; return; end if;
      if v_status is distinct from v_control.implementation_status then
        if (v_control.implementation_status='not_started' and v_status='in_progress')
          or (v_control.implementation_status='in_progress' and v_status='implemented')
          then null;
        elsif (v_control.implementation_status='implemented' and v_status='in_progress')
          or (v_control.implementation_status='in_progress' and v_status='not_started')
          then
          if v_reason is null then
            return query select 'invalid_request'::text,null::jsonb; return;
          end if;
        else return query select 'invalid_request'::text,null::jsonb; return;
        end if;
      end if;
      if v_title=v_control.title and v_description is not distinct from v_control.description
        and v_owner_id=v_control.owner_user_id and v_status=v_control.implementation_status then
        v_outcome:='unchanged';
      else
        update public.framework_controls set title=v_title,description=v_description,
          owner_user_id=v_owner_id,implementation_status=v_status,
          revision=revision+1,updated_by=p_actor_user_id,updated_at=v_now
        where organization_id=p_organization_id and id=v_control_id returning * into v_control;
        v_outcome:='updated';
      end if;
    elsif p_operation='archive_control' then
      update public.framework_controls set archived_at=v_now,revision=revision+1,
        updated_by=p_actor_user_id,updated_at=v_now
      where organization_id=p_organization_id and id=v_control_id returning * into v_control;
      v_outcome:='archived';
    elsif p_operation='link_evidence' then
      v_version_id:=public.m10_control_uuid(p_payload->>'evidenceVersionId');
      v_product_id:=public.m10_control_uuid(p_payload->>'productId');
      if v_version_id is null or v_product_id is null then
        return query select 'invalid_request'::text,null::jsonb; return;
      end if;
      if not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_products')
        or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence')
      then return query select 'forbidden'::text,null::jsonb; return; end if;
      if not exists (
        select 1 from public.evidence_document_versions ev
        join public.evidence_document_version_products vp
          on vp.organization_id=ev.organization_id and vp.version_id=ev.id
        join public.products product
          on product.organization_id=vp.organization_id and product.id=vp.product_id
        where ev.organization_id=p_organization_id and ev.id=v_version_id
          and vp.product_id=v_product_id and product.archived_at is null
          and ev.processing_state='clean'
          and (ev.validity_starts_on is null or ev.validity_starts_on<=current_date)
          and (ev.validity_ends_on is null or ev.validity_ends_on>=current_date)
          and not exists (
            select 1 from public.evidence_document_deletion_intents di
            where di.organization_id=ev.organization_id and di.document_id=ev.document_id
              and di.state in ('queued','claimed','failed','completed'))
      ) then return query select 'invalid_request'::text,null::jsonb; return; end if;
      select * into v_link from public.framework_control_evidence_links x
      where x.organization_id=p_organization_id and x.control_id=v_control_id
        and x.evidence_version_id=v_version_id and x.product_id=v_product_id
        and x.ended_at is null;
      if found then
        v_link_id:=v_link.id; v_outcome:='unchanged';
      else
        update public.framework_controls set revision=revision+1,updated_by=p_actor_user_id,
          updated_at=v_now where organization_id=p_organization_id and id=v_control_id
          returning * into v_control;
        insert into public.framework_control_revisions(
          organization_id,control_id,revision,title,description,owner_user_id,
          implementation_status,archived_at,actor_user_id)
        values(p_organization_id,v_control_id,v_control.revision,v_control.title,
          v_control.description,v_control.owner_user_id,v_control.implementation_status,
          v_control.archived_at,p_actor_user_id);
        insert into public.framework_control_evidence_links(
          organization_id,control_id,evidence_version_id,product_id,
          source_control_revision,created_by)
        values(p_organization_id,v_control_id,v_version_id,v_product_id,
          v_control.revision,p_actor_user_id) returning id into v_link_id;
        v_outcome:='linked';
      end if;
    elsif p_operation='unlink_evidence' then
      v_link_id:=public.m10_control_uuid(p_payload->>'linkId');
      select * into v_link from public.framework_control_evidence_links x
      where x.organization_id=p_organization_id and x.control_id=v_control_id and x.id=v_link_id;
      if not found then return query select 'not_found'::text,null::jsonb; return; end if;
      if v_link.ended_at is not null then v_outcome:='unchanged';
      else
        update public.framework_controls set revision=revision+1,updated_by=p_actor_user_id,
          updated_at=v_now where organization_id=p_organization_id and id=v_control_id
          returning * into v_control;
        insert into public.framework_control_revisions(
          organization_id,control_id,revision,title,description,owner_user_id,
          implementation_status,archived_at,actor_user_id)
        values(p_organization_id,v_control_id,v_control.revision,v_control.title,
          v_control.description,v_control.owner_user_id,v_control.implementation_status,
          v_control.archived_at,p_actor_user_id);
        update public.framework_control_evidence_links set ended_at=v_now,ended_by=p_actor_user_id
          where organization_id=p_organization_id and id=v_link_id;
        v_outcome:='unlinked';
      end if;
    elsif p_operation='upsert_mapping' then
      v_mapping_id:=public.m10_control_uuid(p_payload->>'mappingId');
      v_pack_key:=p_payload->>'packKey';
      v_version_key:=p_payload->>'versionKey';
      v_requirement_key:=p_payload->>'requirementKey';
      v_rationale:=p_payload->>'rationale';
      if v_pack_key is null or v_version_key is null or v_requirement_key is null
        or v_rationale is null or v_rationale<>btrim(v_rationale)
        or char_length(v_rationale) not between 1 and 2000
        or v_rationale ~ '[[:cntrl:]]|<[[:alpha:]/][^>]*>'
        or (p_payload ? 'mappingId' and v_mapping_id is null)
        or jsonb_typeof(p_payload->'productIds')<>'array'
        or jsonb_array_length(p_payload->'productIds') not between 1 and 100
      then return query select 'invalid_request'::text,null::jsonb; return; end if;
      select array_agg(public.m10_control_uuid(x.value) order by public.m10_control_uuid(x.value)),
        count(*) into v_products,v_count
      from jsonb_array_elements_text(p_payload->'productIds') x(value);
      if not public.m9_supplier_actor_can(p_organization_id,p_actor_user_id,'can_view_products') then
        return query select 'forbidden'::text,null::jsonb; return;
      end if;
      if v_products is null or array_position(v_products,null) is not null
        or cardinality(v_products)<>v_count
        or exists(select 1 from unnest(v_products) x(product_id)
          group by x.product_id having count(*)>1)
        or exists(select 1 from unnest(v_products) x(product_id) left join public.products product
          on product.organization_id=p_organization_id and product.id=x.product_id
          where product.id is null or product.archived_at is not null)
        or not exists(select 1 from public.organization_framework_selections selection
          where selection.organization_id=p_organization_id and selection.pack_key=v_pack_key
            and selection.version_key=v_version_key and selection.enabled)
        or not exists(select 1 from public.framework_requirements requirement
          where requirement.pack_key=v_pack_key and requirement.version_key=v_version_key
            and requirement.requirement_key=v_requirement_key)
      then return query select 'invalid_request'::text,null::jsonb; return; end if;
      if v_mapping_id is not null then
        select * into v_mapping from public.framework_control_requirement_mappings m
        where m.organization_id=p_organization_id and m.control_id=v_control_id
          and m.id=v_mapping_id and m.ended_at is null;
        if not found then return query select 'not_found'::text,null::jsonb; return; end if;
        if v_mapping.pack_key is distinct from v_pack_key
          or v_mapping.version_key is distinct from v_version_key
          or v_mapping.requirement_key is distinct from v_requirement_key then
          return query select 'invalid_request'::text,null::jsonb; return;
        end if;
      end if;
      select * into v_current_mapping from public.framework_control_requirement_mappings m
      where m.organization_id=p_organization_id and m.control_id=v_control_id
        and m.pack_key=v_pack_key and m.version_key=v_version_key
        and m.requirement_key=v_requirement_key and m.ended_at is null;
      if found and (v_mapping_id is null or v_current_mapping.id=v_mapping_id) then
        select array_agg(mp.product_id order by mp.product_id) into v_prior_products
        from public.framework_control_mapping_products mp
        where mp.organization_id=p_organization_id and mp.mapping_id=v_current_mapping.id;
        if v_current_mapping.rationale=v_rationale and v_prior_products=v_products then
          v_mapping_id:=v_current_mapping.id; v_outcome:='unchanged';
        elsif v_mapping_id is null then
          return query select 'conflict'::text,
            jsonb_build_object('controlId',v_control_id,'revision',v_control.revision,
              'mappingId',v_current_mapping.id); return;
        end if;
      elsif found then
        return query select 'conflict'::text,
          jsonb_build_object('controlId',v_control_id,'revision',v_control.revision,
            'mappingId',v_current_mapping.id); return;
      end if;
      if v_outcome is null then
        if v_mapping_id is not null then
          update public.framework_control_requirement_mappings
            set ended_at=v_now,ended_by=p_actor_user_id
          where organization_id=p_organization_id and id=v_mapping_id;
        end if;
        update public.framework_controls set revision=revision+1,updated_by=p_actor_user_id,
          updated_at=v_now where organization_id=p_organization_id and id=v_control_id
          returning * into v_control;
        insert into public.framework_control_revisions(
          organization_id,control_id,revision,title,description,owner_user_id,
          implementation_status,archived_at,actor_user_id)
        values(p_organization_id,v_control_id,v_control.revision,v_control.title,
          v_control.description,v_control.owner_user_id,v_control.implementation_status,
          v_control.archived_at,p_actor_user_id);
        insert into public.framework_control_requirement_mappings(
          organization_id,control_id,pack_key,version_key,requirement_key,rationale,
          source_control_revision,created_by)
        values(p_organization_id,v_control_id,v_pack_key,v_version_key,v_requirement_key,
          v_rationale,v_control.revision,p_actor_user_id) returning id into v_mapping_id;
        insert into public.framework_control_mapping_products(organization_id,mapping_id,product_id)
        select p_organization_id,v_mapping_id,id from unnest(v_products) id;
        v_outcome:='mapped';
      end if;
    elsif p_operation='end_mapping' then
      v_mapping_id:=public.m10_control_uuid(p_payload->>'mappingId');
      select * into v_mapping from public.framework_control_requirement_mappings m
      where m.organization_id=p_organization_id and m.control_id=v_control_id and m.id=v_mapping_id;
      if not found then return query select 'not_found'::text,null::jsonb; return; end if;
      if v_mapping.ended_at is not null then v_outcome:='unchanged';
      else
        update public.framework_controls set revision=revision+1,updated_by=p_actor_user_id,
          updated_at=v_now where organization_id=p_organization_id and id=v_control_id
          returning * into v_control;
        insert into public.framework_control_revisions(
          organization_id,control_id,revision,title,description,owner_user_id,
          implementation_status,archived_at,actor_user_id)
        values(p_organization_id,v_control_id,v_control.revision,v_control.title,
          v_control.description,v_control.owner_user_id,v_control.implementation_status,
          v_control.archived_at,p_actor_user_id);
        update public.framework_control_requirement_mappings
          set ended_at=v_now,ended_by=p_actor_user_id
        where organization_id=p_organization_id and id=v_mapping_id;
        v_outcome:='unmapped';
      end if;
    end if;
  end if;
  if p_operation in ('create_control','update_control','archive_control')
    and v_outcome<>'unchanged' then
    insert into public.framework_control_revisions(
      organization_id,control_id,revision,title,description,owner_user_id,
      implementation_status,archived_at,transition_reason,actor_user_id)
    values(p_organization_id,v_control_id,v_control.revision,v_control.title,
      v_control.description,v_control.owner_user_id,v_control.implementation_status,
      v_control.archived_at,v_reason,p_actor_user_id);
  end if;
  v_result:=jsonb_build_object('controlId',v_control_id,'revision',v_control.revision)
    || case when v_link_id is not null then jsonb_build_object('linkId',v_link_id)
       else '{}'::jsonb end
    || case when v_mapping_id is not null then jsonb_build_object('mappingId',v_mapping_id)
       else '{}'::jsonb end;
  if v_outcome<>'unchanged' then
    insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
    values(p_organization_id,p_actor_user_id,'framework.control_'||v_outcome,
      'framework_control',v_control_id::text,
      jsonb_build_object('operation',p_operation,'idempotencyKey',p_idempotency_key,
        'revision',v_control.revision,'linkId',v_link_id,'mappingId',v_mapping_id));
  end if;
  insert into public.framework_control_commands(
    organization_id,actor_user_id,idempotency_key,request_digest,outcome,result)
  values(p_organization_id,p_actor_user_id,p_idempotency_key,v_digest,v_outcome,v_result);
  return query select v_outcome,v_result;
end $$;

revoke all on function public.m10_reject_control_history_change(),
  public.m10_control_uuid(text),
  public.m10_control_command(uuid,uuid,text,jsonb,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.m10_control_command(uuid,uuid,text,jsonb,integer,uuid)
  to service_role;
notify pgrst,'reload schema';
