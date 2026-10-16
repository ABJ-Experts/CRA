import type { LicenceOperation } from "./licence-operation.registry";

// Reviewed explicit operations; the architecture gate checks the register and source parity.
export const licenceRouteOperations: Readonly<
  Record<string, LicenceOperation>
> = Object.freeze({
  "OperatorBackupsController.policy": {
    kind: "security",
    identity: "operator",
    mutation: false,
    authority: "m15_05_backup_control",
    evidence: "apps/api/src/backups/operator-backups.controller.ts",
    reason:
      "Protective recovery assurance preserves current instance action grants and tenant authorization under licence expiry without exposing archives or regulatory effects.",
  },
  "OperatorBackupsController.validate": {
    kind: "security",
    identity: "operator",
    mutation: true,
    authority: "m15_05_backup_control",
    evidence: "apps/api/src/backups/operator-backups.controller.ts",
    reason:
      "Protective recovery assurance preserves current instance action grants and tenant authorization under licence expiry without exposing archives or regulatory effects.",
  },
  "OperatorBackupsController.configure": {
    kind: "security",
    identity: "operator",
    mutation: true,
    authority: "m15_05_backup_control",
    evidence: "apps/api/src/backups/operator-backups.controller.ts",
    reason:
      "Protective recovery assurance preserves current instance action grants and tenant authorization under licence expiry without exposing archives or regulatory effects.",
  },
  "OperatorBackupsController.create": {
    kind: "security",
    identity: "operator",
    mutation: true,
    authority: "m15_05_backup_control",
    evidence: "apps/api/src/backups/operator-backups.controller.ts",
    reason:
      "Protective recovery assurance preserves current instance action grants and tenant authorization under licence expiry without exposing archives or regulatory effects.",
  },
  "OperatorBackupsController.history": {
    kind: "security",
    identity: "operator",
    mutation: false,
    authority: "m15_05_backup_control",
    evidence: "apps/api/src/backups/operator-backups.controller.ts",
    reason:
      "Protective recovery assurance preserves current instance action grants and tenant authorization under licence expiry without exposing archives or regulatory effects.",
  },
  "OperatorBackupsController.detail": {
    kind: "security",
    identity: "operator",
    mutation: false,
    authority: "m15_05_backup_control",
    evidence: "apps/api/src/backups/operator-backups.controller.ts",
    reason:
      "Protective recovery assurance preserves current instance action grants and tenant authorization under licence expiry without exposing archives or regulatory effects.",
  },
  "OperatorBackupsController.cancel": {
    kind: "security",
    identity: "operator",
    mutation: true,
    authority: "m15_05_backup_control",
    evidence: "apps/api/src/backups/operator-backups.controller.ts",
    reason:
      "Protective recovery assurance preserves current instance action grants and tenant authorization under licence expiry without exposing archives or regulatory effects.",
  },
  "OperatorBackupsController.verify": {
    kind: "security",
    identity: "operator",
    mutation: true,
    authority: "m15_05_backup_control",
    evidence: "apps/api/src/backups/operator-backups.controller.ts",
    reason:
      "Protective recovery assurance preserves current instance action grants and tenant authorization under licence expiry without exposing archives or regulatory effects.",
  },
  "OperatorBackupsController.cleanupReview": {
    kind: "security",
    identity: "operator",
    mutation: true,
    authority: "m15_05_backup_control",
    evidence: "apps/api/src/backups/operator-backups.controller.ts",
    reason:
      "Protective recovery assurance preserves current instance action grants and tenant authorization under licence expiry without exposing archives or regulatory effects.",
  },
  "OperatorBackupsController.cleanup": {
    kind: "security",
    identity: "operator",
    mutation: true,
    authority: "m15_05_backup_control",
    evidence: "apps/api/src/backups/operator-backups.controller.ts",
    reason:
      "Protective recovery assurance preserves current instance action grants and tenant authorization under licence expiry without exposing archives or regulatory effects.",
  },
  "CustomerBackupsController.summary": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "m15_05_backup_control",
    evidence: "apps/api/src/backups/customer-backups.controller.ts",
    reason:
      "Protective recovery assurance preserves current instance action grants and tenant authorization under licence expiry without exposing archives or regulatory effects.",
  },
  "CustomerBackupsController.history": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "m15_05_backup_control",
    evidence: "apps/api/src/backups/customer-backups.controller.ts",
    reason:
      "Protective recovery assurance preserves current instance action grants and tenant authorization under licence expiry without exposing archives or regulatory effects.",
  },
  "SupportDiagnosticsController.cancel": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "m15_04_cancel",
    evidence:
      "apps/api/src/support-diagnostics/support-diagnostics.controller.ts",
    reason:
      "Consented creator-only diagnostics retain current administrator, source and session authority under licence expiry; no external transmission or regulatory grant.",
  },
  "SupportDiagnosticsController.cleanup": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "m15_04_request_cleanup",
    evidence:
      "apps/api/src/support-diagnostics/support-diagnostics.controller.ts",
    reason:
      "Consented creator-only diagnostics retain current administrator, source and session authority under licence expiry; no external transmission or regulatory grant.",
  },
  "SupportDiagnosticsController.cleanupReview": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "m15_04_cleanup_review",
    evidence:
      "apps/api/src/support-diagnostics/support-diagnostics.controller.ts",
    reason:
      "Consented creator-only diagnostics retain current administrator, source and session authority under licence expiry; no external transmission or regulatory grant.",
  },
  "SupportDiagnosticsController.content": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "m15_04_access",
    evidence:
      "apps/api/src/support-diagnostics/support-diagnostics.controller.ts",
    reason:
      "Consented creator-only diagnostics retain current administrator, source and session authority under licence expiry; no external transmission or regulatory grant.",
  },
  "SupportDiagnosticsController.create": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "m15_04_create",
    evidence:
      "apps/api/src/support-diagnostics/support-diagnostics.controller.ts",
    reason:
      "Consented creator-only diagnostics retain current administrator, source and session authority under licence expiry; no external transmission or regulatory grant.",
  },
  "SupportDiagnosticsController.download": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "m15_04_redeem_grant",
    evidence:
      "apps/api/src/support-diagnostics/support-diagnostics.controller.ts",
    reason:
      "Consented creator-only diagnostics retain current administrator, source and session authority under licence expiry; no external transmission or regulatory grant.",
  },
  "SupportDiagnosticsController.get": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "m15_04_get",
    evidence:
      "apps/api/src/support-diagnostics/support-diagnostics.controller.ts",
    reason:
      "Consented creator-only diagnostics retain current administrator, source and session authority under licence expiry; no external transmission or regulatory grant.",
  },
  "SupportDiagnosticsController.grant": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "m15_04_issue_grant",
    evidence:
      "apps/api/src/support-diagnostics/support-diagnostics.controller.ts",
    reason:
      "Consented creator-only diagnostics retain current administrator, source and session authority under licence expiry; no external transmission or regulatory grant.",
  },
  "SupportDiagnosticsController.list": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "m15_04_list",
    evidence:
      "apps/api/src/support-diagnostics/support-diagnostics.controller.ts",
    reason:
      "Consented creator-only diagnostics retain current administrator, source and session authority under licence expiry; no external transmission or regulatory grant.",
  },
  "SupportDiagnosticsController.preview": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "preview",
    evidence:
      "apps/api/src/support-diagnostics/support-diagnostics.controller.ts",
    reason:
      "Consented creator-only diagnostics retain current administrator, source and session authority under licence expiry; no external transmission or regulatory grant.",
  },
  "OperatorController.session": {
    kind: "security",
    identity: "operator",
    mutation: false,
    authority: "session",
    evidence: "apps/api/src/operator/operator.controller.ts",
    reason:
      "Private mTLS metadata scope is separate from tenant permissions and preserves no evidence/content access.",
  },
  "OperatorController.instances": {
    kind: "security",
    identity: "operator",
    mutation: false,
    authority: "instances",
    evidence: "apps/api/src/operator/operator.controller.ts",
    reason:
      "Private mTLS metadata scope is separate from tenant permissions and preserves no evidence/content access.",
  },
  "OperatorController.detail": {
    kind: "security",
    identity: "operator",
    mutation: false,
    authority: "detail",
    evidence: "apps/api/src/operator/operator.controller.ts",
    reason:
      "Private mTLS metadata scope is separate from tenant permissions and preserves no evidence/content access.",
  },
  "OperatorController.tenants": {
    kind: "security",
    identity: "operator",
    mutation: false,
    authority: "tenants",
    evidence: "apps/api/src/operator/operator.controller.ts",
    reason:
      "Private mTLS metadata scope is separate from tenant permissions and preserves no evidence/content access.",
  },
  "OperatorController.metadata": {
    kind: "security",
    identity: "operator",
    mutation: false,
    authority: "metadata",
    evidence: "apps/api/src/operator/operator.controller.ts",
    reason:
      "Private mTLS metadata scope is separate from tenant permissions and preserves no evidence/content access.",
  },
  "SystemHealthController.read": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "read",
    evidence: "apps/api/src/system-health/system-health.controller.ts",
    reason:
      "Tenant health diagnostics retain live session, health and source permissions under expiry without granting evidence access or customer writes.",
  },
  "AuditExplorerController.createExport": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "m13_03_create_export",
    evidence: "apps/api/src/audit/audit-explorer.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuditExplorerController.detail": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "detail",
    evidence: "apps/api/src/audit/audit-explorer.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuditExplorerController.download": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "download",
    evidence: "apps/api/src/audit/audit-explorer.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuditExplorerController.downloadGrant": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "m13_03_issue_download_grant",
    evidence: "apps/api/src/audit/audit-explorer.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuditExplorerController.exportStatus": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "exportStatus",
    evidence: "apps/api/src/audit/audit-explorer.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuditExplorerController.page": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "page",
    evidence: "apps/api/src/audit/audit-explorer.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuditExplorerController.search": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "m13_03_create_snapshot",
    evidence: "apps/api/src/audit/audit-explorer.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuditExplorerController.verify": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "m13_03_record_access",
    evidence: "apps/api/src/audit/audit-explorer.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuditRangeController.cancel": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "m13_04_control_verification",
    evidence: "apps/api/src/audit/range/audit-range.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuditRangeController.create": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "m13_04_create_verification",
    evidence: "apps/api/src/audit/range/audit-range.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuditRangeController.resume": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "m13_04_control_verification",
    evidence: "apps/api/src/audit/range/audit-range.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuditRangeController.status": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "status",
    evidence: "apps/api/src/audit/range/audit-range.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "SiemController.catalogue": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "catalogue",
    evidence: "apps/api/src/audit/siem/siem.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "SiemController.create": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m13_05_siem_command",
    evidence: "apps/api/src/audit/siem/siem.controller.ts",
    reason:
      "SIEM configuration and elective replay require connector entitlement; source security scope remains authoritative.",
  },
  "SiemController.deliveries": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "deliveries",
    evidence: "apps/api/src/audit/siem/siem.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "SiemController.delivery": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "delivery",
    evidence: "apps/api/src/audit/siem/siem.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "SiemController.disable": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "m13_05_siem_command",
    evidence: "apps/api/src/audit/siem/siem.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "SiemController.enable": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m13_05_siem_command",
    evidence: "apps/api/src/audit/siem/siem.controller.ts",
    reason:
      "SIEM configuration and elective replay require connector entitlement; source security scope remains authoritative.",
  },
  "SiemController.get": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "get",
    evidence: "apps/api/src/audit/siem/siem.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "SiemController.list": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/audit/siem/siem.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "SiemController.replay_preview": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m13_05_siem_command",
    evidence: "apps/api/src/audit/siem/siem.controller.ts",
    reason:
      "SIEM configuration and elective replay require connector entitlement; source security scope remains authoritative.",
  },
  "SiemController.replay": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m13_05_siem_command",
    evidence: "apps/api/src/audit/siem/siem.controller.ts",
    reason:
      "SIEM configuration and elective replay require connector entitlement; source security scope remains authoritative.",
  },
  "SiemController.revoke_credentials": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "m13_05_siem_command",
    evidence: "apps/api/src/audit/siem/siem.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "SiemController.rotate_credentials": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m13_05_siem_command",
    evidence: "apps/api/src/audit/siem/siem.controller.ts",
    reason:
      "SIEM configuration and elective replay require connector entitlement; source security scope remains authoritative.",
  },
  "SiemController.test": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m13_05_siem_command",
    evidence: "apps/api/src/audit/siem/siem.controller.ts",
    reason:
      "SIEM configuration and elective replay require connector entitlement; source security scope remains authoritative.",
  },
  "SiemController.update": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m13_05_siem_command",
    evidence: "apps/api/src/audit/siem/siem.controller.ts",
    reason:
      "SIEM configuration and elective replay require connector entitlement; source security scope remains authoritative.",
  },
  "AuthController.forgotPassword": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "m13_01_audit_auth_state_change",
    evidence: "apps/api/src/auth/auth.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuthController.refresh": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "refresh",
    evidence: "apps/api/src/auth/auth.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuthController.refreshJson": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "recordBestEffort",
    evidence: "apps/api/src/auth/auth.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuthController.resendCode": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "m13_01_audit_auth_state_change",
    evidence: "apps/api/src/auth/auth.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuthController.resetPassword": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "resetPassword",
    evidence: "apps/api/src/auth/auth.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuthController.session": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "session",
    evidence: "apps/api/src/auth/auth.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuthController.signIn": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "recordBestEffort",
    evidence: "apps/api/src/auth/auth.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuthController.signOut": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "signOutEverywhere",
    evidence: "apps/api/src/auth/auth.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuthController.signUp": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "signUp",
    evidence: "apps/api/src/auth/auth.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuthController.unlock": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "recordBestEffort",
    evidence: "apps/api/src/auth/auth.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AuthController.verifyEmail": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "m13_01_audit_auth_user_security_change",
    evidence: "apps/api/src/auth/auth.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "MfaController.confirm": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "confirmEnrollment",
    evidence: "apps/api/src/auth/mfa/mfa.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "MfaController.enroll": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "enroll",
    evidence: "apps/api/src/auth/mfa/mfa.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "MfaController.factors": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "factors",
    evidence: "apps/api/src/auth/mfa/mfa.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "MfaController.unenroll": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "unenroll",
    evidence: "apps/api/src/auth/mfa/mfa.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "MfaController.verifyTwoFactor": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "verifyTwoFactor",
    evidence: "apps/api/src/auth/mfa/mfa.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "AgentIngressController.enroll": {
    kind: "source",
    capability: "connectors",
    identity: "source",
    mutation: true,
    authority: "m1106_redeem_agent_enrollment",
    evidence: "apps/api/src/connectors/agent/agent-ingress.controller.ts",
    reason:
      "Verified source identity must resolve tenant before licence admission and cannot trust URL/body scope.",
  },
  "AgentIngressController.frames": {
    kind: "source",
    capability: "connectors",
    identity: "source",
    mutation: true,
    authority: "m1106_stage_agent_batch",
    evidence: "apps/api/src/connectors/agent/agent-ingress.controller.ts",
    reason:
      "Verified source identity must resolve tenant before licence admission and cannot trust URL/body scope.",
  },
  "AgentManagementController.issue": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m1106_issue_agent_enrollment",
    evidence: "apps/api/src/connectors/agent/agent-management.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "AgentManagementController.revoke": {
    kind: "security",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m1106_revoke_agent",
    evidence: "apps/api/src/connectors/agent/agent-management.controller.ts",
    reason:
      "Stop or revoke existing external/customer authority without starting new customer work.",
  },
  "AgentManagementController.status": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "status",
    evidence: "apps/api/src/connectors/agent/agent-management.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsSyncOperationsController.currentMapping": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "currentMapping",
    evidence:
      "apps/api/src/connectors/connectors-sync-operations.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsSyncOperationsController.deadLetters": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "deadLetters",
    evidence:
      "apps/api/src/connectors/connectors-sync-operations.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsSyncOperationsController.detail": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "detail",
    evidence:
      "apps/api/src/connectors/connectors-sync-operations.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsSyncOperationsController.history": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "history",
    evidence:
      "apps/api/src/connectors/connectors-sync-operations.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsSyncOperationsController.mappingSchema": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "mappingSchema",
    evidence:
      "apps/api/src/connectors/connectors-sync-operations.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsSyncOperationsController.previewMapping": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "previewMapping",
    evidence:
      "apps/api/src/connectors/connectors-sync-operations.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsSyncOperationsController.replay": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m1102_replay_sync_run",
    evidence:
      "apps/api/src/connectors/connectors-sync-operations.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsSyncOperationsController.replayPreview": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m1102_replay_preview",
    evidence:
      "apps/api/src/connectors/connectors-sync-operations.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsSyncOperationsController.saveMapping": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m1102_save_field_mapping",
    evidence:
      "apps/api/src/connectors/connectors-sync-operations.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsWebhooksController.catalogue": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "catalogue",
    evidence: "apps/api/src/connectors/connectors-webhooks.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsWebhooksController.create": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m1103_execute_webhook_endpoint_command_atomic",
    evidence: "apps/api/src/connectors/connectors-webhooks.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsWebhooksController.deliveries": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "deliveries",
    evidence: "apps/api/src/connectors/connectors-webhooks.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsWebhooksController.delivery": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "delivery",
    evidence: "apps/api/src/connectors/connectors-webhooks.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsWebhooksController.disable": {
    kind: "security",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m1103_execute_webhook_endpoint_command_atomic",
    evidence: "apps/api/src/connectors/connectors-webhooks.controller.ts",
    reason:
      "Stop or revoke existing external/customer authority without starting new customer work.",
  },
  "ConnectorsWebhooksController.enable": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m1103_execute_webhook_endpoint_command_atomic",
    evidence: "apps/api/src/connectors/connectors-webhooks.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsWebhooksController.get": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "get",
    evidence: "apps/api/src/connectors/connectors-webhooks.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsWebhooksController.list": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/connectors/connectors-webhooks.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsWebhooksController.replay": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m1103_execute_webhook_endpoint_command_atomic",
    evidence: "apps/api/src/connectors/connectors-webhooks.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsWebhooksController.replayPreview": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m1103_preview_webhook_replay",
    evidence: "apps/api/src/connectors/connectors-webhooks.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsWebhooksController.revoke": {
    kind: "security",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m1103_execute_webhook_endpoint_command_atomic",
    evidence: "apps/api/src/connectors/connectors-webhooks.controller.ts",
    reason:
      "Stop or revoke existing external/customer authority without starting new customer work.",
  },
  "ConnectorsWebhooksController.rotate": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m1103_execute_webhook_endpoint_command_atomic",
    evidence: "apps/api/src/connectors/connectors-webhooks.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsWebhooksController.test": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m1103_execute_webhook_endpoint_command_atomic",
    evidence: "apps/api/src/connectors/connectors-webhooks.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsWebhooksController.update": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m1103_execute_webhook_endpoint_command_atomic",
    evidence: "apps/api/src/connectors/connectors-webhooks.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsWebhooksController.verification": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "verification",
    evidence: "apps/api/src/connectors/connectors-webhooks.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.archive": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "archive_connector_atomic",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.beginRun": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m11_begin_sync_run_atomic",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.cancel": {
    kind: "security",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "cancel_sync_run_atomic",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Stop or revoke existing external/customer authority without starting new customer work.",
  },
  "ConnectorsController.catalogue": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "catalogue",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.create": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m11_create_connector_atomic",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.deadLetters": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "deadLetters",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.disconnect": {
    kind: "security",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m11_execute_connector_command_atomic",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Stop or revoke existing external/customer authority without starting new customer work.",
  },
  "ConnectorsController.exportDiagnostics": {
    kind: "security",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "diagnosticsExport",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason: "Scoped diagnostic export is maintenance, not licence grant.",
  },
  "ConnectorsController.get": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "get",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.getConflict": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "getConflict",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.getRun": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "getRun",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.identities": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "identities",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.link": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "link_external_identity_atomic",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.list": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.listRuns": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "listRuns",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.mapping": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "mapping",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.merge": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "merge_external_identities_atomic",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.metrics": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "metrics",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.overview": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "overview",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.overviews": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "overviews",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.planItems": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "planItems",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.previewPolicy": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "preview_field_authority_policy",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.reconnect": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m11_execute_connector_command_atomic",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.requestCommit": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m11_request_sync_run_commit_atomic",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.resolveConflict": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "resolve_sync_conflict_atomic",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.retry": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "retry_sync_run_atomic",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.revokeSecret": {
    kind: "security",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m11_execute_connector_command_atomic",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Stop or revoke existing external/customer authority without starting new customer work.",
  },
  "ConnectorsController.runConflicts": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: false,
    authority: "runConflicts",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.setSecret": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m11_execute_connector_command_atomic",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.test": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m11_begin_connector_test_atomic",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.unlink": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "unlink_external_identity_atomic",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.update": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "m11_execute_connector_command_atomic",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "ConnectorsController.upsertPolicy": {
    kind: "customer",
    capability: "connectors",
    identity: "member",
    mutation: true,
    authority: "upsert_field_authority_policy_atomic",
    evidence: "apps/api/src/connectors/connectors.controller.ts",
    reason:
      "Source-owned connectors operation retains its existing identity, tenant and approval checks.",
  },
  "DashboardTrendsController.export": {
    kind: "evidence",
    capability: "dashboards",
    identity: "member",
    mutation: false,
    authority: "export",
    evidence: "apps/api/src/dashboard/dashboard-trends.controller.ts",
    reason:
      "Explicit manual export of retained source evidence remains available.",
  },
  "DashboardTrendsController.sources": {
    kind: "customer",
    capability: "dashboards",
    identity: "member",
    mutation: false,
    authority: "sources",
    evidence: "apps/api/src/dashboard/dashboard-trends.controller.ts",
    reason:
      "Source-owned dashboards operation retains its existing identity, tenant and approval checks.",
  },
  "DashboardTrendsController.trends": {
    kind: "customer",
    capability: "dashboards",
    identity: "member",
    mutation: false,
    authority: "trends",
    evidence: "apps/api/src/dashboard/dashboard-trends.controller.ts",
    reason:
      "Source-owned dashboards operation retains its existing identity, tenant and approval checks.",
  },
  "DashboardController.ingestion": {
    kind: "customer",
    capability: "dashboards",
    identity: "member",
    mutation: false,
    authority: "ingestion",
    evidence: "apps/api/src/dashboard/dashboard.controller.ts",
    reason:
      "Source-owned dashboards operation retains its existing identity, tenant and approval checks.",
  },
  "DashboardController.obligations": {
    kind: "customer",
    capability: "dashboards",
    identity: "member",
    mutation: false,
    authority: "obligations",
    evidence: "apps/api/src/dashboard/dashboard.controller.ts",
    reason:
      "Source-owned dashboards operation retains its existing identity, tenant and approval checks.",
  },
  "DashboardController.overview": {
    kind: "customer",
    capability: "dashboards",
    identity: "member",
    mutation: false,
    authority: "overview",
    evidence: "apps/api/src/dashboard/dashboard.controller.ts",
    reason:
      "Source-owned dashboards operation retains its existing identity, tenant and approval checks.",
  },
  "DashboardController.posture": {
    kind: "customer",
    capability: "dashboards",
    identity: "member",
    mutation: false,
    authority: "posture",
    evidence: "apps/api/src/dashboard/dashboard.controller.ts",
    reason:
      "Source-owned dashboards operation retains its existing identity, tenant and approval checks.",
  },
  "DashboardController.readiness": {
    kind: "customer",
    capability: "dashboards",
    identity: "member",
    mutation: false,
    authority: "readiness",
    evidence: "apps/api/src/dashboard/dashboard.controller.ts",
    reason:
      "Source-owned dashboards operation retains its existing identity, tenant and approval checks.",
  },
  "PortfolioController.concentration": {
    kind: "customer",
    capability: "portfolio",
    identity: "member",
    mutation: false,
    authority: "concentration",
    evidence: "apps/api/src/dashboard/portfolio.controller.ts",
    reason:
      "Source-owned portfolio operation retains its existing identity, tenant and approval checks.",
  },
  "PortfolioController.detail": {
    kind: "customer",
    capability: "portfolio",
    identity: "member",
    mutation: false,
    authority: "detail",
    evidence: "apps/api/src/dashboard/portfolio.controller.ts",
    reason:
      "Source-owned portfolio operation retains its existing identity, tenant and approval checks.",
  },
  "PortfolioController.products": {
    kind: "customer",
    capability: "portfolio",
    identity: "member",
    mutation: false,
    authority: "products",
    evidence: "apps/api/src/dashboard/portfolio.controller.ts",
    reason:
      "Source-owned portfolio operation retains its existing identity, tenant and approval checks.",
  },
  "EvidenceController.authorizeAccess": {
    kind: "evidence",
    capability: "evidence",
    identity: "member",
    mutation: true,
    authority: "authorize_evidence_document_access_atomic",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Retained evidence reads, audited access and manual exports remain available under source authorization.",
  },
  "EvidenceController.bulkIntakeBatch": {
    kind: "customer",
    capability: "evidence",
    identity: "member",
    mutation: false,
    authority: "bulkIntakeBatch",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "EvidenceController.cancelBulkIntakeItem": {
    kind: "customer",
    capability: "evidence",
    identity: "member",
    mutation: true,
    authority: "cancel_evidence_bulk_intake_item_atomic",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "EvidenceController.complete": {
    kind: "admission-finalization",
    capability: "evidence",
    identity: "member",
    mutation: true,
    authority: "finalize_evidence_document_upload_atomic",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Only the existing immutable reservation can finalize; actor, scope, bytes and lease must still validate.",
  },
  "EvidenceController.completeBulkIntakeItem": {
    kind: "admission-finalization",
    capability: "evidence",
    identity: "member",
    mutation: true,
    authority: "complete_evidence_bulk_intake_item_atomic",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Only the existing immutable reservation can finalize; actor, scope, bytes and lease must still validate.",
  },
  "EvidenceController.confirmDeletion": {
    kind: "customer",
    capability: "evidence",
    identity: "member",
    mutation: true,
    authority: "confirm_evidence_document_deletion_atomic",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "EvidenceController.createBulkIntakeBatch": {
    kind: "customer",
    capability: "evidence",
    identity: "member",
    mutation: true,
    authority: "create_evidence_bulk_intake_batch_atomic",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "EvidenceController.createWatermarkExport": {
    kind: "evidence",
    capability: "evidence",
    identity: "member",
    mutation: true,
    authority: "create_evidence_document_watermark_export_atomic",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Retained evidence reads, audited access and manual exports remain available under source authorization.",
  },
  "EvidenceController.deliver": {
    kind: "evidence",
    capability: "evidence",
    identity: "member",
    mutation: false,
    authority: "deliver",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Retained evidence reads, audited access and manual exports remain available under source authorization.",
  },
  "EvidenceController.deliverWatermarkExport": {
    kind: "evidence",
    capability: "evidence",
    identity: "member",
    mutation: true,
    authority: "create_evidence_document_watermark_export_delivery_atomic",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Retained evidence reads, audited access and manual exports remain available under source authorization.",
  },
  "EvidenceController.expiryAlertIntervals": {
    kind: "customer",
    capability: "evidence",
    identity: "member",
    mutation: false,
    authority: "expiryAlertIntervals",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "EvidenceController.extractedText": {
    kind: "evidence",
    capability: "evidence",
    identity: "member",
    mutation: false,
    authority: "extractedText",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Retained evidence reads, audited access and manual exports remain available under source authorization.",
  },
  "EvidenceController.initialize": {
    kind: "customer",
    capability: "evidence",
    identity: "member",
    mutation: true,
    authority: "reserve_evidence_document_upload_atomic",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "EvidenceController.initializeBulkIntakeItem": {
    kind: "customer",
    capability: "evidence",
    identity: "member",
    mutation: true,
    authority: "initialize_evidence_bulk_intake_item_atomic",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "EvidenceController.legalHolds": {
    kind: "evidence",
    capability: "evidence",
    identity: "member",
    mutation: false,
    authority: "legalHolds",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Retained evidence reads, audited access and manual exports remain available under source authorization.",
  },
  "EvidenceController.list": {
    kind: "evidence",
    capability: "evidence",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Retained evidence reads, audited access and manual exports remain available under source authorization.",
  },
  "EvidenceController.placeLegalHold": {
    kind: "protective",
    capability: "evidence",
    identity: "member",
    mutation: true,
    authority: "place_evidence_document_legal_hold_atomic",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Legal hold placement is protective; existing source approval remains mandatory.",
  },
  "EvidenceController.previewWatermarkDelivery": {
    kind: "evidence",
    capability: "evidence",
    identity: "member",
    mutation: false,
    authority: "previewWatermarkDelivery",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Retained evidence reads, audited access and manual exports remain available under source authorization.",
  },
  "EvidenceController.previewWatermarkExport": {
    kind: "evidence",
    capability: "evidence",
    identity: "member",
    mutation: true,
    authority: "preview_evidence_document_watermark_export_atomic",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Retained evidence reads, audited access and manual exports remain available under source authorization.",
  },
  "EvidenceController.releaseLegalHold": {
    kind: "customer",
    capability: "evidence",
    identity: "member",
    mutation: true,
    authority: "release_evidence_document_legal_hold_atomic",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "EvidenceController.replace": {
    kind: "customer",
    capability: "evidence",
    identity: "member",
    mutation: true,
    authority: "reserve_evidence_document_replacement_atomic",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "EvidenceController.retentionReview": {
    kind: "evidence",
    capability: "evidence",
    identity: "member",
    mutation: false,
    authority: "retentionReview",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Retained evidence reads, audited access and manual exports remain available under source authorization.",
  },
  "EvidenceController.retryBulkIntakeItem": {
    kind: "customer",
    capability: "evidence",
    identity: "member",
    mutation: true,
    authority: "retry_evidence_bulk_intake_item_atomic",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "EvidenceController.retryExtraction": {
    kind: "customer",
    capability: "evidence",
    identity: "member",
    mutation: true,
    authority: "retry_evidence_text_extraction_atomic",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "EvidenceController.reuse": {
    kind: "evidence",
    capability: "evidence",
    identity: "member",
    mutation: false,
    authority: "reuse",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Retained evidence reads, audited access and manual exports remain available under source authorization.",
  },
  "EvidenceController.search": {
    kind: "evidence",
    capability: "evidence",
    identity: "member",
    mutation: false,
    authority: "search",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Retained evidence reads, audited access and manual exports remain available under source authorization.",
  },
  "EvidenceController.updateExpiryAlertIntervals": {
    kind: "customer",
    capability: "evidence",
    identity: "member",
    mutation: true,
    authority: "update_evidence_expiry_alert_intervals_atomic",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "EvidenceController.versions": {
    kind: "evidence",
    capability: "evidence",
    identity: "member",
    mutation: false,
    authority: "versions",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Retained evidence reads, audited access and manual exports remain available under source authorization.",
  },
  "EvidenceController.watermarkDelivery": {
    kind: "evidence",
    capability: "evidence",
    identity: "member",
    mutation: false,
    authority: "watermarkDelivery",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Retained evidence reads, audited access and manual exports remain available under source authorization.",
  },
  "EvidenceController.watermarkExport": {
    kind: "evidence",
    capability: "evidence",
    identity: "member",
    mutation: false,
    authority: "watermarkExport",
    evidence: "apps/api/src/evidence/evidence.controller.ts",
    reason:
      "Retained evidence reads, audited access and manual exports remain available under source authorization.",
  },
  "ExportsController.cancel": {
    kind: "evidence",
    identity: "member",
    mutation: true,
    authority: "m14_03_audit",
    evidence: "apps/api/src/exports/exports.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "ExportsController.create": {
    kind: "evidence",
    identity: "member",
    mutation: true,
    authority: "m14_03_audit",
    evidence: "apps/api/src/exports/exports.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "ExportsController.download": {
    kind: "evidence",
    identity: "member",
    mutation: false,
    authority: "download",
    evidence: "apps/api/src/exports/exports.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "ExportsController.get": {
    kind: "evidence",
    identity: "member",
    mutation: false,
    authority: "get",
    evidence: "apps/api/src/exports/exports.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "ExportsController.grant": {
    kind: "evidence",
    identity: "member",
    mutation: true,
    authority: "m14_03_audit",
    evidence: "apps/api/src/exports/exports.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "ExportsController.list": {
    kind: "evidence",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/exports/exports.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "ExportsController.manifest": {
    kind: "evidence",
    identity: "member",
    mutation: false,
    authority: "manifest",
    evidence: "apps/api/src/exports/exports.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "ExportsController.retry": {
    kind: "evidence",
    identity: "member",
    mutation: true,
    authority: "m14_03_audit",
    evidence: "apps/api/src/exports/exports.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "ProductReadinessExportsController.create": {
    kind: "evidence",
    identity: "member",
    mutation: true,
    authority: "m14_03_audit",
    evidence: "apps/api/src/exports/exports.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "PortalExportsController.cancel": {
    kind: "evidence",
    identity: "source",
    mutation: true,
    authority: "m14_03_audit",
    evidence: "apps/api/src/exports/portal-exports.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "PortalExportsController.create": {
    kind: "evidence",
    identity: "source",
    mutation: true,
    authority: "m14_03_audit",
    evidence: "apps/api/src/exports/portal-exports.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "PortalExportsController.download": {
    kind: "evidence",
    identity: "source",
    mutation: false,
    authority: "download",
    evidence: "apps/api/src/exports/portal-exports.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "PortalExportsController.get": {
    kind: "evidence",
    identity: "source",
    mutation: false,
    authority: "get",
    evidence: "apps/api/src/exports/portal-exports.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "PortalExportsController.grant": {
    kind: "evidence",
    identity: "source",
    mutation: true,
    authority: "m14_03_audit",
    evidence: "apps/api/src/exports/portal-exports.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "PortalExportsController.list": {
    kind: "evidence",
    identity: "source",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/exports/portal-exports.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "PortalExportsController.manifest": {
    kind: "evidence",
    identity: "source",
    mutation: false,
    authority: "manifest",
    evidence: "apps/api/src/exports/portal-exports.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "PortalExportsController.retry": {
    kind: "evidence",
    identity: "source",
    mutation: true,
    authority: "m14_03_audit",
    evidence: "apps/api/src/exports/portal-exports.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityAssessmentBulkController.createBulkPreview": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "create_vulnerability_assessment_bulk_preview_atomic",
    evidence:
      "apps/api/src/findings/assessments/bulk/vulnerability-assessment-bulk.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityAssessmentBulkController.createPropagationPreview": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "create_vulnerability_assessment_bulk_preview_atomic",
    evidence:
      "apps/api/src/findings/assessments/bulk/vulnerability-assessment-bulk.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityAssessmentBulkController.execute": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "execute_vulnerability_assessment_bulk_operation_atomic",
    evidence:
      "apps/api/src/findings/assessments/bulk/vulnerability-assessment-bulk.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityAssessmentBulkController.operation": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "operation",
    evidence:
      "apps/api/src/findings/assessments/bulk/vulnerability-assessment-bulk.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityAssessmentBulkController.retry": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "retry_vulnerability_assessment_bulk_operation_atomic",
    evidence:
      "apps/api/src/findings/assessments/bulk/vulnerability-assessment-bulk.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityAssessmentBulkController.undo": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "undo_vulnerability_assessment_bulk_operation_atomic",
    evidence:
      "apps/api/src/findings/assessments/bulk/vulnerability-assessment-bulk.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityAssessmentController.approvalPolicy": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "approvalPolicy",
    evidence:
      "apps/api/src/findings/assessments/vulnerability-assessment.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityAssessmentController.approveAssessment": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "approve_vulnerability_finding_vex_assessment_atomic",
    evidence:
      "apps/api/src/findings/assessments/vulnerability-assessment.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityAssessmentController.assessment": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "assessment",
    evidence:
      "apps/api/src/findings/assessments/vulnerability-assessment.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityAssessmentController.rejectAssessment": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "reject_vulnerability_finding_vex_assessment_atomic",
    evidence:
      "apps/api/src/findings/assessments/vulnerability-assessment.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityAssessmentController.submitAssessment": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "submit_vulnerability_finding_vex_assessment_atomic",
    evidence:
      "apps/api/src/findings/assessments/vulnerability-assessment.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityAssessmentController.updateApprovalPolicy": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "set_vulnerability_assessment_approval_policy_atomic",
    evidence:
      "apps/api/src/findings/assessments/vulnerability-assessment.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityVexExportController.create": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "create_vulnerability_vex_export_snapshot_atomic",
    evidence:
      "apps/api/src/findings/exports/vulnerability-vex-export.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityVexExportController.detail": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "detail",
    evidence:
      "apps/api/src/findings/exports/vulnerability-vex-export.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityVexExportController.download": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "download",
    evidence:
      "apps/api/src/findings/exports/vulnerability-vex-export.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityVexExportController.enqueuePublication": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "enqueue_vulnerability_vex_publication_atomic",
    evidence:
      "apps/api/src/findings/exports/vulnerability-vex-export.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityVexExportController.list": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence:
      "apps/api/src/findings/exports/vulnerability-vex-export.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityVexExportController.preview": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "preview",
    evidence:
      "apps/api/src/findings/exports/vulnerability-vex-export.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityVexExportController.publications": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "publications",
    evidence:
      "apps/api/src/findings/exports/vulnerability-vex-export.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityVexExportController.publicationTargets": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "publicationTargets",
    evidence:
      "apps/api/src/findings/exports/vulnerability-vex-export.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityVexExportController.retryPublication": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "retry_vulnerability_vex_publication_atomic",
    evidence:
      "apps/api/src/findings/exports/vulnerability-vex-export.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityVexExportController.updatePublicationTarget": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "set_vulnerability_vex_publication_target_atomic",
    evidence:
      "apps/api/src/findings/exports/vulnerability-vex-export.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityVexExportController.withdrawPublication": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "withdraw_vulnerability_vex_publication_atomic",
    evidence:
      "apps/api/src/findings/exports/vulnerability-vex-export.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "FindingPropagationSourcesController.register": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "register_finding_propagation_source_atomic",
    evidence: "apps/api/src/findings/findings.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "FindingPropagationSourcesController.update": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "update_finding_propagation_source_atomic",
    evidence: "apps/api/src/findings/findings.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "ProductFindingImpactSummaryController.createOverride": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "create_finding_product_impact_override_atomic",
    evidence: "apps/api/src/findings/findings.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "ProductFindingImpactSummaryController.endOverride": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "end_finding_product_impact_override_atomic",
    evidence: "apps/api/src/findings/findings.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "ProductFindingImpactSummaryController.getSummary": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "getSummary",
    evidence: "apps/api/src/findings/findings.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "JiraRemediationWebhookController.receive": {
    kind: "source",
    capability: "findings",
    identity: "source",
    mutation: true,
    authority: "record_verified_vulnerability_ticket_event_atomic",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Verified source identity must resolve tenant before licence admission and cannot trust URL/body scope.",
  },
  "VulnerabilityTriageController.assign": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "assign_finding_triage_atomic",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.correctRemediation": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "record_finding_remediation_anchor_atomic",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.createNote": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "create_finding_triage_note_atomic",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.createSavedView": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "create_finding_saved_view_atomic",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.deleteNote": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "delete_finding_triage_note_atomic",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.deleteSavedView": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "delete_finding_saved_view_atomic",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.detail": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "detail",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.dryRunRemediationTicketBinding": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "dryRunRemediationTicketBinding",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.noteMentionCandidates": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "noteMentionCandidates",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.notes": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "notes",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.previewRemediationTicket": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "previewRemediationTicket",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.queue": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "queue",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.recordRemediation": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "record_finding_remediation_anchor_atomic",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.remediation": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "remediation",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.remediationTickets": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "remediationTickets",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.replayRemediationTicket": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "reserve_vulnerability_remediation_ticket_atomic",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.requestRemediationTicketTransition": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "reserve_vulnerability_remediation_ticket_transition_atomic",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.savedViews": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "savedViews",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.setDefaultSavedView": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "set_finding_saved_view_default_atomic",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.slaPolicies": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: false,
    authority: "slaPolicies",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.suppress": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "suppress_finding_triage_atomic",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.syncRemediationTicket": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "reserve_vulnerability_remediation_ticket_atomic",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.updateNote": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "update_finding_triage_note_atomic",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.updateSavedView": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "update_finding_saved_view_atomic",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.updateSlaPolicy": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "set_vulnerability_triage_sla_policy_atomic",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityTriageController.upsertRemediationTicketBinding": {
    kind: "customer",
    capability: "findings",
    identity: "member",
    mutation: true,
    authority: "upsert_vulnerability_remediation_ticket_binding_atomic",
    evidence: "apps/api/src/findings/triage/vulnerability-triage.controller.ts",
    reason:
      "Source-owned findings operation retains its existing identity, tenant and approval checks.",
  },
  "ControlsController.archive": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: true,
    authority: "m10_control_command",
    evidence: "apps/api/src/frameworks/controls.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "ControlsController.coverage": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: false,
    authority: "coverage",
    evidence: "apps/api/src/frameworks/controls.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "ControlsController.create": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: true,
    authority: "m10_control_command",
    evidence: "apps/api/src/frameworks/controls.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "ControlsController.createMapping": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: true,
    authority: "m10_control_command",
    evidence: "apps/api/src/frameworks/controls.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "ControlsController.detail": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: false,
    authority: "detail",
    evidence: "apps/api/src/frameworks/controls.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "ControlsController.endMapping": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: true,
    authority: "m10_control_command",
    evidence: "apps/api/src/frameworks/controls.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "ControlsController.linkEvidence": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: true,
    authority: "m10_control_command",
    evidence: "apps/api/src/frameworks/controls.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "ControlsController.list": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/frameworks/controls.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "ControlsController.ownerCandidates": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: false,
    authority: "ownerCandidates",
    evidence: "apps/api/src/frameworks/controls.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "ControlsController.setApplicability": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: true,
    authority: "m10_set_framework_applicability",
    evidence: "apps/api/src/frameworks/controls.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "ControlsController.unlinkEvidence": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: true,
    authority: "m10_control_command",
    evidence: "apps/api/src/frameworks/controls.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "ControlsController.update": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: true,
    authority: "m10_control_command",
    evidence: "apps/api/src/frameworks/controls.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "ControlsController.updateMapping": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: true,
    authority: "m10_control_command",
    evidence: "apps/api/src/frameworks/controls.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "CustomFrameworksController.create": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: true,
    authority: "m10_custom_pack_command",
    evidence: "apps/api/src/frameworks/custom-frameworks.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "CustomFrameworksController.detail": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: false,
    authority: "detail",
    evidence: "apps/api/src/frameworks/custom-frameworks.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "CustomFrameworksController.export": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: false,
    authority: "export",
    evidence: "apps/api/src/frameworks/custom-frameworks.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "CustomFrameworksController.list": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/frameworks/custom-frameworks.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "CustomFrameworksController.update": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: true,
    authority: "m10_custom_pack_command",
    evidence: "apps/api/src/frameworks/custom-frameworks.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "CustomFrameworksController.validate": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: true,
    authority: "m10_custom_pack_validate",
    evidence: "apps/api/src/frameworks/custom-frameworks.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "FrameworksController.catalog": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: false,
    authority: "catalog",
    evidence: "apps/api/src/frameworks/frameworks.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "FrameworksController.select": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: true,
    authority: "m10_select_framework_version",
    evidence: "apps/api/src/frameworks/frameworks.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "FrameworksController.tree": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: false,
    authority: "tree",
    evidence: "apps/api/src/frameworks/frameworks.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "UpgradesController.commit": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: true,
    authority: "m10_commit_upgrade",
    evidence: "apps/api/src/frameworks/upgrades.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "UpgradesController.createReview": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: true,
    authority: "m10_create_upgrade_review",
    evidence: "apps/api/src/frameworks/upgrades.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "UpgradesController.crosswalks": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: false,
    authority: "crosswalks",
    evidence: "apps/api/src/frameworks/upgrades.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "UpgradesController.decide": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: true,
    authority: "m10_set_upgrade_decision",
    evidence: "apps/api/src/frameworks/upgrades.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "UpgradesController.evidenceReuse": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: false,
    authority: "evidenceReuse",
    evidence: "apps/api/src/frameworks/upgrades.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "UpgradesController.preview": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: false,
    authority: "preview",
    evidence: "apps/api/src/frameworks/upgrades.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "UpgradesController.review": {
    kind: "customer",
    capability: "frameworks",
    identity: "member",
    mutation: false,
    authority: "review",
    evidence: "apps/api/src/frameworks/upgrades.controller.ts",
    reason:
      "Source-owned frameworks operation retains its existing identity, tenant and approval checks.",
  },
  "HealthController.liveness": {
    kind: "security",
    identity: "public",
    mutation: false,
    authority: "liveness",
    evidence: "apps/api/src/health/health.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "HealthController.readiness": {
    kind: "security",
    identity: "public",
    mutation: false,
    authority: "readiness",
    evidence: "apps/api/src/health/health.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "InvitationsController.accept": {
    kind: "source",
    capability: "administration",
    identity: "source",
    mutation: true,
    authority: "accept_invitation_atomic",
    evidence: "apps/api/src/invitations/invitations.controller.ts",
    reason:
      "Invitation identity must determine tenant; acceptance transfers reserved seats transactionally.",
  },
  "InvitationsController.create": {
    kind: "customer",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "m13_01_create_invitation_atomic",
    evidence: "apps/api/src/invitations/invitations.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "InvitationsController.list": {
    kind: "customer",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/invitations/invitations.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "InvitationsController.resend": {
    kind: "customer",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "resend_invitation_atomic",
    evidence: "apps/api/src/invitations/invitations.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "InvitationsController.revoke": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "revoke_invitation_atomic",
    evidence: "apps/api/src/invitations/invitations.controller.ts",
    reason: "Credential revocation cannot be blocked by a licence.",
  },
  "LicensingUsageController.getUsage": {
    kind: "protective",
    identity: "member",
    mutation: false,
    authority: "getUsage",
    evidence: "apps/api/src/licensing/licensing-usage.controller.ts",
    reason:
      "Normally authorized aggregate diagnostics remain available under expiry.",
  },
  "LicensingUsageController.exportUsage": {
    kind: "evidence",
    identity: "member",
    mutation: true,
    authority: "m15_02_export_usage",
    evidence: "apps/api/src/licensing/licensing-usage.controller.ts",
    reason:
      "Audited usage snapshots are protected local exports, never customer growth.",
  },
  "LicensingUsageController.reconcileUsage": {
    kind: "protective",
    identity: "member",
    mutation: true,
    authority: "m15_02_reconcile_usage",
    evidence: "apps/api/src/licensing/licensing-usage.controller.ts",
    reason:
      "Authorized bounded accounting repair preserves source data and licence authority.",
  },
  "LicensingController.activate": {
    kind: "renewal",
    identity: "member",
    mutation: true,
    authority: "activate",
    evidence: "apps/api/src/licensing/licensing.controller.ts",
    reason:
      "Source-owned renewal operation retains its existing identity, tenant and approval checks.",
  },
  "LicensingController.current": {
    kind: "renewal",
    identity: "member",
    mutation: false,
    authority: "current",
    evidence: "apps/api/src/licensing/licensing.controller.ts",
    reason:
      "Source-owned renewal operation retains its existing identity, tenant and approval checks.",
  },
  "LicensingController.history": {
    kind: "renewal",
    identity: "member",
    mutation: false,
    authority: "history",
    evidence: "apps/api/src/licensing/licensing.controller.ts",
    reason:
      "Source-owned renewal operation retains its existing identity, tenant and approval checks.",
  },
  "LicensingController.policy": {
    kind: "renewal",
    identity: "member",
    mutation: false,
    authority: "policy",
    evidence: "apps/api/src/licensing/licensing.controller.ts",
    reason:
      "Source-owned renewal operation retains its existing identity, tenant and approval checks.",
  },
  "BoundedUploadController.upload": {
    kind: "admission-finalization",
    capability: "evidence",
    identity: "source",
    mutation: true,
    authority: "upload",
    evidence: "apps/api/src/licensing/uploads/bounded-upload.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "NotificationsController.burstBatches": {
    kind: "customer",
    capability: "notifications",
    identity: "member",
    mutation: false,
    authority: "burstBatches",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Source-owned notifications operation retains its existing identity, tenant and approval checks.",
  },
  "NotificationsController.burstPolicy": {
    kind: "customer",
    capability: "notifications",
    identity: "member",
    mutation: false,
    authority: "burstPolicy",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Source-owned notifications operation retains its existing identity, tenant and approval checks.",
  },
  "NotificationsController.chatChannels": {
    kind: "customer",
    capability: "notifications",
    identity: "member",
    mutation: false,
    authority: "chatChannels",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Source-owned notifications operation retains its existing identity, tenant and approval checks.",
  },
  "NotificationsController.chatDeliveries": {
    kind: "customer",
    capability: "notifications",
    identity: "member",
    mutation: false,
    authority: "chatDeliveries",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Source-owned notifications operation retains its existing identity, tenant and approval checks.",
  },
  "NotificationsController.confirmChatChannel": {
    kind: "customer",
    capability: "notifications",
    identity: "member",
    mutation: true,
    authority: "m12_05_confirm_chat_channel_atomic",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Source-owned notifications operation retains its existing identity, tenant and approval checks.",
  },
  "NotificationsController.createChatChannel": {
    kind: "customer",
    capability: "notifications",
    identity: "member",
    mutation: true,
    authority: "m12_05_create_chat_channel_atomic",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Source-owned notifications operation retains its existing identity, tenant and approval checks.",
  },
  "NotificationsController.criticalRoute": {
    kind: "customer",
    capability: "notifications",
    identity: "member",
    mutation: false,
    authority: "criticalRoute",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Source-owned notifications operation retains its existing identity, tenant and approval checks.",
  },
  "NotificationsController.deliveries": {
    kind: "protective",
    capability: "notifications",
    identity: "member",
    mutation: false,
    authority: "deliveries",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Protective source notifications and audited acknowledgement continue.",
  },
  "NotificationsController.enableChatChannel": {
    kind: "customer",
    capability: "notifications",
    identity: "member",
    mutation: true,
    authority: "m12_05_set_chat_channel_enabled_atomic",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Source-owned notifications operation retains its existing identity, tenant and approval checks.",
  },
  "NotificationsController.feed": {
    kind: "protective",
    capability: "notifications",
    identity: "member",
    mutation: false,
    authority: "feed",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Protective source notifications and audited acknowledgement continue.",
  },
  "NotificationsController.feedDestination": {
    kind: "protective",
    capability: "notifications",
    identity: "member",
    mutation: false,
    authority: "feedDestination",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Protective source notifications and audited acknowledgement continue.",
  },
  "NotificationsController.feedUnreadCount": {
    kind: "protective",
    capability: "notifications",
    identity: "member",
    mutation: false,
    authority: "feedUnreadCount",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Protective source notifications and audited acknowledgement continue.",
  },
  "NotificationsController.markFeedRead": {
    kind: "protective",
    capability: "notifications",
    identity: "member",
    mutation: true,
    authority: "mark_notification_feed_read_atomic",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Protective source notifications and audited acknowledgement continue.",
  },
  "NotificationsController.preferences": {
    kind: "customer",
    capability: "notifications",
    identity: "member",
    mutation: false,
    authority: "preferences",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Source-owned notifications operation retains its existing identity, tenant and approval checks.",
  },
  "NotificationsController.retry": {
    kind: "protective",
    capability: "notifications",
    identity: "member",
    mutation: true,
    authority: "retry_notification_dispatch_atomic",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Protective source notifications and audited acknowledgement continue.",
  },
  "NotificationsController.retryChatDelivery": {
    kind: "protective",
    capability: "notifications",
    identity: "member",
    mutation: true,
    authority: "m12_05_retry_chat_delivery_atomic",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Protective source notifications and audited acknowledgement continue.",
  },
  "NotificationsController.testChatChannel": {
    kind: "customer",
    capability: "notifications",
    identity: "member",
    mutation: true,
    authority: "m12_05_begin_chat_channel_test_atomic",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Source-owned notifications operation retains its existing identity, tenant and approval checks.",
  },
  "NotificationsController.updateBurstPolicy": {
    kind: "customer",
    capability: "notifications",
    identity: "member",
    mutation: true,
    authority: "update_notification_burst_policy_atomic",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Source-owned notifications operation retains its existing identity, tenant and approval checks.",
  },
  "NotificationsController.updateChatChannel": {
    kind: "customer",
    capability: "notifications",
    identity: "member",
    mutation: true,
    authority: "m12_05_update_chat_channel_atomic",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Source-owned notifications operation retains its existing identity, tenant and approval checks.",
  },
  "NotificationsController.updateCriticalRoute": {
    kind: "customer",
    capability: "notifications",
    identity: "member",
    mutation: true,
    authority: "update_critical_notification_route_atomic",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Source-owned notifications operation retains its existing identity, tenant and approval checks.",
  },
  "NotificationsController.updatePreferences": {
    kind: "customer",
    capability: "notifications",
    identity: "member",
    mutation: true,
    authority: "update_notification_preferences_atomic",
    evidence: "apps/api/src/notifications/notifications.controller.ts",
    reason:
      "Source-owned notifications operation retains its existing identity, tenant and approval checks.",
  },
  "BrandingController.preview": {
    kind: "evidence",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "preview",
    evidence: "apps/api/src/organizations/branding/branding.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "BrandingController.publish": {
    kind: "customer",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "publish_organization_branding_atomic",
    evidence: "apps/api/src/organizations/branding/branding.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "BrandingController.removeLogo": {
    kind: "customer",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "remove_organization_branding_logo_atomic",
    evidence: "apps/api/src/organizations/branding/branding.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "BrandingController.renderLogo": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "renderLogo",
    evidence: "apps/api/src/organizations/branding/branding.controller.ts",
    reason: "Incumbent shell branding does not grant feature access.",
  },
  "BrandingController.renderPublishedLogo": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "renderPublishedLogo",
    evidence: "apps/api/src/organizations/branding/branding.controller.ts",
    reason: "Incumbent shell branding does not grant feature access.",
  },
  "BrandingController.resolved": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "resolved",
    evidence: "apps/api/src/organizations/branding/branding.controller.ts",
    reason: "Incumbent shell branding does not grant feature access.",
  },
  "BrandingController.saveDraft": {
    kind: "customer",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "save_organization_branding_draft_atomic",
    evidence: "apps/api/src/organizations/branding/branding.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "BrandingController.uploadLogo": {
    kind: "customer",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "finalize_organization_branding_asset_upload_atomic",
    evidence: "apps/api/src/organizations/branding/branding.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "LegalEntitiesController.activate": {
    kind: "customer",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "transition_organization_legal_entity_atomic",
    evidence:
      "apps/api/src/organizations/legal-entities/legal-entities.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "LegalEntitiesController.create": {
    kind: "customer",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "create_organization_legal_entity_atomic",
    evidence:
      "apps/api/src/organizations/legal-entities/legal-entities.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "LegalEntitiesController.deactivate": {
    kind: "customer",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "transition_organization_legal_entity_atomic",
    evidence:
      "apps/api/src/organizations/legal-entities/legal-entities.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "LegalEntitiesController.get": {
    kind: "evidence",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "get",
    evidence:
      "apps/api/src/organizations/legal-entities/legal-entities.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "LegalEntitiesController.list": {
    kind: "evidence",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence:
      "apps/api/src/organizations/legal-entities/legal-entities.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "LegalEntitiesController.softDelete": {
    kind: "customer",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "transition_organization_legal_entity_atomic",
    evidence:
      "apps/api/src/organizations/legal-entities/legal-entities.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "LegalEntitiesController.update": {
    kind: "customer",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "update_organization_legal_entity_atomic",
    evidence:
      "apps/api/src/organizations/legal-entities/legal-entities.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "OrganizationsController.create": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "create_organization_atomic",
    evidence: "apps/api/src/organizations/organizations.controller.ts",
    reason:
      "Verified identity and tenant selection remain accessible for bootstrap and renewal.",
  },
  "OrganizationsController.current": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "current",
    evidence: "apps/api/src/organizations/organizations.controller.ts",
    reason:
      "Verified identity and tenant selection remain accessible for bootstrap and renewal.",
  },
  "OrganizationsController.onboarding": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "onboarding",
    evidence: "apps/api/src/organizations/organizations.controller.ts",
    reason:
      "Verified identity and tenant selection remain accessible for bootstrap and renewal.",
  },
  "OrganizationsController.switch": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "switch_organization_atomic",
    evidence: "apps/api/src/organizations/organizations.controller.ts",
    reason:
      "Verified identity and tenant selection remain accessible for bootstrap and renewal.",
  },
  "OrganizationsController.updateLegalProfile": {
    kind: "customer",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "update_organization_legal_profile_atomic",
    evidence: "apps/api/src/organizations/organizations.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "TenantAdministrationController.deactivate": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "deactivate_organization_atomic",
    evidence:
      "apps/api/src/organizations/tenant-administration/tenant-administration.controller.ts",
    reason:
      "Existing tenant security lifecycle remains subject to source authorization.",
  },
  "TenantAdministrationController.downloadExport": {
    kind: "evidence",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "downloadExport",
    evidence:
      "apps/api/src/organizations/tenant-administration/tenant-administration.controller.ts",
    reason: "Authenticated tenant evidence exports remain available.",
  },
  "TenantAdministrationController.exportStatus": {
    kind: "evidence",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "exportStatus",
    evidence:
      "apps/api/src/organizations/tenant-administration/tenant-administration.controller.ts",
    reason: "Authenticated tenant evidence exports remain available.",
  },
  "TenantAdministrationController.latestExport": {
    kind: "evidence",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "latestExport",
    evidence:
      "apps/api/src/organizations/tenant-administration/tenant-administration.controller.ts",
    reason: "Authenticated tenant evidence exports remain available.",
  },
  "TenantAdministrationController.lifecycle": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "lifecycle",
    evidence:
      "apps/api/src/organizations/tenant-administration/tenant-administration.controller.ts",
    reason:
      "Existing tenant security lifecycle remains subject to source authorization.",
  },
  "TenantAdministrationController.reauthenticate": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "create_destructive_reauth_grant_atomic",
    evidence:
      "apps/api/src/organizations/tenant-administration/tenant-administration.controller.ts",
    reason:
      "Existing tenant security lifecycle remains subject to source authorization.",
  },
  "TenantAdministrationController.recover": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "recover_organization_atomic",
    evidence:
      "apps/api/src/organizations/tenant-administration/tenant-administration.controller.ts",
    reason:
      "Existing tenant security lifecycle remains subject to source authorization.",
  },
  "TenantAdministrationController.requestExport": {
    kind: "evidence",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "request_organization_export_atomic",
    evidence:
      "apps/api/src/organizations/tenant-administration/tenant-administration.controller.ts",
    reason: "Authenticated tenant evidence exports remain available.",
  },
  "TenantAdministrationController.retention": {
    kind: "evidence",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "retention",
    evidence:
      "apps/api/src/organizations/tenant-administration/tenant-administration.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "TenantAdministrationController.schedulePurge": {
    kind: "customer",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "schedule_organization_purge_atomic",
    evidence:
      "apps/api/src/organizations/tenant-administration/tenant-administration.controller.ts",
    reason:
      "Licence policy never independently authorizes retention or deletion.",
  },
  "TenantAdministrationController.settings": {
    kind: "evidence",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "settings",
    evidence:
      "apps/api/src/organizations/tenant-administration/tenant-administration.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "TenantAdministrationController.settingsCatalog": {
    kind: "evidence",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "settingsCatalog",
    evidence:
      "apps/api/src/organizations/tenant-administration/tenant-administration.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "TenantAdministrationController.updateRetention": {
    kind: "customer",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "update_organization_retention_policy_atomic",
    evidence:
      "apps/api/src/organizations/tenant-administration/tenant-administration.controller.ts",
    reason:
      "Licence policy never independently authorizes retention or deletion.",
  },
  "TenantAdministrationController.updateSettings": {
    kind: "customer",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "update_organization_settings_atomic",
    evidence:
      "apps/api/src/organizations/tenant-administration/tenant-administration.controller.ts",
    reason:
      "Source-owned administration operation retains its existing identity, tenant and approval checks.",
  },
  "CustomRolesController.create": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "m13_01_mutate_role_atomic",
    evidence: "apps/api/src/permissions/custom-roles.controller.ts",
    reason:
      "RBAC maintenance remains under existing authorization independent of entitlements.",
  },
  "CustomRolesController.list": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/permissions/custom-roles.controller.ts",
    reason:
      "RBAC maintenance remains under existing authorization independent of entitlements.",
  },
  "CustomRolesController.overrides": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "overrides",
    evidence: "apps/api/src/permissions/custom-roles.controller.ts",
    reason:
      "RBAC maintenance remains under existing authorization independent of entitlements.",
  },
  "CustomRolesController.remove": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "m13_01_mutate_role_atomic",
    evidence: "apps/api/src/permissions/custom-roles.controller.ts",
    reason:
      "RBAC maintenance remains under existing authorization independent of entitlements.",
  },
  "CustomRolesController.setOverride": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "m13_01_mutate_role_atomic",
    evidence: "apps/api/src/permissions/custom-roles.controller.ts",
    reason:
      "RBAC maintenance remains under existing authorization independent of entitlements.",
  },
  "CustomRolesController.update": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "m13_01_mutate_role_atomic",
    evidence: "apps/api/src/permissions/custom-roles.controller.ts",
    reason:
      "RBAC maintenance remains under existing authorization independent of entitlements.",
  },
  "PermissionsController.catalogue": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "catalogue",
    evidence: "apps/api/src/permissions/permissions.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "PermissionsController.check": {
    kind: "security",
    identity: "member",
    mutation: true,
    authority: "check",
    evidence: "apps/api/src/permissions/permissions.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "PermissionsController.effective": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "effective",
    evidence: "apps/api/src/permissions/permissions.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "PermissionsController.menu": {
    kind: "security",
    identity: "member",
    mutation: false,
    authority: "menu",
    evidence: "apps/api/src/permissions/permissions.controller.ts",
    reason:
      "Source-owned security operation retains its existing identity, tenant and approval checks.",
  },
  "ProductImportsController.cancel": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "cancel_product_import_job",
    evidence: "apps/api/src/products/imports/product-imports.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductImportsController.commit": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "commit_product_import_atomic",
    evidence: "apps/api/src/products/imports/product-imports.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductImportsController.dryRun": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "create_product_import_job",
    evidence: "apps/api/src/products/imports/product-imports.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductImportsController.get": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "get",
    evidence: "apps/api/src/products/imports/product-imports.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductImportsController.list": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/products/imports/product-imports.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductImportsController.report": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "report",
    evidence: "apps/api/src/products/imports/product-imports.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductImportsController.rows": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "rows",
    evidence: "apps/api/src/products/imports/product-imports.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductImportsController.template": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "template",
    evidence: "apps/api/src/products/imports/product-imports.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductClassificationsController.history": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "history",
    evidence: "apps/api/src/products/product-classifications.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductClassificationsController.latest": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "latest",
    evidence: "apps/api/src/products/product-classifications.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductClassificationsController.policy": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "policy",
    evidence: "apps/api/src/products/product-classifications.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductClassificationsController.save": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "save_product_classification_atomic",
    evidence: "apps/api/src/products/product-classifications.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductOwnersController.list": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/products/product-owners.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.addReleaseMarketAvailability": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "add_product_release_market_availability_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.appendSoftwareBaselineRevision": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "append_software_baseline_revision_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.archive": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "archive_product_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.archiveRelease": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "archive_product_release_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.archiveSoftwareBaseline": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "archive_software_baseline_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.assignLegalEntity": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "assign_product_legal_entity_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.assignSoftwareBaselineMembership": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "assign_software_baseline_membership_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.correctPlacedOnMarketDate": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "correct_product_release_placed_on_market_at_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.correctReleaseMarketAvailability": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "correct_product_release_market_availability_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.create": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "create_product_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.createProductComponentLink": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "create_product_component_link_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.createProductVariantRelationship": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "create_product_variant_relationship_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.createRelease": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "create_product_release_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.createSoftwareBaseline": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "create_software_baseline_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.createSubstantialModificationAssessment": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "create_product_substantial_modification_assessment_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.createSubstantialModificationAssessmentDraft": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority:
      "create_product_substantial_modification_assessment_draft_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.createSupportPeriod": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "create_product_support_period_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.downloadSecurityUpdateArtifact": {
    kind: "evidence",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "downloadSecurityUpdateArtifact",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Retained safety artifacts and retention evidence remain accessible.",
  },
  "ProductsController.endProductComponentLink": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "end_product_component_link_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.endProductVariantRelationship": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "end_product_variant_relationship_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.endSoftwareBaselineMembership": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "end_software_baseline_membership_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.finalizeSecurityUpdateArtifact": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "finalize_product_security_update_artifact_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.get": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "get",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.getProductComponentLinks": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "getProductComponentLinks",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.getProductRelationshipGraph": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "getProductRelationshipGraph",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.getProductRetentionCalculation": {
    kind: "evidence",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "getProductRetentionCalculation",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Retained safety artifacts and retention evidence remain accessible.",
  },
  "ProductsController.getProductVariantRelationships": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "getProductVariantRelationships",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.getRelationshipPropagationEvents": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "getRelationshipPropagationEvents",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.getRelease": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "getRelease",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.getReleaseLifecycleTimeline": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "getReleaseLifecycleTimeline",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.getReleaseMarketAvailability": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "getReleaseMarketAvailability",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.getSecurityUpdateArtifact": {
    kind: "evidence",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "getSecurityUpdateArtifact",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Retained safety artifacts and retention evidence remain accessible.",
  },
  "ProductsController.getSoftwareBaselineHistory": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "getSoftwareBaselineHistory",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.getSoftwareBaselineMemberships": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "getSoftwareBaselineMemberships",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.getSubstantialModificationAssessment": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "getSubstantialModificationAssessment",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.getSupportAlertHistory": {
    kind: "evidence",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "getSupportAlertHistory",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Retained safety artifacts and retention evidence remain accessible.",
  },
  "ProductsController.getSupportAlertIntervals": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "getSupportAlertIntervals",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.getSupportPeriods": {
    kind: "evidence",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "getSupportPeriods",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Retained safety artifacts and retention evidence remain accessible.",
  },
  "ProductsController.list": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.listMemberStates": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "listMemberStates",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.listReleases": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "listReleases",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.listSecurityUpdateArtifacts": {
    kind: "evidence",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "listSecurityUpdateArtifacts",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Retained safety artifacts and retention evidence remain accessible.",
  },
  "ProductsController.listSoftwareBaselines": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "listSoftwareBaselines",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.listSubstantialModificationAssessments": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: false,
    authority: "listSubstantialModificationAssessments",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.previewProductComponentLink": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "preview_product_component_link",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.previewSupportPeriodChange": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "preview_product_support_period_change",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.publishSecurityUpdateArtifact": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "publish_product_security_update_artifact_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.reassessSubstantialModificationAssessment": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "reassess_product_substantial_modification_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.removeReleaseMarketAvailability": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "remove_product_release_market_availability_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.replaceSecurityUpdateArtifact": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "replace_product_security_update_artifact_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.requestRelationshipReevaluation": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "request_product_relationship_reevaluation_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.reserveSecurityUpdateArtifact": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "reserve_product_security_update_artifact_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.reviewSecurityUpdateArtifact": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "review_product_security_update_artifact_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.reviewSubstantialModificationAssessment": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "review_product_substantial_modification_assessment_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.supersedeProductComponentLink": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "supersede_product_component_link_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.supersedeSupportPeriod": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "supersede_product_support_period_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.transitionReleaseLifecycle": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "transition_product_release_lifecycle_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.update": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "update_product_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.updateRelease": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "update_product_release_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.updateSecurityUpdateArtifactMetadata": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "update_product_security_update_artifact_metadata_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.updateSupportAlertIntervals": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "update_organization_support_alert_intervals_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ProductsController.withdrawSecurityUpdateArtifact": {
    kind: "customer",
    capability: "products",
    identity: "member",
    mutation: true,
    authority: "withdraw_product_security_update_artifact_atomic",
    evidence: "apps/api/src/products/products.controller.ts",
    reason:
      "Source-owned products operation retains its existing identity, tenant and approval checks.",
  },
  "ReportingObligationController.acquireStageDraftLock": {
    kind: "regulatory",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "acquire_reporting_stage_draft_lock_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "M6 must prove an obligation predates the protection transition; human source approvals remain mandatory.",
  },
  "ReportingObligationController.appendStageAcknowledgement": {
    kind: "regulatory",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "append_reporting_stage_acknowledgement_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "M6 must prove an obligation predates the protection transition; human source approvals remain mandatory.",
  },
  "ReportingObligationController.applyTemplate": {
    kind: "regulatory",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "apply_reporting_family_template_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "M6 must prove an obligation predates the protection transition; human source approvals remain mandatory.",
  },
  "ReportingObligationController.approveStageDraft": {
    kind: "regulatory",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "approve_reporting_stage_draft_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "M6 must prove an obligation predates the protection transition; human source approvals remain mandatory.",
  },
  "ReportingObligationController.cancel": {
    kind: "customer",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "cancel_reporting_obligation_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "Changing deadline authority or cancelling obligations is not automatic expiry continuation.",
  },
  "ReportingObligationController.correctAnchor": {
    kind: "customer",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "correct_reporting_obligation_anchor_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "Changing deadline authority or cancelling obligations is not automatic expiry continuation.",
  },
  "ReportingObligationController.create": {
    kind: "customer",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "create_reporting_obligation_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "Source-owned reporting operation retains its existing identity, tenant and approval checks.",
  },
  "ReportingObligationController.createStageDraft": {
    kind: "regulatory",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "create_reporting_stage_draft_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "M6 must prove an obligation predates the protection transition; human source approvals remain mandatory.",
  },
  "ReportingObligationController.createTemplate": {
    kind: "customer",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "create_reporting_family_template_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "Source-owned reporting operation retains its existing identity, tenant and approval checks.",
  },
  "ReportingObligationController.createTemplateVersion": {
    kind: "customer",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "update_reporting_family_template_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "Source-owned reporting operation retains its existing identity, tenant and approval checks.",
  },
  "ReportingObligationController.deadlineSummary": {
    kind: "evidence",
    capability: "reporting",
    identity: "member",
    mutation: false,
    authority: "deadlineSummary",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "Retained regulatory evidence and deadline visibility remain available.",
  },
  "ReportingObligationController.detail": {
    kind: "evidence",
    capability: "reporting",
    identity: "member",
    mutation: false,
    authority: "detail",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "Retained regulatory evidence and deadline visibility remain available.",
  },
  "ReportingObligationController.downloadEvidencePack": {
    kind: "evidence",
    capability: "reporting",
    identity: "member",
    mutation: false,
    authority: "downloadEvidencePack",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "Retained regulatory evidence and deadline visibility remain available.",
  },
  "ReportingObligationController.downloadStagePackage": {
    kind: "evidence",
    capability: "reporting",
    identity: "member",
    mutation: false,
    authority: "downloadStagePackage",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "Retained regulatory evidence and deadline visibility remain available.",
  },
  "ReportingObligationController.generateEvidencePack": {
    kind: "evidence",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "finalize_reporting_obligation_evidence_pack_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason: "Manual regulatory evidence export remains available.",
  },
  "ReportingObligationController.generateStagePackage": {
    kind: "regulatory",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "finalize_reporting_stage_package_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "M6 must prove an obligation predates the protection transition; human source approvals remain mandatory.",
  },
  "ReportingObligationController.getStageDraft": {
    kind: "evidence",
    capability: "reporting",
    identity: "member",
    mutation: false,
    authority: "getStageDraft",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "Retained regulatory evidence and deadline visibility remain available.",
  },
  "ReportingObligationController.list": {
    kind: "evidence",
    capability: "reporting",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "Retained regulatory evidence and deadline visibility remain available.",
  },
  "ReportingObligationController.listTemplates": {
    kind: "customer",
    capability: "reporting",
    identity: "member",
    mutation: false,
    authority: "listTemplates",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "Source-owned reporting operation retains its existing identity, tenant and approval checks.",
  },
  "ReportingObligationController.reauthenticateStageApproval": {
    kind: "regulatory",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "create_reporting_stage_approval_proof_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "M6 must prove an obligation predates the protection transition; human source approvals remain mandatory.",
  },
  "ReportingObligationController.reauthenticateStageFiling": {
    kind: "regulatory",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "create_reporting_stage_filing_proof_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "M6 must prove an obligation predates the protection transition; human source approvals remain mandatory.",
  },
  "ReportingObligationController.recordStageExternalFiling": {
    kind: "regulatory",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "record_reporting_stage_filing_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "M6 must prove an obligation predates the protection transition; human source approvals remain mandatory.",
  },
  "ReportingObligationController.recordSubmission": {
    kind: "regulatory",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "record_reporting_obligation_stage_submission_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "M6 must prove an obligation predates the protection transition; human source approvals remain mandatory.",
  },
  "ReportingObligationController.saveStageDraft": {
    kind: "regulatory",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "save_reporting_stage_draft_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "M6 must prove an obligation predates the protection transition; human source approvals remain mandatory.",
  },
  "ReportingObligationController.stageEvidenceTimeline": {
    kind: "evidence",
    capability: "reporting",
    identity: "member",
    mutation: false,
    authority: "stageEvidenceTimeline",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "Retained regulatory evidence and deadline visibility remain available.",
  },
  "ReportingObligationController.submitStageDraft": {
    kind: "regulatory",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "submit_reporting_stage_draft_atomic",
    evidence: "apps/api/src/reporting/reporting-obligation.controller.ts",
    reason:
      "M6 must prove an obligation predates the protection transition; human source approvals remain mandatory.",
  },
  "ReportingRehearsalController.create": {
    kind: "customer",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "create_reporting_rehearsal_atomic",
    evidence: "apps/api/src/reporting/reporting-rehearsal.controller.ts",
    reason:
      "Source-owned reporting operation retains its existing identity, tenant and approval checks.",
  },
  "ReportingRehearsalController.recordSyntheticFiling": {
    kind: "customer",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "record_reporting_stage_rehearsal_filing_atomic",
    evidence: "apps/api/src/reporting/reporting-rehearsal.controller.ts",
    reason:
      "Source-owned reporting operation retains its existing identity, tenant and approval checks.",
  },
  "ReportingRehearsalController.replay": {
    kind: "customer",
    capability: "reporting",
    identity: "member",
    mutation: true,
    authority: "replay_reporting_rehearsal_atomic",
    evidence: "apps/api/src/reporting/reporting-rehearsal.controller.ts",
    reason:
      "Source-owned reporting operation retains its existing identity, tenant and approval checks.",
  },
  "ReportsController.activate": {
    kind: "customer",
    capability: "scheduled_reports",
    identity: "member",
    mutation: true,
    authority: "m14_04_mutate_definition",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Source-owned scheduled_reports operation retains its existing identity, tenant and approval checks.",
  },
  "ReportsController.adminPause": {
    kind: "security",
    capability: "scheduled_reports",
    identity: "member",
    mutation: true,
    authority: "m14_04_admin_pause",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Stop or revoke existing external/customer authority without starting new customer work.",
  },
  "ReportsController.archive": {
    kind: "security",
    capability: "scheduled_reports",
    identity: "member",
    mutation: true,
    authority: "m14_04_mutate_definition",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Stop or revoke existing external/customer authority without starting new customer work.",
  },
  "ReportsController.create": {
    kind: "customer",
    capability: "scheduled_reports",
    identity: "member",
    mutation: true,
    authority: "m14_04_create_definition",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Source-owned scheduled_reports operation retains its existing identity, tenant and approval checks.",
  },
  "ReportsController.download": {
    kind: "evidence",
    capability: "scheduled_reports",
    identity: "member",
    mutation: false,
    authority: "download",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Published report artifacts remain accessible; this does not authorize scheduled generation.",
  },
  "ReportsController.emailPreference": {
    kind: "security",
    capability: "scheduled_reports",
    identity: "member",
    mutation: false,
    authority: "emailPreference",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Users may stop delivery without licensing approving new report generation.",
  },
  "ReportsController.get": {
    kind: "customer",
    capability: "scheduled_reports",
    identity: "member",
    mutation: false,
    authority: "get",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Source-owned scheduled_reports operation retains its existing identity, tenant and approval checks.",
  },
  "ReportsController.getRun": {
    kind: "evidence",
    capability: "scheduled_reports",
    identity: "member",
    mutation: false,
    authority: "getRun",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Published report artifacts remain accessible; this does not authorize scheduled generation.",
  },
  "ReportsController.grant": {
    kind: "evidence",
    capability: "scheduled_reports",
    identity: "member",
    mutation: true,
    authority: "m14_04_grant",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Published report artifacts remain accessible; this does not authorize scheduled generation.",
  },
  "ReportsController.list": {
    kind: "customer",
    capability: "scheduled_reports",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Source-owned scheduled_reports operation retains its existing identity, tenant and approval checks.",
  },
  "ReportsController.listAdministration": {
    kind: "customer",
    capability: "scheduled_reports",
    identity: "member",
    mutation: false,
    authority: "listAdministration",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Source-owned scheduled_reports operation retains its existing identity, tenant and approval checks.",
  },
  "ReportsController.listRuns": {
    kind: "evidence",
    capability: "scheduled_reports",
    identity: "member",
    mutation: false,
    authority: "listRuns",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Published report artifacts remain accessible; this does not authorize scheduled generation.",
  },
  "ReportsController.manifest": {
    kind: "evidence",
    capability: "scheduled_reports",
    identity: "member",
    mutation: false,
    authority: "manifest",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Published report artifacts remain accessible; this does not authorize scheduled generation.",
  },
  "ReportsController.pause": {
    kind: "security",
    capability: "scheduled_reports",
    identity: "member",
    mutation: true,
    authority: "m14_04_mutate_definition",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Stop or revoke existing external/customer authority without starting new customer work.",
  },
  "ReportsController.preview": {
    kind: "customer",
    capability: "scheduled_reports",
    identity: "member",
    mutation: true,
    authority: "m14_04_preview",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Source-owned scheduled_reports operation retains its existing identity, tenant and approval checks.",
  },
  "ReportsController.recipients": {
    kind: "evidence",
    capability: "scheduled_reports",
    identity: "member",
    mutation: false,
    authority: "recipients",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Published report artifacts remain accessible; this does not authorize scheduled generation.",
  },
  "ReportsController.replay": {
    kind: "customer",
    capability: "scheduled_reports",
    identity: "member",
    mutation: true,
    authority: "m14_04_replay",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Source-owned scheduled_reports operation retains its existing identity, tenant and approval checks.",
  },
  "ReportsController.resume": {
    kind: "customer",
    capability: "scheduled_reports",
    identity: "member",
    mutation: true,
    authority: "m14_04_mutate_definition",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Source-owned scheduled_reports operation retains its existing identity, tenant and approval checks.",
  },
  "ReportsController.setEmailPreference": {
    kind: "security",
    capability: "scheduled_reports",
    identity: "member",
    mutation: true,
    authority: "m14_04_set_email_preference",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Users may stop delivery without licensing approving new report generation.",
  },
  "ReportsController.update": {
    kind: "customer",
    capability: "scheduled_reports",
    identity: "member",
    mutation: true,
    authority: "m14_04_update_definition",
    evidence: "apps/api/src/reports/reports.controller.ts",
    reason:
      "Source-owned scheduled_reports operation retains its existing identity, tenant and approval checks.",
  },
  "CiProviderWebhookController.receive": {
    kind: "source",
    capability: "sboms",
    identity: "source",
    mutation: true,
    authority: "record_ci_provider_webhook_event_atomic",
    evidence:
      "apps/api/src/sboms/ci-providers/ci-provider-webhook.controller.ts",
    reason:
      "Verified source identity must resolve tenant before licence admission and cannot trust URL/body scope.",
  },
  "SbomCiCredentialsController.create": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: true,
    authority: "m13_01_audit_sbom_ci_credential",
    evidence: "apps/api/src/sboms/sbom-ci-credentials.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SbomCiCredentialsController.list": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/sboms/sbom-ci-credentials.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SbomCiCredentialsController.revoke": {
    kind: "security",
    capability: "sboms",
    identity: "member",
    mutation: true,
    authority: "m13_01_audit_sbom_ci_credential",
    evidence: "apps/api/src/sboms/sbom-ci-credentials.controller.ts",
    reason:
      "Stop or revoke existing external/customer authority without starting new customer work.",
  },
  "SbomCiBuildController.complete": {
    kind: "admission-finalization",
    capability: "sboms",
    identity: "source",
    mutation: true,
    authority: "finalize_ci_build_sbom_atomic",
    evidence: "apps/api/src/sboms/sbom-ci-integrations.controller.ts",
    reason:
      "Finalize only an existing bounded immutable upload reservation under fresh source authorization.",
  },
  "SbomCiBuildController.gate": {
    kind: "source",
    capability: "sboms",
    identity: "source",
    mutation: false,
    authority: "gate",
    evidence: "apps/api/src/sboms/sbom-ci-integrations.controller.ts",
    reason:
      "Verified source identity must resolve tenant before licence admission and cannot trust URL/body scope.",
  },
  "SbomCiBuildController.initialize": {
    kind: "source",
    capability: "sboms",
    identity: "source",
    mutation: true,
    authority: "reserve_ci_build_sbom_atomic",
    evidence: "apps/api/src/sboms/sbom-ci-integrations.controller.ts",
    reason:
      "Verified source identity must resolve tenant before licence admission and cannot trust URL/body scope.",
  },
  "SbomCiReleaseBindingsController.list": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/sboms/sbom-ci-integrations.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SbomCiReleaseBindingsController.revoke": {
    kind: "security",
    capability: "sboms",
    identity: "member",
    mutation: true,
    authority: "revoke_ci_provider_release_binding_atomic",
    evidence: "apps/api/src/sboms/sbom-ci-integrations.controller.ts",
    reason:
      "Stop or revoke existing external/customer authority without starting new customer work.",
  },
  "SbomCiReleaseBindingsController.runs": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "runs",
    evidence: "apps/api/src/sboms/sbom-ci-integrations.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SbomCiReleaseBindingsController.upsert": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: true,
    authority: "upsert_ci_provider_release_binding_atomic",
    evidence: "apps/api/src/sboms/sbom-ci-integrations.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "ProductReleaseSbomCompositeController.create": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: true,
    authority: "create_sbom_composite_review_atomic",
    evidence: "apps/api/src/sboms/sbom-composite.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SbomCompositeReviewsController.generate": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: true,
    authority: "generate_sbom_composite_atomic",
    evidence: "apps/api/src/sboms/sbom-composite.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SbomCompositeReviewsController.resolveConflict": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: true,
    authority: "m13_01_audit_sbom_composite_conflict",
    evidence: "apps/api/src/sboms/sbom-composite.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SbomCompositeReviewsController.resolveRelationship": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: true,
    authority: "m13_01_audit_sbom_composite_relationship",
    evidence: "apps/api/src/sboms/sbom-composite.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SbomCompositeReviewsController.review": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "review",
    evidence: "apps/api/src/sboms/sbom-composite.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SbomExportController.export": {
    kind: "evidence",
    identity: "member",
    mutation: false,
    authority: "export",
    evidence: "apps/api/src/sboms/sbom-export.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "ProductReleaseSbomController.documents": {
    kind: "evidence",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "documents",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason: "Existing product-release SBOM evidence remains accessible.",
  },
  "ProductReleaseSbomController.initialize": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: true,
    authority: "reserve_sbom_source_atomic",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "ProductReleaseSbomController.sources": {
    kind: "evidence",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "sources",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason: "Existing product-release SBOM evidence remains accessible.",
  },
  "SbomCiController.complete": {
    kind: "admission-finalization",
    capability: "sboms",
    identity: "source",
    mutation: true,
    authority: "finalize_sbom_source_deduplicated_atomic",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason:
      "Finalize only an existing bounded immutable upload reservation under fresh source authorization.",
  },
  "SbomCiController.initialize": {
    kind: "source",
    capability: "sboms",
    identity: "source",
    mutation: true,
    authority: "reserve_sbom_source_atomic",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason:
      "Verified source identity must resolve tenant before licence admission and cannot trust URL/body scope.",
  },
  "SbomDiffsController.components": {
    kind: "evidence",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "components",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason: "Existing immutable diff evidence is retained.",
  },
  "SbomDiffsController.findings": {
    kind: "evidence",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "findings",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason: "Existing immutable diff evidence is retained.",
  },
  "SbomDiffsController.report": {
    kind: "evidence",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "report",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason: "Existing immutable diff evidence is retained.",
  },
  "SbomDiffsController.retry": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: true,
    authority: "retry_sbom_diff_report_atomic",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SbomDocumentsController.components": {
    kind: "evidence",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "components",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason: "Existing SBOM inventory is retained evidence.",
  },
  "SbomDocumentsController.dependencyTree": {
    kind: "evidence",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "dependencyTree",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason: "Existing SBOM inventory is retained evidence.",
  },
  "SbomDocumentsController.document": {
    kind: "evidence",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "document",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason: "Existing SBOM inventory is retained evidence.",
  },
  "SbomJobsController.job": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "job",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SbomJobsController.replay": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: true,
    authority: "replay_sbom_ingest_job_atomic",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SbomQualitySettingsController.settings": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "settings",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SbomQualitySettingsController.updateSettings": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: true,
    authority: "m13_01_audit_sbom_quality_settings",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SbomSourcesController.createDiff": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: true,
    authority: "enqueue_sbom_diff_report_atomic",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SbomSourcesController.download": {
    kind: "evidence",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "download",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason:
      "Existing retained SBOM evidence is accessible independently of processing entitlements.",
  },
  "SbomSourcesController.qualityFindings": {
    kind: "evidence",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "qualityFindings",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason:
      "Existing retained SBOM evidence is accessible independently of processing entitlements.",
  },
  "SbomSourcesController.qualityReport": {
    kind: "evidence",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "qualityReport",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason:
      "Existing retained SBOM evidence is accessible independently of processing entitlements.",
  },
  "SbomSourcesController.sourceDiff": {
    kind: "evidence",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "sourceDiff",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason:
      "Existing retained SBOM evidence is accessible independently of processing entitlements.",
  },
  "SbomSourcesController.validationReport": {
    kind: "evidence",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "validationReport",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason:
      "Existing retained SBOM evidence is accessible independently of processing entitlements.",
  },
  "SbomUploadsController.complete": {
    kind: "admission-finalization",
    capability: "sboms",
    identity: "source",
    mutation: true,
    authority: "finalize_sbom_source_deduplicated_atomic",
    evidence: "apps/api/src/sboms/sbom.controller.ts",
    reason:
      "Finalize only an existing bounded immutable upload reservation under fresh source authorization.",
  },
  "ProductReleaseSupplierSbomController.createRequest": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: true,
    authority: "create_supplier_sbom_request_atomic",
    evidence: "apps/api/src/sboms/supplier-sbom.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierSbomPortalController.complete": {
    kind: "admission-finalization",
    capability: "sboms",
    identity: "source",
    mutation: true,
    authority: "finalize_supplier_sbom_submission_atomic",
    evidence: "apps/api/src/sboms/supplier-sbom.controller.ts",
    reason:
      "Finalize only an existing bounded immutable upload reservation under fresh source authorization.",
  },
  "SupplierSbomPortalController.initialize": {
    kind: "source",
    capability: "sboms",
    identity: "source",
    mutation: true,
    authority: "reserve_supplier_sbom_submission_atomic",
    evidence: "apps/api/src/sboms/supplier-sbom.controller.ts",
    reason:
      "Verified source identity must resolve tenant before licence admission and cannot trust URL/body scope.",
  },
  "SupplierSbomPortalController.session": {
    kind: "security",
    capability: "sboms",
    identity: "source",
    mutation: true,
    authority: "m13_01_audit_supplier_sbom_invitation",
    evidence: "apps/api/src/sboms/supplier-sbom.controller.ts",
    reason:
      "Source credential redemption remains separate from licensed intake.",
  },
  "SupplierSbomRequestsController.invite": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: true,
    authority: "create_supplier_sbom_invitation_atomic",
    evidence: "apps/api/src/sboms/supplier-sbom.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierSbomRequestsController.list": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/sboms/supplier-sbom.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierSbomSubmissionsController.review": {
    kind: "customer",
    capability: "sboms",
    identity: "member",
    mutation: true,
    authority: "review_supplier_sbom_submission_atomic",
    evidence: "apps/api/src/sboms/supplier-sbom.controller.ts",
    reason:
      "Source-owned sboms operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierDocumentExtractionController.decide": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "m9_05_decide_supplier_document_field_core",
    evidence:
      "apps/api/src/supplier-evidence/supplier-document-extraction.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierDocumentExtractionController.manual": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "add_supplier_document_field_atomic",
    evidence:
      "apps/api/src/supplier-evidence/supplier-document-extraction.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierDocumentExtractionController.read": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: false,
    authority: "read",
    evidence:
      "apps/api/src/supplier-evidence/supplier-document-extraction.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierDocumentExtractionController.start": {
    kind: "customer",
    capability: "ai",
    identity: "member",
    mutation: true,
    authority: "start_supplier_document_extraction_atomic",
    evidence:
      "apps/api/src/supplier-evidence/supplier-document-extraction.controller.ts",
    reason:
      "New AI extraction requires both supplier access and AI entitlement.",
  },
  "SupplierEvidenceSbomInternalController.eligible": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: false,
    authority: "eligible",
    evidence:
      "apps/api/src/supplier-evidence/supplier-evidence-sbom.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierEvidenceSbomPortalController.complete": {
    kind: "admission-finalization",
    capability: "suppliers",
    identity: "source",
    mutation: true,
    authority: "finalize_supplier_sbom_submission_atomic",
    evidence:
      "apps/api/src/supplier-evidence/supplier-evidence-sbom.controller.ts",
    reason:
      "Finalize only an existing bounded immutable upload reservation under fresh source authorization.",
  },
  "SupplierEvidenceSbomPortalController.initialize": {
    kind: "source",
    capability: "suppliers",
    identity: "source",
    mutation: true,
    authority: "m13_01_audit_supplier_sbom_invitation",
    evidence:
      "apps/api/src/supplier-evidence/supplier-evidence-sbom.controller.ts",
    reason:
      "Verified source identity must resolve tenant before licence admission and cannot trust URL/body scope.",
  },
  "SupplierEvidencePortalController.complete": {
    kind: "admission-finalization",
    capability: "suppliers",
    identity: "source",
    mutation: true,
    authority: "finalize_supplier_evidence_submission_atomic",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Finalize only an existing bounded immutable upload reservation under fresh source authorization.",
  },
  "SupplierEvidencePortalController.redeem": {
    kind: "security",
    capability: "suppliers",
    identity: "source",
    mutation: true,
    authority: "m13_01_audit_supplier_evidence_invitation",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason: "Portal identity redemption grants no licensed mutation authority.",
  },
  "SupplierEvidencePortalController.request": {
    kind: "evidence",
    capability: "suppliers",
    identity: "source",
    mutation: false,
    authority: "request",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason: "Existing scoped portal evidence stays accessible.",
  },
  "SupplierEvidencePortalController.reserve": {
    kind: "source",
    capability: "suppliers",
    identity: "source",
    mutation: true,
    authority: "reserve_supplier_evidence_submission_atomic",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Verified source identity must resolve tenant before licence admission and cannot trust URL/body scope.",
  },
  "SupplierEvidenceRequestsController.close": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "close_supplier_evidence_request_atomic",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierEvidenceRequestsController.create": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "create_supplier_evidence_request_atomic",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierEvidenceRequestsController.detail": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: false,
    authority: "detail",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierEvidenceRequestsController.issue": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "issue_supplier_evidence_request_atomic",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierEvidenceRequestsController.list": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierEvidenceRequestsController.metrics": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: false,
    authority: "metrics",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierEvidenceRequestsController.overdue": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: false,
    authority: "overdue",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierEvidenceRequestsController.preview": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "preview_supplier_evidence_request_atomic",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierEvidenceRequestsController.reissue": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "reissue_supplier_evidence_request_atomic",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierEvidenceRequestsController.reminderSettings": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: false,
    authority: "reminderSettings",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierEvidenceRequestsController.reRequest": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "re_request_supplier_evidence_request_atomic",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierEvidenceRequestsController.retryReminderDelivery": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "retry_supplier_evidence_reminder_delivery_atomic",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierEvidenceRequestsController.review": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "review_supplier_evidence_submission_atomic",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierEvidenceRequestsController.reviewDetail": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: false,
    authority: "reviewDetail",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierEvidenceRequestsController.revise": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "revise_supplier_evidence_request_atomic",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierEvidenceRequestsController.revoke": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "revoke_supplier_evidence_invitation_atomic",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierEvidenceRequestsController.updateReminderSettings": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "update_supplier_evidence_reminder_settings_atomic",
    evidence: "apps/api/src/supplier-evidence/supplier-evidence.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "FindingResponsibleSuppliersController.resolve": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: false,
    authority: "resolve",
    evidence: "apps/api/src/suppliers/supplier-registry.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierRegistryController.archive": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "archive_supplier_organization_atomic",
    evidence: "apps/api/src/suppliers/supplier-registry.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierRegistryController.archiveContact": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "archive_supplier_contact_atomic",
    evidence: "apps/api/src/suppliers/supplier-registry.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierRegistryController.associateRequest": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "associate_supplier_sbom_request_atomic",
    evidence: "apps/api/src/suppliers/supplier-registry.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierRegistryController.create": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "create_supplier_organization_atomic",
    evidence: "apps/api/src/suppliers/supplier-registry.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierRegistryController.createContact": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "create_supplier_contact_atomic",
    evidence: "apps/api/src/suppliers/supplier-registry.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierRegistryController.createResponsibility": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "create_supplier_component_responsibility_atomic",
    evidence: "apps/api/src/suppliers/supplier-registry.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierRegistryController.detail": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: false,
    authority: "detail",
    evidence: "apps/api/src/suppliers/supplier-registry.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierRegistryController.endResponsibility": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "end_supplier_component_responsibility_atomic",
    evidence: "apps/api/src/suppliers/supplier-registry.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierRegistryController.list": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/suppliers/supplier-registry.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierRegistryController.update": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "update_supplier_organization_atomic",
    evidence: "apps/api/src/suppliers/supplier-registry.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "SupplierRegistryController.updateContact": {
    kind: "customer",
    capability: "suppliers",
    identity: "member",
    mutation: true,
    authority: "update_supplier_contact_atomic",
    evidence: "apps/api/src/suppliers/supplier-registry.controller.ts",
    reason:
      "Source-owned suppliers operation retains its existing identity, tenant and approval checks.",
  },
  "TaskAbsencesController.create": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: true,
    authority: "m1201_manage_absence",
    evidence: "apps/api/src/tasks/task-absences.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TaskAbsencesController.delete": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: true,
    authority: "m1201_manage_absence",
    evidence: "apps/api/src/tasks/task-absences.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TaskAbsencesController.list": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/tasks/task-absences.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TaskAbsencesController.memberCandidates": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: false,
    authority: "memberCandidates",
    evidence: "apps/api/src/tasks/task-absences.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TaskGroupsController.addMember": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: true,
    authority: "m1201_manage_group",
    evidence: "apps/api/src/tasks/task-groups.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TaskGroupsController.create": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: true,
    authority: "m1201_manage_group",
    evidence: "apps/api/src/tasks/task-groups.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TaskGroupsController.detail": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: false,
    authority: "detail",
    evidence: "apps/api/src/tasks/task-groups.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TaskGroupsController.list": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/tasks/task-groups.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TaskGroupsController.removeMember": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: true,
    authority: "m1201_manage_group",
    evidence: "apps/api/src/tasks/task-groups.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TaskGroupsController.update": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: true,
    authority: "m1201_manage_group",
    evidence: "apps/api/src/tasks/task-groups.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TasksController.assign": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: true,
    authority: "m1201_route_task",
    evidence: "apps/api/src/tasks/tasks.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TasksController.claim": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: true,
    authority: "m1201_route_task",
    evidence: "apps/api/src/tasks/tasks.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TasksController.delegate": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: true,
    authority: "m1201_route_task",
    evidence: "apps/api/src/tasks/tasks.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TasksController.detail": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: false,
    authority: "detail",
    evidence: "apps/api/src/tasks/tasks.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TasksController.eligibleAssignees": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: false,
    authority: "eligibleAssignees",
    evidence: "apps/api/src/tasks/tasks.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TasksController.list": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/tasks/tasks.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TasksController.release": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: true,
    authority: "m1201_route_task",
    evidence: "apps/api/src/tasks/tasks.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TasksController.revokeDelegation": {
    kind: "customer",
    capability: "tasks",
    identity: "member",
    mutation: true,
    authority: "m1201_route_task",
    evidence: "apps/api/src/tasks/tasks.controller.ts",
    reason:
      "Source-owned tasks operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFileAuditorAccessController.artifact": {
    kind: "evidence",
    identity: "source",
    mutation: false,
    authority: "artifact",
    evidence:
      "apps/api/src/technical-files/technical-file-auditor-access.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFileAuditorAccessController.manifest": {
    kind: "evidence",
    identity: "source",
    mutation: false,
    authority: "manifest",
    evidence:
      "apps/api/src/technical-files/technical-file-auditor-access.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFileAuditorAccessController.redeem": {
    kind: "evidence",
    identity: "source",
    mutation: true,
    authority: "redeem_technical_file_auditor_snapshot_grant_atomic",
    evidence:
      "apps/api/src/technical-files/technical-file-auditor-access.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFileAuditorAccessController.snapshot": {
    kind: "evidence",
    identity: "source",
    mutation: false,
    authority: "snapshot",
    evidence:
      "apps/api/src/technical-files/technical-file-auditor-access.controller.ts",
    reason:
      "Source-owned evidence operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFileAuditorGrantsController.create": {
    kind: "evidence",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "create_technical_file_auditor_snapshot_grant_atomic",
    evidence:
      "apps/api/src/technical-files/technical-file-auditor-access.controller.ts",
    reason:
      "Scoped grants for retained evidence preserve existing reviewer/product checks.",
  },
  "TechnicalFileAuditorGrantsController.list": {
    kind: "evidence",
    capability: "technical_files",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence:
      "apps/api/src/technical-files/technical-file-auditor-access.controller.ts",
    reason:
      "Scoped grants for retained evidence preserve existing reviewer/product checks.",
  },
  "TechnicalFileAuditorGrantsController.preview": {
    kind: "evidence",
    capability: "technical_files",
    identity: "member",
    mutation: false,
    authority: "preview",
    evidence:
      "apps/api/src/technical-files/technical-file-auditor-access.controller.ts",
    reason:
      "Scoped grants for retained evidence preserve existing reviewer/product checks.",
  },
  "TechnicalFileAuditorGrantsController.revoke": {
    kind: "evidence",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "revoke_technical_file_auditor_snapshot_grant_atomic",
    evidence:
      "apps/api/src/technical-files/technical-file-auditor-access.controller.ts",
    reason:
      "Scoped grants for retained evidence preserve existing reviewer/product checks.",
  },
  "TechnicalFilesController.acceptResidualRisk": {
    kind: "customer",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "accept_technical_file_residual_risk_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Source-owned technical_files operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFilesController.addSource": {
    kind: "customer",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "add_technical_file_section_source_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Source-owned technical_files operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFilesController.archiveRisk": {
    kind: "customer",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "archive_technical_file_risk_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Source-owned technical_files operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFilesController.cancelSnapshotExport": {
    kind: "evidence",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "cancel_technical_file_snapshot_export_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Existing retained technical evidence and snapshot export remain available.",
  },
  "TechnicalFilesController.create": {
    kind: "customer",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "create_technical_file_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Source-owned technical_files operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFilesController.createRisk": {
    kind: "customer",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "create_technical_file_risk_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Source-owned technical_files operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFilesController.createSnapshot": {
    kind: "customer",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "create_technical_file_snapshot_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Source-owned technical_files operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFilesController.createSnapshotExport": {
    kind: "evidence",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "create_technical_file_snapshot_export_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Existing retained technical evidence and snapshot export remain available.",
  },
  "TechnicalFilesController.declarationPreview": {
    kind: "evidence",
    capability: "technical_files",
    identity: "member",
    mutation: false,
    authority: "declarationPreview",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Existing retained technical evidence and snapshot export remain available.",
  },
  "TechnicalFilesController.declarationsList": {
    kind: "evidence",
    capability: "technical_files",
    identity: "member",
    mutation: false,
    authority: "declarationsList",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Existing retained technical evidence and snapshot export remain available.",
  },
  "TechnicalFilesController.downloadDeclaration": {
    kind: "evidence",
    capability: "technical_files",
    identity: "member",
    mutation: false,
    authority: "downloadDeclaration",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Existing retained technical evidence and snapshot export remain available.",
  },
  "TechnicalFilesController.downloadSnapshotExport": {
    kind: "evidence",
    capability: "technical_files",
    identity: "member",
    mutation: false,
    authority: "downloadSnapshotExport",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Existing retained technical evidence and snapshot export remain available.",
  },
  "TechnicalFilesController.get": {
    kind: "evidence",
    capability: "technical_files",
    identity: "member",
    mutation: false,
    authority: "get",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Existing retained technical evidence and snapshot export remain available.",
  },
  "TechnicalFilesController.issueDeclaration": {
    kind: "customer",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "issue_technical_file_declaration_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Source-owned technical_files operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFilesController.readinessOverview": {
    kind: "customer",
    capability: "technical_files",
    identity: "member",
    mutation: false,
    authority: "readinessOverview",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Source-owned technical_files operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFilesController.recalculateReadiness": {
    kind: "customer",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "recalculate_technical_file_readiness_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Source-owned technical_files operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFilesController.reissueDeclaration": {
    kind: "customer",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "reissue_technical_file_declaration_contract_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Source-owned technical_files operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFilesController.removeSource": {
    kind: "customer",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "remove_technical_file_section_source_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Source-owned technical_files operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFilesController.reviewSource": {
    kind: "customer",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "review_technical_file_section_source_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Source-owned technical_files operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFilesController.risk": {
    kind: "evidence",
    capability: "technical_files",
    identity: "member",
    mutation: false,
    authority: "risk",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Existing retained technical evidence and snapshot export remain available.",
  },
  "TechnicalFilesController.riskRegister": {
    kind: "evidence",
    capability: "technical_files",
    identity: "member",
    mutation: false,
    authority: "riskRegister",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Existing retained technical evidence and snapshot export remain available.",
  },
  "TechnicalFilesController.saveDeclarationDraft": {
    kind: "customer",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "upsert_technical_file_declaration_draft_contract_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Source-owned technical_files operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFilesController.section": {
    kind: "evidence",
    capability: "technical_files",
    identity: "member",
    mutation: false,
    authority: "section",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Existing retained technical evidence and snapshot export remain available.",
  },
  "TechnicalFilesController.signalMaterialChange": {
    kind: "customer",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "mark_technical_file_section_source_material_change_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Source-owned technical_files operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFilesController.snapshot": {
    kind: "evidence",
    capability: "technical_files",
    identity: "member",
    mutation: false,
    authority: "snapshot",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Existing retained technical evidence and snapshot export remain available.",
  },
  "TechnicalFilesController.snapshotExport": {
    kind: "evidence",
    capability: "technical_files",
    identity: "member",
    mutation: false,
    authority: "snapshotExport",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Existing retained technical evidence and snapshot export remain available.",
  },
  "TechnicalFilesController.snapshotsList": {
    kind: "evidence",
    capability: "technical_files",
    identity: "member",
    mutation: false,
    authority: "snapshotsList",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Existing retained technical evidence and snapshot export remain available.",
  },
  "TechnicalFilesController.updateDeclarationDraft": {
    kind: "customer",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "upsert_technical_file_declaration_draft_contract_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Source-owned technical_files operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFilesController.updateRisk": {
    kind: "customer",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "update_technical_file_risk_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Source-owned technical_files operation retains its existing identity, tenant and approval checks.",
  },
  "TechnicalFilesController.updateSection": {
    kind: "customer",
    capability: "technical_files",
    identity: "member",
    mutation: true,
    authority: "update_technical_file_section_atomic",
    evidence: "apps/api/src/technical-files/technical-files.controller.ts",
    reason:
      "Source-owned technical_files operation retains its existing identity, tenant and approval checks.",
  },
  "UsersController.changeRole": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "m13_01_mutate_member_atomic",
    evidence: "apps/api/src/users/users.controller.ts",
    reason:
      "Existing authentication and authorization maintenance is not licensed access.",
  },
  "UsersController.list": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: false,
    authority: "list",
    evidence: "apps/api/src/users/users.controller.ts",
    reason:
      "Existing authentication and authorization maintenance is not licensed access.",
  },
  "UsersController.remove": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "m13_01_mutate_member_atomic",
    evidence: "apps/api/src/users/users.controller.ts",
    reason:
      "Existing authentication and authorization maintenance is not licensed access.",
  },
  "UsersController.setActive": {
    kind: "mixed",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "m13_01_mutate_member_atomic",
    evidence: "apps/api/src/users/users.controller.ts",
    reason:
      "Parsed activation intent requires seats and customer write policy; deactivation preserves security maintenance.",
  },
  "UsersController.updateMe": {
    kind: "security",
    capability: "administration",
    identity: "member",
    mutation: true,
    authority: "m13_01_update_profile_atomic",
    evidence: "apps/api/src/users/users.controller.ts",
    reason:
      "Existing authentication and authorization maintenance is not licensed access.",
  },
  "OfflineBundleImportsController.confirm": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: true,
    authority: "confirm_vulnerability_offline_bundle_import",
    evidence:
      "apps/api/src/vulnerabilities/offline-bundle-imports.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
  "OfflineBundleImportsController.preflightBundle": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: true,
    authority: "preflightBundle",
    evidence:
      "apps/api/src/vulnerabilities/offline-bundle-imports.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
  "OfflineBundleImportsController.status": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: false,
    authority: "status",
    evidence:
      "apps/api/src/vulnerabilities/offline-bundle-imports.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityFeedsController.csafReconciliation": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: false,
    authority: "csafReconciliation",
    evidence: "apps/api/src/vulnerabilities/vulnerabilities.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityFeedsController.health": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: false,
    authority: "health",
    evidence: "apps/api/src/vulnerabilities/vulnerabilities.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityFeedsController.listRuns": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: false,
    authority: "listRuns",
    evidence: "apps/api/src/vulnerabilities/vulnerabilities.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityFeedsController.replay": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: true,
    authority: "m13_01_audit_manual_vulnerability_feed_event",
    evidence: "apps/api/src/vulnerabilities/vulnerabilities.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityFeedsController.requestSync": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: true,
    authority: "m13_01_audit_manual_vulnerability_feed_event",
    evidence: "apps/api/src/vulnerabilities/vulnerabilities.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityEnrichmentController.acknowledge": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: true,
    authority: "acknowledge_vulnerability_kev_alert_atomic",
    evidence:
      "apps/api/src/vulnerabilities/vulnerability-enrichment.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityEnrichmentController.findings": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: false,
    authority: "findings",
    evidence:
      "apps/api/src/vulnerabilities/vulnerability-enrichment.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityEnrichmentController.openReportingObligation": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: true,
    authority: "record_vulnerability_kev_reporting_intent_atomic",
    evidence:
      "apps/api/src/vulnerabilities/vulnerability-enrichment.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityManualFindingsController.create": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: true,
    authority: "create_vulnerability_manual_finding_atomic",
    evidence:
      "apps/api/src/vulnerabilities/vulnerability-manual-findings.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityMatchingController.advisoryReview": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: false,
    authority: "advisoryReview",
    evidence:
      "apps/api/src/vulnerabilities/vulnerability-matching.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityMatchingController.findings": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: false,
    authority: "findings",
    evidence:
      "apps/api/src/vulnerabilities/vulnerability-matching.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityMatchingController.reachabilityEvidence": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: false,
    authority: "reachabilityEvidence",
    evidence:
      "apps/api/src/vulnerabilities/vulnerability-matching.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityMatchingController.recordHumanVerdict": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: true,
    authority: "record_vulnerability_finding_human_verdict_atomic",
    evidence:
      "apps/api/src/vulnerabilities/vulnerability-matching.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityMatchingController.reevaluationHistory": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: false,
    authority: "reevaluationHistory",
    evidence:
      "apps/api/src/vulnerabilities/vulnerability-matching.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
  "VulnerabilityMatchingController.status": {
    kind: "customer",
    capability: "vulnerabilities",
    identity: "member",
    mutation: false,
    authority: "status",
    evidence:
      "apps/api/src/vulnerabilities/vulnerability-matching.controller.ts",
    reason:
      "Source-owned vulnerabilities operation retains its existing identity, tenant and approval checks.",
  },
});
