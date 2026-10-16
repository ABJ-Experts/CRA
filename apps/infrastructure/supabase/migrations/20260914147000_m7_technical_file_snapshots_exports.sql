-- M7-04: immutable Annex VII snapshots and scoped export-job coordination.
-- Payloads are copied once; export workers only ever read these frozen bytes.

create table public.technical_file_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  technical_file_id uuid not null,
  product_id uuid not null,
  release_id uuid references public.product_releases(id) on delete restrict,
  purpose text not null check (purpose in ('release','audit')),
  audit_rationale text check (audit_rationale is null or (audit_rationale=btrim(audit_rationale) and char_length(audit_rationale) between 1 and 4000)),
  technical_file_version integer not null check (technical_file_version > 0),
  template_key text not null,
  template_version text not null,
  readiness_status text not null check (readiness_status in ('empty','partial','complete','stale')),
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  payload_sha256 text not null check (payload_sha256 ~ '^[a-f0-9]{64}$'),
  superseded_by_snapshot_id uuid,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  unique (organization_id,created_by,purpose,created_at),
  foreign key (organization_id,technical_file_id) references public.technical_files(organization_id,id) on delete restrict,
  foreign key (organization_id,product_id) references public.products(organization_id,id) on delete restrict,
  foreign key (organization_id,release_id) references public.product_releases(organization_id,id) on delete restrict,
  foreign key (organization_id,superseded_by_snapshot_id) references public.technical_file_snapshots(organization_id,id) on delete restrict,
  check ((purpose='release' and release_id is not null and audit_rationale is null) or (purpose='audit' and release_id is null and audit_rationale is not null))
);

create table public.technical_file_snapshot_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  snapshot_id uuid not null,
  requested_by uuid not null references public.users(id) on delete restrict,
  idempotency_key uuid not null,
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  status text not null default 'queued' check (status in ('queued','generating','ready','failed','superseded','cancelled')),
  lease_owner uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  failure_code text check (failure_code is null or failure_code in ('source_unavailable','object_write_failed','renderer_failed','cancelled','corrupt_artifact')),
  pdf_object_path text check (pdf_object_path is null or (pdf_object_path !~ '(^|/)\\.\\.(/|$)' and pdf_object_path !~ '^/')),
  pdf_sha256 text check (pdf_sha256 is null or pdf_sha256 ~ '^[a-f0-9]{64}$'),
  pdf_bytes bigint check (pdf_bytes is null or pdf_bytes between 1 and 52428800),
  archive_object_path text check (archive_object_path is null or (archive_object_path !~ '(^|/)\\.\\.(/|$)' and archive_object_path !~ '^/')),
  archive_sha256 text check (archive_sha256 is null or archive_sha256 ~ '^[a-f0-9]{64}$'),
  archive_bytes bigint check (archive_bytes is null or archive_bytes between 1 and 104857600),
  manifest_object_path text check (manifest_object_path is null or (manifest_object_path !~ '(^|/)\\.\\.(/|$)' and manifest_object_path !~ '^/')),
  manifest_sha256 text check (manifest_sha256 is null or manifest_sha256 ~ '^[a-f0-9]{64}$'),
  manifest_bytes bigint check (manifest_bytes is null or manifest_bytes between 1 and 1048576),
  created_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  unique (organization_id,id),
  unique (organization_id,requested_by,idempotency_key),
  foreign key (organization_id,snapshot_id) references public.technical_file_snapshots(organization_id,id) on delete restrict,
  check ((status='ready' and pdf_object_path is not null and pdf_sha256 is not null and pdf_bytes is not null and archive_object_path is not null and archive_sha256 is not null and archive_bytes is not null and manifest_object_path is not null and manifest_sha256 is not null and manifest_bytes is not null and completed_at is not null) or status<>'ready'),
  check ((status='generating' and lease_owner is not null and lease_expires_at is not null) or status<>'generating')
);

create index technical_file_snapshots_product_idx on public.technical_file_snapshots(organization_id,product_id,created_at desc);
create index technical_file_snapshot_exports_work_idx on public.technical_file_snapshot_exports(status,created_at) where status='queued';
create index technical_file_snapshot_exports_snapshot_idx on public.technical_file_snapshot_exports(organization_id,snapshot_id,created_at desc);

