create or replace function public.get_technical_file_snapshot_export_download_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_export_id uuid,p_artifact text)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_export public.technical_file_snapshot_exports%rowtype; object_path text;
begin
 if p_artifact not in ('pdf','archive','manifest') or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_snapshot_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 select export_row.* into v_export from public.technical_file_snapshot_exports export_row join public.technical_file_snapshots snapshot_row on snapshot_row.organization_id=export_row.organization_id and snapshot_row.id=export_row.snapshot_id where export_row.organization_id=p_organization_id and export_row.id=p_export_id and export_row.snapshot_id=p_snapshot_id and snapshot_row.product_id=p_product_id and export_row.status='ready';
 if not found then return query select 'not_found',null::jsonb; return; end if;
 object_path:=case p_artifact when 'pdf' then v_export.pdf_object_path when 'archive' then v_export.archive_object_path else v_export.manifest_object_path end;
 insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.snapshot_export_downloaded','technical_file_snapshot_export',v_export.id::text,jsonb_build_object('snapshotId',p_snapshot_id,'exportId',v_export.id,'artifact',p_artifact));
 return query select 'found',jsonb_build_object('objectPath',object_path);
end $$;

create or replace function public.cancel_technical_file_snapshot_export_atomic(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_export_id uuid,p_reason text,p_idempotency_key uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_export public.technical_file_snapshot_exports%rowtype; replay record;
begin
 if p_idempotency_key is null or char_length(btrim(coalesce(p_reason,''))) not between 1 and 1000 or not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_snapshot_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':'||p_actor_user_id::text||':'||p_idempotency_key::text,0)); select a.* into replay from public.audit_logs a where a.organization_id=p_organization_id and a.user_id=p_actor_user_id and a.changes->>'idempotencyKey'=p_idempotency_key::text order by a.created_at desc,a.id desc limit 1; if found then if replay.action='technical_file.snapshot_export_cancelled' then return query select 'replayed',public.m7_snapshot_export_json(p_organization_id,(replay.changes->>'exportId')::uuid); else return query select 'idempotency_conflict',null::jsonb; end if; return; end if;
 select export_row.* into v_export from public.technical_file_snapshot_exports export_row join public.technical_file_snapshots snapshot_row on snapshot_row.organization_id=export_row.organization_id and snapshot_row.id=export_row.snapshot_id where export_row.organization_id=p_organization_id and export_row.id=p_export_id and export_row.snapshot_id=p_snapshot_id and snapshot_row.product_id=p_product_id for update;
 if not found then return query select 'not_found',null::jsonb; return; end if; if v_export.status in ('ready','superseded','cancelled') then return query select 'conflict',public.m7_snapshot_export_json(p_organization_id,v_export.id); return; end if;
 update public.technical_file_snapshot_exports set status='cancelled',failure_code=null,cancellation_reason=btrim(p_reason),lease_owner=null,lease_expires_at=null,cancelled_at=clock_timestamp() where id=v_export.id; insert into public.audit_logs(organization_id,user_id,action,entity_type,entity_id,changes) values(p_organization_id,p_actor_user_id,'technical_file.snapshot_export_cancelled','technical_file_snapshot_export',v_export.id::text,jsonb_build_object('snapshotId',p_snapshot_id,'exportId',v_export.id,'idempotencyKey',p_idempotency_key,'reason',btrim(p_reason))); return query select 'cancelled',public.m7_snapshot_export_json(p_organization_id,v_export.id);
end $$;

revoke all on function public.get_technical_file_snapshot_export_download_atomic(uuid,uuid,uuid,uuid,uuid,text),public.cancel_technical_file_snapshot_export_atomic(uuid,uuid,uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.get_technical_file_snapshot_export_download_atomic(uuid,uuid,uuid,uuid,uuid,text),public.cancel_technical_file_snapshot_export_atomic(uuid,uuid,uuid,uuid,uuid,text,uuid) to service_role;
alter function public.get_technical_file_snapshot_export_download_atomic(uuid,uuid,uuid,uuid,uuid,text) owner to postgres;
alter function public.cancel_technical_file_snapshot_export_atomic(uuid,uuid,uuid,uuid,uuid,text,uuid) owner to postgres;
notify pgrst, 'reload schema';
