-- M7-06: a recipient is never made a tenant member.  Grants bind one frozen
-- snapshot/export pair; opaque secrets are hashed before crossing this boundary.

create table public.technical_file_auditor_snapshot_grants (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null,
  snapshot_id uuid not null,
  export_id uuid not null,
  recipient_reference text not null check (recipient_reference=btrim(recipient_reference) and char_length(recipient_reference) between 3 and 320),
  purpose text not null check (purpose=btrim(purpose) and char_length(purpose) between 3 and 4000),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  request_digest text not null check (request_digest ~ '^[a-f0-9]{64}$'),
  idempotency_key uuid not null,
  status text not null default 'active' check (status in ('active','expired','revoked')),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.users(id) on delete restrict,
  version integer not null default 1 check (version > 0),
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,created_by,idempotency_key),
  foreign key (organization_id,product_id) references public.products(organization_id,id) on delete restrict,
  foreign key (organization_id,snapshot_id) references public.technical_file_snapshots(organization_id,id) on delete restrict,
  foreign key (organization_id,export_id) references public.technical_file_snapshot_exports(organization_id,id) on delete restrict,
  check (expires_at > created_at),
  check ((status='active' and revoked_at is null and revoked_by is null) or (status='expired' and revoked_at is null and revoked_by is null) or (status='revoked' and revoked_at is not null and revoked_by is not null))
);

create table public.technical_file_auditor_sessions (
  id uuid primary key,
  grant_id uuid not null,
  session_token_hash text not null unique check (session_token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (grant_id) references public.technical_file_auditor_snapshot_grants(id) on delete restrict,
  check (expires_at > created_at)
);

create table public.technical_file_auditor_access_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  grant_id uuid references public.technical_file_auditor_snapshot_grants(id) on delete restrict,
  session_id uuid references public.technical_file_auditor_sessions(id) on delete restrict,
  action text not null check (action in ('grant_created','grant_revoked','redeemed','viewed','manifest_viewed','artifact_delivered','access_denied','redemption_denied','redemption_rate_limited')),
  artifact text check (artifact is null or artifact in ('pdf','archive','manifest')),
  token_hash text check (token_hash is null or token_hash ~ '^[a-f0-9]{64}$'),
  client_source_hash text check (client_source_hash is null or client_source_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  check ((grant_id is null and session_id is null) or grant_id is not null),
  check (session_id is null or grant_id is not null)
);

create index technical_file_auditor_grants_scope_idx on public.technical_file_auditor_snapshot_grants(organization_id,product_id,snapshot_id,created_at desc);
create index technical_file_auditor_grants_expiry_idx on public.technical_file_auditor_snapshot_grants(expires_at) where status='active';
create index technical_file_auditor_sessions_grant_idx on public.technical_file_auditor_sessions(grant_id);
create index technical_file_auditor_access_rate_idx on public.technical_file_auditor_access_events(token_hash,created_at desc) where action in ('redemption_denied','redemption_rate_limited');

alter table public.technical_file_auditor_snapshot_grants enable row level security;
alter table public.technical_file_auditor_sessions enable row level security;
alter table public.technical_file_auditor_access_events enable row level security;
revoke all on table public.technical_file_auditor_snapshot_grants,public.technical_file_auditor_sessions,public.technical_file_auditor_access_events from public,anon,authenticated;
grant all on table public.technical_file_auditor_snapshot_grants,public.technical_file_auditor_sessions,public.technical_file_auditor_access_events to service_role;

create or replace function public.m7_auditor_grant_json(p_organization_id uuid,p_grant_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',g.id,'productId',g.product_id,'snapshotId',g.snapshot_id,'exportId',g.export_id,'recipientReference',g.recipient_reference,'purpose',g.purpose,'status',case when g.status='active' and g.expires_at<=clock_timestamp() then 'expired' else g.status end,'expiresAt',to_char(g.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'redeemedAt',case when g.redeemed_at is null then null else to_char(g.redeemed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,'revokedAt',case when g.revoked_at is null then null else to_char(g.revoked_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') end,'version',g.version,'createdAt',to_char(g.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))
 from public.technical_file_auditor_snapshot_grants g where g.organization_id=p_organization_id and g.id=p_grant_id
