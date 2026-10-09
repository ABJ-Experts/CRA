import { ConfigService } from "@nestjs/config";

import { SupabaseService } from "../../supabase/supabase.service";
import { ReportingEvidenceWorkflowService } from "./reporting-evidence-workflow.service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const obligationId = "33333333-3333-4333-8333-333333333333";
const stageId = "44444444-4444-4444-8444-444444444444";
const packageId = "55555555-5555-4555-8555-555555555555";
const approvalId = "66666666-6666-4666-8666-666666666666";
const proofId = "77777777-7777-4777-8777-777777777777";
const key = "88888888-8888-4888-888888888888";
const hash = "a".repeat(64);
const timestamp = "2026-09-11T12:00:00Z";

describe("ReportingEvidenceWorkflowService", () => {
  it("returns the contract-parsed filing after the durable filing RPC and evidence reread", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: [{ outcome: "found", result: evidence(null) }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          { outcome: "updated", result: { submissionId, state: "submitted" } },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ outcome: "found", result: evidence(filing()) }],
        error: null,
      });
    const upload = jest.fn().mockResolvedValue({ error: null });
    const service = new ReportingEvidenceWorkflowService(
      {
        admin: () => ({ rpc, storage: { from: () => ({ upload }) } }),
      } as unknown as SupabaseService,
      {} as ConfigService,
    );

    await expect(
      service.recordStageExternalFiling(organizationId, {
        actorId,
        sessionId: "99999999-9999-4999-8999-999999999999",
        obligationId,
        stageId,
        fields: {
          packageId,
          filingReauthenticationProofId: proofId,
          submissionReference: "SRP-MANUAL-001",
          submittedAt: timestamp,
          submittedAtBasis: "Authority portal receipt timestamp.",
          expectedStageVersion: 1,
          idempotencyKey: key,
        },
        receipt: {
          bytes: Buffer.from("receipt"),
          fileName: "receipt.txt",
          mimeType: "text/plain",
        },
      }),
    ).resolves.toMatchObject({
      filing: {
        id: submissionId,
        recordedAt: timestamp,
        receipt: { uploadedAt: timestamp },
      },
    });
    expect(rpc).toHaveBeenCalledWith(
      "record_reporting_stage_filing_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_stage_id: stageId,
        p_package_id: packageId,
      }),
    );
  });
});

const submissionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function approval() {
  return {
    id: approvalId,
    draftId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    draftRevision: 1,
    draftHash: hash,
    state: "approved",
    requestedBy: { userId: actorId, displayName: "Owner" },
    requestedAt: timestamp,
    decidedBy: { userId: actorId, displayName: "Owner" },
    decidedAt: timestamp,
    segregationOfDutiesOverrideReason: null,
  };
}

function filing() {
  return {
    id: submissionId,
    organizationId,
    obligationId,
    stageId,
    stage: "early_warning",
    packageId,
    approvalId,
    submissionReference: "SRP-MANUAL-001",
    submittedAt: timestamp,
    submittedAtBasis: "Authority portal receipt timestamp.",
    receipt: {
      id: submissionId,
      fileName: "receipt.txt",
      mimeType: "text/plain",
      byteLength: 7,
      sha256: hash,
      uploadedAt: timestamp,
    },
    submittedBy: { userId: actorId, displayName: "Owner" },
    recordedAt: timestamp,
    isLate: false,
  };
}

function evidence(submission: ReturnType<typeof filing> | null) {
  return {
    obligationId,
    approval: approval(),
    packages: [
      {
        id: packageId,
        obligationId,
        stageId,
        approvalId,
        state: "available",
        objectPath: "private/package.zip",
        sha256: hash,
        byteLength: 10,
      },
    ],
    submission,
    timeline: [],
  };
}
