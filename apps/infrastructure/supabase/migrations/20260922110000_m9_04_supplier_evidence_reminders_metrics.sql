-- M9-04: durable supplier-evidence reminders and tenant-scoped response metrics.
-- This is intentionally a narrow ledger, not a generic scheduler. M6 owns legal
-- deadlines and M7/M8 retain ownership of technical-file and evidence lifecycles.

create function public.m9_04_reminder_offsets_valid(p_offset_hours integer[])
returns boolean language sql immutable set search_path=public,pg_temp as $$
  select p_offset_hours is not null
    and cardinality(p_offset_hours) between 1 and 3
    and not exists(select 1 from unnest(p_offset_hours) offset_hour where offset_hour not between -720 and 720 or offset_hour = 0)
    and cardinality(p_offset_hours) = (select count(distinct offset_hour) from unnest(p_offset_hours) offset_hour)
    and 24 = any(p_offset_hours)
    and not exists(select 1 from unnest(p_offset_hours) offset_hour where offset_hour > 0 and offset_hour <> 24)
    and not exists(select 1 from unnest(p_offset_hours) a, unnest(p_offset_hours) b where a < b and a < 0 and b < 0 and b-a < 24)
$$;

alter table public.organization_settings
  add column supplier_evidence_reminder_offsets_hours integer[] not null default array[-168,-24,24],
  add column supplier_evidence_reminders_version integer not null default 0,
  add column supplier_evidence_reminders_updated_at timestamptz not null default clock_timestamp(),
  add column supplier_evidence_reminders_updated_by uuid references public.users(id) on delete set null,
  add constraint organization_settings_supplier_evidence_reminder_offsets_check
    check (public.m9_04_reminder_offsets_valid(supplier_evidence_reminder_offsets_hours)),
  add constraint organization_settings_supplier_evidence_reminders_version_check
    check (supplier_evidence_reminders_version >= 0);

create table public.supplier_evidence_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  revision_id uuid not null,
  due_at_snapshot timestamptz not null,
  offset_hours integer not null check (offset_hours between -720 and 720 and offset_hours <> 0),
  recipient_kind text not null check (recipient_kind in ('supplier','owner')),
  event_kind text not null check (event_kind in ('supplier_reminder','owner_escalation')),
  owner_user_id uuid references public.users(id) on delete set null,
  invitation_id uuid,
  version integer not null default 0 check (version >= 0),
  state text not null default 'queued' check (state in ('queued','leased','sent','failed','obsolete','recipient_unavailable')),
  scheduled_for timestamptz not null,
  next_attempt_at timestamptz not null default clock_timestamp(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_owner uuid,
  lease_expires_at timestamptz,
  last_error text check (last_error is null or (last_error=btrim(last_error) and char_length(last_error) between 1 and 1000 and last_error !~ '[[:cntrl:]]')),
  sent_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,revision_id,due_at_snapshot,offset_hours,recipient_kind),
  foreign key (organization_id,request_id) references public.supplier_evidence_requests(organization_id,id) on delete restrict,
  foreign key (organization_id,revision_id) references public.supplier_evidence_request_revisions(organization_id,id) on delete restrict,
  foreign key (organization_id,owner_user_id) references public.organization_members(organization_id,user_id) on delete restrict,
  foreign key (organization_id,invitation_id) references public.supplier_evidence_invitations(organization_id,id) on delete restrict,
  check ((recipient_kind='supplier' and event_kind='supplier_reminder' and owner_user_id is null) or (recipient_kind='owner' and event_kind='owner_escalation' and owner_user_id is not null)),
  check ((state='leased') = (lease_owner is not null and lease_expires_at is not null))
);

create index supplier_evidence_reminder_claim_idx
  on public.supplier_evidence_reminder_deliveries(organization_id,state,next_attempt_at,scheduled_for,id)
  where state in ('queued','leased');
create index supplier_evidence_reminder_request_idx
  on public.supplier_evidence_reminder_deliveries(organization_id,request_id,revision_id,created_at desc,id);
create index supplier_evidence_requests_overdue_idx
  on public.supplier_evidence_requests(organization_id,product_id,state,current_revision_id,id)
  where state='open';

