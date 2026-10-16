import type {
  SupportDiagnosticJob,
  SupportDiagnosticPreview,
  SupportDiagnosticContent,
} from "@repo/contracts/support-diagnostics/types";
export const diagnosticOrg = "00000000-0000-4000-8000-000000000001";
export const diagnosticId = "00000000-0000-4000-8000-000000000002";
export const diagnosticKey = "00000000-0000-4000-8000-000000000003";
export const diagnosticSelection = {
  categories: ["logs", "configuration", "metrics"] as (
    "logs" | "configuration" | "metrics"
  )[],
  from: "2026-10-13T00:00:00.000Z",
  to: "2026-10-14T00:00:00.000Z",
};
export const diagnosticJob: SupportDiagnosticJob = {
  id: diagnosticId,
  organizationId: diagnosticOrg,
  state: "ready",
  stage: "ready",
  version: 1,
  consentedAt: diagnosticSelection.to,
  createdAt: diagnosticSelection.to,
  completedAt: diagnosticSelection.to,
  expiresAt: "2099-10-15T00:00:00.000Z",
  selection: diagnosticSelection,
  progress: { completed: 3, total: 3 },
  omissions: [],
  artifact: {
    sha256: "a".repeat(64),
    byteSize: 100,
    fileName: `support-diagnostics-${diagnosticId}.zip`,
  },
  failureCode: null,
  cleanup: { state: "none", blockers: [] },
};
export const diagnosticPreview: SupportDiagnosticPreview = {
  organizationId: diagnosticOrg,
  disclosureVersion: "m15_04_v1",
  selection: diagnosticSelection,
  estimate: { maxBytes: 10485760, maxLogRows: 5000, measured: false },
  fields: {
    logs: ["at", "source", "code", "outcome"],
    configuration: ["smtpTlsMode"],
    metrics: ["pending"],
  },
  examples: {
    logs: "operation_completed",
    configuration: "mailpit",
    metrics: "healthy",
  },
  previewToken: "opaque-preview",
  expiresAt: "2099-10-15T00:00:00.000Z",
};
export const diagnosticContent: SupportDiagnosticContent = {
  organizationId: diagnosticOrg,
  jobId: diagnosticId,
  manifest: {
    version: "m15_04_v1",
    jobId: diagnosticId,
    generatedAt: diagnosticSelection.to,
    selection: diagnosticSelection,
    entries: [],
    omissions: [],
  },
  section: "logs",
  data: [
    {
      at: diagnosticSelection.to,
      source: "audit",
      code: "operation_completed",
      outcome: "completed",
    },
  ],
  nextOffset: null,
};
