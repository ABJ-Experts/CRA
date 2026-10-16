-- External supplier sessions are identified by the invitation row, never by
-- their bearer token or session hash. The row transition and event are one
-- transaction even when older service-role RPCs perform the update.
create or replace function public.m13_01_audit_supplier_evidence_invitation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_action text;
  v_result text;
begin
  if old.state = 'active' and new.state = 'used' then
    v_action := 'supplier.evidence_invitation_redeemed';
  elsif old.state = 'active' and new.state = 'expired' then
    v_action := 'supplier.evidence_invitation_expired';
  else
    -- Revocation is already captured by the request owner; replays do not
    -- update the row and must not create another event.
    return new;
  end if;

  select outcome into v_result from public.m13_01_append_audit_event(
    new.organization_id, 'organization',
    'supplier-evidence-invitation:' || new.id::text || ':' || new.state,
    'system', 'supplier_portal_session', v_action,
    'supplier_evidence_invitation', new.id::text, 'completed', gen_random_uuid(),
    jsonb_build_object('state', old.state, 'requestId', old.request_id),
    jsonb_build_object('state', new.state, 'requestId', new.request_id),
    null, null, null, null);
  if v_result not in ('inserted', 'replayed') then
    raise exception 'supplier invitation audit identity conflict' using errcode = '23505';
  end if;
  return new;
end $$;

create or replace function public.m13_01_audit_supplier_sbom_invitation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_action text;
  v_event_key text;
  v_result text;
begin
  if old.status = 'active' and new.status = 'used' then
    v_action := case when new.m9_invitation_id is null
      then 'sbom.supplier_invitation_consumed'
      else 'sbom.supplier_linked_session_activated' end;
    v_event_key := 'sbom-supplier-invitation:' || new.id::text || ':used';
  elsif old.status = 'active' and new.status = 'expired' then
    v_action := 'sbom.supplier_invitation_expired';
    v_event_key := 'sbom-supplier-invitation:' || new.id::text || ':expired';
  elsif old.status = 'used' and new.status = 'used'
    and old.session_expires_at is distinct from new.session_expires_at then
    v_action := 'sbom.supplier_linked_session_renewed';
    v_event_key := 'sbom-supplier-invitation:' || new.id::text || ':renewed:'
      || to_char(new.session_expires_at at time zone 'UTC', 'YYYYMMDDHH24MISS.US');
  else
    return new;
  end if;

  select outcome into v_result from public.m13_01_append_audit_event(
    new.organization_id, 'organization', v_event_key,
    'system', 'supplier_portal_session', v_action,
    'sbom_supplier_invitation', new.id::text, 'completed', gen_random_uuid(),
    jsonb_build_object('status', old.status, 'requestId', old.request_id),
    jsonb_build_object('status', new.status, 'requestId', new.request_id),
    null, null, null, null);
  if v_result not in ('inserted', 'replayed') then
    raise exception 'supplier SBOM session audit identity conflict' using errcode = '23505';
  end if;
  return new;
end $$;

alter function public.m13_01_audit_supplier_evidence_invitation() owner to postgres;
alter function public.m13_01_audit_supplier_sbom_invitation() owner to postgres;
revoke all on function public.m13_01_audit_supplier_evidence_invitation()
  from public, anon, authenticated, service_role;
revoke all on function public.m13_01_audit_supplier_sbom_invitation()
  from public, anon, authenticated, service_role;

create trigger m13_01_audit_supplier_evidence_invitation
after update of state on public.supplier_evidence_invitations
for each row execute function public.m13_01_audit_supplier_evidence_invitation();

create trigger m13_01_audit_supplier_sbom_invitation
after update of status, session_expires_at on public.sbom_supplier_invitations
for each row execute function public.m13_01_audit_supplier_sbom_invitation();

-- Successful M9 upload finalization is represented by the M8
-- evidence.upload_completed event, and scan decisions by
-- evidence.scan_completed. The failed integrity/expiry finalization path
-- changes both the evidence version and supplier submission but has no M8
-- completion event. Capture that terminal supplier transition once.
create or replace function public.m13_01_audit_supplier_evidence_failure()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_result text;
begin
  if old.state not in ('uploading', 'scan_pending')
    or new.state <> 'failed' then
    return new;
  end if;

  select outcome into v_result from public.m13_01_append_audit_event(
    new.organization_id, 'organization',
    'supplier-evidence-submission:' || new.id::text || ':failed',
    'system', 'supplier_evidence_intake', 'supplier.evidence_submission_failed',
    'supplier_evidence_submission', new.id::text, 'completed', gen_random_uuid(),
    jsonb_build_object('state', old.state, 'requestId', old.request_id,
      'evidenceVersionId', old.evidence_version_id),
    jsonb_build_object('state', new.state, 'requestId', new.request_id,
      'evidenceVersionId', new.evidence_version_id),
    null, null, null, null);
  if v_result not in ('inserted', 'replayed') then
    raise exception 'supplier submission audit identity conflict' using errcode = '23505';
  end if;
  return new;
end $$;

alter function public.m13_01_audit_supplier_evidence_failure() owner to postgres;
revoke all on function public.m13_01_audit_supplier_evidence_failure()
  from public, anon, authenticated, service_role;

create trigger m13_01_audit_supplier_evidence_failure
after update of state on public.supplier_evidence_submissions
for each row execute function public.m13_01_audit_supplier_evidence_failure();