create or replace function public.m9_04_can_view(
  p_organization_id uuid,p_actor_user_id uuid
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.m9_02_internal_can(p_organization_id,p_actor_user_id,false)
    and public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence')
$$;

create or replace function public.m9_04_can_manage(
  p_organization_id uuid,p_actor_user_id uuid
) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select public.m9_02_internal_can(p_organization_id,p_actor_user_id,true)
    and public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_evidence')
$$;

create or replace function public.m9_04_settings_json(p_organization_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'version',s.supplier_evidence_reminders_version,
    'offsetsHours',to_jsonb(s.supplier_evidence_reminder_offsets_hours)
  ) from public.organization_settings s where s.organization_id=p_organization_id
$$;

create or replace function public.get_supplier_evidence_reminder_settings_atomic(
  p_organization_id uuid,p_actor_user_id uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.m9_04_can_view(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  if not exists(select 1 from public.organization_settings s where s.organization_id=p_organization_id) then return query select 'not_found',null::jsonb; return; end if;
  return query select 'found',public.m9_04_settings_json(p_organization_id);
end $$;

create or replace function public.update_supplier_evidence_reminder_settings_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_expected_version integer,p_offset_hours integer[],p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.organization_settings%rowtype; prior public.audit_logs%rowtype; digest text; response jsonb;
begin
  if not public.m9_04_can_manage(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  if p_expected_version < 0 or p_idempotency_key is null or not public.m9_04_reminder_offsets_valid(p_offset_hours) then return query select 'invalid_request',null::jsonb; return; end if;
  digest:=encode(extensions.digest(jsonb_build_object('expectedVersion',p_expected_version,'offsetHours',p_offset_hours)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',p_organization_id,p_actor_user_id,p_idempotency_key),0));
  select * into prior from public.audit_logs a where a.organization_id=p_organization_id and a.user_id=p_actor_user_id and a.action='supplier.evidence_reminder_settings_updated' and a.changes->>'idempotencyKey'=p_idempotency_key::text limit 1;
  if found then
    if prior.changes->>'payloadDigest'<>digest then return query select 'idempotency_conflict',null::jsonb; else return query select 'replayed',prior.changes->'result'; end if;
  end if;
  select * into s from public.organization_settings where organization_id=p_organization_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if s.supplier_evidence_reminders_version<>p_expected_version then return query select 'conflict',public.m9_04_settings_json(p_organization_id); return; end if;
  update public.organization_settings set supplier_evidence_reminder_offsets_hours=p_offset_hours,supplier_evidence_reminders_version=supplier_evidence_reminders_version+1,supplier_evidence_reminders_updated_at=clock_timestamp(),supplier_evidence_reminders_updated_by=p_actor_user_id where organization_id=p_organization_id;
  response:=public.m9_04_settings_json(p_organization_id);
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'supplier.evidence_reminder_settings_updated','organization_settings',p_organization_id::text,jsonb_build_object('before',to_jsonb(s.supplier_evidence_reminder_offsets_hours),'after',to_jsonb(p_offset_hours),'idempotencyKey',p_idempotency_key,'payloadDigest',digest,'result',response));
  return query select 'updated',response;
end $$;

create or replace function public.m9_04_active_owner(
  p_organization_id uuid,p_preferred_user_id uuid
) returns uuid language sql stable security definer set search_path=public,pg_temp as $$
  select user_id from (
    select m.user_id,case when m.user_id=p_preferred_user_id then 0 when m.role='owner' then 1 else 2 end as priority
    from public.organization_members m join public.users u on u.id=m.user_id and u.is_active
    where m.organization_id=p_organization_id and (m.user_id=p_preferred_user_id or m.role='owner')
  ) candidate order by priority,user_id limit 1
$$;

create function public.m9_04_delivery_state_json(p_state text)
returns text language sql immutable set search_path=public,pg_temp as $$
  select case p_state
    when 'queued' then 'pending'
    when 'leased' then 'processing'
    when 'sent' then 'delivered'
    when 'failed' then 'failed'
    when 'recipient_unavailable' then 'cancelled'
    else 'superseded'
  end
$$;

create function public.m9_04_delivery_json(p_organization_id uuid,p_delivery_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'id',d.id,'requestId',d.request_id,'revisionId',d.revision_id,
    'dueAt',to_char(d.due_at_snapshot at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'offsetHours',d.offset_hours,'recipient',d.recipient_kind,'kind',d.event_kind,
    'state',public.m9_04_delivery_state_json(d.state),'attemptCount',d.attempt_count,
    'nextAttemptAt',case when d.state in ('queued','leased') then to_char(d.next_attempt_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') else null end,
    'leasedUntil',case when d.state='leased' then to_char(d.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') else null end,
    'failureMessage',d.last_error,'invitationId',d.invitation_id,
    'deliveredAt',case when d.sent_at is null then null else to_char(d.sent_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,
    'version',d.version,'createdAt',to_char(d.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'updatedAt',to_char(d.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ) from public.supplier_evidence_reminder_deliveries d where d.organization_id=p_organization_id and d.id=p_delivery_id
$$;

create function public.m9_04_request_has_outstanding_required(p_organization_id uuid,p_revision_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.supplier_evidence_request_items item
    where item.organization_id=p_organization_id and item.revision_id=p_revision_id and item.required
      and not exists(select 1 from public.supplier_evidence_submissions submission_row
        join public.supplier_evidence_submission_reviews review_row
          on review_row.organization_id=submission_row.organization_id
         and review_row.submission_id=submission_row.id and review_row.decision='accepted'
        where submission_row.organization_id=p_organization_id and submission_row.request_item_id=item.id))
$$;

create or replace function public.reconcile_supplier_evidence_reminders_atomic(
  p_organization_id uuid,p_worker_id uuid
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare offsets integer[]; created_count integer:=0; obsolete_count integer:=0;
begin
  if p_organization_id is null or p_worker_id is null then return jsonb_build_object('created',0,'obsolete',0); end if;
  select supplier_evidence_reminder_offsets_hours into offsets from public.organization_settings where organization_id=p_organization_id for share;
  if not found then return jsonb_build_object('created',0,'obsolete',0); end if;
  update public.supplier_evidence_reminder_deliveries d set state='obsolete',lease_owner=null,lease_expires_at=null,last_error='request revision, deadline, or completion changed',version=d.version+1,updated_at=clock_timestamp()
  from public.supplier_evidence_requests q left join public.supplier_evidence_request_revisions r on r.organization_id=q.organization_id and r.id=q.current_revision_id
  where d.organization_id=p_organization_id and q.organization_id=d.organization_id and q.id=d.request_id and d.state in ('queued','leased')
    and (q.state<>'open' or not public.m9_04_request_has_outstanding_required(p_organization_id,d.revision_id) or q.current_revision_id<>d.revision_id or r.due_at<>d.due_at_snapshot or not d.offset_hours=any(offsets));
  get diagnostics obsolete_count=row_count;
  insert into public.supplier_evidence_reminder_deliveries(organization_id,request_id,revision_id,due_at_snapshot,offset_hours,recipient_kind,event_kind,owner_user_id,scheduled_for,next_attempt_at)
  select q.organization_id,q.id,r.id,r.due_at,x.offset_hour,
    recipient.recipient_kind,recipient.event_kind,recipient.owner_user_id,
    r.due_at+make_interval(hours=>x.offset_hour),greatest(clock_timestamp(),r.due_at+make_interval(hours=>x.offset_hour))
  from public.supplier_evidence_requests q join public.supplier_evidence_request_revisions r on r.organization_id=q.organization_id and r.id=q.current_revision_id
  cross join lateral unnest(offsets) x(offset_hour)
  cross join lateral (
    select 'supplier'::text recipient_kind,'supplier_reminder'::text event_kind,null::uuid owner_user_id
    union all
    select 'owner'::text,'owner_escalation'::text,public.m9_04_active_owner(q.organization_id,q.internal_owner_user_id)
    where x.offset_hour=24
  ) recipient
  where q.organization_id=p_organization_id and q.state='open' and public.m9_04_request_has_outstanding_required(p_organization_id,r.id)
    and exists(select 1 from public.supplier_evidence_invitations i where i.organization_id=q.organization_id and i.request_id=q.id and i.revision_id=r.id and i.delivery_state='delivered')
    and (recipient.recipient_kind='supplier' or recipient.owner_user_id is not null)
  on conflict (organization_id,revision_id,due_at_snapshot,offset_hours,recipient_kind) do nothing;
  get diagnostics created_count=row_count;
  return jsonb_build_object('created',created_count,'obsolete',obsolete_count);
end $$;

create or replace function public.list_supplier_evidence_reminder_organization_ids_atomic(
  p_after_organization_id uuid,p_limit integer
) returns table(organization_id uuid) language sql stable security definer set search_path=public,pg_temp as $$
  select s.organization_id from public.organization_settings s join public.organizations o on o.id=s.organization_id and o.is_active
  where p_limit between 1 and 1000 and (p_after_organization_id is null or s.organization_id>p_after_organization_id)
  order by s.organization_id limit p_limit
$$;

create or replace function public.claim_supplier_evidence_reminder_delivery_atomic(
  p_organization_id uuid,p_worker_id uuid,p_lease_seconds integer
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.supplier_evidence_reminder_deliveries%rowtype; q public.supplier_evidence_requests%rowtype; r public.supplier_evidence_request_revisions%rowtype;
begin
  if p_organization_id is null or p_worker_id is null or p_lease_seconds not between 30 and 900 then return null; end if;
  select * into d from public.supplier_evidence_reminder_deliveries x where x.organization_id=p_organization_id and x.state in ('queued','leased') and x.next_attempt_at<=clock_timestamp() and (x.state='queued' or x.lease_expires_at<=clock_timestamp()) order by x.scheduled_for,x.created_at,x.id for update skip locked limit 1;
  if not found then return null; end if;
  select * into q from public.supplier_evidence_requests where organization_id=p_organization_id and id=d.request_id for share;
  select * into r from public.supplier_evidence_request_revisions where organization_id=p_organization_id and id=d.revision_id for share;
  if not found or q.state<>'open' or not public.m9_04_request_has_outstanding_required(p_organization_id,d.revision_id) or q.current_revision_id<>d.revision_id or r.due_at<>d.due_at_snapshot or (d.offset_hours<0 and clock_timestamp()>=d.due_at_snapshot) or (d.recipient_kind='supplier' and exists(select 1 from public.supplier_evidence_reminder_deliveries sent_delivery where sent_delivery.organization_id=p_organization_id and sent_delivery.revision_id=d.revision_id and sent_delivery.recipient_kind='supplier' and sent_delivery.state='sent' and sent_delivery.id<>d.id and sent_delivery.sent_at>clock_timestamp()-interval '24 hours')) then
    update public.supplier_evidence_reminder_deliveries set state='obsolete',lease_owner=null,lease_expires_at=null,last_error='reminder no longer applicable',version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=d.id;
    return jsonb_build_object('outcome','obsolete','deliveryId',d.id);
  end if;
  update public.supplier_evidence_reminder_deliveries set state='leased',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempt_count=attempt_count+1,last_error=null,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=d.id;
  return jsonb_build_object('outcome','claimed','deliveryId',d.id,'eventKind',d.event_kind);
end $$;

create or replace function public.prepare_supplier_evidence_reminder_delivery_atomic(
  p_organization_id uuid,p_delivery_id uuid,p_worker_id uuid,p_token_hash text
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.supplier_evidence_reminder_deliveries%rowtype; q public.supplier_evidence_requests%rowtype; r public.supplier_evidence_request_revisions%rowtype; c public.supplier_contacts%rowtype; owner_email text; new_invitation uuid;
begin
  select * into d from public.supplier_evidence_reminder_deliveries where organization_id=p_organization_id and id=p_delivery_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if d.state<>'leased' or d.lease_owner is distinct from p_worker_id or d.lease_expires_at<=clock_timestamp() then return query select 'not_leased',null::jsonb; return; end if;
  select * into q from public.supplier_evidence_requests where organization_id=p_organization_id and id=d.request_id for share;
  select * into r from public.supplier_evidence_request_revisions where organization_id=p_organization_id and id=d.revision_id for share;
  if not found or q.state<>'open' or not public.m9_04_request_has_outstanding_required(p_organization_id,d.revision_id) or q.current_revision_id<>d.revision_id or r.due_at<>d.due_at_snapshot or not exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=q.product_id and p.archived_at is null) or not exists(select 1 from public.supplier_organizations s where s.organization_id=p_organization_id and s.id=q.supplier_id and s.archived_at is null) or (d.recipient_kind='supplier' and exists(select 1 from public.supplier_evidence_reminder_deliveries sent_delivery where sent_delivery.organization_id=p_organization_id and sent_delivery.revision_id=d.revision_id and sent_delivery.recipient_kind='supplier' and sent_delivery.state='sent' and sent_delivery.id<>d.id and sent_delivery.sent_at>clock_timestamp()-interval '24 hours')) then update public.supplier_evidence_reminder_deliveries set state='obsolete',lease_owner=null,lease_expires_at=null,last_error='request changed before delivery',version=version+1,updated_at=clock_timestamp() where id=d.id; return query select 'obsolete',null::jsonb; return; end if;
  if d.recipient_kind='supplier' then
    if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then return query select 'invalid_request',null::jsonb; return; end if;
    select * into c from public.supplier_contacts where organization_id=p_organization_id and id=q.recipient_contact_id and supplier_id=q.supplier_id and archived_at is null and email=q.recipient_email for share;
    if not found then update public.supplier_evidence_reminder_deliveries set state='recipient_unavailable',sent_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error='supplier recipient unavailable',updated_at=clock_timestamp() where id=d.id; return query select 'recipient_unavailable',null::jsonb; return; end if;
    update public.supplier_evidence_invitations set state='revoked',revoked_at=clock_timestamp(),revoked_by_user_id=q.internal_owner_user_id where organization_id=p_organization_id and request_id=q.id and state in ('active','used');
    insert into public.supplier_evidence_invitations(organization_id,request_id,revision_id,token_prefix,token_hash,expires_at,created_by_user_id,delivery_state)
      values(p_organization_id,q.id,r.id,'cra_sev_'||left(p_token_hash,8),p_token_hash,clock_timestamp()+interval '14 days',q.internal_owner_user_id,'pending') returning id into new_invitation;
    update public.supplier_evidence_reminder_deliveries set invitation_id=new_invitation,version=version+1,updated_at=clock_timestamp() where id=d.id;
    return query select 'prepared',jsonb_build_object('deliveryId',d.id,'eventKind',d.event_kind,'recipientKind','supplier','recipientEmail',c.email,'recipientName',c.name,'portalTitle',r.portal_title,'instructions',nullif(r.instructions,''),'dueAt',to_char(r.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'invitationId',new_invitation);
  end if;
  select u.email into owner_email from public.organization_members m join public.users u on u.id=m.user_id and u.is_active where m.organization_id=p_organization_id and m.user_id=d.owner_user_id;
  if owner_email is null then update public.supplier_evidence_reminder_deliveries set state='recipient_unavailable',sent_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error='owner recipient unavailable',updated_at=clock_timestamp() where id=d.id; return query select 'recipient_unavailable',null::jsonb; return; end if;
  return query select 'prepared',jsonb_build_object('deliveryId',d.id,'eventKind',d.event_kind,'recipientKind','owner','recipientEmail',owner_email,'requestTitle',r.portal_title,'dueAt',to_char(r.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
end $$;

create or replace function public.complete_supplier_evidence_reminder_delivery_atomic(
  p_organization_id uuid,p_delivery_id uuid,p_worker_id uuid,p_outcome text,p_error text default null
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.supplier_evidence_reminder_deliveries%rowtype;
begin
  if p_outcome not in ('sent','retry','recipient_unavailable') then return 'invalid_request'; end if;
  select * into d from public.supplier_evidence_reminder_deliveries where organization_id=p_organization_id and id=p_delivery_id for update;
  if not found then return 'not_found'; end if;
  if d.state='sent' then return 'replayed'; end if;
  if d.state<>'leased' or d.lease_owner is distinct from p_worker_id then return 'not_leased'; end if;
  if p_outcome='sent' then
    update public.supplier_evidence_reminder_deliveries set state='sent',sent_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error=null,version=version+1,updated_at=clock_timestamp() where id=d.id;
    if d.invitation_id is not null then update public.supplier_evidence_invitations set delivery_state='delivered',delivery_attempt_count=delivery_attempt_count+1,delivery_error=null,delivered_at=clock_timestamp() where organization_id=p_organization_id and id=d.invitation_id and delivery_state='pending'; end if;
  elsif p_outcome='recipient_unavailable' then
    update public.supplier_evidence_reminder_deliveries set state='recipient_unavailable',sent_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error='recipient unavailable',version=version+1,updated_at=clock_timestamp() where id=d.id;
  elsif d.attempt_count>=5 then
    update public.supplier_evidence_reminder_deliveries set state='failed',lease_owner=null,lease_expires_at=null,last_error=left(nullif(btrim(coalesce(p_error,'')),''),1000),version=version+1,updated_at=clock_timestamp() where id=d.id;
  else
    update public.supplier_evidence_reminder_deliveries set state='queued',lease_owner=null,lease_expires_at=null,next_attempt_at=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,least(6,d.attempt_count-1))::integer)),last_error=left(nullif(btrim(coalesce(p_error,'')),''),1000),version=version+1,updated_at=clock_timestamp() where id=d.id;
  end if;
  if p_outcome='retry' and d.invitation_id is not null then
    update public.supplier_evidence_invitations set state='revoked',revoked_at=clock_timestamp(),delivery_state='failed',delivery_attempt_count=delivery_attempt_count+1,delivery_error=coalesce(left(nullif(btrim(coalesce(p_error,'')),''),1000),'delivery failed')
    where organization_id=p_organization_id and id=d.invitation_id and delivery_state='pending';
  end if;
  insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) values(p_organization_id,'supplier.evidence_reminder_'||p_outcome,'supplier_evidence_reminder_delivery',d.id::text,jsonb_build_object('requestId',d.request_id,'revisionId',d.revision_id,'eventKind',d.event_kind,'attempt',d.attempt_count));
  return p_outcome;
end $$;

create or replace function public.retry_supplier_evidence_reminder_delivery_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_request_id uuid,p_delivery_id uuid,p_expected_version integer,p_idempotency_key uuid
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare d public.supplier_evidence_reminder_deliveries%rowtype; prior public.audit_logs%rowtype; digest text; response jsonb;
begin
  if not public.m9_04_can_manage(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  if p_request_id is null or p_expected_version<0 or p_idempotency_key is null then return query select 'invalid_request',null::jsonb; return; end if;
  digest:=encode(extensions.digest(jsonb_build_object('requestId',p_request_id,'deliveryId',p_delivery_id,'expectedVersion',p_expected_version)::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(concat_ws('|',p_organization_id,p_actor_user_id,p_idempotency_key),0));
  select * into prior from public.audit_logs a where a.organization_id=p_organization_id and a.user_id=p_actor_user_id and a.action='supplier.evidence_reminder_retry_requested' and a.changes->>'idempotencyKey'=p_idempotency_key::text limit 1;
  if found then
    if prior.changes->>'payloadDigest'<>digest then return query select 'idempotency_conflict',null::jsonb; else return query select 'replayed',prior.changes->'result'; end if;
  end if;
  select * into d from public.supplier_evidence_reminder_deliveries where organization_id=p_organization_id and id=p_delivery_id for update;
  if not found then return query select 'not_found',null::jsonb; return; end if;
  if d.request_id<>p_request_id then return query select 'not_found',null::jsonb; return; end if;
  if d.version<>p_expected_version then return query select 'conflict',public.m9_04_delivery_json(p_organization_id,d.id); return; end if;
  if d.state not in ('failed','recipient_unavailable') then return query select 'conflict',jsonb_build_object('id',d.id,'state',d.state); return; end if;
  update public.supplier_evidence_reminder_deliveries set state='queued',next_attempt_at=clock_timestamp(),lease_owner=null,lease_expires_at=null,last_error=null,version=version+1,updated_at=clock_timestamp() where id=d.id;
  response:=public.m9_04_delivery_json(p_organization_id,d.id);
  insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'supplier.evidence_reminder_retry_requested','supplier_evidence_reminder_delivery',d.id::text,jsonb_build_object('idempotencyKey',p_idempotency_key,'payloadDigest',digest,'result',response));
  return query select 'queued',response;
end $$;

create or replace function public.get_supplier_evidence_response_metrics_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_from timestamptz,p_to timestamptz,p_product_id uuid default null,p_supplier_id uuid default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare denominator integer; responded integer; accepted integer; outstanding integer; overdue integer; average_seconds numeric;
begin
  if not public.m9_04_can_view(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  if p_from is null or p_to is null or p_from>=p_to or p_to-p_from>interval '366 days' then return query select 'invalid_request',null::jsonb; return; end if;
  if (p_product_id is not null and not exists(select 1 from public.products p where p.organization_id=p_organization_id and p.id=p_product_id and p.archived_at is null)) or (p_supplier_id is not null and not exists(select 1 from public.supplier_organizations s where s.organization_id=p_organization_id and s.id=p_supplier_id and s.archived_at is null)) then return query select 'not_found',null::jsonb; return; end if;
  with cycles as materialized (select i.revision_id,q.id request_id,min(i.delivered_at) delivered_at from public.supplier_evidence_invitations i join public.supplier_evidence_requests q on q.organization_id=i.organization_id and q.id=i.request_id where i.organization_id=p_organization_id and i.delivery_state='delivered' and i.delivered_at>=p_from and i.delivered_at<p_to and (p_product_id is null or q.product_id=p_product_id) and (p_supplier_id is null or q.supplier_id=p_supplier_id) group by i.revision_id,q.id), facts as (select c.*, (select min(v.finalized_at) from public.supplier_evidence_submissions sub join public.evidence_document_versions v on v.organization_id=sub.organization_id and v.id=sub.evidence_version_id where sub.organization_id=p_organization_id and sub.request_id=c.request_id and sub.revision_id=c.revision_id and v.finalized_at is not null and v.finalized_at>=c.delivered_at) first_submission_at, not exists(select 1 from public.supplier_evidence_request_items item where item.organization_id=p_organization_id and item.revision_id=c.revision_id and item.required and not exists(select 1 from public.supplier_evidence_submissions sub join public.supplier_evidence_submission_reviews review on review.organization_id=sub.organization_id and review.submission_id=sub.id and review.decision='accepted' where sub.organization_id=p_organization_id and sub.request_item_id=item.id)) accepted_complete from cycles c) select count(*)::integer,count(*) filter(where first_submission_at is not null)::integer,count(*) filter(where accepted_complete)::integer,avg(extract(epoch from first_submission_at-delivered_at)) filter(where first_submission_at is not null) into denominator,responded,accepted,average_seconds from facts;
  select count(*)::integer,count(*) filter(where r.due_at<clock_timestamp())::integer into outstanding,overdue from public.supplier_evidence_requests q join public.supplier_evidence_request_revisions r on r.organization_id=q.organization_id and r.id=q.current_revision_id where q.organization_id=p_organization_id and q.state='open' and exists(select 1 from public.supplier_evidence_request_items item where item.organization_id=q.organization_id and item.revision_id=q.current_revision_id and item.required and not exists(select 1 from public.supplier_evidence_submissions sub join public.supplier_evidence_submission_reviews review on review.organization_id=sub.organization_id and review.submission_id=sub.id and review.decision='accepted' where sub.organization_id=q.organization_id and sub.request_item_id=item.id)) and (p_product_id is null or q.product_id=p_product_id) and (p_supplier_id is null or q.supplier_id=p_supplier_id);
  return query select 'found',jsonb_build_object(
    'from',to_char(p_from at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'to',to_char(p_to at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'outstandingCount',outstanding,'overdueCount',overdue,
    'firstSubmissionResponseRate',jsonb_build_object('numerator',responded,'denominator',denominator,'value',case when denominator=0 then null else responded::numeric/denominator end),
    'acceptedCompletionRate',jsonb_build_object('numerator',accepted,'denominator',denominator,'value',case when denominator=0 then null else accepted::numeric/denominator end),
    'averageFirstSubmissionTurnaroundHours',case when average_seconds is null then null else average_seconds/3600 end,
    'turnaroundSampleCount',responded
  );
end $$;

create or replace function public.list_supplier_evidence_overdue_atomic(
  p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid default null,p_supplier_id uuid default null,p_limit integer default 50,p_cursor uuid default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare rows jsonb;
begin
  if not public.m9_04_can_view(p_organization_id,p_actor_user_id) then return query select 'forbidden',null::jsonb; return; end if;
  if p_limit not between 1 and 100 then return query select 'invalid_request',null::jsonb; return; end if;
  select coalesce(jsonb_agg(jsonb_build_object('requestId',x.id,'revisionId',x.revision_id,'supplierId',x.supplier_id,'supplierDisplayName',x.supplier_name,'productId',x.product_id,'requestTitle',x.portal_title,'dueAt',to_char(x.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'daysOverdue',greatest(1,floor(extract(epoch from clock_timestamp()-x.due_at)/86400))::integer,'state',x.review_state,'latestDelivery',x.latest_delivery) order by x.due_at,x.id),'[]'::jsonb) into rows from (select q.id,q.current_revision_id revision_id,q.supplier_id,s.name supplier_name,q.product_id,r.portal_title,r.due_at,q.review_state,(select public.m9_04_delivery_json(p_organization_id,d.id) from public.supplier_evidence_reminder_deliveries d where d.organization_id=q.organization_id and d.request_id=q.id and d.revision_id=q.current_revision_id and d.event_kind='supplier_reminder' order by d.created_at desc limit 1) latest_delivery from public.supplier_evidence_requests q join public.supplier_evidence_request_revisions r on r.organization_id=q.organization_id and r.id=q.current_revision_id join public.supplier_organizations s on s.organization_id=q.organization_id and s.id=q.supplier_id where q.organization_id=p_organization_id and q.state='open' and exists(select 1 from public.supplier_evidence_request_items item where item.organization_id=q.organization_id and item.revision_id=q.current_revision_id and item.required and not exists(select 1 from public.supplier_evidence_submissions sub join public.supplier_evidence_submission_reviews review on review.organization_id=sub.organization_id and review.submission_id=sub.id and review.decision='accepted' where sub.organization_id=q.organization_id and sub.request_item_id=item.id)) and r.due_at<clock_timestamp() and (p_product_id is null or q.product_id=p_product_id) and (p_supplier_id is null or q.supplier_id=p_supplier_id) and (p_cursor is null or q.id>p_cursor) order by r.due_at,q.id limit p_limit) x;
  return query select 'found',jsonb_build_object('overdue',rows,'nextCursor',case when jsonb_array_length(rows)=p_limit then rows->(p_limit-1)->>'requestId' else null end);
end $$;

alter table public.supplier_evidence_reminder_deliveries enable row level security;
revoke all on table public.supplier_evidence_reminder_deliveries from public,anon,authenticated;
grant select,insert,update on table public.supplier_evidence_reminder_deliveries to service_role;

revoke all on function public.m9_04_reminder_offsets_valid(integer[]),public.m9_04_can_view(uuid,uuid),public.m9_04_can_manage(uuid,uuid),public.m9_04_settings_json(uuid),public.m9_04_active_owner(uuid,uuid),public.m9_04_delivery_state_json(text),public.m9_04_delivery_json(uuid,uuid),public.m9_04_request_has_outstanding_required(uuid,uuid),public.get_supplier_evidence_reminder_settings_atomic(uuid,uuid),public.update_supplier_evidence_reminder_settings_atomic(uuid,uuid,integer,integer[],uuid),public.reconcile_supplier_evidence_reminders_atomic(uuid,uuid),public.list_supplier_evidence_reminder_organization_ids_atomic(uuid,integer),public.claim_supplier_evidence_reminder_delivery_atomic(uuid,uuid,integer),public.prepare_supplier_evidence_reminder_delivery_atomic(uuid,uuid,uuid,text),public.complete_supplier_evidence_reminder_delivery_atomic(uuid,uuid,uuid,text,text),public.retry_supplier_evidence_reminder_delivery_atomic(uuid,uuid,uuid,uuid,integer,uuid),public.get_supplier_evidence_response_metrics_atomic(uuid,uuid,timestamptz,timestamptz,uuid,uuid),public.list_supplier_evidence_overdue_atomic(uuid,uuid,uuid,uuid,integer,uuid) from public,anon,authenticated;
grant execute on function public.get_supplier_evidence_reminder_settings_atomic(uuid,uuid),public.update_supplier_evidence_reminder_settings_atomic(uuid,uuid,integer,integer[],uuid),public.reconcile_supplier_evidence_reminders_atomic(uuid,uuid),public.list_supplier_evidence_reminder_organization_ids_atomic(uuid,integer),public.claim_supplier_evidence_reminder_delivery_atomic(uuid,uuid,integer),public.prepare_supplier_evidence_reminder_delivery_atomic(uuid,uuid,uuid,text),public.complete_supplier_evidence_reminder_delivery_atomic(uuid,uuid,uuid,text,text),public.retry_supplier_evidence_reminder_delivery_atomic(uuid,uuid,uuid,uuid,integer,uuid),public.get_supplier_evidence_response_metrics_atomic(uuid,uuid,timestamptz,timestamptz,uuid,uuid),public.list_supplier_evidence_overdue_atomic(uuid,uuid,uuid,uuid,integer,uuid) to service_role;

notify pgrst,'reload schema';
