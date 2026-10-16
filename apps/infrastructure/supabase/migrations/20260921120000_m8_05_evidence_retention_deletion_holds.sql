-- M8-05: document-scoped retention, reviewed deletion, and legal holds.
-- This migration intentionally consumes M2's durable product projection. It
-- never derives statutory dates itself and never schedules an automatic purge.

alter table public.evidence_documents
  add column lifecycle_state text not null default 'active',
  add column deletion_requested_at timestamptz,
  add column deleted_at timestamptz,
  add constraint evidence_documents_lifecycle_state_check
    check (lifecycle_state in ('active','queued_cleanup','cleanup_claimed','cleanup_failed','deleted')),
  add constraint evidence_documents_lifecycle_timestamps_check check (
    (lifecycle_state='active' and deletion_requested_at is null and deleted_at is null)
    or (lifecycle_state in ('queued_cleanup','cleanup_claimed','cleanup_failed') and deletion_requested_at is not null and deleted_at is null)
    or (lifecycle_state='deleted' and deletion_requested_at is not null and deleted_at is not null)
  );

create table public.evidence_document_version_retention_protections (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version_id uuid not null,
  linked_product_ids uuid[] not null default '{}'::uuid[],
  linked_product_count integer not null default 0 check (linked_product_count >= 0),
  source_status text not null default 'incomplete' check (source_status in ('current','incomplete')),
  source_incomplete boolean not null default true,
  product_legal_hold_active boolean not null default false,
  observed_retention_until timestamptz,
  observed_protection_until timestamptz,
  strongest_retention_until timestamptz,
  strongest_protection_until timestamptz,
  refreshed_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,version_id),
  foreign key (organization_id,version_id)
    references public.evidence_document_versions(organization_id,id) on delete restrict,
  check (source_status='incomplete' or source_incomplete=false),
  check (strongest_protection_until is null or strongest_retention_until is null
    or strongest_protection_until >= strongest_retention_until)
);
create index evidence_version_retention_protection_blocking_idx
  on public.evidence_document_version_retention_protections(organization_id,source_incomplete,product_legal_hold_active,strongest_protection_until);

create table public.evidence_document_legal_holds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null,
  reason text not null check (reason=btrim(reason) and char_length(reason) between 1 and 4000 and reason !~ '[[:cntrl:]]'),
  placed_by_user_id uuid not null references public.users(id) on delete restrict,
  placed_at timestamptz not null default clock_timestamp(),
  released_by_user_id uuid references public.users(id) on delete restrict,
  released_at timestamptz,
  release_reason text check (release_reason is null or (release_reason=btrim(release_reason) and char_length(release_reason) between 1 and 4000 and release_reason !~ '[[:cntrl:]]')),
  place_idempotency_key uuid not null,
  place_payload_digest text not null check (place_payload_digest ~ '^[a-f0-9]{64}$'),
  release_idempotency_key uuid,
  release_payload_digest text check (release_payload_digest is null or release_payload_digest ~ '^[a-f0-9]{64}$'),
  unique (organization_id,id),
  unique (organization_id,placed_by_user_id,place_idempotency_key),
  foreign key (organization_id,document_id) references public.evidence_documents(organization_id,id) on delete restrict,
  constraint evidence_document_legal_holds_active_release_check check (
    (released_at is null and released_by_user_id is null and release_reason is null and release_idempotency_key is null and release_payload_digest is null)
    or (released_at is not null and released_by_user_id is not null and release_reason is not null and release_idempotency_key is not null and release_payload_digest is not null)
  )
);
create index evidence_document_active_holds_idx
  on public.evidence_document_legal_holds(organization_id,document_id,placed_at,id)
  where released_at is null;

create table public.evidence_document_deletion_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null,
  expected_current_version_id uuid not null,
  review_fingerprint text not null check (review_fingerprint ~ '^[a-f0-9]{64}$'),
  reason text not null check (reason=btrim(reason) and char_length(reason) between 1 and 4000 and reason !~ '[[:cntrl:]]'),
  requested_by_user_id uuid not null references public.users(id) on delete restrict,
  requested_at timestamptz not null default clock_timestamp(),
  idempotency_key uuid not null,
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  state text not null default 'queued' check (state in ('queued','claimed','failed','completed','cancelled')),
  lease_owner uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text check (last_error is null or char_length(last_error)<=1000),
  completed_at timestamptz,
  unique (organization_id,id),
  constraint evidence_document_deletion_intents_idempotency_key unique (organization_id,requested_by_user_id,idempotency_key),
  foreign key (organization_id,document_id) references public.evidence_documents(organization_id,id) on delete restrict,
  foreign key (organization_id,expected_current_version_id) references public.evidence_document_versions(organization_id,id) on delete restrict,
  check ((state='claimed' and lease_owner is not null and lease_expires_at is not null)
    or (state<>'claimed' and lease_owner is null and lease_expires_at is null)),
  check ((state='completed' and completed_at is not null) or (state<>'completed' and completed_at is null))
);
create unique index evidence_document_single_open_deletion_idx
  on public.evidence_document_deletion_intents(organization_id,document_id)
  where state in ('queued','claimed','failed');
