-- M5-07: internal, tenant-scoped triage notes. Notes are operational records:
-- they are intentionally separate from assessments, VEX reasons, and evidence.

create table public.vulnerability_finding_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  finding_id uuid not null,
  author_user_id uuid references public.users(id) on delete set null,
  author_display_name text not null check (char_length(author_display_name) between 1 and 320),
  body text check (body is null or (body = btrim(body) and char_length(body) between 1 and 4000)),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  deleted_by_user_id uuid references public.users(id) on delete set null,
  deleted_by_display_name text,
  unique (organization_id, id),
  foreign key (organization_id, finding_id)
    references public.vulnerability_findings(organization_id, id) on delete cascade,
  check ((deleted_at is null and body is not null and deleted_by_display_name is null)
    or (deleted_at is not null and body is null and deleted_by_display_name is not null))
);
create index vulnerability_finding_notes_listing_idx
  on public.vulnerability_finding_notes(organization_id, finding_id, created_at desc, id desc);

create table public.vulnerability_finding_note_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  note_id uuid not null,
  revision integer not null check (revision > 0),
  event_kind text not null check (event_kind in ('created', 'updated', 'deleted')),
  body text,
  mention_recipient_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(mention_recipient_ids) = 'array'),
  actor_user_id uuid references public.users(id) on delete set null,
  actor_display_name text not null check (char_length(actor_display_name) between 1 and 320),
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, note_id, revision),
  foreign key (organization_id, note_id)
    references public.vulnerability_finding_notes(organization_id, id) on delete cascade,
  check ((event_kind = 'deleted' and body is null) or (event_kind <> 'deleted' and body is not null))
);

create table public.vulnerability_finding_note_mentions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  note_id uuid not null,
  recipient_user_id uuid references public.users(id) on delete set null,
  recipient_display_name text not null check (char_length(recipient_display_name) between 1 and 320),
  notification_status text not null default 'queued'
    check (notification_status in ('queued', 'leased', 'retrying', 'delivered', 'cancelled', 'dead_letter')),
  notification_attempts integer not null default 0 check (notification_attempts >= 0),
  notification_due_at timestamptz not null default clock_timestamp(),
  notification_last_attempt_at timestamptz,
  notification_lease_owner text,
  notification_lease_expires_at timestamptz,
  notification_error_code text,
  notification_error_message text,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id),
  unique (note_id, recipient_user_id),
  foreign key (organization_id, note_id)
    references public.vulnerability_finding_notes(organization_id, id) on delete cascade,
  check ((notification_status = 'leased') = (notification_lease_owner is not null and notification_lease_expires_at is not null)),
  check ((notification_status = 'delivered') = (delivered_at is not null)),
  check ((notification_status = 'cancelled') = (cancelled_at is not null))
);
create index vulnerability_finding_note_mentions_due_idx
  on public.vulnerability_finding_note_mentions(organization_id, notification_due_at, id)
  where notification_status in ('queued', 'retrying', 'leased');

alter table public.vulnerability_finding_notes enable row level security;
alter table public.vulnerability_finding_note_revisions enable row level security;
alter table public.vulnerability_finding_note_mentions enable row level security;
grant all on table public.vulnerability_finding_notes, public.vulnerability_finding_note_revisions,
  public.vulnerability_finding_note_mentions to service_role;
revoke all on table public.vulnerability_finding_notes, public.vulnerability_finding_note_revisions,
  public.vulnerability_finding_note_mentions from public, anon, authenticated;

alter table public.vulnerability_triage_commands
  drop constraint if exists vulnerability_triage_commands_operation_check,
  add constraint vulnerability_triage_commands_operation_check check (operation in (
    'assign', 'suppress', 'set_sla_policy', 'record_remediation_anchor',
    'create_vex_export_snapshot', 'configure_vex_publication_target',
    'queue_vex_publication', 'retry_vex_publication', 'withdraw_vex_publication',
    'note_create', 'note_update', 'note_delete'
  ));

