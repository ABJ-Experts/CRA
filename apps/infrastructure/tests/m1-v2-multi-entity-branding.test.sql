-- M1 V2 legal-entity and organization-branding database integration tests.
-- The fixture transaction rolls back, so the test is safe against a shared
-- local stack after the additive V2 migration has been applied.

\set ON_ERROR_STOP on
\timing off

create or replace function pg_temp.check(p_label text, p_ok boolean)
  returns void language plpgsql as $$
begin
  if p_ok then
    raise notice 'ok   %', p_label;
  else
    raise exception 'FAIL %', p_label;
  end if;
end;
$$;

select pg_temp.check(
  'V2 tables use RLS without force and browser roles retain no table grants',
  (select count(*) = 0
     from (values
       ('organization_legal_entities'),
       ('organization_legal_entity_create_idempotencies'),
       ('organization_legal_entity_dependency_authorities'),
       ('organization_legal_entity_dependency_facts'),
       ('organization_branding_drafts'),
       ('organization_branding_assets'),
       ('organization_branding_versions'),
       ('organization_branding_publish_idempotencies')
     ) expected(table_name)
     left join pg_class c on c.relname = expected.table_name
     left join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    where c.oid is null
       or not c.relrowsecurity
       or c.relforcerowsecurity
       or has_table_privilege('anon', c.oid, 'select')
       or has_table_privilege('authenticated', c.oid, 'select'))
);

select pg_temp.check(
  'V2 private branding bucket permits no browser storage policies',
  exists (
    select 1 from storage.buckets
     where id = 'organization-branding'
       and not public
       and file_size_limit = 2097152
  )
  and not exists (
    select 1 from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and ('anon' = any(roles) or 'authenticated' = any(roles) or 'public' = any(roles))
       and (coalesce(qual, '') like '%organization-branding%'
         or coalesce(with_check, '') like '%organization-branding%')
  )
);

select pg_temp.check(
  'legal registration/tax comparison values normalize Unicode whitespace and case',
  public.m1_v2_normalize_legal_identifier('tax' || chr(160) || ' 123') = 'TAX123'
);

select pg_temp.check(
  'V2 mutation and resolver RPCs are service-role-only security definers with pinned search paths',
  (select count(*) = 0
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'get_organization_legal_entities',
        'get_organization_legal_entity',
        'create_organization_legal_entity_atomic',
        'update_organization_legal_entity_atomic',
        'transition_organization_legal_entity_atomic',
        'resolve_active_organization_legal_entity_context',
        'reconcile_organization_legal_entity_dependencies_atomic',
        'get_organization_branding',
        'get_organization_branding_draft',
        'get_organization_branding_assets',
        'reserve_organization_branding_asset_upload_atomic',
        'finalize_organization_branding_asset_upload_atomic',
        'fail_organization_branding_asset_upload_atomic',
        'save_organization_branding_draft_atomic',
        'publish_organization_branding_atomic',
        'remove_organization_branding_logo_atomic',
        'get_organization_branding_logo_render',
        'get_organization_branding_export_snapshot'
      ])
      and (
        not p.prosecdef
        or pg_get_userbyid(p.proowner) <> 'postgres'
        or coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=public, pg_temp%'
        or has_function_privilege('public', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute')
        or has_function_privilege('authenticated', p.oid, 'execute')
        or not has_function_privilege('service_role', p.oid, 'execute')
      ))
);

begin;
do $$
declare
  v_owner uuid;
  v_other_owner uuid;
  v_org uuid;
  v_other_org uuid;
  v_legacy_org uuid;
  v_orphan_legacy_org uuid;
  v_default_entity uuid;
  v_second_entity uuid;
  v_create record;
  v_replay record;
  v_cross_tenant record;
  v_transition record;
  v_context record;
  v_branding record;
  v_draft record;
  v_asset record;
  v_draft_asset record;
  v_finalized record;
  v_published record;
  v_removed record;
  v_logo_render record;
  v_kind text;
