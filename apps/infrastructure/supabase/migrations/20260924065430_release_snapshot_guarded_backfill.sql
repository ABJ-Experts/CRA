-- Repair one known local release created with an empty legal-entity snapshot.
-- The product was created in the same transaction against the same entity
-- version and retained the complete source snapshot. Never infer legal text.
do $$
declare
  v_release public.product_releases%rowtype;
  v_product public.products%rowtype;
  v_entity public.organization_legal_entities%rowtype;
  v_updated integer;
begin
  select * into v_release from public.product_releases
    where id = '90100000-0000-4000-8000-000000000002'::uuid
    for update;
  if not found then return; end if;

  if v_release.legal_entity_snapshot <> '{}'::jsonb then
    if jsonb_typeof(v_release.legal_entity_snapshot) = 'object'
      and nullif(btrim(v_release.legal_entity_snapshot ->> 'identifier'), '') is not null
      and nullif(btrim(v_release.legal_entity_snapshot ->> 'legalName'), '') is not null
      and nullif(btrim(v_release.legal_entity_snapshot ->> 'mainEstablishmentCountry'), '') is not null
    then return; end if;
    raise exception 'release snapshot repair refused: unexpected target content';
  end if;

  select * into v_product from public.products
    where organization_id = v_release.organization_id and id = v_release.product_id;
  select * into v_entity from public.organization_legal_entities
    where organization_id = v_release.organization_id and id = v_release.legal_entity_id;
  if v_product.id is null or v_entity.id is null
    or v_product.legal_entity_id is distinct from v_release.legal_entity_id
    or v_product.legal_entity_version is distinct from v_release.legal_entity_version
    or v_entity.version is distinct from v_release.legal_entity_version
    or v_product.created_at > v_release.created_at
    or v_entity.updated_at > v_release.created_at
    or jsonb_typeof(v_product.legal_entity_snapshot) is distinct from 'object'
    or v_product.legal_entity_snapshot ->> 'id' is distinct from v_entity.id::text
    or nullif(btrim(v_product.legal_entity_snapshot ->> 'identifier'), '') is null
    or nullif(btrim(v_product.legal_entity_snapshot ->> 'legalName'), '') is null
    or nullif(btrim(v_product.legal_entity_snapshot ->> 'mainEstablishmentCountry'), '') is null
  then
    raise exception 'release snapshot repair refused: source identity, edition, time, or text mismatch';
  end if;

  update public.product_releases
    set legal_entity_snapshot = v_product.legal_entity_snapshot,
        version = version + 1,
        updated_at = clock_timestamp()
    where id = v_release.id and legal_entity_snapshot = '{}'::jsonb;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'release snapshot repair refused: concurrent change'; end if;

  insert into public.audit_logs(organization_id, action, entity_type, entity_id, changes)
  values (
    v_release.organization_id,
    'product.release_legal_entity_snapshot_backfilled',
    'product_release', v_release.id::text,
    jsonb_build_object(
      'sourceProductId', v_product.id,
      'legalEntityId', v_entity.id,
      'legalEntityVersion', v_entity.version,
      'releaseVersionBefore', v_release.version,
      'releaseVersionAfter', v_release.version + 1,
      'sourceSnapshotSha256', encode(extensions.digest(v_product.legal_entity_snapshot::text, 'sha256'), 'hex')
    )
  );
end;
$$;
