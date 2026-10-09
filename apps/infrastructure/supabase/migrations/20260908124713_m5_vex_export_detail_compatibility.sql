-- M5-06 compatibility correction. Existing local databases may already have
-- the initial export migration; add the previously omitted detail projection
-- and retain a byte-size check at the private-download boundary.

create or replace function public.get_vulnerability_vex_export_snapshot(
  p_organization_id uuid, p_actor_user_id uuid, p_snapshot_id uuid
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.m5_triage_actor_has_permission(
    p_organization_id, p_actor_user_id, 'can_export_findings'
  ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  if not exists (
    select 1 from public.vulnerability_vex_export_snapshots snapshots
    where snapshots.organization_id = p_organization_id
      and snapshots.id = p_snapshot_id
  ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  return query select 'found'::text,
    public.m5_vex_export_snapshot_json(p_organization_id, p_snapshot_id);
end;
$$;

create or replace function public.get_vulnerability_vex_export_storage_locator(
  p_organization_id uuid, p_actor_user_id uuid, p_snapshot_id uuid
) returns table(outcome text, result jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_snapshot public.vulnerability_vex_export_snapshots%rowtype;
begin
  if not public.m5_triage_actor_has_permission(
    p_organization_id, p_actor_user_id, 'can_export_findings'
  ) then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  select * into v_snapshot
  from public.vulnerability_vex_export_snapshots snapshots
  where snapshots.organization_id = p_organization_id
    and snapshots.id = p_snapshot_id;
  if not found then
    return query select 'not_found'::text, null::jsonb;
    return;
  end if;

  return query select 'found'::text, jsonb_build_object(
    'storageBucket', v_snapshot.storage_bucket,
    'storageObjectPath', v_snapshot.storage_object_path,
    'contentSha256', v_snapshot.content_sha256,
    'byteSize', v_snapshot.content_bytes,
    'format', v_snapshot.export_format
  );
end;
$$;

alter function public.get_vulnerability_vex_export_snapshot(uuid,uuid,uuid)
  owner to postgres;
alter function public.get_vulnerability_vex_export_storage_locator(uuid,uuid,uuid)
  owner to postgres;

revoke all on function public.get_vulnerability_vex_export_snapshot(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.get_vulnerability_vex_export_snapshot(uuid,uuid,uuid)
  to service_role;