begin
  insert into public.users (email) values ('v2-owner@integration.test')
  returning id into v_owner;
  insert into public.users (email) values ('v2-other-owner@integration.test')
  returning id into v_other_owner;

  -- An organization that predates its profile receives exactly one inactive,
  -- incomplete default entity and stays that way if the backfill is rerun.
  insert into public.organizations (name, slug)
  values ('V2 Legacy', 'v2-legacy') returning id into v_legacy_org;
  insert into public.organization_members (organization_id, user_id, role)
  values (v_legacy_org, v_owner, 'owner');
  perform public.backfill_organization_legal_entities();
  perform public.backfill_organization_legal_entities();
  perform pg_temp.check(
    'idempotent legacy backfill creates one inactive needs-completion default without invented profile fields',
    (select count(*) = 1 from public.organization_legal_entities
      where organization_id = v_legacy_org and is_default)
    and (select completion_status = 'needs_completion' and status = 'inactive'
          and legal_name is null and registered_address_line_1 is null
          and manufacturer_contact_email is null
         from public.organization_legal_entities
         where organization_id = v_legacy_org and is_default)
  );

  insert into public.organizations (name, slug)
  values ('V2 Orphan Legacy', 'v2-orphan-legacy') returning id into v_orphan_legacy_org;
  perform public.backfill_organization_legal_entities();
  perform pg_temp.check(
    'backfill never skips an orphaned legacy organization and records a system migration actor',
    exists (select 1 from public.organization_legal_entities entities
      join public.users actors on actors.id = entities.created_by
      where entities.organization_id = v_orphan_legacy_org
        and entities.is_default
        and entities.completion_status = 'needs_completion'
        and actors.email = 'system-legal-entity-backfill@cra.invalid'
        and not actors.is_active)
  );

  select * into v_create from public.create_organization_atomic(
    v_owner,
    '62000000-0000-4000-8000-000000000001',
    'V2 Legal Entity Tenant', '1 Entity Street', null, 'Dublin', null,
    'D02 X285', 'IE', 'IE', 'Entity Owner', 'v2-owner@example.test', null
  );
  v_org := v_create.organization_id;
  select id into v_default_entity from public.organization_legal_entities
   where organization_id = v_org and is_default;
  perform pg_temp.check(
    'create organization atomically includes one complete active default entity',
    v_create.outcome = 'created'
    and v_default_entity is not null
    and (select completion_status = 'complete' and status = 'active'
           from public.organization_legal_entities where id = v_default_entity)
  );

  insert into public.organizations (name, slug) values ('V2 Other', 'v2-other')
  returning id into v_other_org;
  insert into public.organization_members (organization_id, user_id, role)
  values (v_other_org, v_other_owner, 'owner');

  select * into v_create from public.create_organization_legal_entity_atomic(
    v_org, v_owner, '62000000-0000-4000-8000-000000000002',
    'ie-secondary', 'Secondary Entity', 'Secondary Legal Entity',
    '2 Entity Street', null, 'Dublin', null, 'D02 X286', 'IE', 'IE',
    'Secondary Contact', 'secondary@example.test', null, '  ie  123  ', ' tax  123 '
  );
  v_second_entity := (v_create.legal_entity->>'id')::uuid;
  perform pg_temp.check(
    'entity create normalizes organization-local identifiers and records an audit fact',
    v_create.outcome = 'created'
    and (v_create.legal_entity->>'registrationIdentifier') = 'IE123'
    and (v_create.legal_entity->>'taxIdentifier') = 'TAX123'
    and exists (select 1 from public.audit_logs where organization_id = v_org
      and action = 'organization.legal_entity_created' and entity_id = v_second_entity::text)
  );

  select * into v_replay from public.create_organization_legal_entity_atomic(
    v_org, v_owner, '62000000-0000-4000-8000-000000000002',
    'ie-secondary', 'Secondary Entity', 'Secondary Legal Entity',
    '2 Entity Street', null, 'Dublin', null, 'D02 X286', 'IE', 'IE',
    'Secondary Contact', 'secondary@example.test', null, 'IE123', 'TAX123'
  );
  perform pg_temp.check(
    'legal entity create idempotency replay has no duplicate',
    v_replay.outcome = 'replayed'
    and (v_replay.legal_entity->>'id')::uuid = v_second_entity
    and (select count(*) = 1 from public.organization_legal_entities
          where organization_id = v_org and identifier = 'ie-secondary')
  );

  select * into v_cross_tenant from public.get_organization_legal_entity(
    v_other_org, v_second_entity, v_other_owner
  );
  perform pg_temp.check(
    'cross-tenant legal entity identifiers return generic not-found',
    v_cross_tenant.outcome = 'not_found' and v_cross_tenant.legal_entity is null
  );

  select * into v_transition from public.transition_organization_legal_entity_atomic(
    v_org, v_second_entity, v_owner, 0, 'inactive'
  );
  perform pg_temp.check(
    'unreconciled dependency authorities fail closed before entity deactivation',
    v_transition.outcome = 'blocked'
    and v_transition.block_reason = 'dependency_authority_unavailable'
  );

  foreach v_kind in array array['product', 'report', 'obligation', 'legal_hold', 'retention'] loop
    perform public.reconcile_organization_legal_entity_dependencies_atomic(
      v_org, v_second_entity, v_owner, v_kind, true, '[]'::jsonb
    );
  end loop;
  perform public.reconcile_organization_legal_entity_dependencies_atomic(
    v_org, v_second_entity, v_owner, 'product', true,
    jsonb_build_array(jsonb_build_object('recordId', gen_random_uuid(), 'count', 1))
  );
  select * into v_transition from public.transition_organization_legal_entity_atomic(
    v_org, v_second_entity, v_owner, 0, 'inactive'
  );
  perform pg_temp.check(
    'active product dependency blocks lifecycle with a specific reason',
    v_transition.outcome = 'blocked' and v_transition.block_reason = 'active_products'
  );
  perform public.reconcile_organization_legal_entity_dependencies_atomic(
    v_org, v_second_entity, v_owner, 'product', true, '[]'::jsonb
  );
  select * into v_transition from public.transition_organization_legal_entity_atomic(
    v_org, v_second_entity, v_owner, 0, 'inactive'
  );
  perform pg_temp.check(
    'entity lifecycle transition is optimistic, authorized, and audited after dependencies clear',
    v_transition.outcome = 'transitioned'
    and v_transition.legal_entity->>'status' = 'inactive'
    and exists (select 1 from public.audit_logs where organization_id = v_org
      and action = 'organization.legal_entity_lifecycle_changed')
  );

  select * into v_context from public.resolve_active_organization_legal_entity_context(v_org, v_second_entity);
  perform pg_temp.check(
    'inactive legal entity context is not usable by future product/report owners',
    v_context.outcome = 'inactive' and v_context.context is null
  );

  select * into v_branding from public.get_organization_branding(v_org, v_owner);
  perform pg_temp.check(
    'unpublished branding resolves to the immutable CRA Sentinel fallback',
    v_branding.outcome = 'found'
    and v_branding.branding->>'source' = 'sentinel'
    and v_branding.branding->>'displayName' = 'CRA Sentinel'
    and v_branding.branding->>'version' = '0'
  );

  select * into v_draft from public.save_organization_branding_draft_atomic(
    v_org, v_owner, 0, 'V2 Supplier Portal', '#0167FF', '#00A39B',
    'V2 Supplier Portal', 'Contact V2 support', null
  );
  select * into v_asset from public.reserve_organization_branding_asset_upload_atomic(
    v_org, v_owner, 'V2 logo'
  );
  insert into storage.objects (bucket_id, name)
  values ('organization-branding', v_asset.object_key || repeat('a', 64) || '.webp');
  select * into v_finalized from public.finalize_organization_branding_asset_upload_atomic(
    v_org, v_asset.asset_id, v_owner, repeat('a', 64), 4096, 64, 64, 'scanner_not_available'
  );
  select * into v_published from public.publish_organization_branding_atomic(
    v_org, v_owner, (v_finalized.draft->>'version')::integer,
    '62000000-0000-4000-8000-000000000003', repeat('b', 64)
  );
  perform pg_temp.check(
    'approved private raster asset and accessible draft publish one immutable branding version',
    v_finalized.outcome = 'finalized'
    and v_published.outcome = 'published'
    and v_published.branding->>'source' = 'published'
    and v_published.branding#>>'{logo,mimeType}' = 'image/webp'
    and not (v_published.branding::text like '%objectPath%')
    and exists (select 1 from public.organization_branding_versions where organization_id = v_org and version = 1)
  );

  select * into v_draft_asset from public.reserve_organization_branding_asset_upload_atomic(
    v_org, v_owner, 'V2 replacement draft logo'
  );
  insert into storage.objects (bucket_id, name)
  values ('organization-branding', v_draft_asset.object_key || repeat('d', 64) || '.webp');
  select * into v_finalized from public.finalize_organization_branding_asset_upload_atomic(
    v_org, v_draft_asset.asset_id, v_owner, repeat('d', 64), 4096, 64, 64, 'clean'
  );
  select * into v_logo_render from public.get_organization_branding_logo_render(v_org, v_owner);
  perform pg_temp.check(
    'authenticated raster rendering selects the approved draft logo before the immutable published logo',
    v_finalized.outcome = 'finalized'
    and v_finalized.draft#>>'{logoAsset,asset,assetId}' = v_draft_asset.asset_id::text
    and v_logo_render.outcome = 'found'
    and v_logo_render.object_key = v_draft_asset.object_key || repeat('d', 64) || '.webp'
    and v_logo_render.sha256 = repeat('d', 64)
  );

  select * into v_removed from public.remove_organization_branding_logo_atomic(
    v_org, v_owner, (v_published.branding->>'version')::integer,
    '62000000-0000-4000-8000-000000000004', repeat('c', 64)
  );
  perform pg_temp.check(
    'logo removal publishes a new presentation-only version without mutating the old snapshot',
    v_removed.outcome = 'removed'
    and v_removed.branding->'logo' = 'null'::jsonb
    and (select logo_asset_id is not null from public.organization_branding_versions
          where organization_id = v_org and version = 1)
    and (select logo_asset_id is null from public.organization_branding_versions
          where organization_id = v_org and version = 2)
  );
end
$$;
rollback;

select 'M1 V2 multi-entity/branding integration: ALL CHECKS PASSED' as result;
