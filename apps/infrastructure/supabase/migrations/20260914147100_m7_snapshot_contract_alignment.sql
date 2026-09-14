-- Keep the durable M7-04 records aligned with the strict shared wire contract.
alter table public.technical_file_snapshots
  add column status text not null default 'current' check (status in ('current','superseded')),
  add column payload_byte_length integer not null default 1 check (payload_byte_length between 1 and 5242880);
alter table public.technical_file_snapshots
  add constraint technical_file_snapshots_supersession_state_check check ((status='superseded')=(superseded_by_snapshot_id is not null));

alter table public.technical_file_snapshot_exports
  add column cancellation_reason text check (cancellation_reason is null or (cancellation_reason=btrim(cancellation_reason) and char_length(cancellation_reason) between 1 and 1000));
alter table public.technical_file_snapshot_exports drop constraint technical_file_snapshot_exports_archive_bytes_check;
alter table public.technical_file_snapshot_exports drop constraint technical_file_snapshot_exports_pdf_bytes_check;
alter table public.technical_file_snapshot_exports add constraint technical_file_snapshot_exports_archive_bytes_check check (archive_bytes is null or archive_bytes between 1 and 26214400);
alter table public.technical_file_snapshot_exports add constraint technical_file_snapshot_exports_pdf_bytes_check check (pdf_bytes is null or pdf_bytes between 1 and 26214400);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('technical-file-snapshot-exports','technical-file-snapshot-exports',false,26214400,array['application/pdf','application/zip','application/json'])
on conflict (id) do update set public=false,file_size_limit=26214400,allowed_mime_types=excluded.allowed_mime_types;