create or replace function public.m5_triage_actor_has_permission(
  p_organization_id uuid, p_actor_user_id uuid, p_permission_key text
) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  with membership as (
    select member.role from public.organization_members member
    join public.users u on u.id=member.user_id and u.is_active
    join public.organizations o on o.id=member.organization_id and o.is_active
    where member.organization_id=p_organization_id and member.user_id=p_actor_user_id
  ), base_permissions as (
    select role, case p_permission_key
      when 'can_view_findings' then true
      when 'can_edit_findings' then role in ('owner','admin')
      when 'can_edit_organization' then role='owner' else false end as granted
    from membership
  ), custom_permissions as (
    select bool_or((r.permissions->>p_permission_key)::boolean) as granted
    from membership join public.user_role_assignments a on a.organization_id=p_organization_id and a.user_id=p_actor_user_id
    join public.custom_roles r on r.organization_id=p_organization_id and r.id=a.role_id
    where r.is_active and not r.is_deleted and jsonb_typeof(r.permissions->p_permission_key)='boolean'
      and (r.permissions->>p_permission_key)::boolean
  ), overrides as (
    select case when jsonb_typeof(o.permissions->p_permission_key)='boolean' then (o.permissions->>p_permission_key)::boolean end granted
    from base_permissions b left join public.base_role_permission_overrides o
      on o.organization_id=p_organization_id and o.base_role=b.role
  ) select coalesce((select granted from overrides where granted is not null limit 1),
    (select coalesce(b.granted,false) or coalesce(c.granted,false) from base_permissions b cross join custom_permissions c),false)
$$;

create or replace function public.m5_note_display_name(p_user_id uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif(btrim(u.username),''),nullif(btrim(concat_ws(' ',u.first_name,u.last_name)),''),u.email)
  from public.users u where u.id=p_user_id
$$;

