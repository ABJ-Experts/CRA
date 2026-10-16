create or replace function public.preview_technical_file_auditor_snapshot_grant(p_organization_id uuid,p_actor_user_id uuid,p_product_id uuid,p_snapshot_id uuid,p_export_id uuid)
returns table(outcome text,result jsonb) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_snapshot public.technical_file_snapshots%rowtype; v_export public.technical_file_snapshot_exports%rowtype;
begin
 if not public.m7_technical_file_actor_can(p_organization_id,p_actor_user_id,'can_share_technical_files') then return query select 'forbidden',null::jsonb; return; end if;
 select * into v_snapshot from public.technical_file_snapshots where organization_id=p_organization_id and product_id=p_product_id and id=p_snapshot_id for share;
 select * into v_export from public.technical_file_snapshot_exports where organization_id=p_organization_id and snapshot_id=p_snapshot_id and id=p_export_id and status='ready' for share;
 if not found or v_snapshot.id is null then return query select 'not_found',null::jsonb; return; end if;
 return query select 'found',jsonb_build_object('snapshotId',v_snapshot.id,'snapshotSourceDate',public.m7_snapshot_timestamp_utc(v_snapshot.created_at),'snapshotRevision',v_snapshot.technical_file_version,'snapshotStatus',v_snapshot.status,'snapshotSha256',v_snapshot.payload_sha256,'export',public.m7_snapshot_export_json(p_organization_id,v_export.id),'maxExpiresAt',public.m7_snapshot_timestamp_utc(clock_timestamp()+interval '30 days'));
end $$;
revoke all on function public.preview_technical_file_auditor_snapshot_grant(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.preview_technical_file_auditor_snapshot_grant(uuid,uuid,uuid,uuid,uuid) to service_role;
alter function public.preview_technical_file_auditor_snapshot_grant(uuid,uuid,uuid,uuid,uuid) owner to postgres;
