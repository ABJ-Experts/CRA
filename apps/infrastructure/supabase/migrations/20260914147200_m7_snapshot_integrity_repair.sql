-- Follow-up integrity hardening for locally applied M7-04 records.
create or replace function public.m7_reject_technical_file_snapshot_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.payload is distinct from old.payload or new.payload_sha256 is distinct from old.payload_sha256 or new.payload_byte_length is distinct from old.payload_byte_length or new.technical_file_id is distinct from old.technical_file_id or new.product_id is distinct from old.product_id or new.release_id is distinct from old.release_id or new.purpose is distinct from old.purpose or new.technical_file_version is distinct from old.technical_file_version or new.template_key is distinct from old.template_key or new.template_version is distinct from old.template_version or new.readiness_status is distinct from old.readiness_status or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then raise exception 'technical file snapshot payload is immutable'; end if;
 if new.status is distinct from old.status and not (old.status='current' and new.status='superseded' and new.superseded_by_snapshot_id is not null) then raise exception 'invalid technical file snapshot transition'; end if;
 return new;
end $$;
drop trigger if exists technical_file_snapshot_immutable on public.technical_file_snapshots;
create trigger technical_file_snapshot_immutable before update on public.technical_file_snapshots for each row execute function public.m7_reject_technical_file_snapshot_mutation();

create or replace function public.create_technical_file_snapshot_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_expected_technical_file_version integer,p_purpose text,p_release_id uuid,p_audit_rationale text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.technical_files%rowtype; r public.product_releases%rowtype; snapshot_id uuid; payload jsonb; payload_text text; digest text; replay record; readiness jsonb; retention jsonb; technical_file jsonb;
begin
 if p_purpose not in ('release','audit') or p_expected_technical_file_version < 1 or p_idempotency_key is null or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_snapshot_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0));
 select a.* into replay from public.audit_logs a where a.organization_id=p_organization_id and a.user_id=p_actor_user_id and a.changes->>'idempotencyKey'=p_idempotency_key::text order by a.created_at desc,a.id desc limit 1;
 if found then if replay.action='technical_file.snapshot_created' then return query select 'replayed',public.m7_snapshot_json(p_organization_id,(replay.changes->>'snapshotId')::uuid); else return query select 'idempotency_conflict',null::jsonb; end if; return; end if;
 select * into f from public.technical_files where organization_id=p_organization_id and product_id=p_product_id and status='active' for update;
 if not found then return query select 'not_found',null::jsonb; return; end if; if f.version<>p_expected_technical_file_version then return query select 'conflict',jsonb_build_object('currentVersion',f.version); return; end if;
 perform 1 from public.technical_file_sections where organization_id=p_organization_id and technical_file_id=f.id order by sort_order,id for share;
 perform 1 from public.technical_file_section_sources x join public.technical_file_sections s on s.organization_id=x.organization_id and s.id=x.section_id where x.organization_id=p_organization_id and s.technical_file_id=f.id for share;
 perform 1 from public.technical_file_risk_registers where organization_id=p_organization_id and technical_file_id=f.id for share;
 perform 1 from public.technical_file_risks q join public.technical_file_risk_registers rr on rr.organization_id=q.organization_id and rr.id=q.risk_register_id where q.organization_id=p_organization_id and rr.technical_file_id=f.id for share;
 if p_purpose='release' then select * into r from public.product_releases where organization_id=p_organization_id and product_id=p_product_id and id=p_release_id and archived_at is null and lifecycle='released' for share; if not found then return query select 'invalid_request',null::jsonb; return; end if; elsif p_release_id is not null or char_length(btrim(coalesce(p_audit_rationale,''))) not between 1 and 4000 then return query select 'invalid_request',null::jsonb; return; end if;
 select x.result->'technicalFile' into technical_file from public.get_technical_file(p_organization_id,p_actor_user_id,p_product_id) x where x.outcome='found';
 if technical_file is null then return query select 'not_found',null::jsonb; return; end if;
 readiness:=public.m7_evidence_readiness_json(p_organization_id,p_product_id); select t.retention into retention from public.get_product_retention_calculation(p_organization_id,p_product_id,p_actor_user_id) t where t.outcome='found'; if retention is null then return query select 'invalid_request',null::jsonb; return; end if;
 payload:=jsonb_build_object('schemaVersion','m7_04_v1','capturedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),'technicalFile',technical_file,'readiness',readiness,'riskRegister',public.m7_risk_register_json(p_organization_id,p_product_id,true),'retention',retention);
 payload_text:=payload::text; digest:=encode(extensions.digest(payload_text,'sha256'),'hex'); if octet_length(payload_text)>5242880 then return query select 'invalid_request',null::jsonb; return; end if;
 insert into public.technical_file_snapshots(organization_id,technical_file_id,product_id,release_id,purpose,audit_rationale,technical_file_version,template_key,template_version,readiness_status,payload,payload_sha256,payload_byte_length,created_by) values(p_organization_id,f.id,p_product_id,p_release_id,p_purpose,case when p_purpose='audit' then btrim(p_audit_rationale) else null end,f.version,f.template_key,f.template_version,coalesce(readiness->>'status','empty'),payload,digest,octet_length(payload_text),p_actor_user_id) returning id into snapshot_id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.snapshot_created','technical_file_snapshot',snapshot_id::text,jsonb_build_object('snapshotId',snapshot_id,'idempotencyKey',p_idempotency_key,'payloadDigest',digest)); return query select 'created',public.m7_snapshot_json(p_organization_id,snapshot_id);
end $$;

create or replace function public.create_technical_file_snapshot_export_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare s public.technical_file_snapshots%rowtype; e public.technical_file_snapshot_exports%rowtype; digest text;
begin
 if p_idempotency_key is null or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_snapshot_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0));
 select * into e from public.technical_file_snapshot_exports where organization_id=p_organization_id and requested_by=p_actor_user_id and idempotency_key=p_idempotency_key; digest:=encode(extensions.digest(jsonb_build_object('snapshotId',p_snapshot_id,'operation','export')::text,'sha256'),'hex'); if found then if e.payload_digest=digest then return query select 'replayed',public.m7_snapshot_export_json(p_organization_id,e.id); else return query select 'idempotency_conflict',null::jsonb; end if; return; end if;
 select * into s from public.technical_file_snapshots where organization_id=p_organization_id and product_id=p_product_id and id=p_snapshot_id for share; if not found then return query select 'not_found',null::jsonb; return; end if;
 insert into public.technical_file_snapshot_exports(organization_id,snapshot_id,requested_by,idempotency_key,payload_digest) values(p_organization_id,p_snapshot_id,p_actor_user_id,p_idempotency_key,digest) returning * into e;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.snapshot_export_requested','technical_file_snapshot_export',e.id::text,jsonb_build_object('snapshotId',p_snapshot_id,'exportId',e.id,'idempotencyKey',p_idempotency_key,'payloadDigest',digest)); return query select 'created',public.m7_snapshot_export_json(p_organization_id,e.id);
