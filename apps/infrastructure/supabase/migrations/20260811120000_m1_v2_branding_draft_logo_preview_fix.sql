-- An upload that passes byte inspection and scanner policy is the owner's new
-- draft selection. Published branding remains immutable; this only changes
-- draft state and the private, authenticated preview resolver.
create or replace function public.finalize_organization_branding_asset_upload_atomic(
  p_organization_id uuid,
  p_asset_id uuid,
  p_actor_user_id uuid,
  p_content_hash text,
  p_input_bytes integer,
  p_width integer,
  p_height integer,
  p_scanner_status text
)
  returns table (outcome text, draft jsonb, branding jsonb)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare
  v_asset public.organization_branding_assets%rowtype;
  v_draft public.organization_branding_drafts%rowtype;
  v_object_path text;
begin
  if not public.m1_v2_is_active_organization_owner(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::jsonb, null::jsonb;
    return;
  end if;
  select * into v_asset from public.organization_branding_assets assets
   where assets.organization_id = p_organization_id and assets.id = p_asset_id
   for update;
  if not found then
    return query select 'not_found'::text, null::jsonb, null::jsonb;
    return;
  end if;
  if v_asset.state <> 'reserved'
     or p_content_hash !~ '^[0-9a-f]{64}$'
     or p_input_bytes not between 1 and 2097152
     or p_width not between 64 and 2048
     or p_height not between 64 and 2048
     or p_width * p_height > 16000000
     or p_scanner_status not in ('clean', 'scanner_not_available') then
    return query select 'invalid_request'::text, null::jsonb, null::jsonb;
    return;
  end if;
  v_object_path := p_organization_id::text || '/' || p_asset_id::text || '/' || p_content_hash || '.webp';
  if not exists (
    select 1 from storage.objects objects
     where objects.bucket_id = 'organization-branding' and objects.name = v_object_path
  ) then
    return query select 'invalid_request'::text, null::jsonb, null::jsonb;
    return;
  end if;
  select * into v_draft from public.organization_branding_drafts drafts
   where drafts.organization_id = p_organization_id
   for update;
  if not found then
    return query select 'invalid_request'::text, null::jsonb, null::jsonb;
    return;
  end if;
  update public.organization_branding_assets
     set state = 'approved', source_mime_type = 'image/webp',
         normalized_mime_type = 'image/webp', content_hash = p_content_hash,
         object_path = v_object_path, input_bytes = p_input_bytes,
         width = p_width, height = p_height, scanner_status = p_scanner_status,
         failure_code = null, updated_by = p_actor_user_id
   where id = p_asset_id;
  update public.organization_branding_drafts
     set logo_asset_id = p_asset_id,
         version = v_draft.version + 1,
         updated_by = p_actor_user_id
   where organization_id = p_organization_id;
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'organization.branding_asset_approved',
    'organization_branding_asset', p_asset_id::text,
    jsonb_build_object(
      'before', jsonb_build_object('state', v_asset.state),
      'after', jsonb_build_object(
        'state', 'approved', 'sha256', p_content_hash,
        'width', p_width, 'height', p_height, 'scannerStatus', p_scanner_status
      )
    )
  );
  insert into public.audit_logs (organization_id, user_id, action, entity_type, entity_id, changes)
  values (
    p_organization_id, p_actor_user_id, 'organization.branding_draft_logo_selected',
    'organization_branding_draft', v_draft.id::text,
    jsonb_build_object(
      'before', jsonb_build_object(
        'logoAssetId', v_draft.logo_asset_id,
        'version', v_draft.version
      ),
      'after', jsonb_build_object(
        'logoAssetId', p_asset_id,
        'version', v_draft.version + 1
      )
    )
  );
  return query select 'finalized'::text,
    public.m1_v2_branding_draft_json(p_organization_id),
    public.m1_v2_branding_draft_preview_json(p_organization_id);
end;
$$;

-- This resolver is used only by the authenticated API binary endpoint. It
-- resolves the current approved draft asset first, then the published asset
-- only when the draft has no selected logo. It intentionally remains separate
-- from presentation JSON so storage paths cannot reach React, supplier portal
-- markup, exports, or document templates.
create or replace function public.get_organization_branding_logo_render(
  p_organization_id uuid,
  p_actor_user_id uuid
)
  returns table (outcome text, object_key text, sha256 text)
  language plpgsql
  security definer
  set search_path = public, pg_temp
as $$
declare v_asset public.organization_branding_assets%rowtype;
begin
  if not public.m1_v2_is_active_organization_member(p_organization_id, p_actor_user_id) then
    return query select 'not_found'::text, null::text, null::text;
    return;
  end if;
  select assets.* into v_asset
    from (
      select drafts.organization_id, drafts.logo_asset_id, 0 as priority
        from public.organization_branding_drafts drafts
       where drafts.organization_id = p_organization_id
      union all
      select current_version.organization_id, current_version.logo_asset_id, 1 as priority
        from (
          select versions.organization_id, versions.logo_asset_id
            from public.organization_branding_versions versions
           where versions.organization_id = p_organization_id
           order by versions.version desc
           limit 1
        ) current_version
    ) selected_logo
    join public.organization_branding_assets assets
      on assets.organization_id = selected_logo.organization_id
     and assets.id = selected_logo.logo_asset_id
   where selected_logo.logo_asset_id is not null
   order by selected_logo.priority
   limit 1;
  if not found or v_asset.state <> 'approved'
     or not exists (select 1 from storage.objects objects
       where objects.bucket_id = 'organization-branding' and objects.name = v_asset.object_path) then
    return query select 'not_found'::text, null::text, null::text;
    return;
  end if;
  return query select 'found'::text, v_asset.object_path, v_asset.content_hash;
end;
$$;

alter function public.finalize_organization_branding_asset_upload_atomic(
  uuid, uuid, uuid, text, integer, integer, integer, text
) owner to postgres;
alter function public.get_organization_branding_logo_render(uuid, uuid) owner to postgres;
revoke all on function public.finalize_organization_branding_asset_upload_atomic(
  uuid, uuid, uuid, text, integer, integer, integer, text
) from public, anon, authenticated;
revoke all on function public.get_organization_branding_logo_render(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finalize_organization_branding_asset_upload_atomic(
  uuid, uuid, uuid, text, integer, integer, integer, text
) to service_role;
grant execute on function public.get_organization_branding_logo_render(uuid, uuid) to service_role;
