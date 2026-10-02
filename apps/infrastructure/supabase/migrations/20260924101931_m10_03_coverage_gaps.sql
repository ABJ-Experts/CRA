-- M10-03. Product/version-scoped applicability and durable coverage calculation.
-- Requirements, controls, mappings, evidence versions, and M7 snapshots remain unchanged.

create table public.framework_requirement_applicability (
  organization_id uuid not null,
  product_id uuid not null,
  pack_key text not null,
  version_key text not null,
  requirement_key text not null,
  approved_non_applicable boolean not null,
  reason text,
  revision integer not null check (revision >= 1),
  updated_by uuid not null references public.users(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,product_id,pack_key,version_key,requirement_key),
  foreign key (organization_id,product_id)
    references public.products(organization_id,id) on delete cascade,
  foreign key (pack_key,version_key,requirement_key)
    references public.framework_requirements(pack_key,version_key,requirement_key) on delete restrict,
  check (reason is null or (reason=btrim(reason) and char_length(reason) between 1 and 2000
    and reason !~ '[[:cntrl:]]|<[[:alpha:]/][^>]*>')),
  check (not approved_non_applicable or reason is not null)
);
create index framework_applicability_product_idx on public.framework_requirement_applicability
  (organization_id,product_id,pack_key,version_key);

create table public.framework_coverage_scopes (
  organization_id uuid not null,
  product_id uuid not null,
  pack_key text not null,
  version_key text not null,
  source_revision bigint not null default 1 check (source_revision >= 1),
  computed_revision bigint not null default 0 check (computed_revision >= 0),
  status text not null default 'pending' check (status in ('pending','leased','current','error')),
  lease_owner uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default clock_timestamp(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_boundary_on date,
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,product_id,pack_key,version_key),
  foreign key (organization_id,product_id)
    references public.products(organization_id,id) on delete cascade,
  foreign key (pack_key,version_key)
    references public.framework_pack_versions(pack_key,version_key) on delete restrict,
  check ((status='leased' and lease_owner is not null and lease_expires_at is not null)
    or (status<>'leased' and lease_owner is null and lease_expires_at is null))
);
create index framework_coverage_claim_idx on public.framework_coverage_scopes
  (status,next_attempt_at,updated_at)
  where status in ('pending','error','leased');

create table public.framework_coverage_rows (
  organization_id uuid not null,
  product_id uuid not null,
  pack_key text not null,
  version_key text not null,
  requirement_key text not null,
  status text not null check(status in ('structural','excluded','evidence_backed',
    'no_mapping','unimplemented','missing_evidence','expired_evidence',
    'quarantined_evidence','unavailable_evidence')),
  control_count integer not null check(control_count >= 0),
  implemented_count integer not null check(implemented_count >= 0),
  valid_evidence_count integer not null check(valid_evidence_count >= 0),
  computed_revision bigint not null check(computed_revision >= 1),
  primary key (organization_id,product_id,pack_key,version_key,requirement_key),
  foreign key (organization_id,product_id,pack_key,version_key)
    references public.framework_coverage_scopes(organization_id,product_id,pack_key,version_key)
    on delete cascade,
  foreign key (pack_key,version_key,requirement_key)
    references public.framework_requirements(pack_key,version_key,requirement_key) on delete restrict
);
create index framework_coverage_rows_status_idx on public.framework_coverage_rows
  (organization_id,product_id,pack_key,version_key,status,requirement_key);

alter table public.framework_requirement_applicability enable row level security;
alter table public.framework_coverage_scopes enable row level security;
alter table public.framework_coverage_rows enable row level security;
revoke all on public.framework_requirement_applicability,public.framework_coverage_scopes,
  public.framework_coverage_rows from public,anon,authenticated,service_role;
grant select on public.framework_requirement_applicability,public.framework_coverage_scopes,
  public.framework_coverage_rows to service_role;

