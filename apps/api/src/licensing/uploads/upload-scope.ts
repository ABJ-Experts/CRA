/** Verified source identity is passed by the source application, never a body claim. */
export type UploadScope =
  | Readonly<{ kind: "member"; organizationId: string; actorId: string }>
  | Readonly<{
      kind: "supplier_evidence" | "supplier_sbom";
      sessionTokenHash: string;
    }>
  | Readonly<{
      kind: "reporting_receipt";
      organizationId: string;
      actorId: string;
      sessionId: string;
      obligationId: string;
      stageId: string;
      packageId: string;
      approvalId: string;
      proofId: string;
      idempotencyKey: string;
      isRehearsal: boolean;
    }>
  | Readonly<{ kind: "ci"; organizationId: string; credentialId: string }>;