create index evidence_document_deletion_intents_claim_idx
  on public.evidence_document_deletion_intents(organization_id,state,requested_at,id)
  where state in ('queued','claimed','failed');

create table public.evidence_document_deletion_cleanup_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  intent_id uuid not null,
  version_id uuid not null,
  object_bucket text not null check (object_bucket='evidence-documents'),
  object_key text not null check (object_key=btrim(object_key) and char_length(object_key) between 1 and 1000),
  state text not null default 'queued' check (state in ('queued','claimed','deleted','failed')),
  lease_owner uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  completed_at timestamptz,
  last_error text check (last_error is null or char_length(last_error)<=1000),
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,intent_id,version_id),
  foreign key (organization_id,intent_id) references public.evidence_document_deletion_intents(organization_id,id) on delete restrict,
  foreign key (organization_id,version_id) references public.evidence_document_versions(organization_id,id) on delete restrict,
  check ((state='claimed' and lease_owner is not null and lease_expires_at is not null)
    or (state<>'claimed' and lease_owner is null and lease_expires_at is null)),
  check ((state='deleted' and completed_at is not null) or (state<>'deleted' and completed_at is null))
);
create index evidence_document_deletion_cleanup_claim_idx
  on public.evidence_document_deletion_cleanup_items(organization_id,state,created_at,id)
  where state in ('queued','claimed','failed');