create or replace function public.m5_note_json(p_organization_id uuid,p_note_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
 select jsonb_build_object('id',n.id,'findingId',n.finding_id,'body',n.body,'version',n.version,
  'author',jsonb_build_object('userId',n.author_user_id,'displayName',n.author_display_name),
  'createdAt',public.m2_utc_z(n.created_at),'updatedAt',public.m2_utc_z(n.updated_at),
  'deletedAt',case when n.deleted_at is null then null else public.m2_utc_z(n.deleted_at) end,
  'mentions',coalesce((select jsonb_agg(jsonb_build_object('userId',m.recipient_user_id,'displayName',m.recipient_display_name) order by m.recipient_display_name)
    from public.vulnerability_finding_note_mentions m where m.organization_id=n.organization_id and m.note_id=n.id), '[]'::jsonb))
 from public.vulnerability_finding_notes n where n.organization_id=p_organization_id and n.id=p_note_id
$$;

create or replace function public.list_finding_triage_notes(
 p_organization_id uuid,p_actor_user_id uuid,p_finding_id uuid,p_cursor timestamptz default null,p_limit integer default 50
) returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_rows jsonb;
begin
 if p_limit not between 1 and 100 or p_organization_id is null or p_actor_user_id is null or p_finding_id is null
  or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings')
  or not exists(select 1 from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=p_finding_id and f.status='active') then
   return query select 'not_found'::text,null::jsonb; return; end if;
 select coalesce(jsonb_agg(public.m5_note_json(p_organization_id,n.id) order by n.created_at desc,n.id desc),'[]'::jsonb) into v_rows
 from (select id from public.vulnerability_finding_notes where organization_id=p_organization_id and finding_id=p_finding_id
   and (p_cursor is null or created_at < p_cursor) order by created_at desc,id desc limit p_limit) n;
 return query select 'found'::text,jsonb_build_object('notes',v_rows,'nextCursor',null);
end $$;

create or replace function public.list_finding_triage_note_mention_candidates(
 p_organization_id uuid,p_actor_user_id uuid,p_finding_id uuid,p_query text default '',p_limit integer default 20
) returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_query text:=btrim(coalesce(p_query,''));
begin
 if p_limit not between 1 and 50 or p_organization_id is null or p_actor_user_id is null or p_finding_id is null
  or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings')
  or not exists(select 1 from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=p_finding_id and f.status='active') then
   return query select 'not_found'::text,null::jsonb; return; end if;
 return query select 'found'::text,jsonb_build_object('members',coalesce(jsonb_agg(jsonb_build_object('userId',s.user_id,'displayName',s.display_name,'avatarUrl',null) order by s.display_name),'[]'::jsonb))
 from (select m.user_id,public.m5_note_display_name(m.user_id) display_name from public.organization_members m join public.users u on u.id=m.user_id and u.is_active
  where m.organization_id=p_organization_id and public.m5_triage_actor_has_permission(p_organization_id,m.user_id,'can_view_findings')
   and (v_query='' or public.m5_note_display_name(m.user_id) ilike '%'||v_query||'%') order by public.m5_note_display_name(m.user_id),m.user_id limit p_limit) s;
end $$;

create or replace function public.create_finding_triage_note_atomic(
 p_organization_id uuid,p_actor_user_id uuid,p_finding_id uuid,p_body text,p_mention_recipient_ids uuid[],p_idempotency_key uuid,p_correlation_id uuid default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_note public.vulnerability_finding_notes%rowtype; v_digest text; v_existing record; v_mentions uuid[]:=coalesce(p_mention_recipient_ids,'{}'); v_name text;
begin
 if p_organization_id is null or p_actor_user_id is null or p_finding_id is null or p_idempotency_key is null or p_body<>btrim(coalesce(p_body,'')) or char_length(coalesce(p_body,'')) not between 1 and 4000 or cardinality(v_mentions)>20 or cardinality(v_mentions)<>(select count(distinct x) from unnest(v_mentions) x) or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_findings') then return query select 'not_found'::text,null::jsonb; return; end if;
 if not exists(select 1 from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=p_finding_id and f.status='active') then return query select 'not_found'::text,null::jsonb; return; end if;
 if exists(select 1 from unnest(v_mentions) x where not public.m5_triage_actor_has_permission(p_organization_id,x,'can_view_findings')) then return query select 'invalid_request'::text,null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('findingId',p_finding_id,'body',p_body,'mentions',v_mentions)::text,'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0));
 select * into v_existing from public.m5_triage_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'note_create',v_digest); if found then return query select v_existing.outcome,v_existing.result; return; end if;
 v_name:=public.m5_note_display_name(p_actor_user_id); if v_name is null then return query select 'not_found'::text,null::jsonb; return; end if;
 insert into public.vulnerability_finding_notes(organization_id,finding_id,author_user_id,author_display_name,body) values(p_organization_id,p_finding_id,p_actor_user_id,v_name,p_body) returning * into v_note;
 insert into public.vulnerability_finding_note_revisions(organization_id,note_id,revision,event_kind,body,mention_recipient_ids,actor_user_id,actor_display_name) values(p_organization_id,v_note.id,1,'created',p_body,to_jsonb(v_mentions),p_actor_user_id,v_name);
 insert into public.vulnerability_finding_note_mentions(organization_id,note_id,recipient_user_id,recipient_display_name) select p_organization_id,v_note.id,x,public.m5_note_display_name(x) from unnest(v_mentions) x;
 insert into public.vulnerability_triage_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'note_create',v_digest,jsonb_build_object('note',public.m5_note_json(p_organization_id,v_note.id)));
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'vulnerability.triage_note_created','vulnerability_finding_note',v_note.id::text,jsonb_build_object('findingId',p_finding_id,'mentionCount',cardinality(v_mentions),'correlationId',p_correlation_id));
 return query select 'created'::text,jsonb_build_object('note',public.m5_note_json(p_organization_id,v_note.id));
end $$;

