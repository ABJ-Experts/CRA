begin;

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'check failed: %', p_name; end if;
end $$;

do $$
declare
  v_org uuid := '00000000-0000-4000-8000-0000000000ca';
  v_actor uuid;
  v_entity uuid;
  v_product uuid;
  v_release uuid;
  v_credential uuid := gen_random_uuid();
  v_prefix text := 'cra_sbom_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_token_salt text := 'm13-salt-' || repeat('s', 24);
  v_token_hash text := repeat('a', 64);
  v_quality_version integer;
  v_review uuid := gen_random_uuid();
  v_conflict uuid := gen_random_uuid();
  v_relationship uuid := gen_random_uuid();
  v_result record;
begin
  select id into strict v_actor from public.users where email = 'owner@cra.test';
  select id into strict v_entity from public.organization_legal_entities
    where organization_id = v_org and is_default;

  insert into public.products(id, organization_id, legal_entity_id, legal_entity_version,
    legal_entity_snapshot, name, internal_code, product_type, responsible_owner_id, created_by, updated_by)
  values(gen_random_uuid(), v_org, v_entity, 0, '{}'::jsonb, 'M13 SBOM audit product',
    'M13-SBOM-' || substr(gen_random_uuid()::text, 1, 8), 'standalone_software', v_actor, v_actor, v_actor)
  returning id into v_product;
  insert into public.product_releases(id, organization_id, product_id, legal_entity_id,
    legal_entity_version, legal_entity_snapshot, label, release_version, lifecycle, created_by, updated_by)
  values(gen_random_uuid(), v_org, v_product, v_entity, 0, '{}'::jsonb,
    'M13 SBOM audit release', '1.0-' || substr(gen_random_uuid()::text, 1, 8),
    'development', v_actor, v_actor)
  returning id into v_release;

  select * into v_result from public.create_sbom_ci_credential_atomic(
    v_org, v_actor, v_credential, 'M13 SBOM audit credential',
    v_prefix, v_token_salt, v_token_hash);
  perform pg_temp.check('CI credential create succeeds', v_result.outcome = 'created');
  perform pg_temp.check('CI credential create writes one v2 audit event',
    (select count(*) = 1 from public.audit_logs
      where organization_id = v_org and schema_version = 2
        and action = 'sbom.ci_credential_created'
        and entity_type = 'sbom_ci_credential'
        and entity_id = v_credential::text
        and actor_type = 'user' and actor_id = v_actor::text
        and outcome = 'completed'));
  perform pg_temp.check('CI credential create audit does not expose credential material',
    not exists(select 1 from public.audit_logs a
      where a.organization_id = v_org and a.schema_version = 2
        and a.entity_id = v_credential::text
        and (position(v_token_salt in row_to_json(a)::text) > 0
          or position(v_token_hash in row_to_json(a)::text) > 0
          or position(v_prefix in row_to_json(a)::text) > 0)));

  select * into v_result from public.revoke_sbom_ci_credential_atomic(v_org, v_actor, v_credential);
  perform pg_temp.check('CI credential revoke succeeds', v_result.outcome = 'revoked');
  perform pg_temp.check('CI credential revoke writes one v2 audit event',
    (select count(*) = 1 from public.audit_logs
      where organization_id = v_org and schema_version = 2
        and action = 'sbom.ci_credential_revoked'
        and entity_type = 'sbom_ci_credential'
        and entity_id = v_credential::text
        and actor_type = 'user' and actor_id = v_actor::text
        and outcome = 'completed'));

  select coalesce((select config_version from public.organization_sbom_quality_settings
    where organization_id = v_org), 0) into v_quality_version;
  select * into v_result from public.update_sbom_quality_settings_atomic(
    v_org, v_actor, v_quality_version,
    not coalesce((select bsi_profile_enabled from public.organization_sbom_quality_settings
      where organization_id = v_org), false), gen_random_uuid());
  perform pg_temp.check('SBOM quality settings update succeeds', v_result.outcome = 'updated');
  perform pg_temp.check('SBOM quality settings update writes one v2 audit event for new version',
    (select count(*) = 1 from public.audit_logs
      where organization_id = v_org and schema_version = 2
        and action = 'sbom.quality_settings_updated'
        and entity_type = 'organization_sbom_quality_settings'
        and entity_id = v_org::text
        and after_redacted ->> 'version' = ((v_result.result -> 'settings' ->> 'version'))
        and actor_id = v_actor::text));

  insert into public.sbom_composite_reviews(id, organization_id, product_id, release_id,
    merge_rules_version, input_set_digest, status, created_by)
  values(v_review, v_org, v_product, v_release, 'm13-audit-test', repeat('b', 64),
    'awaiting_review', v_actor);
  insert into public.sbom_composite_conflicts(id, organization_id, review_id, identity_key,
    conflict_type, field_name, candidates)
  values(v_conflict, v_org, v_review, 'pkg:npm/m13-audit', 'unresolved_identity',
    null, jsonb_build_array(jsonb_build_object('value', 'one')));
  insert into public.sbom_composite_unresolved_relationships(id, organization_id, review_id,
    relationship_key, detail)
  values(v_relationship, v_org, v_review, 'm13-audit-relationship',
    jsonb_build_object('from', 'a', 'to', 'b'));

  select * into v_result from public.resolve_sbom_composite_conflict_atomic(
    v_org, v_actor, v_review, v_conflict, null, 'exclude_identity',
    'contains supplier-specific component notes that must not be copied',
    gen_random_uuid(), gen_random_uuid());
  perform pg_temp.check('composite conflict resolution succeeds', v_result.outcome = 'resolved');
  perform pg_temp.check('composite conflict resolution writes one v2 audit event',
    (select count(*) = 1 from public.audit_logs
      where organization_id = v_org and schema_version = 2
        and action = 'sbom.composite_conflict_resolved'
        and entity_type = 'sbom_composite_conflict'
        and entity_id = v_conflict::text
        and actor_id = v_actor::text));
  perform pg_temp.check('composite conflict reason is not copied raw into audit',
    not exists(select 1 from public.audit_logs a
      where a.organization_id = v_org and a.schema_version = 2
        and a.entity_id = v_conflict::text
        and position('supplier-specific component notes' in row_to_json(a)::text) > 0));
  select * into v_result from public.resolve_sbom_composite_conflict_atomic(
    v_org, v_actor, v_review, v_conflict, null, 'exclude_identity',
    'contains supplier-specific component notes that must not be copied',
    gen_random_uuid(), gen_random_uuid());
  perform pg_temp.check('composite conflict replay does not duplicate audit',
    v_result.outcome = 'replayed'
    and (select count(*) = 1 from public.audit_logs
      where organization_id = v_org and schema_version = 2
        and action = 'sbom.composite_conflict_resolved'
        and entity_id = v_conflict::text));

  select * into v_result from public.resolve_sbom_composite_relationship_atomic(
    v_org, v_actor, v_review, v_relationship, 'include',
    'relationship confirmed from protected supplier evidence',
    gen_random_uuid(), gen_random_uuid());
  perform pg_temp.check('composite relationship resolution succeeds', v_result.outcome = 'resolved');
  perform pg_temp.check('composite relationship resolution writes one v2 audit event',
    (select count(*) = 1 from public.audit_logs
      where organization_id = v_org and schema_version = 2
        and action = 'sbom.composite_relationship_resolved'
        and entity_type = 'sbom_composite_relationship'
        and entity_id = v_relationship::text
        and actor_id = v_actor::text));
  perform pg_temp.check('composite relationship reason is not copied raw into audit',
    not exists(select 1 from public.audit_logs a
      where a.organization_id = v_org and a.schema_version = 2
        and a.entity_id = v_relationship::text
        and position('protected supplier evidence' in row_to_json(a)::text) > 0));
end $$;

select pg_temp.check('SBOM audit trigger functions are protected',
  not has_function_privilege('anon', 'public.m13_01_audit_sbom_ci_credential()', 'execute')
  and not has_function_privilege('authenticated', 'public.m13_01_audit_sbom_ci_credential()', 'execute')
  and not has_function_privilege('anon', 'public.m13_01_audit_sbom_quality_settings()', 'execute')
  and not has_function_privilege('authenticated', 'public.m13_01_audit_sbom_quality_settings()', 'execute')
  and not has_function_privilege('anon', 'public.m13_01_audit_sbom_composite_conflict()', 'execute')
  and not has_function_privilege('authenticated', 'public.m13_01_audit_sbom_composite_conflict()', 'execute')
  and not has_function_privilege('anon', 'public.m13_01_audit_sbom_composite_relationship()', 'execute')
  and not has_function_privilege('authenticated', 'public.m13_01_audit_sbom_composite_relationship()', 'execute'));

rollback;