end $$;

create or replace function public.claim_technical_file_snapshot_export(p_worker_id uuid,p_lease_seconds integer default 120)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.technical_file_snapshot_exports%rowtype;
begin
 if p_worker_id is null or p_lease_seconds not between 30 and 900 then return query select 'invalid_request',null::jsonb; return; end if;
 select * into e from public.technical_file_snapshot_exports where status='queued' or (status='generating' and lease_expires_at<=clock_timestamp()) order by created_at,id limit 1 for update skip locked; if not found then return query select 'empty',null::jsonb; return; end if;
 update public.technical_file_snapshot_exports set status='generating',lease_owner=p_worker_id,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),attempt_count=attempt_count+1,started_at=coalesce(started_at,clock_timestamp()) where id=e.id returning * into e;
 return query select 'claimed',jsonb_build_object('export',public.m7_snapshot_export_json(e.organization_id,e.id),'snapshot',public.m7_snapshot_json(e.organization_id,e.snapshot_id));
end $$;

create or replace function public.finalize_technical_file_snapshot_export_atomic(p_organization_id uuid,p_export_id uuid,p_worker_id uuid,p_pdf_path text,p_pdf_sha256 text,p_pdf_bytes bigint,p_archive_path text,p_archive_sha256 text,p_archive_bytes bigint,p_manifest_path text,p_manifest_sha256 text,p_manifest_bytes bigint)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.technical_file_snapshot_exports%rowtype;
begin
 select * into e from public.technical_file_snapshot_exports where organization_id=p_organization_id and id=p_export_id for update; if not found then return query select 'not_found',null::jsonb; return; end if; if e.status<>'generating' or e.lease_owner<>p_worker_id or e.lease_expires_at<=clock_timestamp() then return query select 'conflict',public.m7_snapshot_export_json(p_organization_id,e.id); return; end if;
 if p_pdf_path ~ '(^|/)\\.\\.(/|$)' or p_pdf_path ~ '^/' or p_archive_path ~ '(^|/)\\.\\.(/|$)' or p_archive_path ~ '^/' or p_manifest_path ~ '(^|/)\\.\\.(/|$)' or p_manifest_path ~ '^/' or p_pdf_sha256 !~ '^[a-f0-9]{64}$' or p_archive_sha256 !~ '^[a-f0-9]{64}$' or p_manifest_sha256 !~ '^[a-f0-9]{64}$' or p_pdf_bytes not between 1 and 26214400 or p_archive_bytes not between 1 and 26214400 or p_manifest_bytes not between 1 and 1048576 then return query select 'invalid_request',null::jsonb; return; end if;
 update public.technical_file_snapshot_exports set status='ready',lease_owner=null,lease_expires_at=null,pdf_object_path=p_pdf_path,pdf_sha256=p_pdf_sha256,pdf_bytes=p_pdf_bytes,archive_object_path=p_archive_path,archive_sha256=p_archive_sha256,archive_bytes=p_archive_bytes,manifest_object_path=p_manifest_path,manifest_sha256=p_manifest_sha256,manifest_bytes=p_manifest_bytes,completed_at=clock_timestamp() where id=e.id;
 insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) values(p_organization_id,'technical_file.snapshot_export_ready','technical_file_snapshot_export',e.id::text,jsonb_build_object('exportId',e.id)); return query select 'ready',public.m7_snapshot_export_json(p_organization_id,e.id);