alter table public.technical_file_snapshots enable row level security;
alter table public.technical_file_snapshot_exports enable row level security;
revoke all on table public.technical_file_snapshots,public.technical_file_snapshot_exports from public,anon,authenticated;
grant all on table public.technical_file_snapshots,public.technical_file_snapshot_exports to service_role;

create or replace function public.m7_snapshot_json(p_organization_id uuid,p_snapshot_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('id',s.id,'organizationId',s.organization_id,'technicalFileId',s.technical_file_id,'productId',s.product_id,'releaseId',s.release_id,'purpose',s.purpose,'auditRationale',s.audit_rationale,'technicalFileVersion',s.technical_file_version,'templateKey',s.template_key,'templateVersion',s.template_version,'readinessStatus',s.readiness_status,'payload',s.payload,'payloadSha256',s.payload_sha256,'supersededBySnapshotId',s.superseded_by_snapshot_id,'createdByUserId',s.created_by,'createdAt',to_char(s.created_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')) from public.technical_file_snapshots s where s.organization_id=p_organization_id and s.id=p_snapshot_id
$$;

create or replace function public.m7_snapshot_export_json(p_organization_id uuid,p_export_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',e.id,'organizationId',e.organization_id,'snapshotId',e.snapshot_id,'status',e.status,'attemptCount',e.attempt_count,'failureCode',e.failure_code,'pdf',case when e.pdf_object_path is null then null else jsonb_build_object('objectPath',e.pdf_object_path,'sha256',e.pdf_sha256,'bytes',e.pdf_bytes) end,'archive',case when e.archive_object_path is null then null else jsonb_build_object('objectPath',e.archive_object_path,'sha256',e.archive_sha256,'bytes',e.archive_bytes) end,'manifest',case when e.manifest_object_path is null then null else jsonb_build_object('objectPath',e.manifest_object_path,'sha256',e.manifest_sha256,'bytes',e.manifest_bytes) end,'createdAt',to_char(e.created_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),'startedAt',case when e.started_at is null then null else to_char(e.started_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') end,'completedAt',case when e.completed_at is null then null else to_char(e.completed_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') end) from public.technical_file_snapshot_exports e where e.organization_id=p_organization_id and e.id=p_export_id
$$;

create or replace function public.create_technical_file_snapshot_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_expected_technical_file_version integer,p_purpose text,p_release_id uuid,p_audit_rationale text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.technical_files%rowtype; r public.product_releases%rowtype; snapshot_id uuid; payload jsonb; payload_text text; digest text; replay record; readiness jsonb;
begin
 if p_purpose not in ('release','audit') or p_expected_technical_file_version < 1 or p_idempotency_key is null or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_snapshot_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 select a.* into replay from public.audit_logs a where a.organization_id=p_organization_id and a.user_id=p_actor_user_id and a.changes->>'idempotencyKey'=p_idempotency_key::text order by a.created_at desc,a.id desc limit 1;
 if found then
   if replay.action='technical_file.snapshot_created' then return query select 'replayed',public.m7_snapshot_json(p_organization_id,(replay.changes->>'snapshotId')::uuid); else return query select 'idempotency_conflict',null::jsonb; end if; return;
 end if;
 select * into f from public.technical_files where organization_id=p_organization_id and product_id=p_product_id and status='active' for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if f.version<>p_expected_technical_file_version then return query select 'conflict',jsonb_build_object('currentVersion',f.version); return; end if;
 perform 1 from public.technical_file_sections where organization_id=p_organization_id and technical_file_id=f.id order by sort_order,id for share;
 perform 1 from public.technical_file_section_sources x join public.technical_file_sections s on s.organization_id=x.organization_id and s.id=x.section_id where x.organization_id=p_organization_id and s.technical_file_id=f.id for share;
 perform 1 from public.technical_file_risks r join public.technical_file_risk_registers rr on rr.organization_id=r.organization_id and rr.id=r.risk_register_id where r.organization_id=p_organization_id and rr.technical_file_id=f.id for share;
 if p_purpose='release' then
   select * into r from public.product_releases where organization_id=p_organization_id and product_id=p_product_id and id=p_release_id and archived_at is null and lifecycle='released' for share;
   if not found then return query select 'invalid_request',null::jsonb; return; end if;
 elsif p_release_id is not null or char_length(btrim(coalesce(p_audit_rationale,''))) not between 1 and 4000 then return query select 'invalid_request',null::jsonb; return;
 end if;
 readiness:=public.m7_evidence_readiness_json(p_organization_id,p_product_id);
 payload:=jsonb_build_object('schemaVersion','m7-04/v1','capturedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),'product',(select to_jsonb(p) from public.products p where p.organization_id=p_organization_id and p.id=p_product_id),'release',case when p_release_id is null then null else to_jsonb(r) end,'technicalFile',(select x.result->'technicalFile' from public.get_technical_file(p_organization_id,p_product_id,p_actor_user_id) x limit 1),'readiness',readiness,'riskRegister',public.m7_risk_register_json(p_organization_id,p_product_id,true));
 payload_text:=payload::text; digest:=encode(extensions.digest(payload_text,'sha256'),'hex');
 insert into public.technical_file_snapshots(organization_id,technical_file_id,product_id,release_id,purpose,audit_rationale,technical_file_version,template_key,template_version,readiness_status,payload,payload_sha256,created_by) values(p_organization_id,f.id,p_product_id,p_release_id,p_purpose,case when p_purpose='audit' then btrim(p_audit_rationale) else null end,f.version,f.template_key,f.template_version,coalesce(readiness->>'status','empty'),payload,digest,p_actor_user_id) returning id into snapshot_id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.snapshot_created','technical_file_snapshot',snapshot_id::text,jsonb_build_object('snapshotId',snapshot_id,'idempotencyKey',p_idempotency_key,'payloadDigest',digest));
 return query select 'created',public.m7_snapshot_json(p_organization_id,snapshot_id);
end $$;

create or replace function public.create_technical_file_snapshot_export_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.technical_file_snapshots%rowtype; e public.technical_file_snapshot_exports%rowtype; digest text;
begin
 if p_idempotency_key is null or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_snapshot_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 select * into s from public.technical_file_snapshots where organization_id=p_organization_id and product_id=p_product_id and id=p_snapshot_id for share;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 digest:=encode(extensions.digest(jsonb_build_object('snapshotId',p_snapshot_id,'operation','export')::text,'sha256'),'hex');
 select * into e from public.technical_file_snapshot_exports where organization_id=p_organization_id and requested_by=p_actor_user_id and idempotency_key=p_idempotency_key;
 if found then if e.payload_digest=digest then return query select 'replayed',public.m7_snapshot_export_json(p_organization_id,e.id); else return query select 'idempotency_conflict',null::jsonb; end if; return; end if;
 insert into public.technical_file_snapshot_exports(organization_id,snapshot_id,requested_by,idempotency_key,payload_digest) values(p_organization_id,p_snapshot_id,p_actor_user_id,p_idempotency_key,digest) returning * into e;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.snapshot_export_requested','technical_file_snapshot_export',e.id::text,jsonb_build_object('snapshotId',p_snapshot_id,'exportId',e.id,'idempotencyKey',p_idempotency_key,'payloadDigest',digest));
 return query select 'created',public.m7_snapshot_export_json(p_organization_id,e.id);
end $$;

create or replace function public.claim_technical_file_snapshot_export(p_worker_id uuid,p_lease_seconds integer default 120)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.technical_file_snapshot_exports%rowtype;
begin
 if p_worker_id is null or p_lease_seconds not between 30 and 900 then return query select 'invalid_request',null::jsonb; return; end if;
 select * into e from public.technical_file_snapshot_exports where status='queued' order by created_at,id limit 1 for update skip locked;
 if not found then return query select 'empty',null::jsonb; return; end if;
 update public.technical_file_snapshot_exports set status='generating',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempt_count=attempt_count+1,started_at=clock_timestamp() where id=e.id returning * into e;
 return query select 'claimed',jsonb_build_object('export',public.m7_snapshot_export_json(e.organization_id,e.id),'snapshot',public.m7_snapshot_json(e.organization_id,e.snapshot_id));
end $$;

create or replace function public.finalize_technical_file_snapshot_export_atomic(p_organization_id uuid,p_export_id uuid,p_worker_id uuid,p_pdf_path text,p_pdf_sha256 text,p_pdf_bytes bigint,p_archive_path text,p_archive_sha256 text,p_archive_bytes bigint,p_manifest_path text,p_manifest_sha256 text,p_manifest_bytes bigint)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.technical_file_snapshot_exports%rowtype;
begin
 select * into e from public.technical_file_snapshot_exports where organization_id=p_organization_id and id=p_export_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if e.status<>'generating' or e.lease_owner<>p_worker_id or e.lease_expires_at<=clock_timestamp() then return query select 'conflict',public.m7_snapshot_export_json(p_organization_id,e.id); return; end if;
 if p_pdf_path ~ '(^|/)\\.\\.(/|$)' or p_pdf_path ~ '^/' or p_archive_path ~ '(^|/)\\.\\.(/|$)' or p_archive_path ~ '^/' or p_manifest_path ~ '(^|/)\\.\\.(/|$)' or p_manifest_path ~ '^/' or p_pdf_sha256 !~ '^[a-f0-9]{64}$' or p_archive_sha256 !~ '^[a-f0-9]{64}$' or p_manifest_sha256 !~ '^[a-f0-9]{64}$' or p_pdf_bytes not between 1 and 52428800 or p_archive_bytes not between 1 and 104857600 or p_manifest_bytes not between 1 and 1048576 then return query select 'invalid_request',null::jsonb; return; end if;
 update public.technical_file_snapshot_exports set status='ready',lease_owner=null,lease_expires_at=null,pdf_object_path=p_pdf_path,pdf_sha256=p_pdf_sha256,pdf_bytes=p_pdf_bytes,archive_object_path=p_archive_path,archive_sha256=p_archive_sha256,archive_bytes=p_archive_bytes,manifest_object_path=p_manifest_path,manifest_sha256=p_manifest_sha256,manifest_bytes=p_manifest_bytes,completed_at=clock_timestamp() where id=e.id;
 return query select 'ready',public.m7_snapshot_export_json(p_organization_id,e.id);
end $$;

create or replace function public.get_technical_file_snapshot_export_download_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_export_id uuid,p_artifact text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.technical_file_snapshot_exports%rowtype; object_path text;
begin
 if p_artifact not in ('pdf','archive','manifest') or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_snapshot_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 select e.* into e from public.technical_file_snapshot_exports e join public.technical_file_snapshots s on s.organization_id=e.organization_id and s.id=e.snapshot_id where e.organization_id=p_organization_id and e.id=p_export_id and e.snapshot_id=p_snapshot_id and s.product_id=p_product_id and e.status='ready';
 if not found then return query select 'not_found',null::jsonb; return; end if;
 object_path:=case p_artifact when 'pdf' then e.pdf_object_path when 'archive' then e.archive_object_path else e.manifest_object_path end;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.snapshot_export_downloaded','technical_file_snapshot_export',e.id::text,jsonb_build_object('snapshotId',p_snapshot_id,'exportId',e.id,'artifact',p_artifact));
 return query select 'found',jsonb_build_object('objectPath',object_path);
end $$;

revoke all on function public.m7_snapshot_json(uuid,uuid),public.m7_snapshot_export_json(uuid,uuid),public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid),public.create_technical_file_snapshot_export_atomic(uuid,uuid,uuid,uuid,uuid),public.claim_technical_file_snapshot_export(uuid,integer),public.finalize_technical_file_snapshot_export_atomic(uuid,uuid,uuid,text,text,bigint,text,text,bigint,text,text,bigint),public.get_technical_file_snapshot_export_download_atomic(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.m7_snapshot_json(uuid,uuid),public.m7_snapshot_export_json(uuid,uuid),public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid),public.create_technical_file_snapshot_export_atomic(uuid,uuid,uuid,uuid,uuid),public.claim_technical_file_snapshot_export(uuid,integer),public.finalize_technical_file_snapshot_export_atomic(uuid,uuid,uuid,text,text,bigint,text,text,bigint,text,text,bigint),public.get_technical_file_snapshot_export_download_atomic(uuid,uuid,uuid,uuid,uuid,text) to service_role;
alter function public.m7_snapshot_json(uuid,uuid) owner to postgres;
alter function public.m7_snapshot_export_json(uuid,uuid) owner to postgres;
alter function public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid) owner to postgres;
alter function public.create_technical_file_snapshot_export_atomic(uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function public.claim_technical_file_snapshot_export(uuid,integer) owner to postgres;
alter function public.finalize_technical_file_snapshot_export_atomic(uuid,uuid,uuid,text,text,bigint,text,text,bigint,text,text,bigint) owner to postgres;
alter function public.get_technical_file_snapshot_export_download_atomic(uuid,uuid,uuid,uuid,uuid,text) owner to postgres;
notify pgrst, 'reload schema';