-- Snapshot only the product projection already calculated by M2. Historical
-- maxima deliberately survive source correction or future unlink migrations.
create or replace function public.refresh_evidence_document_retention_protection_atomic(
  p_organization_id uuid,p_version_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_version public.evidence_document_versions%rowtype; v_existing public.evidence_document_version_retention_protections%rowtype;
declare v_product_ids uuid[]; v_product_count integer; v_incomplete boolean; v_legal_hold boolean;
declare v_retention_until timestamptz; v_protection_until timestamptz;
begin
  select * into v_version from public.evidence_document_versions
  where organization_id=p_organization_id and id=p_version_id for update;
  if not found then return null; end if;
  select coalesce(array_agg(vp.product_id order by vp.product_id),'{}'::uuid[]),count(*)::integer,
    coalesce(bool_or(p.retention_status<>'current' or p.retention_until is null or p.retention_protection_until is null),true),
    coalesce(bool_or(exists(select 1 from public.product_lifecycle_dependency_facts f where f.organization_id=p.organization_id and f.product_id=p.id and f.active and f.authority_kind='legal_hold')),false),
    max(p.retention_until),max(p.retention_protection_until)
  into v_product_ids,v_product_count,v_incomplete,v_legal_hold,v_retention_until,v_protection_until
  from public.evidence_document_version_products vp
  left join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id
  where vp.organization_id=p_organization_id and vp.version_id=p_version_id;
  select * into v_existing from public.evidence_document_version_retention_protections
  where organization_id=p_organization_id and version_id=p_version_id for update;
  insert into public.evidence_document_version_retention_protections(
    organization_id,version_id,linked_product_ids,linked_product_count,source_status,source_incomplete,product_legal_hold_active,
    observed_retention_until,observed_protection_until,strongest_retention_until,strongest_protection_until,refreshed_at
  ) values (
    p_organization_id,p_version_id,v_product_ids,v_product_count,
    case when v_incomplete or v_product_count=0 then 'incomplete' else 'current' end,
    v_incomplete or v_product_count=0,v_legal_hold,v_retention_until,v_protection_until,v_retention_until,v_protection_until,clock_timestamp()
  ) on conflict (organization_id,version_id) do update set
    linked_product_ids=excluded.linked_product_ids,linked_product_count=excluded.linked_product_count,
    source_status=excluded.source_status,source_incomplete=excluded.source_incomplete,
    product_legal_hold_active=excluded.product_legal_hold_active,
    observed_retention_until=excluded.observed_retention_until,observed_protection_until=excluded.observed_protection_until,
    strongest_retention_until=case when evidence_document_version_retention_protections.strongest_retention_until is null then excluded.observed_retention_until when excluded.observed_retention_until is null then evidence_document_version_retention_protections.strongest_retention_until else greatest(evidence_document_version_retention_protections.strongest_retention_until,excluded.observed_retention_until) end,
    strongest_protection_until=case when evidence_document_version_retention_protections.strongest_protection_until is null then excluded.observed_protection_until when excluded.observed_protection_until is null then evidence_document_version_retention_protections.strongest_protection_until else greatest(evidence_document_version_retention_protections.strongest_protection_until,excluded.observed_protection_until) end,
    refreshed_at=clock_timestamp();
  return jsonb_build_object('versionId',p_version_id,'linkedProductIds',to_jsonb(v_product_ids),'status',case when v_incomplete or v_product_count=0 then 'incomplete' else 'current' end,'retentionUntil',v_retention_until,'retentionProtectionUntil',v_protection_until,'legalHoldActive',v_legal_hold);
end $$;

create or replace function public.m8_05_refresh_retention_after_evidence_link()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.refresh_evidence_document_retention_protection_atomic(new.organization_id,new.version_id);
  return new;
end $$;
create trigger m8_05_refresh_retention_after_evidence_link
after insert on public.evidence_document_version_products for each row execute function public.m8_05_refresh_retention_after_evidence_link();

create or replace function public.m8_05_refresh_retention_after_product_projection()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v record;
begin
  for v in select distinct vp.organization_id,vp.version_id from public.evidence_document_version_products vp
    where vp.organization_id=new.organization_id and vp.product_id=new.id
  loop perform public.refresh_evidence_document_retention_protection_atomic(v.organization_id,v.version_id); end loop;
  return new;
end $$;
create trigger m8_05_refresh_retention_after_product_projection
after update of retention_status,retention_until,retention_protection_until on public.products
for each row execute function public.m8_05_refresh_retention_after_product_projection();

-- Backfill is additive/idempotent and creates no deletion intent or cleanup work.
insert into public.evidence_document_version_retention_protections(
  organization_id,version_id,linked_product_ids,linked_product_count,source_status,source_incomplete,product_legal_hold_active,
  observed_retention_until,observed_protection_until,strongest_retention_until,strongest_protection_until
)
select v.organization_id,v.id,coalesce(array_agg(vp.product_id order by vp.product_id) filter(where vp.product_id is not null),'{}'::uuid[]),count(vp.product_id)::integer,
  case when count(vp.product_id)=0 or bool_or(p.retention_status<>'current' or p.retention_until is null or p.retention_protection_until is null) then 'incomplete' else 'current' end,
  count(vp.product_id)=0 or bool_or(p.retention_status<>'current' or p.retention_until is null or p.retention_protection_until is null),
  coalesce(bool_or(exists(select 1 from public.product_lifecycle_dependency_facts f where f.organization_id=p.organization_id and f.product_id=p.id and f.active and f.authority_kind='legal_hold')),false),
  max(p.retention_until),max(p.retention_protection_until),max(p.retention_until),max(p.retention_protection_until)
from public.evidence_document_versions v left join public.evidence_document_version_products vp on vp.organization_id=v.organization_id and vp.version_id=v.id
left join public.products p on p.organization_id=vp.organization_id and p.id=vp.product_id
group by v.organization_id,v.id
on conflict (organization_id,version_id) do nothing;

create or replace function public.m8_05_actor_can_manage_evidence(p_organization_id uuid,p_actor_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.m8_evidence_actor_active(p_organization_id,p_actor_user_id)
    and public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_manage_evidence')
$$;

create or replace function public.m8_05_retention_review_json(p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with doc as (select d.* from public.evidence_documents d where d.organization_id=p_organization_id and d.id=p_document_id),
  protections as (select pr.* from public.evidence_document_version_retention_protections pr join public.evidence_document_versions v on v.organization_id=pr.organization_id and v.id=pr.version_id where pr.organization_id=p_organization_id and v.document_id=p_document_id),
  holds as (select h.* from public.evidence_document_legal_holds h where h.organization_id=p_organization_id and h.document_id=p_document_id and h.released_at is null),
  refs as (select exists(select 1 from public.technical_file_section_sources x where x.organization_id=p_organization_id and x.source_kind='evidence_document' and x.record_id=p_document_id) or exists(select 1 from public.technical_file_snapshots s where s.organization_id=p_organization_id and s.payload::text like '%'||p_document_id::text||'%') value),
  product_ids as (select coalesce(array_agg(distinct x),'{}'::uuid[]) ids from protections p cross join lateral unnest(p.linked_product_ids) x),
  product_blocks as (select p.id,p.name,p.retention_until,p.retention_protection_until,p.retention_status from public.products p join product_ids i on p.id=any(i.ids) where p.organization_id=p_organization_id and (p.retention_status<>'current' or p.retention_protection_until is null or p.retention_protection_until>clock_timestamp()))
  select jsonb_build_object(
    'documentId',d.id,'currentVersionId',d.current_version_id,'lifecycleState',d.lifecycle_state,
    -- Stable state timestamps make a reviewed fingerprint retryable. Do not use
    -- clock_timestamp() here: confirmation recomputes this projection.
    'reviewedAt',to_char(d.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'retentionIncomplete',coalesce((select bool_or(p.source_incomplete or p.linked_product_count=0) from protections p),true),
    'productLegalHoldActive',coalesce((select bool_or(p.product_legal_hold_active) from protections p),false),
    'retentionUntil',(select max(p.strongest_retention_until) from protections p),
    'retentionProtectionUntil',(select max(p.strongest_protection_until) from protections p),
    'linkedProductIds',coalesce((select to_jsonb(ids) from product_ids),'[]'::jsonb),
    'activeHolds',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'reason',h.reason,'placedAt',to_char(h.placed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'placedByUserId',h.placed_by_user_id) order by h.placed_at,h.id) from holds h),'[]'::jsonb),
    'blockingReasons',coalesce((select jsonb_agg(x order by x->>'code') from (
      select jsonb_build_object('code','document_legal_hold','kind','legal_hold','legalHoldId',h.id,'message','An active legal hold prevents deletion.') x from holds h
      union all select jsonb_build_object('code','retention_incomplete','kind','retention','message','Retention information is incomplete; deletion cannot be approved.') from protections p where p.source_incomplete or p.linked_product_count=0
      union all select jsonb_build_object('code','product_legal_hold','kind','legal_hold','message','A linked product has an active legal hold.') from protections p where p.product_legal_hold_active
      union all select jsonb_build_object('code','retention_protection','kind','retention','productId',b.id,'productName',case when public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_products') then b.name else null end,'retentionUntil',b.retention_until,'retentionProtectionUntil',b.retention_protection_until,'message',case when public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_products') then 'A linked product retention obligation prevents deletion.' else 'A protected linked reference prevents deletion.' end) from product_blocks b
      union all select jsonb_build_object('code','retained_reference','kind','reference','message','A retained technical-file or snapshot reference prevents deletion.') from refs where value
      union all select jsonb_build_object('code','lifecycle','kind','lifecycle','message','This evidence is already pending or has completed deletion.') from doc where lifecycle_state<>'active'
    ) x),'[]'::jsonb),
    'deletionIntent',(select jsonb_build_object('id',i.id,'state',i.state,'requestedAt',to_char(i.requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'lastError',i.last_error) from public.evidence_document_deletion_intents i where i.organization_id=p_organization_id and i.document_id=p_document_id and i.state in ('queued','claimed','failed') order by i.requested_at desc limit 1)
  ) from doc d
$$;

create or replace function public.get_evidence_document_retention_review_atomic(p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid)
returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_result jsonb;
begin
  if not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id) or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence') then return query select 'forbidden',null::jsonb; return; end if;
  if not exists(select 1 from public.evidence_documents d where d.organization_id=p_organization_id and d.id=p_document_id) then return query select 'not_found',null::jsonb; return; end if;
  v_result:=public.m8_05_retention_review_json(p_organization_id,p_actor_user_id,p_document_id);
  v_result:=v_result || jsonb_build_object('reviewFingerprint',encode(extensions.digest(v_result::text,'sha256'),'hex'));
  return query select 'found',v_result;
