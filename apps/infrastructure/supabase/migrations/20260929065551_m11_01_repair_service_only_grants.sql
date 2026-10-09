-- M11-01 grant repair: keep security-critical mutation RPCs and durable command
-- ledgers service-role-only after local cutover and replayed migration stacks.

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

revoke insert, update, delete, truncate on table public.framework_requirements from service_role;
revoke execute on function public.m10_import_framework_pack(jsonb) from service_role;
revoke insert, update, delete, truncate on table public.framework_controls from service_role;
revoke execute on function public.m10_control_command_impl(uuid, uuid, text, jsonb, integer, uuid) from service_role;
revoke insert, update, delete, truncate on table public.framework_upgrade_reviews,
  public.framework_upgrade_decisions from service_role;
revoke insert, update, delete, truncate on table public.framework_custom_pack_drafts from service_role;
revoke all on table public.product_classification_runs from service_role;
revoke update, delete, truncate on table public.audit_logs from service_role;
revoke all on table
  public.product_substantial_modification_assessments,
  public.product_substantial_modification_releases,
  public.product_security_update_artifacts
from service_role;
grant select, insert on table public.product_substantial_modification_assessments to service_role;
grant update (
  status, determination, review_rationale, override_reason, reviewed_at, reviewed_by,
  superseded_at, superseded_by_id, version, updated_at, updated_by
) on table public.product_substantial_modification_assessments to service_role;
grant select, insert on table public.product_substantial_modification_releases to service_role;
grant select, insert on table public.product_security_update_artifacts to service_role;
grant update (
  support_period_id, support_period_revision, upload_status, integrity_status,
  review_status, reviewed_at, reviewed_by,
  review_reason, publication_status, published_at, published_by, availability_status,
  issued_candidate_at, support_candidate_at, availability_winning_rule,
  computed_availability_until, availability_until, non_reduction_applied,
  availability_explanation, replacement_artifact_id, replaced_at, replaced_by,
  replacement_reason, withdrawn_at, withdrawn_by, withdrawal_reason,
  cleanup_scheduled_at, cleanup_scheduled_by, cleanup_completed_at, cleanup_completed_by,
  version, updated_at, updated_by
) on table public.product_security_update_artifacts to service_role;
revoke update (object_key, sha256, byte_size, content_type)
  on table public.product_security_update_artifacts from service_role;


revoke all on table public.connector_commands from public, anon, authenticated;
grant select on table public.connector_commands to service_role;

revoke all on function public.create_organization_atomic(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_organization_atomic(uuid, uuid, text, text, text, text, text, text, text, text, text, text, text)
  to service_role;

revoke all on function public.update_organization_legal_profile_atomic(uuid, uuid, integer, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_organization_legal_profile_atomic(uuid, uuid, integer, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text, text)
  to service_role;

revoke all on function public.switch_organization_atomic(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.switch_organization_atomic(uuid, uuid)
  to service_role;

revoke all on function public.record_organization_onboarding_evidence_atomic(uuid, text, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.record_organization_onboarding_evidence_atomic(uuid, text, uuid, uuid, boolean)
  to service_role;

revoke all on function public.resend_invitation_atomic(uuid, uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.resend_invitation_atomic(uuid, uuid, uuid, text, text, timestamptz)
  to service_role;

revoke all on function public.record_invitation_delivery_onboarding_atomic(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.record_invitation_delivery_onboarding_atomic(uuid, uuid, uuid)
  to service_role;

do $$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'initialize_tenant_administration_state',
        'm1_settings_json',
        'm1_retention_policy_json',
        'm1_normalize_lifecycle_blockers',
        'm1_organization_lifecycle_json',
        'get_organization_settings_catalog',
        'get_organization_settings',
        'get_organization_lifecycle',
        'update_organization_settings_atomic',
        'get_organization_retention_policies',
        'update_organization_retention_policy_atomic',
        'reconcile_organization_retention_atomic',
        'claim_retention_cleanup_atomic',
        'complete_retention_cleanup_atomic',
        'fail_retention_cleanup_atomic',
        'request_organization_export_atomic',
        'claim_organization_export_atomic',
        'materialize_organization_export_snapshot_atomic',
        'checkpoint_organization_export_atomic',
        'complete_organization_export_atomic',
        'fail_organization_export_atomic',
        'record_organization_export_artifact_snapshot_atomic',
        'record_organization_export_download_atomic',
        'claim_organization_deletion_artifact_work_atomic',
        'complete_organization_deletion_artifact_work_atomic',
        'fail_organization_deletion_artifact_work_atomic',
        'register_organization_session_atomic',
        'create_destructive_reauth_grant_atomic',
        'consume_destructive_reauth_grant_atomic',
        'deactivate_organization_atomic',
        'schedule_organization_purge_atomic',
        'recover_organization_atomic',
        'claim_organization_purge_atomic',
        'complete_organization_purge_atomic',
        'fail_organization_purge_atomic',
        'accept_invitation_atomic',
        'resend_invitation_atomic',
        'record_organization_onboarding_evidence_atomic',
        'record_invitation_delivery_onboarding_atomic'
      ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_function);
  end loop;
end $$;
