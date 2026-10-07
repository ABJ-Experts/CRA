import type { ConfigService } from "@nestjs/config";
import type { PermissionSet } from "@repo/contracts/permissions";

import type { RequestUser } from "../auth/auth.types";
import type { AuditExplorerRepository } from "./application/audit-explorer.port";
import { AuditExplorerTokenService } from "./audit-explorer-token.service";
import { AuditExplorerUseCases } from "./application/audit-explorer.use-cases";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const snapshotRequestId = "44444444-4444-4444-8444-444444444444";
const pageRequestId = "55555555-5555-4555-8555-555555555555";
const receiptId = "66666666-6666-4666-8666-666666666666";
const eventId = "77777777-7777-4777-8777-777777777777";

const filters = {
  from: "2026-01-01T00:00:00.000Z",
  to: "2026-01-02T00:00:00.000Z",
  resourceType: "product",
} as const;

const user: RequestUser = {
  id: actorId,
  authUserId: "88888888-8888-4888-8888-888888888888",
  email: "owner@cra.test",
  isActive: true,
  organizationId,
  role: "owner",
  accessToken: "access",
  aal: "aal2",
  sessionId,
};

function tokens(): AuditExplorerTokenService {
  return new AuditExplorerTokenService({
    getOrThrow: () => "test-cookie-secret-with-enough-entropy",
  } as unknown as ConfigService);
}

function repository(permissions: PermissionSet = { can_view_products: true }) {
  return {
    effectivePermissions: jest
      .fn()
      .mockResolvedValue({ permissions, version: "7" }),
    createSnapshot: jest.fn().mockResolvedValue({
      receiptId,
      highWaterSequence: "41",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      filterDigest: "a".repeat(64),
      scopeDigest: "b".repeat(64),
      scopeVersion: "7",
    }),
    recordDenial: jest.fn().mockResolvedValue({ receiptId, replayed: false }),
    recordAccess: jest.fn().mockResolvedValue({ receiptId, replayed: false }),
    readPage: jest.fn().mockResolvedValue({
      items: [
        {
          id: eventId,
          sequence: "41",
          legacy: false,
          createdAt: "2026-01-01T12:00:00.000Z",
          actor: { id: actorId, type: "user", label: "Owner" },
          action: "product.updated",
          resourceType: "product",
          resourceId: "prod-1",
          correlationId: null,
          outcome: "completed",
          verificationStatus: "event_hashes_checked",
        },
      ],
      lastCursor: {
        afterSequence: "41",
        afterCreatedAt: null,
        afterId: eventId,
      },
    }),
    readDetail: jest.fn(),
    verify: jest.fn(),
    createExport: jest.fn(),
    getExport: jest.fn(),
    issueDownloadGrant: jest.fn(),
    redeemDownloadGrant: jest.fn(),
    downloadPackage: jest.fn(),
  } satisfies jest.Mocked<AuditExplorerRepository>;
}

describe("AuditExplorerUseCases", () => {
  it("creates a snapshot receipt from plain filters and an exact source allowlist", async () => {
    const repo = repository();
    const service = new AuditExplorerUseCases(repo, tokens());

    await service.createSnapshot(user, {
      requestId: snapshotRequestId,
      filters,
    });

    expect(repo.createSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        actorId,
        requestId: snapshotRequestId,
        filterDigest: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
        scopeDigest: expect.stringMatching(/^[0-9a-f]{64}$/) as string,
      }),
    );
  });

  it("records the page access receipt before reading with a fresh operation UUID", async () => {
    const repo = repository();
    const tokenService = tokens();
    const service = new AuditExplorerUseCases(repo, tokenService);
    const snapshot = await service.createSnapshot(user, {
      requestId: snapshotRequestId,
      filters,
    });

    await service.page(user, snapshot.snapshotToken, {
      requestId: pageRequestId,
      limit: 50,
    });

    expect(repo.recordAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: pageRequestId,
        action: "audit.search.page",
        receiptId,
      }),
    );
    expect(repo.recordAccess.mock.invocationCallOrder[0]!).toBeLessThan(
      repo.readPage.mock.invocationCallOrder[0]!,
    );
    expect(repo.readPage).toHaveBeenCalledWith(
      expect.objectContaining({ allowedEntityTypes: ["product"] }),
    );
  });

  it("accepts a cursor for the same receipt while using a new page request ID", async () => {
    const repo = repository();
    const service = new AuditExplorerUseCases(repo, tokens());
    const snapshot = await service.createSnapshot(user, {
      requestId: snapshotRequestId,
      filters,
    });
    const first = await service.page(user, snapshot.snapshotToken, {
      requestId: pageRequestId,
      limit: 50,
    });

    await service.page(user, snapshot.snapshotToken, {
      requestId: "99999999-9999-4999-8999-999999999999",
      limit: 50,
      cursor: first.nextCursor ?? undefined,
    });

    expect(repo.readPage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: {
          afterSequence: "41",
          afterCreatedAt: null,
          afterId: eventId,
        },
      }),
    );
  });
});