-- All source changes conservatively invalidate the organization's existing scopes.
-- This is synchronous in the source transaction, so reads cannot see old green data.
create function public.m10_invalidate_coverage_source()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_org uuid;
begin
  v_org:=case when tg_op='DELETE' then old.organization_id else new.organization_id end;
  update public.framework_coverage_scopes s
  set source_revision=source_revision+1,status='pending',lease_owner=null,
    lease_expires_at=null,next_attempt_at=clock_timestamp(),last_error=null,
    updated_at=clock_timestamp()
  where s.organization_id=v_org;
  return coalesce(new,old);
end $$;

create trigger m10_coverage_control_change after insert or update or delete on public.framework_controls
  for each row execute function public.m10_invalidate_coverage_source();
create trigger m10_coverage_mapping_change after insert or update or delete on public.framework_control_requirement_mappings
  for each row execute function public.m10_invalidate_coverage_source();
create trigger m10_coverage_mapping_product_change after insert or update or delete on public.framework_control_mapping_products
  for each row execute function public.m10_invalidate_coverage_source();
create trigger m10_coverage_link_change after insert or update or delete on public.framework_control_evidence_links
  for each row execute function public.m10_invalidate_coverage_source();
create trigger m10_coverage_version_change after insert or update or delete on public.evidence_document_versions
  for each row execute function public.m10_invalidate_coverage_source();
create trigger m10_coverage_document_change after insert or update or delete on public.evidence_documents
  for each row execute function public.m10_invalidate_coverage_source();
create trigger m10_coverage_deletion_change after insert or update or delete on public.evidence_document_deletion_intents
  for each row execute function public.m10_invalidate_coverage_source();
create trigger m10_coverage_product_change after update on public.products
  for each row execute function public.m10_invalidate_coverage_source();
create trigger m10_coverage_selection_change after insert or update or delete on public.organization_framework_selections
  for each row execute function public.m10_invalidate_coverage_source();
create trigger m10_coverage_applicability_change after insert or update or delete on public.framework_requirement_applicability
  for each row execute function public.m10_invalidate_coverage_source();

create function public.m10_set_framework_applicability(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,
  p_pack_key text,p_version_key text,p_requirement_key text,
  p_approved boolean,p_reason text,p_expected_revision integer,p_idempotency_key uuid
) returns table(outcome text,result jsonb)
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_prior public.framework_control_commands%rowtype;
  v_current public.framework_requirement_applicability%rowtype;
  v_digest text;
  v_revision integer;
  v_result jsonb;
