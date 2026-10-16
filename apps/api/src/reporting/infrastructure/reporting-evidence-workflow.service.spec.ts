import { BoundedUploadService } from "../../licensing/uploads/bounded-upload.service";
import { ConfigService } from "@nestjs/config";
import { LicensingService } from "../../licensing/application/licensing.service";

import { SupabaseService } from "../../supabase/supabase.service";
import { ReportingEvidenceWorkflowService } from "./reporting-evidence-workflow.service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const obligationId = "33333333-3333-4333-8333-333333333333";
const stageId = "44444444-4444-4444-8444-444444444444";
const packageId = "55555555-5555-4555-8555-555555555555";
const approvalId = "66666666-6666-4666-8666-666666666666";
const proofId = "77777777-7777-4777-8777-777777777777";
const key = "88888888-8888-4888-8888-888888888888";
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
    const write = jest.fn().mockResolvedValue(undefined);
    const service = new ReportingEvidenceWorkflowService(
      {
        admin: () => ({ rpc, storage: { from: () => ({ upload }) } }),
      } as unknown as SupabaseService,
      {} as ConfigService,
      { write } as unknown as BoundedUploadService,
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
    expect(upload).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "reporting-evidence",
        bytes: Buffer.from("receipt"),
        scope: expect.objectContaining({
          kind: "reporting_receipt",
          organizationId,
          actorId,
          obligationId,
          stageId,
          packageId,
          approvalId,
          proofId,
          idempotencyKey: key,
          isRehearsal: false,
        }) as unknown,
      }),
    );
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

function receiptInput() {
  return {
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
      mimeType: "text/plain" as const,
    },
  };
}
function receiptService(read = evidence(null), outcome = "updated") {
  const write = jest.fn().mockResolvedValue(undefined);
  const rpc = jest
    .fn()
    .mockResolvedValueOnce({
      data: [{ outcome: "found", result: read }],
      error: null,
    })
    .mockResolvedValueOnce({ data: [{ outcome, result: {} }], error: null })
    .mockResolvedValueOnce({
      data: [{ outcome: "found", result: evidence(filing()) }],
      error: null,
    });
  const service = new ReportingEvidenceWorkflowService(
    { admin: () => ({ rpc }) } as unknown as SupabaseService,
    {} as ConfigService,
    { write } as unknown as BoundedUploadService,
  );
  return { service, write, rpc };
}
describe("source-bound filing receipt admission", () => {
  it("retries a failed filing with the completed receipt without publishing twice", async () => {
    let stored = false;
    let filed = false;
    let attempts = 0;
    const receiptRpc = jest.fn().mockImplementation(() =>
      Promise.resolve({
        data: { outcome: stored ? "completed" : "absent" },
        error: null,
      }),
    );
    const uploads = new BoundedUploadService(
      { admin: () => ({ rpc: receiptRpc }) } as unknown as SupabaseService,
      {} as ConfigService,
      {
        getWorkerPolicy: jest.fn().mockResolvedValue({}),
      } as unknown as LicensingService,
    );
    const issue = jest.spyOn(uploads, "issue").mockResolvedValue({
      uploadUrl: `http://localhost:3004/api/v1/licensing/uploads/${key}/test-token`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const publish = jest.spyOn(uploads, "accept").mockImplementation(() => {
      stored = true;
      return Promise.resolve();
    });
    const rpc = jest.fn().mockImplementation((name: string) => {
      if (name === "get_reporting_stage_evidence_api")
        return Promise.resolve({
          data: [
            { outcome: "found", result: evidence(filed ? filing() : null) },
          ],
          error: null,
        });
      attempts += 1;
      if (attempts === 1)
        return Promise.resolve({
          data: null,
          error: { code: "provider_unavailable" },
        });
      filed = true;
      return Promise.resolve({
        data: [{ outcome: "updated", result: {} }],
        error: null,
      });
    });
    const service = new ReportingEvidenceWorkflowService(
      { admin: () => ({ rpc }) } as unknown as SupabaseService,
      {} as ConfigService,
      uploads,
    );
    await expect(
      service.recordStageExternalFiling(organizationId, receiptInput()),
    ).rejects.toThrow("unavailable");
    await expect(
      service.recordStageExternalFiling(organizationId, receiptInput()),
    ).resolves.toMatchObject({ filing: { id: submissionId } });
    expect(issue).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(receiptRpc).toHaveBeenCalledTimes(2);
    expect(attempts).toBe(2);
  });
  it.each([0, 10 * 1024 * 1024 + 1])(
    "rejects %i bytes before source/storage effects",
    async (size) => {
      const { service, write, rpc } = receiptService();
      const input = receiptInput();
      await expect(
        service.recordStageExternalFiling(organizationId, {
          ...input,
          receipt: { ...input.receipt, bytes: Buffer.alloc(size) },
        }),
      ).rejects.toThrow("invalid_request");
      expect(write).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it.each(["stageId", "obligationId", "state", "id"])(
    "denies a mismatched package %s before admission",
    async (field) => {
      const read = evidence(null);
      const { service, write } = receiptService({
        ...read,
        packages: read.packages.map((entry) => ({
          ...entry,
          [field]: field === "state" ? "reserved" : key,
        })),
      });
      await expect(
        service.recordStageExternalFiling(organizationId, receiptInput()),
      ).resolves.toBeNull();
      expect(write).not.toHaveBeenCalled();
    },
  );
  it("keeps source filing uncommitted when bounded admission/publication fails", async () => {
    const { service, write, rpc } = receiptService();
    write.mockRejectedValue(new Error("storage quota exhausted"));
    await expect(
      service.recordStageExternalFiling(organizationId, receiptInput()),
    ).rejects.toThrow("storage quota exhausted");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("replays a durable filing through its source command without uploading again", async () => {
    const { service, write, rpc } = receiptService(
      evidence(filing()),
      "idempotent",
    );
    await expect(
      service.recordStageExternalFiling(organizationId, receiptInput()),
    ).resolves.toMatchObject({ filing: { id: submissionId } });
    expect(write).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "record_reporting_stage_filing_atomic",
      expect.objectContaining({ p_idempotency_key: key }),
    );
  });
  it.each(["conflict", "unavailable", "not_found"])(
    "preserves source outcome %s after admitted bytes",
    async (outcome) => {
      const { service } = receiptService(evidence(null), outcome);
      if (outcome === "not_found")
        await expect(
          service.recordStageExternalFiling(organizationId, receiptInput()),
        ).resolves.toBeNull();
      else
        await expect(
          service.recordStageExternalFiling(organizationId, receiptInput()),
        ).rejects.toThrow("conflict");
    },
  );
  it("binds rehearsal admission to its explicit rehearsal source and namespace", async () => {
    const { service, write } = receiptService();
    await service.recordStageRehearsalFiling(organizationId, receiptInput());
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: `rehearsals/${organizationId}/${stageId}/filings/${key}/receipt.txt`,
        scope: expect.objectContaining({ isRehearsal: true }) as unknown,
      }),
    );
  });
});