const exportJob = {
  id: "99999999-9999-4999-8999-999999999999",
  status: "ready" as const,
  format: "json" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "2026-01-02T00:00:00.000Z",
  rowCount: 1,
  packageHash: "c".repeat(64),
  failureCode: null,
};

async function snapshotFor(
  service: AuditExplorerUseCases,
  inputUser: RequestUser = user,
): Promise<string> {
  return (
    await service.createSnapshot(inputUser, {
      requestId: snapshotRequestId,
      filters,
    })
  ).snapshotToken;
}

describe("AuditExplorerUseCases read/export operations", () => {
  it("records detail and verification receipts before delegated reads", async () => {
    const repo = repository();
    repo.readDetail.mockResolvedValue({
      event: {
        id: eventId,
        sequence: "41",
        legacy: false,
        createdAt: "2026-01-01T12:00:00.000Z",
        actor: { id: actorId, type: "user", label: "Owner" },
        action: "product.updated",
        resourceType: "product",
        resourceId: "prod-1",
        correlationId: null,
        outcome: "completed",
        verificationStatus: "event_hashes_checked",
      },
      before: null,
      after: { ok: true },
      reason: null,
    });
    repo.verify.mockResolvedValue({
      checkedAt: "2026-01-01T00:00:00.000Z",
      items: [{ eventId, status: "event_hashes_checked" }],
      completenessProven: false,
      authenticityProven: false,
    });
    const service = new AuditExplorerUseCases(repo, tokens());
    const snapshot = await snapshotFor(service);

    await service.detail(user, snapshot, eventId, { requestId: pageRequestId });
    await service.verify(user, snapshot, {
      requestId: pageRequestId,
      eventIds: [eventId],
    });

    expect(repo.recordAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "audit.search.detail",
        requestId: pageRequestId,
      }),
    );
    expect(repo.recordAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "audit.search.verify",
        requestId: pageRequestId,
      }),
    );
    expect(repo.readDetail).toHaveBeenCalledWith(
      expect.objectContaining({ eventId, allowedEntityTypes: ["product"] }),
    );
    expect(repo.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        eventIds: [eventId],
        allowedEntityTypes: ["product"],
      }),
    );
  });

  it("creates and polls exports with current source policy", async () => {
    const repo = repository();
    repo.createExport.mockResolvedValue(exportJob);
    repo.getExport.mockResolvedValue(exportJob);
    const service = new AuditExplorerUseCases(repo, tokens());
    const snapshotToken = await snapshotFor(service);

    await expect(
      service.createExport(user, {
        requestId: pageRequestId,
        snapshotToken,
        format: "json",
      }),
    ).resolves.toEqual(exportJob);
    await expect(
      service.getExport(user, exportJob.id, { requestId: pageRequestId }),
    ).resolves.toEqual(exportJob);

    expect(repo.createExport).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedEntityTypes: ["product"],
        format: "json",
      }),
    );
    expect(repo.getExport).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: pageRequestId,
        jobId: exportJob.id,
      }),
    );
  });

  it("issues and redeems a session-bound download grant through verified storage", async () => {
    const repo = repository();
    repo.getExport.mockResolvedValue(exportJob);
    repo.issueDownloadGrant.mockResolvedValue(exportJob);
    repo.redeemDownloadGrant.mockResolvedValue({
      packageHash: exportJob.packageHash,
      objectPath: `${organizationId}/${exportJob.id}/${exportJob.packageHash}.zip`,
      bytes: 9,
    });
    repo.downloadPackage.mockResolvedValue({
      body: new ReadableStream() as never,
      contentLength: 9,
      packageHash: exportJob.packageHash,
      cleanup: jest.fn(),
    });
    const service = new AuditExplorerUseCases(repo, tokens());
    const grant = await service.issueDownloadGrant(user, exportJob.id, {
      requestId: pageRequestId,
    });

    await expect(
      service.download(user, exportJob.id, pageRequestId, grant.cookieValue),
    ).resolves.toMatchObject({ packageHash: exportJob.packageHash });
    expect(repo.issueDownloadGrant).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId, jobId: exportJob.id }),
    );
    expect(repo.downloadPackage).toHaveBeenCalledWith(
      expect.objectContaining({ bytes: 9, packageHash: exportJob.packageHash }),
    );
  });

  it("maps expired tokens to stale conflicts", async () => {
    const repo = repository();
    const tokenService = tokens();
    const service = new AuditExplorerUseCases(repo, tokenService);
    const expired = tokenService.snapshot({
      kind: "snapshot",
      organizationId,
      actorId,
      sessionId,
      requestId: snapshotRequestId,
      receiptId,
      highWaterSequence: "41",
      expiresAt: "2020-01-01T00:00:00.000Z",
      filterDigest: "a".repeat(64),
      scopeDigest: "b".repeat(64),
      scopeVersion: "7",
      filters,
    });

    await expect(
      service.page(user, expired, { requestId: pageRequestId, limit: 50 }),
    ).rejects.toThrow("audit explorer snapshot is stale");
  });

  it("rejects requests without a complete verified principal", async () => {
    const service = new AuditExplorerUseCases(repository(), tokens());
    await expect(
      service.createSnapshot(
        { ...user, organizationId: null },
        { requestId: snapshotRequestId, filters },
      ),
    ).rejects.toThrow("audit explorer access denied");
    await expect(
      service.createSnapshot(
        { ...user, role: null },
        { requestId: snapshotRequestId, filters },
      ),
    ).rejects.toThrow("audit explorer access denied");
  });

  it("maps tampered tokens to forbidden and expired tokens to stale", async () => {
    const repo = repository();
    const service = new AuditExplorerUseCases(repo, tokens());
    const snapshot = await snapshotFor(service);
    const [version, iv, encrypted, tag] = snapshot.split(".");
    const tampered = [version, iv, `A${encrypted?.slice(1)}`, tag].join(".");

    await expect(
      service.page(user, tampered, { requestId: pageRequestId, limit: 50 }),
    ).rejects.toThrow("audit explorer access denied");
  });
});