begin
  if p_organization_id is null or p_actor_user_id is null or p_product_id is null
    or p_pack_key is null or p_version_key is null or p_requirement_key is null
    or p_approved is null or p_idempotency_key is null
    or (p_expected_revision is not null and p_expected_revision < 1)
    or (p_approved and (p_reason is null or p_reason<>btrim(p_reason)
      or char_length(p_reason) not between 1 and 2000
      or p_reason ~ '[[:cntrl:]]|<[[:alpha:]/][^>]*>'))
    or (not p_approved and p_reason is not null)
  then return query select 'invalid_request'::text,null::jsonb; return; end if;
  if not public.m10_actor_can_manage_frameworks(p_organization_id,p_actor_user_id) then
    return query select 'forbidden'::text,null::jsonb; return;
  end if;
  if not exists(select 1 from public.products p where p.organization_id=p_organization_id
    and p.id=p_product_id and p.archived_at is null)
    or not exists(select 1 from public.framework_requirements r
      where r.pack_key=p_pack_key and r.version_key=p_version_key
        and r.requirement_key=p_requirement_key and r.depth>0)
    or not exists(select 1 from public.organization_framework_selections s
      where s.organization_id=p_organization_id and s.pack_key=p_pack_key
        and s.version_key=p_version_key and s.enabled)
  then return query select 'not_found'::text,null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('operation','applicability',
    'productId',p_product_id,'packKey',p_pack_key,'versionKey',p_version_key,
    'requirementKey',p_requirement_key,'approved',p_approved,'reason',p_reason,
    'expectedRevision',p_expected_revision)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0));
  select * into v_prior from public.framework_control_commands c
    where c.organization_id=p_organization_id and c.actor_user_id=p_actor_user_id
      and c.idempotency_key=p_idempotency_key;
  if found then
    if v_prior.request_digest<>v_digest then
      return query select 'invalid_request'::text,null::jsonb; return;
    end if;
    return query select v_prior.outcome,v_prior.result; return;
  end if;
  select * into v_current from public.framework_requirement_applicability a
    where a.organization_id=p_organization_id and a.product_id=p_product_id
      and a.pack_key=p_pack_key and a.version_key=p_version_key
      and a.requirement_key=p_requirement_key for update;
  if (not found and p_expected_revision is not null)
    or (found and p_expected_revision is distinct from v_current.revision) then
    return query select 'conflict'::text,null::jsonb; return;
  end if;
  v_revision:=coalesce(v_current.revision,0)+1;
  insert into public.framework_requirement_applicability(
    organization_id,product_id,pack_key,version_key,requirement_key,
    approved_non_applicable,reason,revision,updated_by)
  values(p_organization_id,p_product_id,p_pack_key,p_version_key,p_requirement_key,
    p_approved,p_reason,v_revision,p_actor_user_id)
  on conflict (organization_id,product_id,pack_key,version_key,requirement_key)
  do update set approved_non_applicable=excluded.approved_non_applicable,
    reason=excluded.reason,revision=excluded.revision,
    updated_by=excluded.updated_by,updated_at=clock_timestamp();
  v_result:=jsonb_build_object('productId',p_product_id,'packKey',p_pack_key,
    'versionKey',p_version_key,'requirementKey',p_requirement_key,
    'approvedNonApplicable',p_approved,'reason',p_reason,'revision',v_revision);
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes)
  values(p_organization_id,p_actor_user_id,'framework.applicability_changed',
    'framework_requirement',p_requirement_key,
    jsonb_build_object('productId',p_product_id,'packKey',p_pack_key,
      'versionKey',p_version_key,'oldApproved',v_current.approved_non_applicable,
      'newApproved',p_approved,'oldReason',v_current.reason,'newReason',p_reason,
      'revision',v_revision,'idempotencyKey',p_idempotency_key));
  insert into public.framework_control_commands(
    organization_id,actor_user_id,idempotency_key,request_digest,outcome,result)
  values(p_organization_id,p_actor_user_id,p_idempotency_key,v_digest,'updated',v_result);
  return query select 'updated'::text,v_result;
end $$;

create function public.m10_request_coverage(
  p_organization_id uuid,p_product_id uuid,p_pack_key text,p_version_key text
) returns table(status text,source_revision bigint,computed_revision bigint,next_boundary_on date)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_scope public.framework_coverage_scopes%rowtype;
begin
  if not exists(select 1 from public.products p where p.organization_id=p_organization_id
    and p.id=p_product_id and p.archived_at is null)
    or not exists(select 1 from public.framework_pack_versions p
      where p.pack_key=p_pack_key and p.version_key=p_version_key)
  then return; end if;
  insert into public.framework_coverage_scopes(
    organization_id,product_id,pack_key,version_key)
  values(p_organization_id,p_product_id,p_pack_key,p_version_key)
  on conflict do nothing;
  select * into v_scope from public.framework_coverage_scopes s
  where s.organization_id=p_organization_id and s.product_id=p_product_id
    and s.pack_key=p_pack_key and s.version_key=p_version_key for update;
  if v_scope.status='current' and v_scope.next_boundary_on is not null
    and v_scope.next_boundary_on <= (clock_timestamp() at time zone 'UTC')::date then
    update public.framework_coverage_scopes s
    set status='pending',source_revision=s.source_revision+1,
      next_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
    where s.organization_id=p_organization_id and s.product_id=p_product_id
      and s.pack_key=p_pack_key and s.version_key=p_version_key
    returning * into v_scope;
  end if;
  return query select v_scope.status,v_scope.source_revision,
    v_scope.computed_revision,v_scope.next_boundary_on;
