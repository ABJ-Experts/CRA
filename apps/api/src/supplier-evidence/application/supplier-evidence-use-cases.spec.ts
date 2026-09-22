import type {
  SupplierEvidenceMetricsSummary,
  SupplierEvidenceInvitation,
  SupplierEvidenceReminderDelivery,
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
    getReminderSettings: jest.fn(),
    updateReminderSettings: jest.fn(),
    metrics: jest.fn(),
    overdue: jest.fn(),
    retryReminderDelivery: jest.fn(),
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

  it("keeps internal reminder settings, metrics, overdue reads, and retry org-first", async () => {
    const organizationId = "00000000-0000-4000-8000-0000000000ca";
    const actorId = requestId;
    repository.getReminderSettings.mockResolvedValue({
      version: 0,
      offsetsHours: [-168, -24, 24],
    });
    repository.updateReminderSettings.mockResolvedValue({
      version: 1,
      offsetsHours: [-168, -24, 24],
    });
    repository.metrics.mockResolvedValue({} as SupplierEvidenceMetricsSummary);
    repository.overdue.mockResolvedValue({ overdue: [], nextCursor: null });
    repository.retryReminderDelivery.mockResolvedValue(
      {} as SupplierEvidenceReminderDelivery,
    );
    const useCases = new SupplierEvidenceUseCases(repository, storage);

    await useCases.getReminderSettings(organizationId, { actorId });
    await useCases.updateReminderSettings(organizationId, {
      actorId,
      expectedVersion: 0,
      offsetsHours: [-168, -24, 24],
      idempotencyKey: "00000000-0000-4000-8000-000000000002",
    });
    await useCases.metrics(organizationId, {
      actorId,
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
    });
    await useCases.overdue(organizationId, { actorId, limit: 25 });
    await useCases.retryReminderDelivery(organizationId, {
      actorId,
      requestId,
      deliveryId: "00000000-0000-4000-8000-000000000003",
      expectedVersion: 0,
      idempotencyKey: "00000000-0000-4000-8000-000000000004",
    });

    expect(repository.getReminderSettings.mock.calls).toEqual([
      [organizationId, { actorId }],
    ]);
    expect(repository.updateReminderSettings.mock.calls).toEqual([
      [
        organizationId,
        expect.objectContaining({ actorId, expectedVersion: 0 }),
      ],
    ]);
    expect(repository.metrics.mock.calls).toEqual([
      [
        organizationId,
        expect.objectContaining({ actorId, from: "2026-09-01T00:00:00.000Z" }),
      ],
    ]);
    expect(repository.overdue.mock.calls).toEqual([
      [organizationId, expect.objectContaining({ actorId, limit: 25 })],
    ]);
    expect(repository.retryReminderDelivery.mock.calls).toEqual([
      [
        organizationId,
        expect.objectContaining({
          actorId,
          requestId,
          deliveryId: "00000000-0000-4000-8000-000000000003",
        }),
      ],
    ]);
  });
});
