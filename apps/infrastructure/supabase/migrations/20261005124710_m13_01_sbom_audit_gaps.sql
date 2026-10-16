-- M13-01: close remaining SBOM mutation audit gaps with source-owned,
-- transaction-bound v2 events. These triggers deliberately record row identity,
-- actor, outcome and safe state only; credential material and supplier text never
-- enter audit rows.

create or replace function public.m13_01_audit_sbom_ci_credential()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_action text;
  v_event_key text;
  v_actor uuid;
  v_before jsonb;
  v_after jsonb;
  v_result text;
begin
  if tg_op = 'INSERT' then
    v_action := 'sbom.ci_credential_created';
    v_event_key := 'sbom-ci-credential:' || new.id::text || ':created';
    v_actor := new.created_by;
    v_before := null;
    v_after := jsonb_build_object('status', new.status);
  elsif tg_op = 'UPDATE' and old.status = 'active' and new.status = 'revoked' then
    v_action := 'sbom.ci_credential_revoked';
    v_event_key := 'sbom-ci-credential:' || new.id::text || ':revoked';
    v_actor := new.revoked_by;
    v_before := jsonb_build_object('status', old.status);
    v_after := jsonb_build_object('status', new.status);
  else
    return new;
  end if;

  select outcome into v_result from public.m13_01_append_audit_event(
    new.organization_id, 'organization', v_event_key,
    'user', v_actor::text, v_action, 'sbom_ci_credential', new.id::text,
    'completed', gen_random_uuid(), v_before, v_after, null, null, null, v_actor);
  if v_result not in ('inserted', 'replayed') then
    raise exception 'SBOM CI credential audit identity conflict' using errcode = '23505';
  end if;
  return new;
end $$;

create or replace function public.m13_01_audit_sbom_quality_settings()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_result text;
begin
  if tg_op <> 'UPDATE' or new.config_version is not distinct from old.config_version then
    return new;
  end if;

  select outcome into v_result from public.m13_01_append_audit_event(
    new.organization_id, 'organization',
    'sbom-quality-settings:' || new.organization_id::text || ':v' || new.config_version::text,
    'user', new.updated_by::text, 'sbom.quality_settings_updated',
    'organization_sbom_quality_settings', new.organization_id::text,
    'completed', gen_random_uuid(),
    jsonb_build_object('enabled', old.bsi_profile_enabled, 'version', old.config_version),
    jsonb_build_object('enabled', new.bsi_profile_enabled, 'version', new.config_version),
    null, null, null, new.updated_by);
  if v_result not in ('inserted', 'replayed') then
    raise exception 'SBOM quality settings audit identity conflict' using errcode = '23505';
  end if;
  return new;
end $$;

create or replace function public.m13_01_audit_sbom_composite_conflict()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_result text;
  v_decision text;
begin
  if tg_op <> 'UPDATE' or old.resolved_at is not null or new.resolved_at is null then
    return new;
  end if;
  v_decision := case when new.selected_source_component_id is null
    then 'exclude_identity' else 'select_source_component' end;

  select outcome into v_result from public.m13_01_append_audit_event(
    new.organization_id, 'organization',
    'sbom-composite-conflict:' || new.id::text || ':resolved',
    'user', new.resolved_by::text, 'sbom.composite_conflict_resolved',
    'sbom_composite_conflict', new.id::text, 'completed', gen_random_uuid(),
    jsonb_build_object('state', 'unresolved'),
    jsonb_build_object('state', 'resolved', 'decision', v_decision),
    new.resolution_reason, null, null, new.resolved_by);
  if v_result not in ('inserted', 'replayed') then
    raise exception 'SBOM composite conflict audit identity conflict' using errcode = '23505';
  end if;
  return new;
end $$;

create or replace function public.m13_01_audit_sbom_composite_relationship()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_result text;
  v_decision text;
begin
  if tg_op <> 'UPDATE' or old.resolved_at is not null or new.resolved_at is null then
    return new;
  end if;
  v_decision := case new.disposition when 'include' then 'include' else 'exclude' end;

  select outcome into v_result from public.m13_01_append_audit_event(
    new.organization_id, 'organization',
    'sbom-composite-relationship:' || new.id::text || ':resolved',
    'user', new.resolved_by::text, 'sbom.composite_relationship_resolved',
    'sbom_composite_relationship', new.id::text, 'completed', gen_random_uuid(),
    jsonb_build_object('state', 'unresolved'),
    jsonb_build_object('state', 'resolved', 'decision', v_decision),
    new.resolution_reason, null, null, new.resolved_by);
  if v_result not in ('inserted', 'replayed') then
    raise exception 'SBOM composite relationship audit identity conflict' using errcode = '23505';
  end if;
  return new;
end $$;

alter function public.m13_01_audit_sbom_ci_credential() owner to postgres;
alter function public.m13_01_audit_sbom_quality_settings() owner to postgres;
alter function public.m13_01_audit_sbom_composite_conflict() owner to postgres;
alter function public.m13_01_audit_sbom_composite_relationship() owner to postgres;

revoke all on function public.m13_01_audit_sbom_ci_credential()
  from public, anon, authenticated, service_role;
revoke all on function public.m13_01_audit_sbom_quality_settings()
  from public, anon, authenticated, service_role;
revoke all on function public.m13_01_audit_sbom_composite_conflict()
  from public, anon, authenticated, service_role;
revoke all on function public.m13_01_audit_sbom_composite_relationship()
  from public, anon, authenticated, service_role;

drop trigger if exists m13_01_audit_sbom_ci_credential_insert on public.sbom_ci_credentials;
drop trigger if exists m13_01_audit_sbom_ci_credential_revoke on public.sbom_ci_credentials;
drop trigger if exists m13_01_audit_sbom_quality_settings_update on public.organization_sbom_quality_settings;
drop trigger if exists m13_01_audit_sbom_composite_conflict_resolved on public.sbom_composite_conflicts;
drop trigger if exists m13_01_audit_sbom_composite_relationship_resolved on public.sbom_composite_unresolved_relationships;

create trigger m13_01_audit_sbom_ci_credential_insert
after insert on public.sbom_ci_credentials
for each row execute function public.m13_01_audit_sbom_ci_credential();

create trigger m13_01_audit_sbom_ci_credential_revoke
after update of status, revoked_by, revoked_at on public.sbom_ci_credentials
for each row execute function public.m13_01_audit_sbom_ci_credential();

create trigger m13_01_audit_sbom_quality_settings_update
after update of bsi_profile_enabled, config_version on public.organization_sbom_quality_settings
for each row execute function public.m13_01_audit_sbom_quality_settings();

create trigger m13_01_audit_sbom_composite_conflict_resolved
after update of selected_source_component_id, resolution_reason, resolved_by, resolved_at
on public.sbom_composite_conflicts
for each row execute function public.m13_01_audit_sbom_composite_conflict();

create trigger m13_01_audit_sbom_composite_relationship_resolved
after update of disposition, resolution_reason, resolved_by, resolved_at
on public.sbom_composite_unresolved_relationships
for each row execute function public.m13_01_audit_sbom_composite_relationship();