create or replace function public.m7_snapshot_json(p_organization_id uuid,p_snapshot_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('id',s.id,'organizationId',s.organization_id,'technicalFileId',s.technical_file_id,'productId',s.product_id,'technicalFileVersion',s.technical_file_version,'releaseId',s.release_id,'purpose',s.purpose,'auditRationale',s.audit_rationale,'templateKey',s.template_key,'templateVersion',s.template_version,'readinessStatus',s.readiness_status,'payload',s.payload,'payloadByteLength',s.payload_byte_length,'payloadSha256',s.payload_sha256,'status',s.status,'supersededBySnapshotId',s.superseded_by_snapshot_id,'createdByUserId',s.created_by,'createdAt',to_char(s.created_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')) from public.technical_file_snapshots s where s.organization_id=p_organization_id and s.id=p_snapshot_id
$$;

create or replace function public.m7_snapshot_export_json(p_organization_id uuid,p_export_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object('id',e.id,'snapshotId',e.snapshot_id,'status',e.status,'failureCode',case e.failure_code when 'object_write_failed' then 'storage_unavailable' when 'renderer_failed' then 'unknown' when 'cancelled' then null else e.failure_code end,'cancellationReason',e.cancellation_reason,'artifacts',case when e.status='ready' then jsonb_build_array(jsonb_build_object('kind','pdf','fileName','technical-file.pdf','mimeType','application/pdf','byteLength',e.pdf_bytes,'sha256',e.pdf_sha256,'generatedAt',to_char(e.completed_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),jsonb_build_object('kind','archive','fileName','technical-file-archive.zip','mimeType','application/zip','byteLength',e.archive_bytes,'sha256',e.archive_sha256,'generatedAt',to_char(e.completed_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')),jsonb_build_object('kind','manifest','fileName','manifest.json','mimeType','application/json','byteLength',e.manifest_bytes,'sha256',e.manifest_sha256,'generatedAt',to_char(e.completed_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'))) else '[]'::jsonb end,'manifestSha256',case when e.status='ready' then e.manifest_sha256 else null end,'idempotencyKey',e.idempotency_key,'createdAt',to_char(e.created_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),'startedAt',case when e.started_at is null then null else to_char(e.started_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') end,'completedAt',case when e.completed_at is null then null else to_char(e.completed_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') end) from public.technical_file_snapshot_exports e where e.organization_id=p_organization_id and e.id=p_export_id
$$;

create or replace function public.get_technical_file_snapshots(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_view_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 return query select 'found',jsonb_build_object('snapshots',coalesce((select jsonb_agg(public.m7_snapshot_json(p_organization_id,s.id) order by s.created_at desc,s.id desc) from public.technical_file_snapshots s where s.organization_id=p_organization_id and s.product_id=p_product_id),'[]'::jsonb));
end $$;

create or replace function public.get_technical_file_snapshot(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_view_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 if not exists(select 1 from public.technical_file_snapshots where organization_id=p_organization_id and product_id=p_product_id and id=p_snapshot_id) then return query select 'not_found',null::jsonb; return; end if;
 return query select 'found',jsonb_build_object('snapshot',public.m7_snapshot_json(p_organization_id,p_snapshot_id));
end $$;

create or replace function public.get_technical_file_snapshot_export(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_export_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_view_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 if not exists(select 1 from public.technical_file_snapshot_exports e join public.technical_file_snapshots s on s.organization_id=e.organization_id and s.id=e.snapshot_id where e.organization_id=p_organization_id and e.id=p_export_id and e.snapshot_id=p_snapshot_id and s.product_id=p_product_id) then return query select 'not_found',null::jsonb; return; end if;
 return query select 'found',jsonb_build_object('export',public.m7_snapshot_export_json(p_organization_id,p_export_id));
end $$;

create or replace function public.cancel_technical_file_snapshot_export_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_export_id uuid,p_reason text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.technical_file_snapshot_exports%rowtype;
begin
 if p_idempotency_key is null or char_length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_snapshot_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 select e.* into e from public.technical_file_snapshot_exports e join public.technical_file_snapshots s on s.organization_id=e.organization_id and s.id=e.snapshot_id where e.organization_id=p_organization_id and e.id=p_export_id and e.snapshot_id=p_snapshot_id and s.product_id=p_product_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if e.status in ('ready','superseded','cancelled') then return query select 'conflict',public.m7_snapshot_export_json(p_organization_id,e.id); return; end if;
 update public.technical_file_snapshot_exports set status='cancelled',failure_code=null,cancellation_reason=btrim(p_reason),lease_owner=null,lease_expires_at=null,cancelled_at=clock_timestamp() where id=e.id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.snapshot_export_cancelled','technical_file_snapshot_export',e.id::text,jsonb_build_object('snapshotId',p_snapshot_id,'exportId',e.id,'idempotencyKey',p_idempotency_key,'reason',btrim(p_reason)));
 return query select 'cancelled',public.m7_snapshot_export_json(p_organization_id,e.id);
end $$;

create or replace function public.fail_technical_file_snapshot_export_atomic(p_organization_id uuid,p_export_id uuid,p_worker_id uuid,p_failure_code text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare e public.technical_file_snapshot_exports%rowtype;
begin
 if p_failure_code not in ('snapshot_unavailable','artifact_too_large','storage_unavailable','source_unavailable','worker_unavailable','unknown') then return query select 'invalid_request',null::jsonb; return; end if;
 select * into e from public.technical_file_snapshot_exports where organization_id=p_organization_id and id=p_export_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if e.status<>'generating' or e.lease_owner<>p_worker_id then return query select 'conflict',public.m7_snapshot_export_json(p_organization_id,e.id); return; end if;
 update public.technical_file_snapshot_exports set status='failed',lease_owner=null,lease_expires_at=null,failure_code=p_failure_code where id=e.id;
 insert into public.audit_logs(organization_id,action,entity_type,entity_id,changes) values(p_organization_id,'technical_file.snapshot_export_failed','technical_file_snapshot_export',e.id::text,jsonb_build_object('exportId',e.id,'failureCode',p_failure_code));
 return query select 'failed',public.m7_snapshot_export_json(p_organization_id,e.id);
end $$;

create or replace function public.create_technical_file_snapshot_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_expected_technical_file_version integer,p_purpose text,p_release_id uuid,p_audit_rationale text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.technical_files%rowtype; r public.product_releases%rowtype; snapshot_id uuid; payload jsonb; payload_text text; digest text; replay record; readiness jsonb; retention jsonb;
begin
 if p_purpose not in ('release','audit') or p_expected_technical_file_version < 1 or p_idempotency_key is null or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_snapshot_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 select a.* into replay from public.audit_logs a where a.organization_id=p_organization_id and a.user_id=p_actor_user_id and a.changes->>'idempotencyKey'=p_idempotency_key::text order by a.created_at desc,a.id desc limit 1;
 if found then if replay.action='technical_file.snapshot_created' then return query select 'replayed',public.m7_snapshot_json(p_organization_id,(replay.changes->>'snapshotId')::uuid); else return query select 'idempotency_conflict',null::jsonb; end if; return; end if;
 select * into f from public.technical_files where organization_id=p_organization_id and product_id=p_product_id and status='active' for update;
 if not found then return query select 'not_found',null::jsonb; return; end if;
 if f.version<>p_expected_technical_file_version then return query select 'conflict',jsonb_build_object('currentVersion',f.version); return; end if;
 perform 1 from public.technical_file_sections where organization_id=p_organization_id and technical_file_id=f.id order by sort_order,id for share;
 perform 1 from public.technical_file_section_sources x join public.technical_file_sections s on s.organization_id=x.organization_id and s.id=x.section_id where x.organization_id=p_organization_id and s.technical_file_id=f.id for share;
 perform 1 from public.technical_file_risks q join public.technical_file_risk_registers rr on rr.organization_id=q.organization_id and rr.id=q.risk_register_id where q.organization_id=p_organization_id and rr.technical_file_id=f.id for share;
 if p_purpose='release' then select * into r from public.product_releases where organization_id=p_organization_id and product_id=p_product_id and id=p_release_id and archived_at is null and lifecycle='released' for share; if not found then return query select 'invalid_request',null::jsonb; return; end if; elsif p_release_id is not null or char_length(btrim(coalesce(p_audit_rationale,''))) not between 1 and 4000 then return query select 'invalid_request',null::jsonb; return; end if;
 readiness:=public.m7_evidence_readiness_json(p_organization_id,p_product_id);
 select t.retention into retention from public.get_product_retention_calculation(p_organization_id,p_product_id,p_actor_user_id) t where t.outcome='found';
 if retention is null then return query select 'invalid_request',null::jsonb; return; end if;
 payload:=jsonb_build_object('schemaVersion','m7_04_v1','capturedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"'),'technicalFile',(select x.result->'technicalFile' from public.get_technical_file(p_organization_id,p_product_id,p_actor_user_id) x limit 1),'readiness',readiness,'riskRegister',public.m7_risk_register_json(p_organization_id,p_product_id,true),'retention',retention);
 payload_text:=payload::text; digest:=encode(extensions.digest(payload_text,'sha256'),'hex');
 if octet_length(payload_text)>5242880 then return query select 'invalid_request',null::jsonb; return; end if;
 insert into public.technical_file_snapshots(organization_id,technical_file_id,product_id,release_id,purpose,audit_rationale,technical_file_version,template_key,template_version,readiness_status,payload,payload_sha256,payload_byte_length,created_by) values(p_organization_id,f.id,p_product_id,p_release_id,p_purpose,case when p_purpose='audit' then btrim(p_audit_rationale) else null end,f.version,f.template_key,f.template_version,coalesce(readiness->>'status','empty'),payload,digest,octet_length(payload_text),p_actor_user_id) returning id into snapshot_id;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.snapshot_created','technical_file_snapshot',snapshot_id::text,jsonb_build_object('snapshotId',snapshot_id,'idempotencyKey',p_idempotency_key,'payloadDigest',digest));
 return query select 'created',public.m7_snapshot_json(p_organization_id,snapshot_id);
end $$;

revoke all on function public.m7_snapshot_json(uuid,uuid),public.m7_snapshot_export_json(uuid,uuid),public.get_technical_file_snapshots(uuid,uuid,uuid),public.get_technical_file_snapshot(uuid,uuid,uuid,uuid),public.get_technical_file_snapshot_export(uuid,uuid,uuid,uuid,uuid),public.cancel_technical_file_snapshot_export_atomic(uuid,uuid,uuid,uuid,uuid,text,uuid),public.fail_technical_file_snapshot_export_atomic(uuid,uuid,uuid,text),public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.m7_snapshot_json(uuid,uuid),public.m7_snapshot_export_json(uuid,uuid),public.get_technical_file_snapshots(uuid,uuid,uuid),public.get_technical_file_snapshot(uuid,uuid,uuid,uuid),public.get_technical_file_snapshot_export(uuid,uuid,uuid,uuid,uuid),public.cancel_technical_file_snapshot_export_atomic(uuid,uuid,uuid,uuid,uuid,text,uuid),public.fail_technical_file_snapshot_export_atomic(uuid,uuid,uuid,text),public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid) to service_role;
alter function public.m7_snapshot_json(uuid,uuid) owner to postgres;
alter function public.m7_snapshot_export_json(uuid,uuid) owner to postgres;
alter function public.get_technical_file_snapshots(uuid,uuid,uuid) owner to postgres;
alter function public.get_technical_file_snapshot(uuid,uuid,uuid,uuid) owner to postgres;
alter function public.get_technical_file_snapshot_export(uuid,uuid,uuid,uuid,uuid) owner to postgres;
alter function public.cancel_technical_file_snapshot_export_atomic(uuid,uuid,uuid,uuid,uuid,text,uuid) owner to postgres;
alter function public.fail_technical_file_snapshot_export_atomic(uuid,uuid,uuid,text) owner to postgres;
alter function public.create_technical_file_snapshot_atomic(uuid,uuid,uuid,integer,text,uuid,text,uuid) owner to postgres;
notify pgrst, 'reload schema';