create or replace function public.update_finding_triage_note_atomic(
 p_organization_id uuid,p_actor_user_id uuid,p_finding_id uuid,p_note_id uuid,p_body text,p_mention_recipient_ids uuid[],p_expected_version integer,p_idempotency_key uuid,p_correlation_id uuid default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_note public.vulnerability_finding_notes%rowtype; v_digest text; v_existing record; v_mentions uuid[]:=coalesce(p_mention_recipient_ids,'{}'); v_name text;
begin
 if p_organization_id is null or p_actor_user_id is null or p_finding_id is null or p_note_id is null or p_idempotency_key is null or p_expected_version<1 or p_body<>btrim(coalesce(p_body,'')) or char_length(coalesce(p_body,'')) not between 1 and 4000 or cardinality(v_mentions)>20 or cardinality(v_mentions)<>(select count(distinct x) from unnest(v_mentions) x) or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_findings') then return query select 'not_found'::text,null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('findingId',p_finding_id,'noteId',p_note_id,'body',p_body,'mentions',v_mentions,'version',p_expected_version)::text,'sha256'),'hex'); perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0)); select * into v_existing from public.m5_triage_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'note_update',v_digest); if found then return query select v_existing.outcome,v_existing.result; return; end if;
 select * into v_note from public.vulnerability_finding_notes n where n.organization_id=p_organization_id and n.finding_id=p_finding_id and n.id=p_note_id for update; if not found then return query select 'not_found'::text,null::jsonb; return; end if; if v_note.author_user_id is distinct from p_actor_user_id then return query select 'forbidden'::text,null::jsonb; return; end if; if v_note.deleted_at is not null or v_note.version<>p_expected_version then return query select 'conflict'::text,jsonb_build_object('note',public.m5_note_json(p_organization_id,p_note_id)); return; end if;
 if exists(select 1 from unnest(v_mentions) x where not public.m5_triage_actor_has_permission(p_organization_id,x,'can_view_findings')) then return query select 'invalid_request'::text,null::jsonb; return; end if;
 v_name:=public.m5_note_display_name(p_actor_user_id); update public.vulnerability_finding_notes set body=p_body,version=version+1,updated_at=clock_timestamp() where organization_id=p_organization_id and id=p_note_id returning * into v_note;
 insert into public.vulnerability_finding_note_revisions(organization_id,note_id,revision,event_kind,body,mention_recipient_ids,actor_user_id,actor_display_name) values(p_organization_id,p_note_id,v_note.version,'updated',p_body,to_jsonb(v_mentions),p_actor_user_id,v_name);
 update public.vulnerability_finding_note_mentions set notification_status='cancelled',cancelled_at=clock_timestamp(),notification_lease_owner=null,notification_lease_expires_at=null where organization_id=p_organization_id and note_id=p_note_id and recipient_user_id<>all(v_mentions) and notification_status in ('queued','retrying','leased');
 insert into public.vulnerability_finding_note_mentions(organization_id,note_id,recipient_user_id,recipient_display_name) select p_organization_id,p_note_id,x,public.m5_note_display_name(x) from unnest(v_mentions) x on conflict(note_id,recipient_user_id) do nothing;
 insert into public.vulnerability_triage_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'note_update',v_digest,jsonb_build_object('note',public.m5_note_json(p_organization_id,p_note_id)));
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'vulnerability.triage_note_updated','vulnerability_finding_note',p_note_id::text,jsonb_build_object('findingId',p_finding_id,'mentionCount',cardinality(v_mentions),'correlationId',p_correlation_id)); return query select 'updated'::text,jsonb_build_object('note',public.m5_note_json(p_organization_id,p_note_id));
end $$;

