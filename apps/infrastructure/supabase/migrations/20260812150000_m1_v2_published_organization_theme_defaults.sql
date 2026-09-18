-- Align the server fallback with the dashboard theme and expose a separate
-- published-only binary-logo resolver. Draft preview behavior remains intact.
create or replace function public.m1_v2_sentinel_branding_json()
  returns jsonb
  language sql
  immutable
  set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'source', 'sentinel',
    'displayName', 'CRA Sentinel',
    'footerText', 'CRA Sentinel',
    'contactText', null,
    'palette', jsonb_build_object(
      'primary', '#595FE5', 'primaryText', '#FFFFFF',
      'secondary', '#ADB0ED', 'secondaryText', '#000000'
    ),
    'logo', null,
    'version', 0,
    'publishedAt', null,
    'updatedAt', '1970-01-01T00:00:00.000Z'
  );
$$;

create function public.get_organization_branding_published_logo_render(
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
      select versions.organization_id, versions.logo_asset_id
        from public.organization_branding_versions versions
       where versions.organization_id = p_organization_id
       order by versions.version desc
       limit 1
    ) current_version
    join public.organization_branding_assets assets
      on assets.organization_id = current_version.organization_id
     and assets.id = current_version.logo_asset_id;

  if not found or v_asset.state <> 'approved'
     or not exists (
       select 1 from storage.objects objects
        where objects.bucket_id = 'organization-branding'
          and objects.name = v_asset.object_path
     ) then
    return query select 'not_found'::text, null::text, null::text;
    return;
  end if;

  return query select 'found'::text, v_asset.object_path, v_asset.content_hash;
end;
$$;

alter function public.m1_v2_sentinel_branding_json() owner to postgres;
alter function public.get_organization_branding_published_logo_render(uuid, uuid) owner to postgres;
revoke all on function public.m1_v2_sentinel_branding_json() from public, anon, authenticated;
revoke all on function public.get_organization_branding_published_logo_render(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.get_organization_branding_published_logo_render(uuid, uuid)
  to service_role;
