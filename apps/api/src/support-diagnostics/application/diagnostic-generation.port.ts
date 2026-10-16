import type {
  SupportDiagnosticSelection,
  SupportDiagnosticPayload,
  SupportDiagnosticManifest,
} from "@repo/contracts/support-diagnostics/types";
export interface DiagnosticTokenAuthority {
  organizationId: string;
  actorId: string;
  sessionId: string;
  authRevision: string;
}
export interface DiagnosticPreviewTokenPort {
  deriveGrant(
    authority: Pick<
      DiagnosticTokenAuthority,
      "organizationId" | "actorId" | "sessionId"
    >,
    jobId: string,
    idempotencyKey: string,
  ): { grantId: string; cookieValue: string };
  mint(
    input: DiagnosticTokenAuthority & { selection: SupportDiagnosticSelection },
  ): { previewToken: string; expiresAt: string };
  verify(
    token: string,
    authority: DiagnosticTokenAuthority,
  ): SupportDiagnosticSelection;
}
export interface DiagnosticArtifactPort {
  read(
    orgId: string,
    objectPath: string,
    artifact?: { sha256: string; byteSize: number },
  ): Promise<Buffer>;
}
export interface DiagnosticArchivePort {
  inspect(bytes: Buffer): Promise<{
    manifest: SupportDiagnosticManifest;
    logs: NonNullable<SupportDiagnosticPayload["logs"]>;
    configuration: SupportDiagnosticPayload["configuration"] | null;
    metrics: NonNullable<SupportDiagnosticPayload["metrics"]>;
    omissions: SupportDiagnosticPayload["omissions"];
  }>;
}
