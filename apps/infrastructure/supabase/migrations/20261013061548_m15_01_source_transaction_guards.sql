-- Exact source-authority entry points for customer transactions. Route identity
-- and approvals remain source-owned; this gate adds serialized licence admission.
-- No table trigger, function renaming, signature, grants, defaults, response or
-- exception-body changes. Existing admitted step completions, manual evidence/VEX
-- export, audit append, timers, feed maintenance and bounded upload completion
-- are deliberately excluded. SQL facade cores are gated, not rewritten.
do $migration$
declare rule record; routine record; definition text; body text; guarded text; matches integer;
begin
 for rule in select * from (values
   -- 20261001075940_m11_06_pending_revoke_fence.sql
   ('m1106_issue_agent_enrollment','p_organization_id','connectors','true'),
   -- 20260929083706_m11_02_durable_sync_history.sql
   ('m1102_replay_sync_run','p_org_id','connectors','true'),
   -- 20260929083706_m11_02_durable_sync_history.sql
   ('m1102_save_field_mapping','p_org_id','connectors','true'),
   -- 20260929114854_m11_03_signed_webhooks.sql
   ('m1103_execute_webhook_endpoint_command_atomic','p_organization_id','connectors','p_operation not in (''disable'',''revoke_secret'')'),
   -- 20260820100000_m2_v2_connector_sync_foundation.sql
   ('archive_connector_atomic','p_organization_id','connectors','true'),
   -- 20261001072256_m11_06_on_prem_agent.sql
   ('m11_begin_sync_run_atomic','p_organization_id','connectors','true'),
   -- 20260930120000_m11_04_ci_sbom_gate_contracts.sql
   ('m11_create_connector_atomic','p_organization_id','connectors','true'),
   -- 20260820100000_m2_v2_connector_sync_foundation.sql
   ('link_external_identity_atomic','p_organization_id','connectors','true'),
   -- 20260820100000_m2_v2_connector_sync_foundation.sql
   ('merge_external_identities_atomic','p_organization_id','connectors','true'),
   -- 20260930120000_m11_04_ci_sbom_gate_contracts.sql
   ('m11_execute_connector_command_atomic','p_organization_id','connectors','p_operation not in (''revoke_secret'',''disconnect'')'),
   -- 20260928125859_m11_01_integration_catalogue_vault.sql
   ('m11_request_sync_run_commit_atomic','p_organization_id','connectors','true'),
   -- 20260820120000_m2_v2_connector_sync_hardening.sql
   ('resolve_sync_conflict_atomic','p_organization_id','connectors','true'),
   -- 20260929083706_m11_02_durable_sync_history.sql
   ('retry_sync_run_atomic','p_organization_id','connectors','true'),
   -- 20260930120000_m11_04_ci_sbom_gate_contracts.sql
   ('m11_begin_connector_test_atomic','p_organization_id','connectors','true'),
   -- 20260820100000_m2_v2_connector_sync_foundation.sql
   ('unlink_external_identity_atomic','p_organization_id','connectors','true'),
   -- 20260820120000_m2_v2_connector_sync_hardening.sql
   ('upsert_field_authority_policy_atomic','p_organization_id','connectors','true'),
   -- 20260921134000_m8_06_bulk_rpc_body_alignment.sql
   ('cancel_evidence_bulk_intake_item_atomic','p_organization_id','evidence','true'),
   -- 20260921123000_m8_05_retention_rpc_contract_alignment.sql
   ('confirm_evidence_document_deletion_atomic','p_organization_id','evidence','true'),
   -- 20260921138000_m8_06_bulk_owner_scope_hardening.sql
   ('create_evidence_bulk_intake_batch_atomic','p_organization_id','evidence','true'),
   -- 20260916110000_m8_evidence_intake_foundation.sql
   ('reserve_evidence_document_upload_atomic','p_organization_id','evidence','true'),
   -- 20260921134000_m8_06_bulk_rpc_body_alignment.sql
   ('initialize_evidence_bulk_intake_item_atomic','p_organization_id','evidence','true'),
   -- 20260921123000_m8_05_retention_rpc_contract_alignment.sql
   ('release_evidence_document_legal_hold_atomic','p_organization_id','evidence','true'),
   -- 20260917110000_m8_evidence_versions_verified_delivery.sql
   ('reserve_evidence_document_replacement_atomic','p_organization_id','evidence','true'),
   -- 20260921132000_m8_06_retry_scope_alignment.sql
   ('retry_evidence_bulk_intake_item_atomic','p_organization_id','evidence','true'),
   -- 20260918100000_m8_evidence_ocr_search.sql
   ('retry_evidence_text_extraction_atomic','p_organization_id','evidence','true'),
   -- 20260918110000_m8_04_evidence_validity_reuse_alerts.sql
   ('update_evidence_expiry_alert_intervals_atomic','p_organization_id','evidence','true'),
   -- 20260907123848_m5_bulk_assessment_propagation.sql
   ('execute_vulnerability_assessment_bulk_operation_atomic','p_organization_id','findings','true'),
   -- 20260907130000_m5_bulk_assessment_retry_command_repair.sql
   ('retry_vulnerability_assessment_bulk_operation_atomic','p_organization_id','findings','true'),
   -- 20260907123848_m5_bulk_assessment_propagation.sql
   ('undo_vulnerability_assessment_bulk_operation_atomic','p_organization_id','findings','true'),
   -- 20260907095929_m5_vex_assessments_approval.sql
   ('submit_vulnerability_finding_vex_assessment_atomic','p_organization_id','findings','true'),
   -- 20260907095929_m5_vex_assessments_approval.sql
   ('set_vulnerability_assessment_approval_policy_atomic','p_organization_id','findings','true'),
   -- 20260908122058_m5_vex_export_publication.sql
   ('enqueue_vulnerability_vex_publication_atomic','p_organization_id','findings','true'),
   -- 20260909054115_m5_vex_publication_manual_retry_attempt_reset.sql
   ('retry_vulnerability_vex_publication_atomic','p_organization_id','findings','true'),
   -- 20260908122058_m5_vex_export_publication.sql
   ('set_vulnerability_vex_publication_target_atomic','p_organization_id','findings','true'),
   -- 20260908122058_m5_vex_export_publication.sql
   ('withdraw_vulnerability_vex_publication_atomic','p_organization_id','findings','true'),
   -- 20260814105337_m2_v1_finding_propagation_commands.sql
   ('register_finding_propagation_source_atomic','p_organization_id','findings','true'),
   -- 20260814111734_m2_v1_finding_source_update.sql
   ('update_finding_propagation_source_atomic','p_organization_id','findings','true'),
   -- 20260814105837_m2_v1_finding_impact_api_commands.sql
   ('create_finding_product_impact_override_atomic','p_organization_id','findings','true'),
   -- 20260814111416_m2_v1_finding_override_end.sql
   ('end_finding_product_impact_override_atomic','p_organization_id','findings','true'),
   -- 20260908090000_m5_suppression_sla.sql
   ('assign_finding_triage_atomic','p_organization_id','findings','true'),
   -- 20260908095440_m5_remediation_anchor_outbox_contract_repair.sql
   ('record_finding_remediation_anchor_atomic','p_organization_id','findings','true'),
   -- 20260909070833_m5_triage_notes_mentions.sql
   ('create_finding_triage_note_atomic','p_organization_id','findings','true'),
   -- 20260907075911_m5_triage_queue_runtime_repair.sql
   ('create_finding_saved_view_atomic','p_organization_id','findings','true'),
   -- 20260909070833_m5_triage_notes_mentions.sql
   ('delete_finding_triage_note_atomic','p_organization_id','findings','true'),
   -- 20260907075911_m5_triage_queue_runtime_repair.sql
   ('delete_finding_saved_view_atomic','p_organization_id','findings','true'),
   -- 20261001055853_m11_05_operation_timestamp_context.sql
   ('reserve_vulnerability_remediation_ticket_atomic','p_organization_id','findings','true'),
   -- 20260930153200_m11_05_webhook_binding_correlation.sql
   ('reserve_vulnerability_remediation_ticket_transition_atomic','p_organization_id','findings','true'),
   -- 20260907075911_m5_triage_queue_runtime_repair.sql
   ('set_finding_saved_view_default_atomic','p_organization_id','findings','true'),
   -- 20260908090002_m5_suppression_revision_history.sql
   ('suppress_finding_triage_atomic','p_organization_id','findings','true'),
   -- 20260909070833_m5_triage_notes_mentions.sql
   ('update_finding_triage_note_atomic','p_organization_id','findings','true'),
   -- 20260907075911_m5_triage_queue_runtime_repair.sql
   ('update_finding_saved_view_atomic','p_organization_id','findings','true'),
   -- 20260908090000_m5_suppression_sla.sql
   ('set_vulnerability_triage_sla_policy_atomic','p_organization_id','findings','true'),
   -- 20260930153100_m11_05_remediation_ticket_sync_repair.sql
   ('upsert_vulnerability_remediation_ticket_binding_atomic','p_organization_id','findings','true'),
   -- 20260924074000_m10_02_mapping_selection_lock_repair.sql
   ('m10_control_command','p_organization_id','frameworks','true'),
   -- 20260924101931_m10_03_coverage_gaps.sql
   ('m10_set_framework_applicability','p_organization_id','frameworks','true'),
   -- 20260925160000_m10_05_customer_packs.sql
   ('m10_custom_pack_command','p_organization_id','frameworks','true'),
   -- 20260925160000_m10_05_customer_packs.sql
   ('m10_select_framework_version','p_organization_id','frameworks','true'),
   -- 20260925160100_m10_05_archive_upgrade_guard.sql
   ('m10_commit_upgrade','p_organization_id','frameworks','true'),
   -- 20260925120000_m10_04_curated_crosswalk_upgrades.sql
   ('m10_create_upgrade_review','p_organization_id','frameworks','true'),
   -- 20260925120000_m10_04_curated_crosswalk_upgrades.sql
   ('m10_set_upgrade_decision','p_organization_id','frameworks','true'),
   -- 20261005110405_m13_01_invitation_permission_cast_repair.sql
   ('m13_01_create_invitation_atomic','p_organization_id','administration','true'),
   -- 20260810134000_m1_tenant_worker_and_lifecycle_coordination.sql
   ('resend_invitation_atomic','p_organization_id','administration','true'),
   -- 20261005125332_m13_01_chat_test_security_audit.sql
   ('m12_05_confirm_chat_channel_atomic','p_organization_id','notifications','true'),
   -- 20261002110041_m12_05_chat_delivery.sql
   ('m12_05_create_chat_channel_atomic','p_organization_id','notifications','true'),
   -- 20261002110041_m12_05_chat_delivery.sql
   ('m12_05_set_chat_channel_enabled_atomic','p_organization_id','notifications','p_enabled'),
   -- 20261005125332_m13_01_chat_test_security_audit.sql
   ('m12_05_begin_chat_channel_test_atomic','p_organization_id','notifications','true'),
   -- 20261005055356_m12_06_notification_bursts.sql
   ('update_notification_burst_policy_atomic','p_organization_id','notifications','true'),
   -- 20261002110041_m12_05_chat_delivery.sql
   ('m12_05_update_chat_channel_atomic','p_organization_id','notifications','true'),
   -- 20261001143000_m12_03_notification_delivery_foundation.sql
   ('update_critical_notification_route_atomic','p_organization_id','notifications','true'),
   -- 20261001143000_m12_03_notification_delivery_foundation.sql
   ('update_notification_preferences_atomic','p_organization_id','notifications','true'),
   -- 20260811100000_m1_v2_multi_entity_branding.sql
   ('publish_organization_branding_atomic','p_organization_id','administration','true'),
   -- 20260811100000_m1_v2_multi_entity_branding.sql
   ('remove_organization_branding_logo_atomic','p_organization_id','administration','true'),
   -- 20260811100000_m1_v2_multi_entity_branding.sql
   ('save_organization_branding_draft_atomic','p_organization_id','administration','true'),
   -- 20260811100000_m1_v2_multi_entity_branding.sql
   ('transition_organization_legal_entity_atomic','p_organization_id','administration','true'),
   -- 20260811100000_m1_v2_multi_entity_branding.sql
   ('create_organization_legal_entity_atomic','p_organization_id','administration','true'),
   -- 20260811100000_m1_v2_multi_entity_branding.sql
   ('update_organization_legal_entity_atomic','p_organization_id','administration','true'),
   -- 20260810120000_m1_organization_profile_onboarding.sql
   ('update_organization_legal_profile_atomic','p_organization_id','administration','true'),
   -- 20260810131500_m1_tenant_administration_lifecycle_contract.sql
   ('schedule_organization_purge_atomic','p_organization_id','administration','true'),
   -- 20260810124500_m1_tenant_administration_foundation.sql
   ('update_organization_retention_policy_atomic','p_organization_id','administration','true'),
   -- 20260810124500_m1_tenant_administration_foundation.sql
   ('update_organization_settings_atomic','p_organization_id','administration','true'),
   -- 20260817120521_m2_v1_product_release_csv_import.sql
   ('cancel_product_import_job','p_organization_id','products','true'),
   -- 20260817124750_m2_v1_product_import_concurrency_revalidation.sql
   ('commit_product_import_atomic','p_organization_id','products','true'),
   -- 20260817124750_m2_v1_product_import_concurrency_revalidation.sql
   ('create_product_import_job','p_organization_id','products','true'),
   -- 20260928070538_m2_product_classification_commands.sql
   ('save_product_classification_atomic','p_organization_id','products','true'),
   -- 20260813100000_m2_v1_minimize_regulatory_history.sql
   ('add_product_release_market_availability_atomic','p_organization_id','products','true'),
   -- 20260813130000_m2_v1_product_relationships.sql
   ('append_software_baseline_revision_atomic','p_organization_id','products','true'),
   -- 20260813130000_m2_v1_product_relationships.sql
   ('archive_product_atomic','p_organization_id','products','true'),
   -- 20260813130000_m2_v1_product_relationships.sql
   ('archive_product_release_atomic','p_organization_id','products','true'),
   -- 20260817093818_m2_v1_propagation_scale_and_lifecycle_consolidation.sql
   ('archive_software_baseline_atomic','p_organization_id','products','true'),
   -- 20260812142000_m2_product_registry_sql_safety.sql
   ('assign_product_legal_entity_atomic','p_organization_id','products','true'),
   -- 20260813130000_m2_v1_product_relationships.sql
   ('assign_software_baseline_membership_atomic','p_organization_id','products','true'),
   -- 20260813100000_m2_v1_minimize_regulatory_history.sql
   ('correct_product_release_placed_on_market_at_atomic','p_organization_id','products','true'),
   -- 20260813102000_m2_v1_retired_availability_commands.sql
   ('correct_product_release_market_availability_atomic','p_organization_id','products','true'),
   -- 20260812142000_m2_product_registry_sql_safety.sql
   ('create_product_atomic','p_organization_id','products','true'),
   -- 20260813130000_m2_v1_product_relationships.sql
   ('create_product_component_link_atomic','p_organization_id','products','true'),
   -- 20260813133000_m2_v1_variant_function_lint_cleanup.sql
   ('create_product_variant_relationship_atomic','p_organization_id','products','true'),
   -- 20260812151000_m2_v1_release_regulatory_foundation.sql
   ('create_product_release_atomic','p_organization_id','products','true'),
   -- 20260813130000_m2_v1_product_relationships.sql
   ('create_software_baseline_atomic','p_organization_id','products','true'),
   -- 20260817151835_m2_v2_substantial_modification_security_update_artifacts.sql
   ('create_product_substantial_modification_assessment_atomic','p_organization_id','products','true'),
   -- 20260817151835_m2_v2_substantial_modification_security_update_artifacts.sql
   ('create_product_substantial_modification_assessment_draft_atomic','p_organization_id','products','true'),
   -- 20260813125800_m2_v1_support_period_command_idempotency.sql
   ('create_product_support_period_atomic','p_organization_id','products','true'),
   -- 20260813130000_m2_v1_product_relationships.sql
   ('end_product_component_link_atomic','p_organization_id','products','true'),
   -- 20260813130000_m2_v1_product_relationships.sql
   ('end_product_variant_relationship_atomic','p_organization_id','products','true'),
   -- 20260813130000_m2_v1_product_relationships.sql
   ('end_software_baseline_membership_atomic','p_organization_id','products','true'),
   -- 20260819100000_m2_v2_close_implementation_gaps.sql
   ('publish_product_security_update_artifact_atomic','p_organization_id','products','true'),
   -- 20260819100000_m2_v2_close_implementation_gaps.sql
   ('reassess_product_substantial_modification_atomic','p_organization_id','products','true'),
   -- 20260813102000_m2_v1_retired_availability_commands.sql
   ('remove_product_release_market_availability_atomic','p_organization_id','products','true'),
   -- 20260817151835_m2_v2_substantial_modification_security_update_artifacts.sql
   ('replace_product_security_update_artifact_atomic','p_organization_id','products','true'),
   -- 20260813130000_m2_v1_product_relationships.sql
   ('request_product_relationship_reevaluation_atomic','p_organization_id','products','true'),
   -- 20260818100000_m2_v2_finalize_rpc_surface.sql
   ('reserve_product_security_update_artifact_atomic','p_organization_id','products','true'),
   -- 20260817160813_m2_v2_external_artifact_worker_hardening.sql
   ('review_product_security_update_artifact_atomic','p_organization_id','products','true'),
   -- 20260819100000_m2_v2_close_implementation_gaps.sql
   ('review_product_substantial_modification_assessment_atomic','p_organization_id','products','true'),
   -- 20260813130000_m2_v1_product_relationships.sql
   ('supersede_product_component_link_atomic','p_organization_id','products','true'),
   -- 20260813125800_m2_v1_support_period_command_idempotency.sql
   ('supersede_product_support_period_atomic','p_organization_id','products','true'),
   -- 20260813101000_m2_v1_active_placement_availability.sql
   ('transition_product_release_lifecycle_atomic','p_organization_id','products','true'),
   -- 20260812141000_m2_product_registry_correctness.sql
   ('update_product_atomic','p_organization_id','products','true'),
   -- 20260812151000_m2_v1_release_regulatory_foundation.sql
   ('update_product_release_atomic','p_organization_id','products','true'),
   -- 20260819100000_m2_v2_close_implementation_gaps.sql
   ('update_product_security_update_artifact_metadata_atomic','p_organization_id','products','true'),
   -- 20260813120000_m2_v1_product_support_periods.sql
   ('update_organization_support_alert_intervals_atomic','p_organization_id','products','true'),
   -- 20260817151835_m2_v2_substantial_modification_security_update_artifacts.sql
   ('withdraw_product_security_update_artifact_atomic','p_organization_id','products','true'),
   -- 20260909093001_m6_reporting_obligations.sql
   ('cancel_reporting_obligation_atomic','p_organization_id','reporting','true'),
   -- 20260909093001_m6_reporting_obligations.sql
   ('correct_reporting_obligation_anchor_atomic','p_organization_id','reporting','true'),
   -- 20260909093001_m6_reporting_obligations.sql
   ('create_reporting_obligation_atomic','p_organization_id','reporting','true'),
   -- 20260910130000_m6_stage_draft_runtime_alignment.sql
   ('create_reporting_family_template_atomic','p_organization_id','reporting','true'),
   -- 20260910130000_m6_stage_draft_runtime_alignment.sql
   ('update_reporting_family_template_atomic','p_organization_id','reporting','true'),
   -- 20260911110000_m6_reporting_rehearsals.sql
   ('create_reporting_rehearsal_atomic','p_organization_id','reporting','true'),
   -- 20260911110000_m6_reporting_rehearsals.sql
   ('replay_reporting_rehearsal_atomic','p_organization_id','reporting','true'),
   -- 20261012064414_m14_04_report_workflow.sql
   ('m14_04_mutate_definition','p_organization_id','scheduled_reports','p_operation in (''activate'',''resume'')'),
   -- 20261012064414_m14_04_report_workflow.sql
   ('m14_04_create_definition','p_organization_id','scheduled_reports','true'),
   -- 20261012075103_m14_04_report_foreign_key_indexes.sql
   ('m14_04_preview','p_organization_id','scheduled_reports','true'),
   -- 20261012073440_m14_04_report_recovery_fairness.sql
   ('m14_04_replay','p_organization_id','scheduled_reports','true'),
   -- 20261012064414_m14_04_report_workflow.sql
   ('m14_04_update_definition','p_organization_id','scheduled_reports','true'),
   -- 20260930122000_m11_04_binding_revision_fence.sql
   ('upsert_ci_provider_release_binding_atomic','p_organization_id','sboms','true'),
   -- 20260923123908_m9_06_supplier_sbom_bridge.sql
   ('create_sbom_composite_review_atomic','p_organization_id','sboms','true'),
   -- 20260825124000_m3_sbom_composite_security_repair.sql
   ('generate_sbom_composite_atomic','p_organization_id','sboms','true'),
   -- 20260821070557_m3_sbom_validation_persistence.sql
   ('reserve_sbom_source_atomic','p_organization_id','sboms','true'),
   -- 20260824121517_m3_sbom_lineage_diff.sql
   ('retry_sbom_diff_report_atomic','p_organization_id','sboms','true'),
   -- 20260820174000_m3_sbom_completion_access_and_replay_idempotency.sql
   ('replay_sbom_ingest_job_atomic','p_organization_id','sboms','true'),
   -- 20260928084351_m3_lineage_installed_version_comparators.sql
   ('enqueue_sbom_diff_report_atomic','p_organization_id','sboms','true'),
   -- 20260825120000_m3_sbom_composite_supplier_intake.sql
   ('create_supplier_sbom_request_atomic','p_organization_id','sboms','true'),
   -- 20260825120000_m3_sbom_composite_supplier_intake.sql
   ('create_supplier_sbom_invitation_atomic','p_organization_id','sboms','true'),
   -- 20260825120000_m3_sbom_composite_supplier_intake.sql
   ('review_supplier_sbom_submission_atomic','p_organization_id','sboms','true'),
   -- 20260923114524_m9_05_field_decision_row_lock_fix.sql
   ('m9_05_decide_supplier_document_field_core','p_organization_id','suppliers','true'),
   -- 20260923102149_m9_05_supplier_document_extraction.sql
   ('add_supplier_document_field_atomic','p_organization_id','suppliers','true'),
   -- 20260923102149_m9_05_supplier_document_extraction.sql
   ('start_supplier_document_extraction_atomic','p_organization_id','ai','true'),
   -- 20260921171000_m9_02_supplier_evidence_portal.sql
   ('close_supplier_evidence_request_atomic','p_organization_id','suppliers','true'),
   -- 20260921171000_m9_02_supplier_evidence_portal.sql
   ('create_supplier_evidence_request_atomic','p_organization_id','suppliers','true'),
   -- 20260922100200_m9_03_review_boundary_fixes.sql
   ('re_request_supplier_evidence_request_atomic','p_organization_id','suppliers','true'),
   -- 20260922110000_m9_04_supplier_evidence_reminders_metrics.sql
   ('retry_supplier_evidence_reminder_delivery_atomic','p_organization_id','suppliers','true'),
   -- 20260922100000_m9_03_supplier_evidence_review.sql
   ('review_supplier_evidence_submission_atomic','p_organization_id','suppliers','true'),
   -- 20260921172000_m9_02_supplier_evidence_runtime_alignment.sql
   ('revise_supplier_evidence_request_atomic','p_organization_id','suppliers','true'),
   -- 20260921171000_m9_02_supplier_evidence_portal.sql
   ('revoke_supplier_evidence_invitation_atomic','p_organization_id','suppliers','true'),
   -- 20260922110000_m9_04_supplier_evidence_reminders_metrics.sql
   ('update_supplier_evidence_reminder_settings_atomic','p_organization_id','suppliers','true'),
   -- 20260921170000_m9_supplier_registry.sql
   ('archive_supplier_organization_atomic','p_organization_id','suppliers','true'),
   -- 20260921170000_m9_supplier_registry.sql
   ('archive_supplier_contact_atomic','p_organization_id','suppliers','true'),
   -- 20260921170000_m9_supplier_registry.sql
   ('associate_supplier_sbom_request_atomic','p_organization_id','suppliers','true'),
   -- 20260921170000_m9_supplier_registry.sql
   ('create_supplier_organization_atomic','p_organization_id','suppliers','true'),
   -- 20260921170000_m9_supplier_registry.sql
   ('create_supplier_contact_atomic','p_organization_id','suppliers','true'),
   -- 20260921170000_m9_supplier_registry.sql
   ('create_supplier_component_responsibility_atomic','p_organization_id','suppliers','true'),
   -- 20260921170000_m9_supplier_registry.sql
   ('end_supplier_component_responsibility_atomic','p_organization_id','suppliers','true'),
   -- 20260921170000_m9_supplier_registry.sql
   ('update_supplier_organization_atomic','p_organization_id','suppliers','true'),
   -- 20260921170000_m9_supplier_registry.sql
   ('update_supplier_contact_atomic','p_organization_id','suppliers','true'),
   -- 20261001105343_m12_01_membership_revocation_fence.sql
   ('m1201_manage_absence','p_organization_id','tasks','true'),
   -- 20261001105343_m12_01_membership_revocation_fence.sql
   ('m1201_manage_group','p_organization_id','tasks','true'),
   -- 20261001105105_m12_01_active_user_fence.sql
   ('m1201_route_task','p_organization_id','tasks','true'),
   -- 20260914130000_m7_structured_cybersecurity_risk_register.sql
   ('accept_technical_file_residual_risk_atomic','p_organization_id','technical_files','true'),
   -- 20260916110000_m8_evidence_intake_foundation.sql
   ('add_technical_file_section_source_atomic','p_organization_id','technical_files','true'),
   -- 20260914130000_m7_structured_cybersecurity_risk_register.sql
   ('archive_technical_file_risk_atomic','p_organization_id','technical_files','true'),
   -- 20260914120000_m7_annex_vii_technical_files.sql
   ('create_technical_file_atomic','p_organization_id','technical_files','true'),
   -- 20260914130000_m7_structured_cybersecurity_risk_register.sql
   ('create_technical_file_risk_atomic','p_organization_id','technical_files','true'),
   -- 20260914147610_m7_snapshot_tenant_locking_hardening.sql
   ('create_technical_file_snapshot_atomic','p_organization_id','technical_files','true'),
   -- 20260915010000_m7_versioned_declarations_of_conformity.sql
   ('issue_technical_file_declaration_atomic','p_organization_id','technical_files','true'),
   -- 20260914140000_m7_version_pinned_evidence_readiness.sql
   ('recalculate_technical_file_readiness_atomic','p_organization_id','technical_files','true'),
   -- 20260915083006_m7_declaration_contract_reissue_fix.sql
   ('reissue_technical_file_declaration_contract_atomic','p_organization_id','technical_files','true'),
   -- 20260914120000_m7_annex_vii_technical_files.sql
   ('remove_technical_file_section_source_atomic','p_organization_id','technical_files','true'),
   -- 20260914144000_m7_evidence_idempotency_lock.sql
   ('review_technical_file_section_source_atomic','p_organization_id','technical_files','true'),
   -- 20260915085128_m7_declaration_reissue_only_after_issue.sql
   ('upsert_technical_file_declaration_draft_contract_atomic','p_organization_id','technical_files','true'),
   -- 20260914144000_m7_evidence_idempotency_lock.sql
   ('mark_technical_file_section_source_material_change_atomic','p_organization_id','technical_files','true'),
   -- 20260914130000_m7_structured_cybersecurity_risk_register.sql
   ('update_technical_file_risk_atomic','p_organization_id','technical_files','true'),
   -- 20260914120000_m7_annex_vii_technical_files.sql
   ('update_technical_file_section_atomic','p_organization_id','technical_files','true'),
   -- 20260826133647_m4_03_enrichment_kev_alerts_projection_repair.sql
   ('acknowledge_vulnerability_kev_alert_atomic','p_organization_id','vulnerabilities','true'),
   -- 20260826134030_m4_03_reporting_intent_idempotency.sql
   ('record_vulnerability_kev_reporting_intent_atomic','p_organization_id','vulnerabilities','true'),
   -- 20260902121956_m4_manual_vulnerability_findings.sql
   ('create_vulnerability_manual_finding_atomic','p_organization_id','vulnerabilities','true'),
   -- 20260827130000_m4_04_human_verdict_evidence_repair.sql
   ('record_vulnerability_finding_human_verdict_atomic','p_organization_id','vulnerabilities','true'),
   -- SQL wrapper source-owned core
   ('m5_vex_decide_assessment_atomic','p_organization_id','findings','true'),
   -- SQL wrapper source-owned core
   ('m9_02_issue_invitation','p_organization_id','suppliers','true'),
   -- SQL wrapper source-owned core
   ('m10_control_command_impl','p_organization_id','frameworks','true')
 ) as rules(routine,org_argument,capability,condition)
 loop
  matches:=0;
  for routine in select p.oid,p.prosrc,p.proargnames,l.lanname
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   join pg_language l on l.oid=p.prolang
   where n.nspname='public' and p.proname=rule.routine and rule.org_argument=any(p.proargnames)
  loop
   if routine.lanname<>'plpgsql' then raise exception 'M15 source language changed: %',rule.routine;end if;
   body:=routine.prosrc;
   if body !~* '\mbegin\M' then raise exception 'M15 source body changed: %',rule.routine;end if;
   if strpos(body,'m15_01_assert_customer_write('||rule.org_argument||',')>0 then continue;end if;
   guarded:=regexp_replace(body,'\mbegin\M',format(E'begin\n  -- M15 source transaction admission; identity/domain policy below remains authoritative.\n  if %s then perform public.m15_01_assert_customer_write(%s,%L); end if;',rule.condition,rule.org_argument,rule.capability),'i');
   definition:=pg_get_functiondef(routine.oid);
   if strpos(definition,body)=0 or guarded=body then raise exception 'M15 source definition changed: %',rule.routine;end if;
   execute replace(definition,body,guarded);
   matches:=matches+1;
  end loop;
  if matches=0 then raise exception 'M15 source authority missing or already changed: %',rule.routine;end if;
 end loop;
end $migration$;
notify pgrst,'reload schema';
