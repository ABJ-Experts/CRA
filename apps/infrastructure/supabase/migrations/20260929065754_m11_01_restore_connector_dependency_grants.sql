-- Reassert the existing connector module's explicit M2 grants after a local
-- schema restore. No other feature's grants, records, or migration ledger change.
-- Signatures and column grants come from the connector foundation/hardening.
revoke all on table
  public.connectors, public.connector_secrets, public.product_external_identities,
  public.field_authority_policies, public.sync_runs, public.sync_run_plan_items,
  public.sync_conflicts, public.sync_connector_cursors
from public, anon, authenticated;
revoke all on table
  public.connectors, public.connector_secrets, public.product_external_identities,
  public.field_authority_policies, public.sync_runs, public.sync_run_plan_items,
  public.sync_conflicts, public.sync_connector_cursors
from service_role;

grant select, insert on table public.connectors to service_role;
grant update (
  display_name, mapping_version, connection_config, secret_ref, commit_policy, enabled,
  last_tested_at, last_test_outcome, last_test_error_code, archived_at, archived_by, archived_reason,
  version, updated_at, updated_by
) on table public.connectors to service_role;
grant select, insert on table public.connector_secrets to service_role;
grant select, insert on table public.product_external_identities to service_role;
grant update (
  external_display_label, unlinked_at, unlinked_by, unlink_reason,
  superseded_at, superseded_by_id, version, updated_at, updated_by
) on table public.product_external_identities to service_role;
grant select, insert on table public.field_authority_policies to service_role;
grant update (superseded_at, superseded_by_id, updated_at, updated_by) on table public.field_authority_policies to service_role;
grant select, insert on table public.sync_runs to service_role;
grant update (
  work_kind, status, commit_idempotency_key, commit_actor_user_id, commit_request_digest,
  cursor_to, fetch_content_hash, plan_basis_digest, row_count, processed_count, checkpoint_cursor,
  create_count, update_count, unchanged_count, skip_count, conflict_count, tombstone_count,
  cycle_blocked_count, estimated_graph_impact, retry_count, next_attempt_at, lease_owner,
  lease_expires_at, error_code, committed_at, canceled_at, cancellation_reason, updated_at
) on table public.sync_runs to service_role;
grant select, insert on table public.sync_run_plan_items to service_role;
grant update (applied_at) on table public.sync_run_plan_items to service_role;
grant select, insert on table public.sync_conflicts to service_role;
grant update (
  resolution_status, resolution_chosen_action, resolution_value, resolution_reason,
  resolved_by, resolved_at, resolved_against_external_value_hash, version, updated_at
) on table public.sync_conflicts to service_role;
grant select, insert on table public.sync_connector_cursors to service_role;
grant update (
  cursor, cursor_issued_at, last_committed_run_id, last_committed_at, last_full_reconciliation_at,
  consecutive_failure_count, circuit_state, circuit_opened_at, updated_at
) on table public.sync_connector_cursors to service_role;


do $$
declare v_signature text; v_function regprocedure;
begin
 foreach v_signature in array array[
  'public.archive_connector_atomic(uuid, uuid, uuid, integer, text)',
  'public.begin_sync_run_atomic(uuid, uuid, uuid, text, uuid, uuid)',
  'public.cancel_sync_run_atomic(uuid, uuid, uuid, text)',
  'public.claim_sync_run(text, integer)',
  'public.claim_sync_run(uuid, text, integer)',
  'public.commit_sync_run_atomic(uuid, uuid, uuid, text, uuid, uuid)',
  'public.connector_compliance_metrics_snapshot(uuid)',
  'public.create_connector_atomic(uuid, uuid, uuid, text, text, text, text, jsonb, text)',
  'public.fail_sync_run_atomic(uuid, uuid, text, text)',
  'public.link_external_identity_atomic(uuid, uuid, uuid, text, text, text, uuid, uuid, text)',
  'public.list_due_sync_run_organizations(integer)',
  'public.list_field_authority_policies(uuid, uuid, uuid)',
  'public.m2_v2_field_authority_policy_preview_digest(uuid, uuid, text, text, text, boolean, text)',
  'public.m2_v2_sync_conflict_json(public.sync_conflicts)',
  'public.m2_v2_sync_field_external_value(jsonb, text)',
  'public.m2_v2_sync_run_json(public.sync_runs)',
  'public.m2_v2_sync_text_field_value(jsonb, boolean, text)',
  'public.m2_v2_valid_field_authority_field(text, text)',
  'public.m2_v2_valid_sync_field_diffs(jsonb)',
  'public.merge_external_identities_atomic(uuid, uuid, uuid, uuid, text)',
  'public.preview_field_authority_policy(uuid, uuid, uuid, text, text, text, boolean, text)',
  'public.record_connector_test_atomic(uuid, uuid, uuid, text, text, integer)',
  'public.request_sync_run_commit_atomic(uuid, uuid, uuid, integer)',
  'public.resolve_connector_secret(uuid, uuid, text)',
  'public.resolve_connector_sync_worker_actor(uuid)',
  'public.resolve_sync_conflict_atomic(uuid, uuid, uuid, integer, text, jsonb, text, uuid)',
  'public.retry_sync_run_atomic(uuid, uuid, uuid)',
  'public.save_sync_run_plan_atomic(uuid, uuid, text, text, text, jsonb, jsonb)',
  'public.set_connector_secret_atomic(uuid, uuid, uuid, text, text)',
  'public.unlink_external_identity_atomic(uuid, uuid, uuid, text)',
  'public.update_connector_atomic(uuid, uuid, uuid, integer, text, text, jsonb, text)',
  'public.upsert_field_authority_policy_atomic(uuid, uuid, uuid, text, text, text, boolean, text)',
  'public.upsert_field_authority_policy_atomic(uuid, uuid, uuid, text, text, text, boolean, text, text)',
  'public.enforce_sync_run_status_transition()'
 ] loop
  -- Two foundation overloads were deliberately removed by hardening.
  v_function:=to_regprocedure(v_signature);
  if v_function is null then continue; end if;
  execute format('revoke all on function %s from public,anon,authenticated',v_function);
  -- Never re-enable credentials RPCs after the explicit GCM cutover.
  if v_signature not in ('public.resolve_connector_secret(uuid, uuid, text)',
                         'public.set_connector_secret_atomic(uuid, uuid, uuid, text, text)') then
   execute format('grant execute on function %s to service_role',v_function);
  end if;
 end loop;
end $$;
