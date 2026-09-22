import type {
  SupplierEvidenceInvitation,
  SupplierEvidenceRequestDetail,
} from "@repo/contracts/supplier-evidence";
import {
  type SupplierEvidenceRepository,
  type SupplierEvidenceStoragePort,
  SupplierEvidenceUseCases,
} from "./supplier-evidence-use-cases";

const requestId = "00000000-0000-4000-8000-000000000001";

describe("SupplierEvidenceUseCases", () => {
  const repository: jest.Mocked<SupplierEvidenceRepository> = {
    preview: jest.fn(),
    create: jest.fn(),
    revise: jest.fn(),
    issue: jest.fn(),
    reissue: jest.fn(),
    review: jest.fn(),
    reRequest: jest.fn(),
    markInvitationDelivery: jest.fn(),
    revoke: jest.fn(),
    close: jest.fn(),
    list: jest.fn(),
    detail: jest.fn(),
    reviewDetail: jest.fn(),
    redeem: jest.fn(),
    portalRequest: jest.fn(),
    reserve: jest.fn(),
    uploadForFinalization: jest.fn(),
    finalize: jest.fn(),
  };
  const storage: jest.Mocked<SupplierEvidenceStoragePort> = {
    createSignedUpload: jest.fn(),
    inspect: jest.fn(),
  };

  beforeEach(() => jest.resetAllMocks());

  it("hashes invitation bearers before passing them to persistence", async () => {
    repository.issue.mockResolvedValue({
      outcome: "issued",
      request: {} as SupplierEvidenceRequestDetail,
      invitation: {} as SupplierEvidenceInvitation,
      recipientEmail: "supplier@example.test",
    });
    const useCases = new SupplierEvidenceUseCases(repository, storage);
    const result = await useCases.issue(
      "00000000-0000-4000-8000-0000000000ca",
      {
        actorId: requestId,
        requestId,
        revisionId: requestId,
        expectedVersion: 0,
        previewFingerprint: "a".repeat(64),
        idempotencyKey: "00000000-0000-4000-8000-000000000002",
      },
    );
    const issueCall = repository.issue.mock.calls.at(0);
    expect(issueCall).toBeDefined();
    expect(issueCall?.[0]).toBe("00000000-0000-4000-8000-0000000000ca");
    expect(issueCall?.[1].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.invitationToken).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("does not invent a replacement bearer for an idempotent invitation replay", async () => {
    repository.issue.mockResolvedValue({
      outcome: "replayed",
      request: {} as SupplierEvidenceRequestDetail,
      invitation: {} as SupplierEvidenceInvitation,
      recipientEmail: "supplier@example.test",
    });
    const useCases = new SupplierEvidenceUseCases(repository, storage);
    const result = await useCases.issue(
      "00000000-0000-4000-8000-0000000000ca",
      {
        actorId: requestId,
        requestId,
        revisionId: requestId,
        expectedVersion: 0,
        previewFingerprint: "a".repeat(64),
        idempotencyKey: "00000000-0000-4000-8000-000000000002",
      },
    );
    expect(result.outcome).toBe("replayed");
    expect(result.invitationToken).toBeUndefined();
  });

  it("hashes a fresh bearer for a re-request cycle without persisting it", async () => {
    repository.reRequest.mockResolvedValue({
      outcome: "re_requested",
      request: {} as SupplierEvidenceRequestDetail,
      invitation: {} as SupplierEvidenceInvitation,
      recipientEmail: "supplier@example.test",
    });
    const useCases = new SupplierEvidenceUseCases(repository, storage);
    const result = await useCases.reRequest(
      "00000000-0000-4000-8000-0000000000ca",
      {
        actorId: requestId,
        requestId,
        expectedVersion: 3,
        dueAt: "2026-10-01T10:00:00.000Z",
        items: [
          {
            sourceRequestItemId: requestId,
            title: "Current declaration",
            documentClass: "supplier_attestation",
          },
        ],
        idempotencyKey: "00000000-0000-4000-8000-000000000002",
      },
    );
    const call = repository.reRequest.mock.calls.at(0);
    expect(call?.[1].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.invitationToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(call)).not.toContain(result.invitationToken ?? "");
  });

  it("inspects the private object before finalizing an external submission", async () => {
    repository.uploadForFinalization.mockResolvedValue({
      objectKey: `${requestId}/${requestId}/${requestId}/${requestId}`,
    });
    storage.inspect.mockResolvedValue({
      outcome: "verified",
      sha256: "a".repeat(64),
      byteSize: 12,
      mediaType: "application/pdf",
    });
    repository.finalize.mockResolvedValue({});
    const useCases = new SupplierEvidenceUseCases(repository, storage);
    await useCases.finalize({
      sessionToken: "x".repeat(32),
      versionId: requestId,
      idempotencyKey: "00000000-0000-4000-8000-000000000002",
    });
    const inspectCall = storage.inspect.mock.calls.at(0);
    const finalizeCall = repository.finalize.mock.calls.at(0);
    expect(inspectCall).toBeDefined();
    expect(finalizeCall).toBeDefined();
    expect(inspectCall?.[0].maximumByteSize).toBe(50 * 1024 * 1024);
    expect(finalizeCall?.[0]).toMatchObject({
      sha256: "a".repeat(64),
      mediaType: "application/pdf",
      actualByteSize: 12,
    });
  });

  it("does not put an external session bearer into a durable request digest", async () => {
    repository.reserve.mockResolvedValue({
      submission: {},
      versionId: requestId,
      objectKey: `${requestId}/${requestId}/${requestId}/${requestId}`,
    });
    storage.createSignedUpload.mockResolvedValue({
      uploadUrl: "http://localhost/upload",
      expiresAt: "2026-10-01T10:00:00.000Z",
    });
    const useCases = new SupplierEvidenceUseCases(repository, storage);
    await useCases.reserve({
      sessionToken: "s".repeat(32),
      checklistItemId: requestId,
      fileName: "evidence.pdf",
      mediaType: "application/pdf",
      byteSize: 12,
      sha256: "a".repeat(64),
      idempotencyKey: "00000000-0000-4000-8000-000000000002",
    });
    const reserveCall = repository.reserve.mock.calls.at(0);
    expect(reserveCall).toBeDefined();
    expect(reserveCall?.[0].requestDigest).toEqual(expect.any(String));
    expect(reserveCall?.[0].sessionTokenHash).toEqual(expect.any(String));
    expect(JSON.stringify(reserveCall?.[0])).not.toContain("s".repeat(32));
  });
});