end $$;

create or replace function public.place_evidence_document_legal_hold_atomic(p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid,p_reason text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.evidence_documents%rowtype; h public.evidence_document_legal_holds%rowtype; v_digest text;
begin
  if not public.m8_05_actor_can_manage_evidence(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_reason is null or p_reason<>btrim(p_reason) or char_length(p_reason) not between 1 and 4000 or p_reason~'[[:cntrl:]]' then return query select 'invalid_request',null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('documentId',p_document_id,'reason',p_reason)::text,'sha256'),'hex');
  select * into h from public.evidence_document_legal_holds where organization_id=p_organization_id and placed_by_user_id=p_actor_user_id and place_idempotency_key=p_idempotency_key;
  if found then return query select case when h.place_payload_digest=v_digest then 'replayed' else 'idempotency_conflict' end,jsonb_build_object('id',h.id,'documentId',h.document_id,'reason',h.reason,'placedAt',h.placed_at,'releasedAt',h.released_at); return; end if;
  select * into d from public.evidence_documents where organization_id=p_organization_id and id=p_document_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if d.lifecycle_state in ('cleanup_claimed','deleted') then return query select 'conflict',jsonb_build_object('lifecycleState',d.lifecycle_state); return; end if;
  insert into public.evidence_document_legal_holds(organization_id,document_id,reason,placed_by_user_id,place_idempotency_key,place_payload_digest) values(p_organization_id,p_document_id,p_reason,p_actor_user_id,p_idempotency_key,v_digest) returning * into h;
  if d.lifecycle_state in ('queued_cleanup','cleanup_failed') then update public.evidence_document_deletion_intents set state='cancelled',lease_owner=null,lease_expires_at=null,last_error='cancelled by legal hold' where organization_id=p_organization_id and document_id=p_document_id and state in ('queued','failed'); update public.evidence_documents set lifecycle_state='active',deletion_requested_at=null where organization_id=p_organization_id and id=p_document_id; end if;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.legal_hold_placed','evidence_document_legal_hold',h.id::text,jsonb_build_object('documentId',p_document_id,'reason',p_reason,'idempotencyKey',p_idempotency_key));
  return query select 'placed',jsonb_build_object('id',h.id,'documentId',h.document_id,'reason',h.reason,'placedAt',h.placed_at,'placedByUserId',h.placed_by_user_id);
end $$;