$$;

create or replace function public.m7_auditor_scope_json(p_grant_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'snapshot',jsonb_build_object('id',s.id,'sourceDate',to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'technicalFileVersion',s.technical_file_version,'templateKey',s.template_key,'templateVersion',s.template_version,'payloadSha256',s.payload_sha256,'superseded',s.superseded_by_snapshot_id is not null,'payload',s.payload),
  'export',jsonb_build_object('id',e.id,'completedAt',to_char(e.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'pdf',jsonb_build_object('sha256',e.pdf_sha256,'bytes',e.pdf_bytes),'archive',jsonb_build_object('sha256',e.archive_sha256,'bytes',e.archive_bytes),'manifest',jsonb_build_object('sha256',e.manifest_sha256,'bytes',e.manifest_bytes)))
 from public.technical_file_auditor_snapshot_grants g
 join public.technical_file_snapshots s on s.organization_id=g.organization_id and s.id=g.snapshot_id
 join public.technical_file_snapshot_exports e on e.organization_id=g.organization_id and e.id=g.export_id and e.snapshot_id=g.snapshot_id
 where g.id=p_grant_id and e.status='ready'
$$;

create or replace function public.preview_technical_file_auditor_snapshot_grant(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_export_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_snapshot public.technical_file_snapshots%rowtype; v_export public.technical_file_snapshot_exports%rowtype;
begin
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_share_technical_file_snapshots') then return query select 'forbidden',null::jsonb; return; end if;
 select * into v_snapshot from public.technical_file_snapshots where organization_id=p_organization_id and product_id=p_product_id and id=p_snapshot_id for share;
 select * into v_export from public.technical_file_snapshot_exports where organization_id=p_organization_id and snapshot_id=p_snapshot_id and id=p_export_id and status='ready' for share;
 if not found or v_snapshot.id is null then return query select 'not_found',null::jsonb; return; end if;
 return query select 'found',jsonb_build_object('snapshotId',v_snapshot.id,'payloadSha256',v_snapshot.payload_sha256,'sourceDate',to_char(v_snapshot.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'superseded',v_snapshot.superseded_by_snapshot_id is not null,'exportId',v_export.id,'artifacts',jsonb_build_array('pdf','archive','manifest'));
end $$;

create or replace function public.create_technical_file_auditor_snapshot_grant_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_export_id uuid,p_grant_id uuid,p_recipient_reference text,p_purpose text,p_expires_at timestamptz,p_token_hash text,p_idempotency_key uuid,p_request_digest text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_snapshot public.technical_file_snapshots%rowtype; v_grant public.technical_file_auditor_snapshot_grants%rowtype;
begin
 if p_grant_id is null or p_idempotency_key is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_request_digest !~ '^[a-f0-9]{64}$' or char_length(btrim(coalesce(p_recipient_reference,''))) not between 3 and 320 or char_length(btrim(coalesce(p_purpose,''))) not between 3 and 4000 or p_expires_at<=clock_timestamp()+interval '15 minutes' or p_expires_at>clock_timestamp()+interval '30 days' or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_share_technical_file_snapshots') then return query select 'invalid_request',null::jsonb; return; end if;
 select * into v_grant from public.technical_file_auditor_snapshot_grants where organization_id=p_organization_id and created_by=p_actor_user_id and idempotency_key=p_idempotency_key for update;
 if found then if v_grant.request_digest=p_request_digest then return query select 'replayed',public.m7_auditor_grant_json(p_organization_id,v_grant.id); else return query select 'idempotency_conflict',null::jsonb; end if; return; end if;
 select * into v_snapshot from public.technical_file_snapshots where organization_id=p_organization_id and product_id=p_product_id and id=p_snapshot_id for share;
 perform 1 from public.technical_file_snapshot_exports where organization_id=p_organization_id and snapshot_id=p_snapshot_id and id=p_export_id and status='ready' for share;
 if not found or v_snapshot.id is null then return query select 'not_found',null::jsonb; return; end if;
 insert into public.technical_file_auditor_snapshot_grants(id,organization_id,product_id,snapshot_id,export_id,recipient_reference,purpose,token_hash,request_digest,idempotency_key,expires_at,created_by) values(p_grant_id,p_organization_id,p_product_id,p_snapshot_id,p_export_id,btrim(p_recipient_reference),btrim(p_purpose),p_token_hash,p_request_digest,p_idempotency_key,p_expires_at,p_actor_user_id) returning * into v_grant;
 insert into public.technical_file_auditor_access_events(organization_id,grant_id,action) values(p_organization_id,v_grant.id,'grant_created');
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.auditor_grant_created','technical_file_auditor_snapshot_grant',v_grant.id::text,jsonb_build_object('snapshotId',p_snapshot_id,'exportId',p_export_id,'idempotencyKey',p_idempotency_key));
 return query select 'created',public.m7_auditor_grant_json(p_organization_id,v_grant.id);
exception when unique_violation then return query select 'conflict',null::jsonb;
end $$;

create or replace function public.list_technical_file_auditor_snapshot_grants(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_share_technical_file_snapshots') then return query select 'forbidden',null::jsonb; return; end if;
 if not exists(select 1 from public.technical_file_snapshots where organization_id=p_organization_id and product_id=p_product_id and id=p_snapshot_id) then return query select 'not_found',null::jsonb; return; end if;
 return query select 'found',jsonb_build_object('grants',coalesce((select jsonb_agg(public.m7_auditor_grant_json(p_organization_id,g.id) order by g.created_at desc,g.id) from public.technical_file_auditor_snapshot_grants g where g.organization_id=p_organization_id and g.product_id=p_product_id and g.snapshot_id=p_snapshot_id),'[]'::jsonb));
end $$;

create or replace function public.revoke_technical_file_auditor_snapshot_grant_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_grant_id uuid,p_expected_version integer)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_grant public.technical_file_auditor_snapshot_grants%rowtype;
begin
 if p_expected_version<1 or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_share_technical_file_snapshots') then return query select 'forbidden',null::jsonb; return; end if;
 select * into v_grant from public.technical_file_auditor_snapshot_grants where organization_id=p_organization_id and product_id=p_product_id and snapshot_id=p_snapshot_id and id=p_grant_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if v_grant.version<>p_expected_version then return query select 'conflict',jsonb_build_object('currentVersion',v_grant.version); return; end if;
 if v_grant.status='revoked' then return query select 'revoked',public.m7_auditor_grant_json(p_organization_id,v_grant.id); return; end if;
 update public.technical_file_auditor_snapshot_grants set status='revoked',revoked_at=clock_timestamp(),revoked_by=p_actor_user_id,version=version+1 where id=v_grant.id;
 update public.technical_file_auditor_sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where grant_id=v_grant.id;
 insert into public.technical_file_auditor_access_events(organization_id,grant_id,action) values(p_organization_id,v_grant.id,'grant_revoked');
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.auditor_grant_revoked','technical_file_auditor_snapshot_grant',v_grant.id::text,jsonb_build_object('snapshotId',p_snapshot_id));
 return query select 'revoked',public.m7_auditor_grant_json(p_organization_id,v_grant.id);
end $$;

create or replace function public.redeem_technical_file_auditor_snapshot_grant_atomic(p_token_hash text,p_session_id uuid,p_session_token_hash text,p_session_expires_at timestamptz,p_client_source_hash text default null)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_grant public.technical_file_auditor_snapshot_grants%rowtype;
begin
 if p_token_hash !~ '^[a-f0-9]{64}$' or p_session_id is null or p_session_token_hash !~ '^[a-f0-9]{64}$' or (p_client_source_hash is not null and p_client_source_hash !~ '^[a-f0-9]{64}$') or p_session_expires_at<=clock_timestamp() or p_session_expires_at>clock_timestamp()+interval '1 hour' then return query select 'unavailable',null::jsonb; return; end if;
 if (select count(*) from public.technical_file_auditor_access_events where token_hash=p_token_hash and action in ('redemption_denied','redemption_rate_limited') and created_at>clock_timestamp()-interval '15 minutes')>=5 then insert into public.technical_file_auditor_access_events(action,token_hash,client_source_hash) values('redemption_rate_limited',p_token_hash,p_client_source_hash); return query select 'rate_limited',null::jsonb; return; end if;
 select * into v_grant from public.technical_file_auditor_snapshot_grants where token_hash=p_token_hash for update;
 if not found or v_grant.status<>'active' or v_grant.expires_at<=clock_timestamp() or v_grant.redeemed_at is not null then
   if found and v_grant.status='active' and v_grant.expires_at<=clock_timestamp() then update public.technical_file_auditor_snapshot_grants set status='expired',version=version+1 where id=v_grant.id; end if;
   insert into public.technical_file_auditor_access_events(organization_id,grant_id,action,token_hash,client_source_hash) values(case when found then v_grant.organization_id else null end,case when found then v_grant.id else null end,'redemption_denied',p_token_hash,p_client_source_hash);
   return query select 'unavailable',null::jsonb; return;
 end if;
 if p_session_expires_at>v_grant.expires_at then return query select 'unavailable',null::jsonb; return; end if;
 update public.technical_file_auditor_snapshot_grants set redeemed_at=clock_timestamp(),version=version+1 where id=v_grant.id;
 insert into public.technical_file_auditor_sessions(id,grant_id,session_token_hash,expires_at) values(p_session_id,v_grant.id,p_session_token_hash,p_session_expires_at);
 insert into public.technical_file_auditor_access_events(organization_id,grant_id,session_id,action) values(v_grant.organization_id,v_grant.id,p_session_id,'redeemed');
 return query select 'redeemed',jsonb_build_object('sessionExpiresAt',to_char(p_session_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'));
exception when unique_violation then return query select 'unavailable',null::jsonb;
end $$;

create or replace function public.get_technical_file_auditor_snapshot_access_atomic(p_session_token_hash text,p_action text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session public.technical_file_auditor_sessions%rowtype; v_grant public.technical_file_auditor_snapshot_grants%rowtype;
begin
 if p_session_token_hash !~ '^[a-f0-9]{64}$' or p_action not in ('viewed','manifest_viewed') then return query select 'unavailable',null::jsonb; return; end if;
 select * into v_session from public.technical_file_auditor_sessions where session_token_hash=p_session_token_hash for update;
 if not found then return query select 'unavailable',null::jsonb; return; end if;
 select * into v_grant from public.technical_file_auditor_snapshot_grants where id=v_session.grant_id for share;
 if not found or v_session.revoked_at is not null or v_session.expires_at<=clock_timestamp() or v_grant.status<>'active' or v_grant.expires_at<=clock_timestamp() then return query select 'unavailable',null::jsonb; return; end if;
 update public.technical_file_auditor_sessions set last_used_at=clock_timestamp() where id=v_session.id;
 insert into public.technical_file_auditor_access_events(organization_id,grant_id,session_id,action) values(v_grant.organization_id,v_grant.id,v_session.id,p_action);
 return query select 'available',public.m7_auditor_scope_json(v_grant.id);
end $$;

create or replace function public.get_technical_file_auditor_snapshot_artifact_atomic(p_session_token_hash text,p_artifact text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_session public.technical_file_auditor_sessions%rowtype; v_grant public.technical_file_auditor_snapshot_grants%rowtype; v_export public.technical_file_snapshot_exports%rowtype; v_path text;
begin
 if p_session_token_hash !~ '^[a-f0-9]{64}$' or p_artifact not in ('pdf','archive','manifest') then return query select 'unavailable',null::jsonb; return; end if;
 select * into v_session from public.technical_file_auditor_sessions where session_token_hash=p_session_token_hash for update;
 if not found then return query select 'unavailable',null::jsonb; return; end if;
 select * into v_grant from public.technical_file_auditor_snapshot_grants where id=v_session.grant_id for share;
 select * into v_export from public.technical_file_snapshot_exports where organization_id=v_grant.organization_id and id=v_grant.export_id and snapshot_id=v_grant.snapshot_id and status='ready' for share;
 if not found or v_session.revoked_at is not null or v_session.expires_at<=clock_timestamp() or v_grant.status<>'active' or v_grant.expires_at<=clock_timestamp() then return query select 'unavailable',null::jsonb; return; end if;
 v_path:=case p_artifact when 'pdf' then v_export.pdf_object_path when 'archive' then v_export.archive_object_path else v_export.manifest_object_path end;
 if v_path is null then return query select 'unavailable',null::jsonb; return; end if;
 update public.technical_file_auditor_sessions set last_used_at=clock_timestamp() where id=v_session.id;
 insert into public.technical_file_auditor_access_events(organization_id,grant_id,session_id,action,artifact) values(v_grant.organization_id,v_grant.id,v_session.id,'artifact_delivered',p_artifact);
 return query select 'available',jsonb_build_object('objectPath',v_path);
end $$;

revoke all on function public.m7_auditor_grant_json(uuid,uuid),public.m7_auditor_scope_json(uuid),public.preview_technical_file_auditor_snapshot_grant(uuid,uuid,uuid,uuid,uuid),public.create_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,text,uuid,text),public.list_technical_file_auditor_snapshot_grants(uuid,uuid,uuid,uuid),public.revoke_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,integer),public.redeem_technical_file_auditor_snapshot_grant_atomic(text,uuid,text,timestamptz,text),public.get_technical_file_auditor_snapshot_access_atomic(text,text),public.get_technical_file_auditor_snapshot_artifact_atomic(text,text) from public,anon,authenticated;
grant execute on function public.m7_auditor_grant_json(uuid,uuid),public.m7_auditor_scope_json(uuid),public.preview_technical_file_auditor_snapshot_grant(uuid,uuid,uuid,uuid,uuid),public.create_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,text,uuid,text),public.list_technical_file_auditor_snapshot_grants(uuid,uuid,uuid,uuid),public.revoke_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,integer),public.redeem_technical_file_auditor_snapshot_grant_atomic(text,uuid,text,timestamptz,text),public.get_technical_file_auditor_snapshot_access_atomic(text,text),public.get_technical_file_auditor_snapshot_artifact_atomic(text,text) to service_role;
alter function public.m7_auditor_grant_json(uuid,uuid) owner to postgres;
alter function public.m7_auditor_scope_json(uuid) owner to postgres;
alter function public.preview_technical_file_auditor_snapshot_grant(uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function public.create_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,text,uuid,text) owner to postgres;
alter function public.list_technical_file_auditor_snapshot_grants(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.revoke_technical_file_auditor_snapshot_grant_atomic(uuid,uuid,uuid,uuid,uuid,integer) owner to postgres;
alter function public.redeem_technical_file_auditor_snapshot_grant_atomic(text,uuid,text,timestamptz,text) owner to postgres;
alter function public.get_technical_file_auditor_snapshot_access_atomic(text,text) owner to postgres;
alter function public.get_technical_file_auditor_snapshot_artifact_atomic(text,text) owner to postgres;
notify pgrst, 'reload schema';