end $$;

create function public.m10_claim_coverage_scope(p_worker_id uuid)
returns table(organization_id uuid,product_id uuid,pack_key text,version_key text,source_revision bigint)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_scope public.framework_coverage_scopes%rowtype;
begin
  if p_worker_id is null then return; end if;
  select * into v_scope from public.framework_coverage_scopes s
    where ((s.status in ('pending','error') and s.next_attempt_at<=clock_timestamp())
      or (s.status='leased' and s.lease_expires_at<clock_timestamp()))
    order by s.next_attempt_at,s.updated_at
    for update skip locked limit 1;
  if not found then return; end if;
  update public.framework_coverage_scopes s
    set status='leased',lease_owner=p_worker_id,
      lease_expires_at=clock_timestamp()+interval '2 minutes',
      attempt_count=s.attempt_count+1,updated_at=clock_timestamp()
    where s.organization_id=v_scope.organization_id and s.product_id=v_scope.product_id
      and s.pack_key=v_scope.pack_key and s.version_key=v_scope.version_key;
  return query select v_scope.organization_id,v_scope.product_id,
    v_scope.pack_key,v_scope.version_key,v_scope.source_revision;
end $$;

create function public.m10_recalculate_coverage_scope(
  p_worker_id uuid,p_organization_id uuid,p_product_id uuid,
  p_pack_key text,p_version_key text
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_scope public.framework_coverage_scopes%rowtype;
  v_today date:=(clock_timestamp() at time zone 'UTC')::date;
  v_boundary date;
begin
  select * into v_scope from public.framework_coverage_scopes s
    where s.organization_id=p_organization_id and s.product_id=p_product_id
      and s.pack_key=p_pack_key and s.version_key=p_version_key for update;
  if not found or v_scope.status<>'leased' or v_scope.lease_owner is distinct from p_worker_id
    or v_scope.lease_expires_at<=clock_timestamp() then return 'lease_lost'; end if;
  if not exists(select 1 from public.products p where p.organization_id=p_organization_id
    and p.id=p_product_id and p.archived_at is null) then
    update public.framework_coverage_scopes s set status='error',lease_owner=null,
      lease_expires_at=null,last_error='product_unavailable',
      next_attempt_at=clock_timestamp()+interval '1 hour',updated_at=clock_timestamp()
    where s.organization_id=p_organization_id and s.product_id=p_product_id
      and s.pack_key=p_pack_key and s.version_key=p_version_key;
    return 'unavailable';
  end if;
  -- Recalculation and source invalidation serialize on the scope row. A later
  -- source change increments its revision and makes the result stale atomically.
  delete from public.framework_coverage_rows r where r.organization_id=p_organization_id
    and r.product_id=p_product_id and r.pack_key=p_pack_key and r.version_key=p_version_key;
  insert into public.framework_coverage_rows(
    organization_id,product_id,pack_key,version_key,requirement_key,status,
    control_count,implemented_count,valid_evidence_count,computed_revision)
  with paths as (
    select m.requirement_key,c.id control_id,c.implementation_status,
      coalesce(bool_or(v.processing_state='clean'
        and d.lifecycle_state='active'
        and (v.validity_starts_on is null or v.validity_starts_on<=v_today)
        and (v.validity_ends_on is null or v.validity_ends_on>=v_today)
        and not exists(select 1 from public.evidence_document_deletion_intents di
          where di.organization_id=p_organization_id and di.document_id=d.id
            and di.state in ('queued','claimed','failed','completed'))),false) valid,
      coalesce(bool_or(v.validity_ends_on<v_today and v.processing_state='clean'),false) expired,
      coalesce(bool_or(v.processing_state='quarantined'),false) quarantined,
      count(l.id)>0 has_link
    from public.framework_control_requirement_mappings m
    join public.framework_control_mapping_products mp on mp.organization_id=m.organization_id
      and mp.mapping_id=m.id and mp.product_id=p_product_id
    join public.framework_controls c on c.organization_id=m.organization_id
      and c.id=m.control_id and c.archived_at is null
    left join public.framework_control_evidence_links l on l.organization_id=c.organization_id
      and l.control_id=c.id and l.product_id=p_product_id and l.ended_at is null
    left join public.evidence_document_versions v on v.organization_id=l.organization_id
      and v.id=l.evidence_version_id
    left join public.evidence_documents d on d.organization_id=v.organization_id
      and d.id=v.document_id
    where m.organization_id=p_organization_id and m.pack_key=p_pack_key
      and m.version_key=p_version_key and m.ended_at is null
    group by m.requirement_key,c.id,c.implementation_status
  ), aggregates as (
    select requirement_key,count(*)::integer control_count,
      count(*) filter(where implementation_status='implemented')::integer implemented_count,
      count(*) filter(where implementation_status='implemented' and valid)::integer valid_count,
      bool_or(expired) expired,bool_or(quarantined) quarantined,
      bool_or(has_link) has_link
    from paths group by requirement_key
  )
  select p_organization_id,p_product_id,p_pack_key,p_version_key,r.requirement_key,
    case when r.depth=0 then 'structural'
      when a.approved_non_applicable then 'excluded'
      when coalesce(g.control_count,0)=0 then 'no_mapping'
      when coalesce(g.implemented_count,0)=0 then 'unimplemented'
      when coalesce(g.valid_count,0)>0 then 'evidence_backed'
      when coalesce(g.quarantined,false) then 'quarantined_evidence'
      when coalesce(g.expired,false) then 'expired_evidence'
      when not coalesce(g.has_link,false) then 'missing_evidence'
      else 'unavailable_evidence' end,
    coalesce(g.control_count,0),coalesce(g.implemented_count,0),coalesce(g.valid_count,0),
    v_scope.source_revision
  from public.framework_requirements r
  left join aggregates g on g.requirement_key=r.requirement_key
  left join public.framework_requirement_applicability a
    on a.organization_id=p_organization_id and a.product_id=p_product_id
      and a.pack_key=r.pack_key and a.version_key=r.version_key
      and a.requirement_key=r.requirement_key
  where r.pack_key=p_pack_key and r.version_key=p_version_key;
  select min(boundary_on) into v_boundary from (
    select v.validity_starts_on boundary_on
    from public.framework_control_evidence_links l
    join public.evidence_document_versions v on v.organization_id=l.organization_id
      and v.id=l.evidence_version_id
    where l.organization_id=p_organization_id and l.product_id=p_product_id
      and l.ended_at is null and v.validity_starts_on>v_today
    union all
    select v.validity_ends_on+1
    from public.framework_control_evidence_links l
    join public.evidence_document_versions v on v.organization_id=l.organization_id
      and v.id=l.evidence_version_id
    where l.organization_id=p_organization_id and l.product_id=p_product_id
      and l.ended_at is null and v.validity_ends_on>=v_today
  ) dates;
  update public.framework_coverage_scopes s
    set status='current',computed_revision=v_scope.source_revision,
      next_boundary_on=v_boundary,lease_owner=null,lease_expires_at=null,
      last_error=null,updated_at=clock_timestamp()
    where s.organization_id=p_organization_id and s.product_id=p_product_id
      and s.pack_key=p_pack_key and s.version_key=p_version_key;
  return 'current';
end $$;

revoke all on function public.m10_invalidate_coverage_source(),
  public.m10_set_framework_applicability(uuid,uuid,uuid,text,text,text,boolean,text,integer,uuid),
  public.m10_request_coverage(uuid,uuid,text,text),
  public.m10_claim_coverage_scope(uuid),
  public.m10_recalculate_coverage_scope(uuid,uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.m10_set_framework_applicability(uuid,uuid,uuid,text,text,text,boolean,text,integer,uuid),
  public.m10_request_coverage(uuid,uuid,text,text),
  public.m10_claim_coverage_scope(uuid),
  public.m10_recalculate_coverage_scope(uuid,uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