create or replace function public.release_evidence_document_legal_hold_atomic(p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid,p_hold_id uuid,p_reason text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare h public.evidence_document_legal_holds%rowtype; v_digest text;
begin
  if not public.m8_05_actor_can_manage_evidence(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_reason is null or p_reason<>btrim(p_reason) or char_length(p_reason) not between 1 and 4000 or p_reason~'[[:cntrl:]]' then return query select 'invalid_request',null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('documentId',p_document_id,'holdId',p_hold_id,'reason',p_reason)::text,'sha256'),'hex');
  select * into h from public.evidence_document_legal_holds where organization_id=p_organization_id and id=p_hold_id and document_id=p_document_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if h.released_at is not null then return query select case when h.release_idempotency_key=p_idempotency_key and h.release_payload_digest=v_digest then 'replayed' else 'conflict' end,jsonb_build_object('id',h.id,'releasedAt',h.released_at); return; end if;
  update public.evidence_document_legal_holds set released_at=clock_timestamp(),released_by_user_id=p_actor_user_id,release_reason=p_reason,release_idempotency_key=p_idempotency_key,release_payload_digest=v_digest where organization_id=p_organization_id and id=p_hold_id returning * into h;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.legal_hold_released','evidence_document_legal_hold',h.id::text,jsonb_build_object('documentId',p_document_id,'reason',p_reason,'idempotencyKey',p_idempotency_key));
  return query select 'released',jsonb_build_object('id',h.id,'documentId',h.document_id,'releasedAt',h.released_at,'releasedByUserId',h.released_by_user_id,'releaseReason',h.release_reason);
end $$;

