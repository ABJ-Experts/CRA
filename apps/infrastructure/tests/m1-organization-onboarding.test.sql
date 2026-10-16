-- M1 organization profile/onboarding database integration tests.
-- Every fixture is rolled back so this is safe against the shared local stack.

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
  'M1 mutation RPCs are service-role-only and pin search_path',
  (select count(*) = 0
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'create_organization_atomic',
        'update_organization_legal_profile_atomic',
        'switch_organization_atomic',
        'record_organization_onboarding_evidence_atomic',
        'resend_invitation_atomic',
        'record_invitation_delivery_onboarding_atomic'
      )
      and (
        not p.prosecdef
        or coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path=public, pg_temp%'
        or has_function_privilege('authenticated', p.oid, 'execute')
        or not has_function_privilege('service_role', p.oid, 'execute')
      )
  )
);

select pg_temp.check(
  'M1 actor foreign keys have covering indexes',
  (select count(*) = 4
     from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'organization_legal_profiles_created_by_idx',
        'organization_onboarding_completed_by_idx',
        'organization_onboarding_evidence_recorded_by_idx',
        'organization_onboarding_stages_completed_by_idx'
      ))
);

begin;
do $$
declare
  v_creator uuid;
  v_other_user uuid;
  v_org uuid;
  v_create record;
  v_replay record;
  v_mismatch record;
  v_duplicate record;
  v_update record;
  v_switch record;
  v_evidence record;
  v_invitation uuid := gen_random_uuid();
  v_product uuid := gen_random_uuid();
  v_sbom uuid := gen_random_uuid();
  v_before_count integer;
