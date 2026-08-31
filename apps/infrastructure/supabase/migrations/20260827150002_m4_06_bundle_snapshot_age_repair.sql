-- Clamp provider-controlled source timestamps in the import status projection
-- so future or malformed timestamps cannot overflow the age receipt.
create or replace function public.vulnerability_offline_bundle_import_json(p_import_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select case when imports.id is null then null else jsonb_build_object(
    'id', imports.id,
    'status', case imports.status
      when 'staging' then 'awaiting_confirmation'
      when 'promoting' then 'promoting'
      when 'completed' then 'completed'
      when 'rejected' then 'rejected'
      else 'failed' end,
    'bundleSha256', imports.manifest_sha256,
    'manifest', imports.signed_manifest,
    'signature', imports.verification_receipt,
    'compatibility', jsonb_build_object('status', 'compatible', 'reason', null),
    'estimatedChanges', jsonb_build_object(
      'recordsToCreate', 0,
      'recordsToUpdate', 0,
      'recordsToWithdraw', 0
    ),
    'sourceSnapshotAt', (select max(runs.source_snapshot_at) from public.vulnerability_feed_sync_runs runs
      where runs.bundle_import_id = imports.id),
    'sourceSnapshotAgeSeconds', (select least(2147483647::numeric,
      greatest(0::numeric, extract(epoch from clock_timestamp() - max(runs.source_snapshot_at))))::integer
      from public.vulnerability_feed_sync_runs runs where runs.bundle_import_id = imports.id),
    'failureCode', case imports.failure_code
      when 'rollback_rejected' then 'bundle_rollback_rejected'
      when 'incompatible_version' then 'compatibility_incompatible'
      when 'insufficient_storage' then 'disk_capacity_unavailable'
      when 'invalid_manifest' then 'manifest_invalid'
      when 'payload_hash_mismatch' then 'payload_hash_mismatch'
      when 'payload_inventory_invalid' then 'payload_inventory_invalid'
      when 'invalid_signature' then 'signature_invalid'
      when 'untrusted_key' then 'untrusted_key'
      when 'key_revoked' then 'untrusted_key'
      when 'key_expired' then 'untrusted_key'
      else case when imports.failure_code is null then null else 'unknown' end end,
    'createdAt', imports.created_at,
    'updatedAt', imports.updated_at,
    'completedAt', imports.completed_at,
    'runs', coalesce((select jsonb_agg(jsonb_build_object(
      'id', runs.id,
      'feedKey', runs.feed_key
    ) order by runs.feed_key) from public.vulnerability_feed_sync_runs runs
      where runs.bundle_import_id = imports.id), '[]'::jsonb)
  ) end
  from public.vulnerability_offline_bundle_imports imports where imports.id = p_import_id;
$$;

alter function public.vulnerability_offline_bundle_import_json(uuid) owner to postgres;
revoke all on function public.vulnerability_offline_bundle_import_json(uuid) from public, anon, authenticated;
grant execute on function public.vulnerability_offline_bundle_import_json(uuid) to service_role;