create or replace function public.delete_finding_triage_note_atomic(
 p_organization_id uuid,p_actor_user_id uuid,p_finding_id uuid,p_note_id uuid,p_expected_version integer,p_idempotency_key uuid,p_correlation_id uuid default null
) returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v_note public.vulnerability_finding_notes%rowtype; v_digest text; v_existing record; v_name text;
begin
 if p_organization_id is null or p_actor_user_id is null or p_finding_id is null or p_note_id is null or p_idempotency_key is null or p_expected_version<1 or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_edit_findings') then return query select 'not_found'::text,null::jsonb; return; end if;
 v_digest:=encode(extensions.digest(jsonb_build_object('findingId',p_finding_id,'noteId',p_note_id,'version',p_expected_version)::text,'sha256'),'hex'); perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0)); select * into v_existing from public.m5_triage_command_result(p_organization_id,p_actor_user_id,p_idempotency_key,'note_delete',v_digest); if found then return query select v_existing.outcome,v_existing.result; return; end if;
 select * into v_note from public.vulnerability_finding_notes n where n.organization_id=p_organization_id and n.finding_id=p_finding_id and n.id=p_note_id for update; if not found then return query select 'not_found'::text,null::jsonb; return; end if; if v_note.author_user_id is distinct from p_actor_user_id then return query select 'forbidden'::text,null::jsonb; return; end if; if v_note.deleted_at is not null or v_note.version<>p_expected_version then return query select 'conflict'::text,jsonb_build_object('note',public.m5_note_json(p_organization_id,p_note_id)); return; end if;
 v_name:=public.m5_note_display_name(p_actor_user_id); update public.vulnerability_finding_notes set body=null,version=version+1,updated_at=clock_timestamp(),deleted_at=clock_timestamp(),deleted_by_user_id=p_actor_user_id,deleted_by_display_name=v_name where organization_id=p_organization_id and id=p_note_id returning * into v_note;
 insert into public.vulnerability_finding_note_revisions(organization_id,note_id,revision,event_kind,body,mention_recipient_ids,actor_user_id,actor_display_name) values(p_organization_id,p_note_id,v_note.version,'deleted',null,'[]',p_actor_user_id,v_name);
 update public.vulnerability_finding_note_mentions set notification_status='cancelled',cancelled_at=clock_timestamp(),notification_lease_owner=null,notification_lease_expires_at=null where organization_id=p_organization_id and note_id=p_note_id and notification_status in ('queued','retrying','leased');
 insert into public.vulnerability_triage_commands(organization_id,actor_user_id,idempotency_key,operation,request_digest,result) values(p_organization_id,p_actor_user_id,p_idempotency_key,'note_delete',v_digest,jsonb_build_object('note',public.m5_note_json(p_organization_id,p_note_id)));
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'vulnerability.triage_note_deleted','vulnerability_finding_note',p_note_id::text,jsonb_build_object('findingId',p_finding_id,'correlationId',p_correlation_id)); return query select 'deleted'::text,jsonb_build_object('note',public.m5_note_json(p_organization_id,p_note_id));
end $$;

create or replace function public.list_due_finding_triage_note_mention_orgs(p_limit integer default 1000)
returns table(organization_id uuid) language sql stable security definer set search_path = public, pg_temp as $$
 select distinct m.organization_id from public.vulnerability_finding_note_mentions m where m.notification_due_at<=clock_timestamp() and (m.notification_status in ('queued','retrying') or (m.notification_status='leased' and m.notification_lease_expires_at<=clock_timestamp())) order by m.organization_id limit p_limit
$$;
create or replace function public.claim_finding_triage_note_mention(
 p_organization_id uuid,p_worker_id text,p_lease_seconds integer default 120
) returns table(outcome text,mention jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.vulnerability_finding_note_mentions%rowtype;
begin if p_organization_id is null or char_length(btrim(coalesce(p_worker_id,''))) not between 1 and 200 or p_lease_seconds not between 15 and 900 then return query select 'invalid_request'::text,null::jsonb; return; end if;
 select * into v from public.vulnerability_finding_note_mentions m where m.organization_id=p_organization_id and m.notification_due_at<=clock_timestamp() and (m.notification_status in ('queued','retrying') or (m.notification_status='leased' and m.notification_lease_expires_at<=clock_timestamp())) order by m.notification_due_at,m.id for update skip locked limit 1; if not found then return query select 'none_available'::text,null::jsonb; return; end if;
 update public.vulnerability_finding_note_mentions set notification_status='leased',notification_attempts=notification_attempts+1,notification_last_attempt_at=clock_timestamp(),notification_lease_owner=btrim(p_worker_id),notification_lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),notification_error_code=null,notification_error_message=null where id=v.id returning * into v; return query select 'claimed'::text,jsonb_build_object('id',v.id,'noteId',v.note_id); end $$;