begin
  insert into public.users (email)
  values ('m1-owner@integration.test')
  returning id into v_creator;
  insert into public.users (email)
  values ('m1-other@integration.test')
  returning id into v_other_user;

  select * into v_create from public.create_organization_atomic(
    v_creator,
    '10000000-0000-4000-8000-000000000001',
    '  M1  Unicode  Åcme  Limited  ',
    '  1 Legal Street  ', null, '  Dublin  ', null, ' D02 X285 ',
    'IE', 'IE', '  Ada  Manufacturer  ', 'ADA@M1.TEST', null
  );
  v_org := v_create.organization_id;
  perform pg_temp.check(
    'atomic create returns one organization identifier',
    v_create.outcome = 'created' and v_org is not null
  );
  perform pg_temp.check(
    'atomic create persists owner profile onboarding and audit together',
    (select count(*) = 1 from public.organization_members
      where organization_id = v_org and user_id = v_creator and role = 'owner')
    and (select count(*) = 1 from public.organization_legal_profiles
      where organization_id = v_org and legal_name = 'M1 Unicode Åcme Limited'
        and manufacturer_contact_email = 'ada@m1.test')
    and (select count(*) = 5 from public.organization_onboarding_stages
      where organization_id = v_org)
    and (select count(*) = 1 from public.audit_logs
      where organization_id = v_org and action = 'organization.created')
    and (select count(*) = 1 from public.audit_logs
      where organization_id = v_org
        and action = 'onboarding.stage_completed'
        and changes->>'stage' = 'organization_details')
  );

  select count(*) into v_before_count from public.organizations;
  select * into v_replay from public.create_organization_atomic(
    v_creator,
    '10000000-0000-4000-8000-000000000001',
    'M1 Unicode Åcme Limited', '1 Legal Street', null, 'Dublin', null, 'D02 X285',
    'IE', 'IE', 'Ada Manufacturer', 'ada@m1.test', null
  );
  perform pg_temp.check(
    'same idempotency key and canonical payload replay without a duplicate',
    v_replay.outcome = 'replayed'
    and v_replay.organization_id = v_org
    and (select count(*) from public.organizations) = v_before_count
  );

  select * into v_mismatch from public.create_organization_atomic(
    v_creator,
    '10000000-0000-4000-8000-000000000001',
    'M1 Unicode Åcme Limited', '1 Legal Street', null, 'Dublin', null, 'D02 X285',
    'IE', 'IE', 'Ada Manufacturer', 'different@m1.test', null
  );
  perform pg_temp.check(
    'idempotency key reuse with different data has no identifier oracle',
    v_mismatch.outcome = 'idempotency_mismatch' and v_mismatch.organization_id is null
  );

  select * into v_duplicate from public.create_organization_atomic(
    v_other_user,
    '10000000-0000-4000-8000-000000000002',
    'm1 unicode åcme limited', '1 legal street', null, 'dublin', null, 'd02 x285',
    'IE', 'IE', 'Other Actor', 'other@m1.test', null
  );
  perform pg_temp.check(
    'global legal identity conflict exposes no organization identifier',
    v_duplicate.outcome = 'legal_identity_conflict' and v_duplicate.organization_id is null
  );

  select * into v_update from public.update_organization_legal_profile_atomic(
    v_org, v_creator, 0,
    'M1 Unicode Åcme Limited', '1 Legal Street', null, 'Dublin', null, 'D02 X285',
    'IE', 'IE', 'Ada Manufacturer', 'updated@m1.test', null,
    repeat('a', 64), repeat('a', 64), repeat('b', 64), repeat('c', 64),
    repeat('d', 64), repeat('d', 64)
  );
  perform pg_temp.check(
    'versioned profile update audits redacted contact metadata',
    v_update.outcome = 'updated'
    and (select version = 1 from public.organization_legal_profiles where organization_id = v_org)
    and (select changes::text not like '%updated@m1.test%'
           from public.audit_logs
          where organization_id = v_org and action = 'organization.legal_profile_updated'
          order by created_at desc limit 1)
  );

  select * into v_switch from public.switch_organization_atomic(v_org, v_other_user);
  perform pg_temp.check(
    'cross-tenant switch is a generic not-found result',
    v_switch.outcome = 'not_found'
  );

  -- SBOM evidence may arrive first. It is retained, but reconciliation only
  -- advances in stage order after Product evidence is authoritative.
  select * into v_evidence from public.record_organization_onboarding_evidence_atomic(
    v_org, 'first_sbom', v_sbom, v_creator, true
  );
  perform pg_temp.check(
    'out-of-order SBOM evidence is recorded without impossible stage advancement',
    v_evidence.outcome = 'recorded'
    and (select status = 'blocked' from public.organization_onboarding_stages
          where organization_id = v_org and stage = 'first_sbom')
  );
  select * into v_evidence from public.record_organization_onboarding_evidence_atomic(
    v_org, 'first_product', v_product, v_creator, true
  );
  perform pg_temp.check(
    'product evidence reconciles contiguous product and prior SBOM stages',
    v_evidence.outcome = 'recorded'
    and (select count(*) = 2 from public.organization_onboarding_stages
          where organization_id = v_org and stage in ('first_product', 'first_sbom')
            and status = 'completed')
  );

  select * into v_evidence from public.record_organization_onboarding_evidence_atomic(
    v_org, 'first_product', v_product, v_creator, false
  );
  perform pg_temp.check(
    'unavailable evidence never regresses completed historical onboarding',
    v_evidence.outcome = 'recorded'
    and (select status = 'completed' from public.organization_onboarding_stages
          where organization_id = v_org and stage = 'first_product')
    and (select not is_available from public.organization_onboarding_evidence
          where organization_id = v_org and stage = 'first_product' and resource_id = v_product)
  );

  insert into public.invitations (
    id, organization_id, email, role, token_hash, expires_at
  ) values (
    v_invitation, v_org, 'invitee@m1.test', 'member', repeat('e', 64), now() + interval '1 day'
  );
  select * into v_evidence from public.record_invitation_delivery_onboarding_atomic(
    v_org, v_invitation, v_creator
  );
  perform pg_temp.check(
    'confirmed invitation delivery completes the final durable onboarding stages once',
    v_evidence.outcome = 'recorded'
    and (select completed_at is not null from public.organization_onboarding where organization_id = v_org)
    and (select count(*) = 1 from public.audit_logs
          where organization_id = v_org and action = 'onboarding.completed')
  );
end
$$;
rollback;

select 'M1 organization/onboarding integration: ALL CHECKS PASSED' as result;