create or replace function public.confirm_evidence_document_deletion_atomic(p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid,p_expected_current_version_id uuid,p_review_fingerprint text,p_reason text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.evidence_documents%rowtype; i public.evidence_document_deletion_intents%rowtype; v_review jsonb; v_digest text; v_fingerprint text;
begin
  if not public.m8_05_actor_can_manage_evidence(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  if p_idempotency_key is null or p_expected_current_version_id is null or p_review_fingerprint !~ '^[a-f0-9]{64}$' or p_reason is null or p_reason<>btrim(p_reason) or char_length(p_reason) not between 1 and 4000 or p_reason~'[[:cntrl:]]' then return query select 'invalid_request',null::jsonb; return; end if;
  v_digest:=encode(extensions.digest(jsonb_build_object('documentId',p_document_id,'expectedCurrentVersionId',p_expected_current_version_id,'reviewFingerprint',p_review_fingerprint,'reason',p_reason)::text,'sha256'),'hex');
  select * into i from public.evidence_document_deletion_intents where organization_id=p_organization_id and requested_by_user_id=p_actor_user_id and idempotency_key=p_idempotency_key;
  if found then return query select case when i.payload_digest=v_digest then 'replayed' else 'idempotency_conflict' end,jsonb_build_object('intentId',i.id,'documentId',i.document_id,'state',i.state,'requestedAt',i.requested_at); return; end if;
  select * into d from public.evidence_documents where organization_id=p_organization_id and id=p_document_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if d.lifecycle_state<>'active' or d.current_version_id<>p_expected_current_version_id then return query select 'conflict',jsonb_build_object('documentId',d.id,'currentVersionId',d.current_version_id,'lifecycleState',d.lifecycle_state); return; end if;
  perform 1 from public.evidence_document_versions where organization_id=p_organization_id and document_id=p_document_id for update;
  perform 1 from public.evidence_document_version_retention_protections pr join public.evidence_document_versions v on v.organization_id=pr.organization_id and v.id=pr.version_id where pr.organization_id=p_organization_id and v.document_id=p_document_id for update;
  perform 1 from public.evidence_document_legal_holds where organization_id=p_organization_id and document_id=p_document_id for update;
  v_review:=public.m8_05_retention_review_json(p_organization_id,p_actor_user_id,p_document_id);
  v_fingerprint:=encode(extensions.digest(v_review::text,'sha256'),'hex');
  if v_fingerprint<>p_review_fingerprint then return query select 'conflict',v_review || jsonb_build_object('reviewFingerprint',v_fingerprint); return; end if;
  if jsonb_array_length(coalesce(v_review->'blockingReasons','[]'::jsonb))>0 then return query select 'blocked',v_review || jsonb_build_object('reviewFingerprint',v_fingerprint); return; end if;
  insert into public.evidence_document_deletion_intents(organization_id,document_id,expected_current_version_id,review_fingerprint,reason,requested_by_user_id,idempotency_key,payload_digest) values(p_organization_id,p_document_id,p_expected_current_version_id,p_review_fingerprint,p_reason,p_actor_user_id,p_idempotency_key,v_digest) returning * into i;
  insert into public.evidence_document_deletion_cleanup_items(organization_id,intent_id,version_id,object_bucket,object_key) select p_organization_id,i.id,v.id,v.object_bucket,v.object_key from public.evidence_document_versions v where v.organization_id=p_organization_id and v.document_id=p_document_id;
  update public.evidence_document_access_grants set expires_at=least(expires_at,clock_timestamp()),terminal_outcome='revoked' where organization_id=p_organization_id and document_id=p_document_id and terminal_outcome is null;
  update public.evidence_documents set lifecycle_state='queued_cleanup',deletion_requested_at=clock_timestamp(),updated_at=clock_timestamp() where organization_id=p_organization_id and id=p_document_id;
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.access_revoked_for_deletion','evidence_document',p_document_id::text,jsonb_build_object('intentId',i.id,'reason',p_reason,'idempotencyKey',p_idempotency_key));
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.deletion_confirmed','evidence_document_deletion_intent',i.id::text,jsonb_build_object('documentId',p_document_id,'reviewFingerprint',p_review_fingerprint,'reason',p_reason,'idempotencyKey',p_idempotency_key));
  return query select 'queued',jsonb_build_object('intentId',i.id,'documentId',p_document_id,'state','queued_cleanup','requestedAt',i.requested_at);
end $$;

-- Override access redemption so a queued/claimed deletion cannot leave an old
-- bearer grant usable between confirmation and physical object cleanup.
create or replace function public.redeem_evidence_document_access_atomic(p_organization_id uuid,p_actor_user_id uuid,p_token_sha256 text,p_request_correlation_id uuid,p_range_start bigint default null,p_range_end bigint default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.evidence_document_access_grants%rowtype; v_version public.evidence_document_versions%rowtype;
begin
 if p_token_sha256 is null or p_token_sha256 !~ '^[a-f0-9]{64}$' or p_request_correlation_id is null or ((p_range_start is null)<>(p_range_end is null)) or (p_range_start is not null and (p_range_start<0 or p_range_end<p_range_start)) or not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
 select * into g from public.evidence_document_access_grants where organization_id=p_organization_id and token_sha256=p_token_sha256 for update;
 if not found or g.actor_user_id<>p_actor_user_id or g.terminal_outcome='revoked' then return query select 'forbidden',null::jsonb; return; end if;
 if g.expires_at<clock_timestamp() then update public.evidence_document_access_grants set terminal_outcome='expired' where id=g.id; return query select 'expired',null::jsonb; return; end if;
 select ev.* into v_version from public.evidence_document_versions ev join public.evidence_documents d on d.organization_id=ev.organization_id and d.id=ev.document_id and d.lifecycle_state='active' where ev.organization_id=p_organization_id and ev.id=g.version_id and ev.document_id=g.document_id;
 if not found or v_version.processing_state<>'clean' or (v_version.validity_ends_on is not null and v_version.validity_ends_on<current_date) or not exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=g.product_id and p.archived_at is null) or not exists(select 1 from public.evidence_document_version_products vp where vp.organization_id=p_organization_id and vp.version_id=v_version.id and vp.product_id=g.product_id) then return query select 'unavailable',null::jsonb; return; end if;
 if p_range_start is not null and p_range_end>=v_version.actual_size_bytes then return query select 'invalid_range',null::jsonb; return; end if;
 update public.evidence_document_access_grants set first_redeemed_at=coalesce(first_redeemed_at,clock_timestamp()),last_redeemed_at=clock_timestamp(),redemption_count=redemption_count+1,first_range_start=coalesce(first_range_start,p_range_start),first_range_end=coalesce(first_range_end,p_range_end),last_range_start=p_range_start,last_range_end=p_range_end,terminal_outcome='delivered' where id=g.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'evidence.byte_delivery_started','evidence_document_version',v_version.id::text,jsonb_build_object('grantId',g.id,'documentId',g.document_id,'mode',g.access_mode,'purpose',g.purpose,'correlationId',p_request_correlation_id,'rangeStart',p_range_start,'rangeEnd',p_range_end));
 return query select 'redeemed',jsonb_build_object('grantId',g.id,'documentId',g.document_id,'versionId',v_version.id,'objectBucket',v_version.object_bucket,'objectKey',v_version.object_key,'filename',v_version.original_filename,'mediaType',v_version.detected_media_type,'byteSize',v_version.actual_size_bytes,'sha256',v_version.original_sha256,'mode',g.access_mode,'expiresAt',g.expires_at);
end $$;

create or replace function public.list_evidence_document_deletion_cleanup_organizations_atomic(p_limit integer)
returns table(organization_id uuid) language sql stable security definer set search_path=public,pg_temp as $$
  select distinct i.organization_id from public.evidence_document_deletion_intents i join public.organizations o on o.id=i.organization_id and o.is_active
  where p_limit between 1 and 1000 and i.state in ('queued','failed','claimed') order by i.organization_id limit p_limit
$$;

create or replace function public.claim_evidence_document_deletion_cleanup_atomic(p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.evidence_document_deletion_intents%rowtype; c public.evidence_document_deletion_cleanup_items%rowtype; d public.evidence_documents%rowtype; v_review jsonb;
begin
 if p_organization_id is null or p_worker_id is null or p_lease_seconds not between 30 and 900 then return null; end if;
 select * into i from public.evidence_document_deletion_intents where organization_id=p_organization_id and state in ('queued','failed','claimed') and (state<>'claimed' or lease_expires_at<=clock_timestamp()) order by requested_at,id for update skip locked limit 1;
 if not found then return null; end if;
 select * into d from public.evidence_documents where organization_id=p_organization_id and id=i.document_id for update;
 if not found then return null; end if;
 perform 1 from public.evidence_document_legal_holds where organization_id=p_organization_id and document_id=d.id for update;
 v_review:=public.m8_05_retention_review_json(p_organization_id,i.requested_by_user_id,d.id);
 if jsonb_array_length(coalesce(v_review->'blockingReasons','[]'::jsonb))>0 then
   update public.evidence_document_deletion_intents set state='cancelled',lease_owner=null,lease_expires_at=null,last_error='protection recheck blocked cleanup' where id=i.id;
   update public.evidence_documents set lifecycle_state='active',deletion_requested_at=null where id=d.id;
   insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) values(p_organization_id,'evidence.deletion_cleanup_blocked','evidence_document_deletion_intent',i.id::text,jsonb_build_object('documentId',d.id));
   return null;
 end if;
 update public.evidence_document_deletion_intents set state='claimed',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempt_count=attempt_count+1,last_error=null where id=i.id returning * into i;
 update public.evidence_documents set lifecycle_state='cleanup_claimed',updated_at=clock_timestamp() where id=d.id;
 select * into c from public.evidence_document_deletion_cleanup_items where organization_id=p_organization_id and intent_id=i.id and state in ('queued','failed','claimed') and (state<>'claimed' or lease_expires_at<=clock_timestamp()) order by created_at,id for update skip locked limit 1;
 if not found then return jsonb_build_object('intentId',i.id,'documentId',d.id,'complete',true); end if;
 update public.evidence_document_deletion_cleanup_items set state='claimed',lease_owner=p_worker_id,lease_expires_at=i.lease_expires_at,attempt_count=attempt_count+1,last_error=null where id=c.id returning * into c;
 return jsonb_build_object('intentId',i.id,'cleanupItemId',c.id,'documentId',d.id,'objectBucket',c.object_bucket,'objectKey',c.object_key,'complete',false);
end $$;

create or replace function public.complete_evidence_document_deletion_cleanup_atomic(p_organization_id uuid,p_worker_id uuid,p_intent_id uuid,p_cleanup_item_id uuid,p_outcome text,p_error text default null)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare i public.evidence_document_deletion_intents%rowtype; c public.evidence_document_deletion_cleanup_items%rowtype; v_failed boolean;
begin
 if p_outcome not in ('deleted','missing','retry','failed') then return 'invalid_request'; end if;
 select * into i from public.evidence_document_deletion_intents where organization_id=p_organization_id and id=p_intent_id for update;
 if not found then return 'not_found'; end if;
 select * into c from public.evidence_document_deletion_cleanup_items where organization_id=p_organization_id and id=p_cleanup_item_id and intent_id=p_intent_id for update;
 if not found then return 'not_found'; end if;
 if c.state='deleted' then return 'replayed'; end if;
 if c.state<>'claimed' or c.lease_owner<>p_worker_id then return 'not_leased'; end if;
 if p_outcome in ('deleted','missing') then update public.evidence_document_deletion_cleanup_items set state='deleted',lease_owner=null,lease_expires_at=null,completed_at=clock_timestamp(),last_error=case when p_outcome='missing' then 'object missing; treated as deleted' else null end where id=c.id;
 elsif p_outcome='retry' then update public.evidence_document_deletion_cleanup_items set state='failed',lease_owner=null,lease_expires_at=null,last_error=left(coalesce(nullif(btrim(p_error),''),'object deletion retry requested'),1000) where id=c.id; update public.evidence_document_deletion_intents set state='failed',lease_owner=null,lease_expires_at=null,last_error='cleanup retry requested' where id=i.id; update public.evidence_documents set lifecycle_state='cleanup_failed' where organization_id=p_organization_id and id=i.document_id; return 'retry';
 else update public.evidence_document_deletion_cleanup_items set state='failed',lease_owner=null,lease_expires_at=null,last_error=left(coalesce(nullif(btrim(p_error),''),'object deletion failed'),1000) where id=c.id; update public.evidence_document_deletion_intents set state='failed',lease_owner=null,lease_expires_at=null,last_error='cleanup failed' where id=i.id; update public.evidence_documents set lifecycle_state='cleanup_failed' where organization_id=p_organization_id and id=i.document_id; return 'failed'; end if;
 select exists(select 1 from public.evidence_document_deletion_cleanup_items where organization_id=p_organization_id and intent_id=i.id and state<>'deleted') into v_failed;
 if not v_failed then update public.evidence_document_deletion_intents set state='completed',lease_owner=null,lease_expires_at=null,completed_at=clock_timestamp(),last_error=null where id=i.id; update public.evidence_documents set lifecycle_state='deleted',deleted_at=clock_timestamp(),updated_at=clock_timestamp() where organization_id=p_organization_id and id=i.document_id; insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) values(p_organization_id,'evidence.deletion_completed','evidence_document_deletion_intent',i.id::text,jsonb_build_object('documentId',i.document_id)); end if;
 return case when v_failed then 'deleted' else 'completed' end;