end $$;

create or replace function public.cancel_technical_file_snapshot_export_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_export_id uuid,p_reason text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.technical_file_snapshot_exports%rowtype; replay record;
begin
 if p_idempotency_key is null or char_length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_snapshot_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0)); select a.* into replay from public.audit_logs a where a.organization_id=p_organization_id and a.user_id=p_actor_user_id and a.changes->>'idempotencyKey'=p_idempotency_key::text order by a.created_at desc,a.id desc limit 1; if found then if replay.action='technical_file.snapshot_export_cancelled' then return query select 'replayed',public.m7_snapshot_export_json(p_organization_id,(replay.changes->>'exportId')::uuid); else return query select 'idempotency_conflict',null::jsonb; end if; return; end if;
 select e.* into e from public.technical_file_snapshot_exports e join public.technical_file_snapshots s on s.organization_id=e.organization_id and s.id=e.snapshot_id where e.organization_id=p_organization_id and e.id=p_export_id and e.snapshot_id=p_snapshot_id and s.product_id=p_product_id for update; if not found then return query select 'not_found',null::jsonb; return; end if; if e.status in ('ready','superseded','cancelled') then return query select 'conflict',public.m7_snapshot_export_json(p_organization_id,e.id); return; end if;
 update public.technical_file_snapshot_exports set status='cancelled',failure_code=null,cancellation_reason=btrim(p_reason),lease_owner=null,lease_expires_at=null,cancelled_at=clock_timestamp() where id=e.id; insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.snapshot_export_cancelled','technical_file_snapshot_export',e.id::text,jsonb_build_object('snapshotId',p_snapshot_id,'exportId',e.id,'idempotencyKey',p_idempotency_key,'reason',btrim(p_reason))); return query select 'cancelled',public.m7_snapshot_export_json(p_organization_id,e.id);
end $$;

revoke all on function public.m7_reject_technical_file_snapshot_mutation(),public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid),public.create_technical_file_snapshot_export_atomic(uuid,uuid,uuid,uuid,uuid),public.claim_technical_file_snapshot_export(uuid,integer),public.finalize_technical_file_snapshot_export_atomic(uuid,uuid,uuid,text,text,bigint,text,text,bigint,text,text,bigint),public.cancel_technical_file_snapshot_export_atomic(uuid,uuid,uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid),public.create_technical_file_snapshot_export_atomic(uuid,uuid,uuid,uuid,uuid),public.claim_technical_file_snapshot_export(uuid,integer),public.finalize_technical_file_snapshot_export_atomic(uuid,uuid,uuid,text,text,bigint,text,text,bigint,text,text,bigint),public.cancel_technical_file_snapshot_export_atomic(uuid,uuid,uuid,uuid,uuid,text,uuid) to service_role;
alter function public.m7_reject_technical_file_snapshot_mutation() owner to postgres;
alter function public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid) owner to postgres;
alter function public.create_technical_file_snapshot_export_atomic(uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function public.claim_technical_file_snapshot_export(uuid,integer) owner to postgres;
alter function public.finalize_technical_file_snapshot_export_atomic(uuid,uuid,uuid,text,text,bigint,text,text,bigint,text,text,bigint) owner to postgres;
alter function public.cancel_technical_file_snapshot_export_atomic(uuid,uuid,uuid,uuid,uuid,text,uuid) owner to postgres;
notify pgrst, 'reload schema';
