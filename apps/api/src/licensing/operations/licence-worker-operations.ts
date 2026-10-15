import type { LicenceOperation } from "./licence-operation.registry";

export const licenceWorkerOperations: Readonly<
  Record<string, LicenceOperation>
> = Object.freeze({
  "apps/api/src/backups/worker/backup-cleanup-worker.ts": {
    kind: "protective",
    identity: "worker",
    mutation: true,
    authority: "m15_05_backup_control",
    evidence: "apps/api/src/backups/worker/backup-cleanup-worker.ts",
    reason:
      "Only explicitly reviewed cleanup intents retain live all-tenant protection locks; licence state cannot confer deletion authority.",
  },
  "apps/api/src/backups/worker/backup-worker.ts": {
    kind: "security",
    identity: "worker",
    mutation: true,
    authority: "m15_05_backup_control",
    evidence: "apps/api/src/backups/worker/backup-worker.ts",
    reason:
      "Protective capture and isolated restoration preserve fenced native execution and durable audit under licence expiry.",
  },
  "apps/api/src/support-diagnostics/worker/diagnostic-worker.ts": {
    kind: "security",
    identity: "worker",
    mutation: true,
    authority: "m15_04_complete",
    evidence:
      "apps/infrastructure/supabase/migrations/20261014090758_m15_04_support_diagnostics.sql",
    reason:
      "Consented creator-only diagnostics retain current administrator, source and session authority under licence expiry; no external transmission or regulatory grant.",
  },
  "apps/api/src/operator-registry-worker.ts": {
    kind: "security",
    identity: "worker",
    mutation: true,
    authority: "m15_03_publish_observation",
    evidence:
      "apps/infrastructure/supabase/migrations/20261014054407_m15_03_scoped_operator_health.sql",
    reason:
      "Deployment-scoped local metadata publication and private collector preserve durable audit and existing evidence boundaries.",
  },
  "apps/api/src/ai/supplier-document-extraction.worker.ts": {
    kind: "customer",
    capability: "ai",
    identity: "worker",
    mutation: true,
    authority: "complete_supplier_document_extraction_atomic",
    evidence:
      "apps/infrastructure/supabase/migrations/20260923102149_m9_05_supplier_document_extraction.sql",
    reason:
      "Gate before claim and each new step; retain queued state, attempts and fair tenant scheduling when blocked.",
  },
  "apps/api/src/connectors/worker/connector-sync-worker.ts": {
    kind: "customer",
    capability: "connectors",
    identity: "worker",
    mutation: true,
    authority: "m1102_claim_sync_run",
    evidence:
      "apps/api/src/connectors/infrastructure/supabase-connector.repository.ts",
    reason:
      "Gate before claim and each new step; retain queued state, attempts and fair tenant scheduling when blocked.",
  },
  "apps/api/src/connectors/worker/webhook-delivery-worker.ts": {
    kind: "customer",
    capability: "connectors",
    identity: "worker",
    mutation: true,
    authority: "m1103_claim_webhook_delivery",
    evidence:
      "apps/api/src/connectors/infrastructure/supabase-webhook.repository.ts",
    reason:
      "Gate before claim and each new step; retain queued state, attempts and fair tenant scheduling when blocked.",
  },
  "apps/api/src/evidence/worker/evidence-deletion-cleanup-worker.ts": {
    kind: "protective",
    identity: "worker",
    mutation: true,
    authority: "claim_evidence_document_deletion_cleanup_atomic",
    evidence:
      "apps/api/src/evidence/infrastructure/supabase-evidence-deletion-cleanup.queue.ts",
    reason:
      "Already approved deletion reconciliation cannot create a new deletion authority.",
  },
  "apps/api/src/evidence/worker/evidence-scan-worker.ts": {
    kind: "protective",
    identity: "worker",
    mutation: true,
    authority: "claim_evidence_scan_job_atomic",
    evidence: "apps/api/src/evidence/worker/evidence-scan-worker.ts",
    reason:
      "Scan previously admitted quarantined bytes; do not publish without original authorization.",
  },
  "apps/api/src/evidence/worker/evidence-text-extraction-worker.ts": {
    kind: "customer",
    capability: "evidence",
    identity: "worker",
    mutation: true,
    authority: "claim_evidence_text_extraction_job_atomic",
    evidence: "apps/api/src/evidence/worker/evidence-text-extraction-worker.ts",
    reason:
      "Gate before claim and each new step; retain queued state, attempts and fair tenant scheduling when blocked.",
  },
  "apps/api/src/evidence/worker/evidence-validity-alert-worker.ts": {
    kind: "protective",
    identity: "worker",
    mutation: true,
    authority: "claim_evidence_validity_notification_atomic",
    evidence:
      "apps/api/src/evidence/infrastructure/supabase-evidence-validity-alert-queue.ts",
    reason: "Validity safety alerts continue.",
  },
  "apps/api/src/evidence/worker/evidence-watermark-export-worker.ts": {
    kind: "evidence",
    identity: "worker",
    mutation: true,
    authority: "claim_evidence_document_watermark_export",
    evidence:
      "apps/api/src/evidence/infrastructure/supabase-evidence.repository.ts",
    reason: "Manual retained evidence export continues.",
  },
  "apps/api/src/findings/exports/worker/vulnerability-vex-publication-worker.ts":
    {
      kind: "evidence",
      identity: "worker",
      mutation: true,
      authority: "claim_vulnerability_vex_publication_job",
      evidence:
        "apps/api/src/findings/exports/infrastructure/supabase-vulnerability-vex-publication-queue.ts",
      reason:
        "Previously approved VEX evidence publication retains source approval.",
    },
  "apps/api/src/findings/triage/worker/vulnerability-remediation-ticket-operation-worker.ts":
    {
      kind: "customer",
      capability: "findings",
      identity: "worker",
      mutation: true,
      authority: "claim_vulnerability_remediation_ticket_operation_atomic",
      evidence:
        "apps/api/src/findings/triage/infrastructure/supabase-vulnerability-triage.repository.ts",
      reason:
        "Gate before claim and each new step; retain queued state, attempts and fair tenant scheduling when blocked.",
    },
  "apps/api/src/findings/triage/worker/vulnerability-triage-note-mention-worker.ts":
    {
      kind: "protective",
      identity: "worker",
      mutation: true,
      authority: "claim_finding_triage_note_mention",
      evidence:
        "apps/api/src/findings/triage/infrastructure/supabase-vulnerability-triage-note-mention-queue.ts",
      reason: "Existing source-linked notification delivery continues.",
    },
  "apps/api/src/findings/worker/finding-propagation-worker.ts": {
    kind: "protective",
    identity: "worker",
    mutation: true,
    authority: "claim_finding_propagation_job_atomic",
    evidence:
      "apps/api/src/findings/infrastructure/supabase-finding-propagation.repository.ts",
    reason:
      "Protective established finding propagation preserves human verdict ownership.",
  },
  "apps/api/src/frameworks/application/coverage-recalculation-worker.ts": {
    kind: "customer",
    capability: "frameworks",
    identity: "worker",
    mutation: true,
    authority: "m10_claim_coverage_scope",
    evidence:
      "apps/api/src/frameworks/infrastructure/supabase-coverage-work.queue.ts",
    reason:
      "Gate before claim and each new step; retain queued state, attempts and fair tenant scheduling when blocked.",
  },
  "apps/api/src/notifications/worker/burst-notification-dispatch-worker.ts": {
    kind: "protective",
    identity: "worker",
    mutation: true,
    authority: "claim_notification_burst_batch_atomic",
    evidence:
      "apps/infrastructure/supabase/migrations/20261005055356_m12_06_notification_bursts.sql",
    reason: "Protective delivery continues without new customer configuration.",
  },
  "apps/api/src/notifications/worker/chat-notification-worker.ts": {
    kind: "protective",
    identity: "worker",
    mutation: true,
    authority: "m12_05_claim_chat_delivery_atomic",
    evidence:
      "apps/api/src/notifications/worker/supabase-chat-notification-queue.adapter.ts",
    reason: "Protective notification transport remains available.",
  },
  "apps/api/src/notifications/worker/digest-notification-dispatch-worker.ts": {
    kind: "protective",
    identity: "worker",
    mutation: true,
    authority: "claim_notification_digest_batch_atomic",
    evidence:
      "apps/api/src/notifications/worker/supabase-notification-digest-queue.adapter.ts",
    reason: "Protective digest delivery remains available.",
  },
  "apps/api/src/notifications/worker/notification-dispatch-worker.ts": {
    kind: "protective",
    identity: "worker",
    mutation: true,
    authority: "claim_notification_dispatch_atomic",
    evidence:
      "apps/api/src/notifications/worker/supabase-notification-dispatch-queue.adapter.ts",
    reason: "Protective source notification delivery remains available.",
  },
  "apps/api/src/organizations/tenant-administration/worker/tenant-lifecycle-worker.ts":
    {
      kind: "mixed",
      capability: "administration",
      identity: "worker",
      mutation: true,
      authority: "claim_organization_export_atomic",
      evidence:
        "apps/api/src/organizations/tenant-administration/worker/supabase-tenant-lifecycle-worker.adapter.ts",
      reason:
        "Exports and existing approved lifecycle reconciliation continue; new purge authority never follows from licensing.",
    },
  "apps/api/src/products/worker/product-compliance-worker.ts": {
    kind: "protective",
    identity: "worker",
    mutation: true,
    authority: "claim_product_security_update_artifact_work_atomic",
    evidence:
      "apps/api/src/products/worker/supabase-product-compliance-worker.adapter.ts",
    reason:
      "Admitted safety artifact reconciliation continues under source authority.",
  },
  "apps/api/src/products/worker/product-retention-worker.ts": {
    kind: "protective",
    identity: "worker",
    mutation: true,
    authority: "claim_product_support_alert_atomic",
    evidence:
      "apps/api/src/products/worker/supabase-product-retention-worker.adapter.ts",
    reason:
      "Retention and support evaluation is not a licence grant or deletion authorization.",
  },
  "apps/api/src/reporting/worker/reporting-deadline-monitor-worker.ts": {
    kind: "protective",
    identity: "worker",
    mutation: true,
    authority: "claim_reporting_deadline_alert_delivery_atomic",
    evidence:
      "apps/api/src/reporting/infrastructure/supabase-reporting-deadline-monitor.repository.ts",
    reason: "M6 authoritative deadline evaluations and alerts continue.",
  },
  "apps/api/src/sboms/worker/sbom-composite-worker.ts": {
    kind: "customer",
    capability: "sboms",
    identity: "worker",
    mutation: true,
    authority: "claim_sbom_composite_generation",
    evidence: "apps/api/src/sboms/infrastructure/supabase-sbom.repository.ts",
    reason:
      "Gate before claim and each new step; retain queued state, attempts and fair tenant scheduling when blocked.",
  },
  "apps/api/src/sboms/worker/sbom-diff-worker.ts": {
    kind: "customer",
    capability: "sboms",
    identity: "worker",
    mutation: true,
    authority: "claim_sbom_diff_report",
    evidence: "apps/api/src/sboms/infrastructure/supabase-sbom.repository.ts",
    reason:
      "Gate before claim and each new step; retain queued state, attempts and fair tenant scheduling when blocked.",
  },
  "apps/api/src/sboms/worker/sbom-ingest-worker.ts": {
    kind: "customer",
    capability: "sboms",
    identity: "worker",
    mutation: true,
    authority: "claim_sbom_ingest_job",
    evidence: "apps/api/src/sboms/infrastructure/supabase-sbom.repository.ts",
    reason:
      "Gate before claim and each new step; retain queued state, attempts and fair tenant scheduling when blocked.",
  },
  "apps/api/src/sboms/worker/sbom-quality-worker.ts": {
    kind: "customer",
    capability: "sboms",
    identity: "worker",
    mutation: true,
    authority: "claim_sbom_quality_report",
    evidence: "apps/api/src/sboms/infrastructure/supabase-sbom.repository.ts",
    reason:
      "Gate before claim and each new step; retain queued state, attempts and fair tenant scheduling when blocked.",
  },
  "apps/api/src/supplier-evidence/worker/supplier-evidence-reminder-worker.ts":
    {
      kind: "protective",
      identity: "worker",
      mutation: true,
      authority: "claim_supplier_evidence_reminder_delivery_atomic",
      evidence:
        "apps/api/src/supplier-evidence/infrastructure/supabase-supplier-evidence-reminder-queue.ts",
      reason: "Existing obligation-linked reminders continue.",
    },
  "apps/api/src/technical-files/worker/technical-file-declaration-worker.ts": {
    kind: "customer",
    capability: "technical_files",
    identity: "worker",
    mutation: true,
    authority: "claim_technical_file_declaration",
    evidence:
      "apps/api/src/technical-files/worker/technical-file-declaration-worker.ts",
    reason:
      "Gate before claim and each new step; retain queued state, attempts and fair tenant scheduling when blocked.",
  },
  "apps/api/src/technical-files/worker/technical-file-snapshot-export-worker.ts":
    {
      kind: "evidence",
      identity: "worker",
      mutation: true,
      authority: "claim_technical_file_snapshot_export",
      evidence:
        "apps/api/src/technical-files/worker/technical-file-snapshot-export-worker.ts",
      reason: "Manual immutable technical-file export continues.",
    },
  "apps/api/src/vulnerabilities/matching/worker/vulnerability-matching-worker.ts":
    {
      kind: "protective",
      identity: "worker",
      mutation: true,
      authority: "claim_vulnerability_match_job_atomic",
      evidence:
        "apps/api/src/vulnerabilities/infrastructure/supabase-vulnerability-matching.repository.ts",
      reason:
        "Protective vulnerability detection continues for admitted inventory.",
    },
  "apps/api/src/vulnerabilities/worker/vulnerability-feed-worker.ts": {
    kind: "protective",
    identity: "worker",
    mutation: true,
    authority: "claim_vulnerability_feed_sync",
    evidence:
      "apps/api/src/vulnerabilities/infrastructure/supabase-vulnerability-feed.repository.ts",
    reason:
      "Safety knowledge synchronization continues; no call-home licensing dependency.",
  },
  "apps/api/src/vulnerabilities/worker/vulnerability-finding-review-notification-worker.ts":
    {
      kind: "protective",
      identity: "worker",
      mutation: true,
      authority: "claim_vulnerability_finding_review_notification",
      evidence:
        "apps/api/src/vulnerabilities/infrastructure/supabase-vulnerability-finding-review-notification-queue.ts",
      reason: "Safety review notifications continue.",
    },
  "apps/api/src/vulnerabilities/worker/vulnerability-kev-alert-worker.ts": {
    kind: "protective",
    identity: "worker",
    mutation: true,
    authority: "claim_vulnerability_kev_alert_delivery",
    evidence:
      "apps/api/src/vulnerabilities/infrastructure/supabase-vulnerability-kev-alert-queue.ts",
    reason: "KEV safety alerts continue.",
  },
  "apps/api/src/vulnerabilities/worker/vulnerability-reevaluation-worker.ts": {
    kind: "protective",
    identity: "worker",
    mutation: true,
    authority: "claim_vulnerability_reevaluation_job_atomic",
    evidence:
      "apps/api/src/vulnerabilities/infrastructure/supabase-vulnerability-reevaluation.repository.ts",
    reason:
      "Previously established safety findings reevaluate without licensing deciding a verdict.",
  },
  "apps/api/src/vulnerabilities/worker/vulnerability-triage-alert-worker.ts": {
    kind: "protective",
    identity: "worker",
    mutation: true,
    authority: "claim_vulnerability_triage_alert",
    evidence:
      "apps/api/src/vulnerabilities/infrastructure/supabase-vulnerability-triage-alert-queue.ts",
    reason: "SLA safety timers continue.",
  },
  "apps/api/src/audit/worker/audit-export-worker.ts": {
    kind: "evidence",
    identity: "worker",
    mutation: true,
    authority: "m13_03_transition_export",
    evidence:
      "apps/infrastructure/supabase/migrations/20261007055032_m13_03_audit_explorer_exports.sql",
    reason: "Authenticated manual audit export continues.",
  },
  "apps/api/src/audit/range/audit-range-worker.ts": {
    kind: "security",
    identity: "worker",
    mutation: true,
    authority: "m13_04_checkpoint_verification",
    evidence:
      "apps/infrastructure/supabase/migrations/20261007090257_m13_04_audit_range_verification.sql",
    reason: "Append-only ledger verification continues.",
  },
  "apps/api/src/audit/siem/worker/siem-worker.ts": {
    kind: "security",
    identity: "worker",
    mutation: true,
    authority: "m13_05_siem_complete",
    evidence:
      "apps/infrastructure/supabase/migrations/20261007104830_m13_05_siem_forwarding.sql",
    reason: "Durable security evidence forwarding continues.",
  },
  "apps/api/src/exports/worker/export-worker.ts": {
    kind: "evidence",
    identity: "worker",
    mutation: true,
    authority: "m14_03_audit",
    evidence:
      "apps/infrastructure/supabase/migrations/20261009110804_m14_03_filtered_export_persistence.sql",
    reason: "Manual authenticated retained evidence export continues.",
  },
  "apps/api/src/reports/worker/reports-worker.ts": {
    kind: "customer",
    capability: "scheduled_reports",
    identity: "worker",
    mutation: true,
    authority: "m14_04_publish_recipient",
    evidence:
      "apps/infrastructure/supabase/migrations/20261012064415_m14_04_report_generation.sql",
    reason:
      "Gate before claim and each new step; retain queued state, attempts and fair tenant scheduling when blocked.",
  },
});