end $$;

-- Hold history is separately listed so release of one hold never conceals the
-- remaining active holds or the immutable actor/reason trail.
create or replace function public.list_evidence_document_legal_holds_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_document_id uuid
) returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.m8_evidence_actor_active(p_organization_id,p_actor_user_id)
    or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence') then
   return query select 'forbidden',null::jsonb; return;
 end if;
 if not exists(select 1 from public.evidence_documents d where d.organization_id=p_organization_id and d.id=p_document_id) then
   return query select 'not_found',null::jsonb; return;
 end if;
 return query select 'found',jsonb_build_object('legalHolds',coalesce((
   select jsonb_agg(jsonb_build_object(
     'id',h.id,'documentId',h.document_id,'reason',h.reason,
     'status',case when h.released_at is null then 'active' else 'released' end,
     'placedByUserId',h.placed_by_user_id,
     'placedAt',to_char(h.placed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
     'releasedByUserId',h.released_by_user_id,
     'releasedAt',case when h.released_at is null then null else to_char(h.released_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
     'releaseReason',h.release_reason
   ) order by h.placed_at desc,h.id)
   from public.evidence_document_legal_holds h
   where h.organization_id=p_organization_id and h.document_id=p_document_id
 ), '[]'::jsonb));
end $$;

-- Prevent new versions/access grants after deliberate deletion is queued.
create or replace function public.m8_05_reject_nonactive_document_mutation()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_state text;
begin
 select lifecycle_state into v_state from public.evidence_documents where organization_id=new.organization_id and id=new.document_id;
 if v_state is distinct from 'active' then raise exception using errcode='55000',message='Evidence document is not active'; end if;
 return new;
end $$;
create trigger m8_05_reject_replacement_after_deletion before insert on public.evidence_document_versions for each row execute function public.m8_05_reject_nonactive_document_mutation();

alter table public.evidence_document_access_grants drop constraint evidence_document_access_grants_terminal_outcome_check;
alter table public.evidence_document_access_grants add constraint evidence_document_access_grants_terminal_outcome_check check (terminal_outcome is null or terminal_outcome in ('delivered','expired','integrity_failed','revoked'));

alter table public.evidence_document_version_retention_protections enable row level security;
alter table public.evidence_document_legal_holds enable row level security;
alter table public.evidence_document_deletion_intents enable row level security;
alter table public.evidence_document_deletion_cleanup_items enable row level security;
revoke all on table public.evidence_document_version_retention_protections,public.evidence_document_legal_holds,public.evidence_document_deletion_intents,public.evidence_document_deletion_cleanup_items from public,anon,authenticated;
grant all on table public.evidence_document_version_retention_protections,public.evidence_document_legal_holds,public.evidence_document_deletion_intents,public.evidence_document_deletion_cleanup_items to service_role;
revoke all on function public.refresh_evidence_document_retention_protection_atomic(uuid,uuid),public.get_evidence_document_retention_review_atomic(uuid,uuid,uuid),public.list_evidence_document_legal_holds_atomic(uuid,uuid,uuid),public.place_evidence_document_legal_hold_atomic(uuid,uuid,uuid,text,uuid),public.release_evidence_document_legal_hold_atomic(uuid,uuid,uuid,uuid,text,uuid),public.confirm_evidence_document_deletion_atomic(uuid,uuid,uuid,uuid,text,text,uuid),public.list_evidence_document_deletion_cleanup_organizations_atomic(integer),public.claim_evidence_document_deletion_cleanup_atomic(uuid,uuid,integer),public.complete_evidence_document_deletion_cleanup_atomic(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.refresh_evidence_document_retention_protection_atomic(uuid,uuid),public.get_evidence_document_retention_review_atomic(uuid,uuid,uuid),public.list_evidence_document_legal_holds_atomic(uuid,uuid,uuid),public.place_evidence_document_legal_hold_atomic(uuid,uuid,uuid,text,uuid),public.release_evidence_document_legal_hold_atomic(uuid,uuid,uuid,uuid,text,uuid),public.confirm_evidence_document_deletion_atomic(uuid,uuid,uuid,uuid,text,text,uuid),public.list_evidence_document_deletion_cleanup_organizations_atomic(integer),public.claim_evidence_document_deletion_cleanup_atomic(uuid,uuid,integer),public.complete_evidence_document_deletion_cleanup_atomic(uuid,uuid,uuid,uuid,text,text) to service_role;
notify pgrst,'reload schema';