it("rejects mismatched cursors and invalid download grant states", async () => {
  const repo = repository();
  repo.getExport.mockResolvedValue({
    ...exportJob,
    status: "processing",
    packageHash: null,
  });
  const tokenService = tokens();
  const service = new AuditExplorerUseCases(repo, tokenService);
  const snapshot = await snapshotFor(service);
  const mismatchedCursor = tokenService.cursor({
    kind: "cursor",
    organizationId,
    actorId,
    sessionId,
    requestId: snapshotRequestId,
    receiptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    afterSequence: "41",
    afterCreatedAt: null,
    afterId: eventId,
  });

  await expect(
    service.page(user, snapshot, {
      requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      limit: 50,
      cursor: mismatchedCursor,
    }),
  ).rejects.toThrow("audit explorer access denied");
  await expect(
    service.issueDownloadGrant(user, exportJob.id, {
      requestId: pageRequestId,
    }),
  ).rejects.toThrow("audit explorer access denied");
  await expect(
    service.download(user, exportJob.id, pageRequestId, undefined),
  ).rejects.toThrow("audit explorer access denied");
});

it("rejects wrong-job grants and stale package hashes before storage opens", async () => {
  const repo = repository();
  repo.getExport.mockResolvedValue(exportJob);
  repo.issueDownloadGrant.mockResolvedValue(exportJob);
  repo.redeemDownloadGrant.mockResolvedValue({
    packageHash: "d".repeat(64),
    objectPath: `${organizationId}/${exportJob.id}/${"d".repeat(64)}.zip`,
    bytes: 9,
  });
  const service = new AuditExplorerUseCases(repo, tokens());
  const grant = await service.issueDownloadGrant(user, exportJob.id, {
    requestId: pageRequestId,
  });

  await expect(
    service.download(
      user,
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      pageRequestId,
      grant.cookieValue,
    ),
  ).rejects.toThrow("audit explorer access denied");
  await expect(
    service.download(user, exportJob.id, pageRequestId, grant.cookieValue),
  ).rejects.toThrow("audit explorer snapshot is stale");
  expect(repo.downloadPackage).not.toHaveBeenCalled();
});