create or replace function public.get_finding_triage_note_mention_notification_details(p_organization_id uuid,p_mention_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.vulnerability_finding_note_mentions%rowtype; v_note public.vulnerability_finding_notes%rowtype;
begin select * into v from public.vulnerability_finding_note_mentions where organization_id=p_organization_id and id=p_mention_id for update; if not found then return query select 'not_found'::text,null::jsonb; return; end if; select * into v_note from public.vulnerability_finding_notes where organization_id=p_organization_id and id=v.note_id; if not found or v_note.deleted_at is not null or v.recipient_user_id is null or not public.m5_triage_actor_has_permission(p_organization_id,v.recipient_user_id,'can_view_findings') then update public.vulnerability_finding_note_mentions set notification_status='cancelled',cancelled_at=clock_timestamp(),notification_lease_owner=null,notification_lease_expires_at=null where id=v.id; return query select 'cancelled'::text,null::jsonb; return; end if; return query select 'found'::text,jsonb_build_object('recipient',jsonb_build_object('userId',v.recipient_user_id,'email',(select u.email from public.users u where u.id=v.recipient_user_id)),'findingId',v_note.finding_id); end $$;
create or replace function public.complete_finding_triage_note_mention(
 p_organization_id uuid,p_mention_id uuid,p_worker_id text,p_delivered boolean,p_error_code text default null,p_error_message text default null
) returns table(outcome text) language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.vulnerability_finding_note_mentions%rowtype;
begin select * into v from public.vulnerability_finding_note_mentions where organization_id=p_organization_id and id=p_mention_id for update; if not found or v.notification_status<>'leased' or v.notification_lease_owner is distinct from btrim(p_worker_id) then return query select 'not_found'::text; return; end if; if p_delivered then update public.vulnerability_finding_note_mentions set notification_status='delivered',delivered_at=clock_timestamp(),notification_lease_owner=null,notification_lease_expires_at=null where id=v.id; return query select 'delivered'::text; return; end if; if v.notification_attempts>=5 then update public.vulnerability_finding_note_mentions set notification_status='dead_letter',notification_lease_owner=null,notification_lease_expires_at=null,notification_error_code=p_error_code,notification_error_message=left(p_error_message,1000) where id=v.id; return query select 'dead_letter'::text; return; end if; update public.vulnerability_finding_note_mentions set notification_status='retrying',notification_due_at=clock_timestamp()+make_interval(secs=>(30*power(2,least(v.notification_attempts,6)))::integer),notification_lease_owner=null,notification_lease_expires_at=null,notification_error_code=p_error_code,notification_error_message=left(p_error_message,1000) where id=v.id; return query select 'retry_scheduled'::text; end $$;

do $$
declare v_signature text;
begin
  foreach v_signature in array array[
    'm5_note_display_name(uuid)', 'm5_note_json(uuid,uuid)',
    'list_finding_triage_notes(uuid,uuid,uuid,timestamptz,integer)',
    'list_finding_triage_note_mention_candidates(uuid,uuid,uuid,text,integer)',
    'create_finding_triage_note_atomic(uuid,uuid,uuid,text,uuid[],uuid,uuid)',
    'update_finding_triage_note_atomic(uuid,uuid,uuid,uuid,text,uuid[],integer,uuid,uuid)',
    'delete_finding_triage_note_atomic(uuid,uuid,uuid,uuid,integer,uuid,uuid)',
    'list_due_finding_triage_note_mention_orgs(integer)',
    'claim_finding_triage_note_mention(uuid,text,integer)',
    'get_finding_triage_note_mention_notification_details(uuid,uuid)',
    'complete_finding_triage_note_mention(uuid,uuid,text,boolean,text,text)'
  ] loop
    execute 'alter function public.' || v_signature || ' owner to postgres';
  end loop;
end;
$$;
revoke all on function public.m5_note_display_name(uuid), public.m5_note_json(uuid,uuid), public.list_finding_triage_notes(uuid,uuid,uuid,timestamptz,integer), public.list_finding_triage_note_mention_candidates(uuid,uuid,uuid,text,integer), public.create_finding_triage_note_atomic(uuid,uuid,uuid,text,uuid[],uuid,uuid), public.update_finding_triage_note_atomic(uuid,uuid,uuid,uuid,text,uuid[],integer,uuid,uuid), public.delete_finding_triage_note_atomic(uuid,uuid,uuid,uuid,integer,uuid,uuid), public.list_due_finding_triage_note_mention_orgs(integer), public.claim_finding_triage_note_mention(uuid,text,integer), public.get_finding_triage_note_mention_notification_details(uuid,uuid), public.complete_finding_triage_note_mention(uuid,uuid,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.list_finding_triage_notes(uuid,uuid,uuid,timestamptz,integer), public.list_finding_triage_note_mention_candidates(uuid,uuid,uuid,text,integer), public.create_finding_triage_note_atomic(uuid,uuid,uuid,text,uuid[],uuid,uuid), public.update_finding_triage_note_atomic(uuid,uuid,uuid,uuid,text,uuid[],integer,uuid,uuid), public.delete_finding_triage_note_atomic(uuid,uuid,uuid,uuid,integer,uuid,uuid), public.list_due_finding_triage_note_mention_orgs(integer), public.claim_finding_triage_note_mention(uuid,text,integer), public.get_finding_triage_note_mention_notification_details(uuid,uuid), public.complete_finding_triage_note_mention(uuid,uuid,text,boolean,text,text) to service_role;

insert into public.organization_export_sources(source_id,enabled,sort_order) values('vulnerability_triage_notes',true,48) on conflict(source_id) do update set enabled=excluded.enabled,sort_order=excluded.sort_order;
insert into public.organization_export_source_tables(source_id,table_name,tenant_key_column,record_order_column,table_sort) values
 ('vulnerability_triage_notes', 'vulnerability_finding_notes', 'organization_id', 'id', 1),
 ('vulnerability_triage_notes', 'vulnerability_finding_note_revisions', 'organization_id', 'id', 2),
 ('vulnerability_triage_notes', 'vulnerability_finding_note_mentions', 'organization_id', 'id', 3)
on conflict(source_id,table_name) do update set tenant_key_column=excluded.tenant_key_column,record_order_column=excluded.record_order_column,table_sort=excluded.table_sort;

-- Keep wire snapshots expressive enough for disabled/removed/deleted people
-- without ever reusing a live account profile as historical attribution.
create or replace function public.m5_note_actor_json(p_organization_id uuid,p_user_id uuid,p_display_name text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
 select jsonb_build_object('userId',p_user_id,'displayName',p_display_name,'status',case
   when p_user_id is null then 'deleted'
   when not exists(select 1 from public.users u where u.id=p_user_id) then 'deleted'
   when not exists(select 1 from public.users u where u.id=p_user_id and u.is_active) then 'disabled'
   when not exists(select 1 from public.organization_members m where m.organization_id=p_organization_id and m.user_id=p_user_id) then 'removed'
   else 'active' end)
$$;
create or replace function public.m5_note_json(p_organization_id uuid,p_note_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
 with note as (select * from public.vulnerability_finding_notes where organization_id=p_organization_id and id=p_note_id), latest as (
  select r.* from public.vulnerability_finding_note_revisions r join note n on n.id=r.note_id
  where r.event_kind='updated' order by r.revision desc limit 1
 ) select jsonb_build_object('id',n.id,'findingId',n.finding_id,'body',n.body,'version',n.version,
  'mentions',coalesce((select jsonb_agg(jsonb_build_object('userId',m.recipient_user_id,'displayName',m.recipient_display_name,'status',case when m.recipient_user_id is null then 'deleted' when not exists(select 1 from public.users u where u.id=m.recipient_user_id and u.is_active) then 'disabled' when not exists(select 1 from public.organization_members om where om.organization_id=n.organization_id and om.user_id=m.recipient_user_id) then 'removed' else 'active' end) order by m.recipient_display_name) from public.vulnerability_finding_note_mentions m where m.organization_id=n.organization_id and m.note_id=n.id),'[]'::jsonb),
  'createdBy',public.m5_note_actor_json(n.organization_id,n.author_user_id,n.author_display_name),'createdAt',public.m2_utc_z(n.created_at),
  'updatedBy',case when latest.id is null then null else public.m5_note_actor_json(n.organization_id,latest.actor_user_id,latest.actor_display_name) end,'updatedAt',public.m2_utc_z(n.updated_at),
  'deletedBy',case when n.deleted_at is null then null else public.m5_note_actor_json(n.organization_id,n.deleted_by_user_id,n.deleted_by_display_name) end,
  'deletedAt',case when n.deleted_at is null then null else public.m2_utc_z(n.deleted_at) end) from note n left join latest on true
$$;
alter function public.m5_note_actor_json(uuid,uuid,text) owner to postgres;
revoke all on function public.m5_note_actor_json(uuid,uuid,text) from public,anon,authenticated;

drop function public.list_finding_triage_notes(uuid,uuid,uuid,timestamptz,integer);

create or replace function public.list_finding_triage_notes(
 p_organization_id uuid,p_actor_user_id uuid,p_finding_id uuid,p_cursor text,p_limit integer default 50
) returns table(outcome text,result jsonb) language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_after_created timestamptz; v_after_id uuid; v_rows jsonb; v_cursor text;
begin
 if p_cursor is not null then
   begin select split_part(convert_from(decode(translate(p_cursor,'-_','+/')||repeat('=',(4-length(p_cursor)%4)%4),'base64'),'utf8'),'|',1)::timestamptz,
     split_part(convert_from(decode(translate(p_cursor,'-_','+/')||repeat('=',(4-length(p_cursor)%4)%4),'base64'),'utf8'),'|',2)::uuid into v_after_created,v_after_id;
   exception when others then return query select 'invalid_request'::text,null::jsonb; return; end;
 end if;
 if p_limit not between 1 and 100 or p_organization_id is null or p_actor_user_id is null or p_finding_id is null or not public.m5_triage_actor_has_permission(p_organization_id,p_actor_user_id,'can_view_findings') or not exists(select 1 from public.vulnerability_findings f where f.organization_id=p_organization_id and f.id=p_finding_id and f.status='active') then return query select 'not_found'::text,null::jsonb; return; end if;
 select coalesce(jsonb_agg(public.m5_note_json(p_organization_id,n.id) order by n.created_at desc,n.id desc),'[]'::jsonb), max(translate(trim(trailing '=' from encode(convert_to(n.created_at::text||'|'||n.id::text,'utf8'),'base64')),'+/','-_')) into v_rows,v_cursor from (select id,created_at from public.vulnerability_finding_notes where organization_id=p_organization_id and finding_id=p_finding_id and (p_cursor is null or (created_at,id)<(v_after_created,v_after_id)) order by created_at desc,id desc limit p_limit) n;
 return query select 'found'::text,jsonb_build_object('notes',v_rows,'nextCursor',case when jsonb_array_length(v_rows)=p_limit then v_cursor else null end);
end $$;
alter function public.list_finding_triage_notes(uuid,uuid,uuid,text,integer) owner to postgres;
revoke all on function public.list_finding_triage_notes(uuid,uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.list_finding_triage_notes(uuid,uuid,uuid,text,integer) to service_role;

-- The tenant export materializer deliberately locks every registered source.
-- Extend its current definition rather than forking that security-sensitive RPC.
do $$
declare
  v_definition text;
  v_old_lock text := 'public.vulnerability_vex_publication_attempts' || chr(10) || '  in share mode';
  v_new_lock text := 'public.vulnerability_vex_publication_attempts, public.vulnerability_finding_notes, public.vulnerability_finding_note_revisions, public.vulnerability_finding_note_mentions' || chr(10) || '  in share mode';
begin
  select pg_get_functiondef(to_regprocedure('public.materialize_organization_export_snapshot_atomic(uuid,uuid,uuid,integer)')) into v_definition;
  if position(v_old_lock in v_definition) = 0 then raise exception 'M5-07 export lock anchor is missing'; end if;
  execute replace(v_definition,v_old_lock,v_new_lock);
end;
$$;
