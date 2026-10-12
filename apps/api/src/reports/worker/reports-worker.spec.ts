import { ReportsWorker, reportRecipientClaimSchema } from "./reports-worker";
import type {
  ReportsWorkerQueue,
  ReportRecipientClaim,
} from "./reports-worker";
import { sourceSchemaDigest } from "../domain/report-source-digest";
import { ExportAccessDeniedError } from "../../exports/domain/export.errors";
import { ExportUnavailableError } from "../../exports/domain/export.errors";
import { safeReportWorkerFailure } from "./reports-worker";

const claim = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  recipientId: "22222222-2222-4222-8222-222222222222",
  runId: "33333333-3333-4333-8333-333333333333",
  definitionId: "44444444-4444-4444-8444-444444444444",
  definitionVersion: 1,
  ownerUserId: "55555555-5555-4555-8555-555555555555",
  userId: "66666666-6666-4666-8666-666666666666",
  ownerBaseRole: "owner",
  recipientBaseRole: "member",
  config: {
    title: "Readiness",
    report: {
      kind: "readiness",
      productId: "77777777-7777-4777-8777-777777777777",
    },
    schedule: { frequency: "daily", timezone: "UTC", localTime: "00:00" },
    dateWindow: { kind: "fixed" },
    recipientUserIds: ["66666666-6666-4666-8666-666666666666"],
    emailEnabled: false,
  },
  scheduledFor: "2026-10-12T00:00:00.000Z",
  workerId: "88888888-8888-4888-8888-888888888888",
  version: 1,
  exportJobId: null,
  sourceSchemaDigest: sourceSchemaDigest({
    kind: "readiness",
    productId: "77777777-7777-4777-8777-777777777777",
  }),
} as ReportRecipientClaim;

describe("ReportsWorker", () => {
  it("services pending scheduled exports even when no recipient can be claimed", async () => {
    const queue = {
      scheduleDue: jest.fn().mockResolvedValue(0),
      claimRecipient: jest.fn().mockResolvedValue(null),
    } as unknown as ReportsWorkerQueue;
    const runOnce = jest.fn().mockResolvedValue("idle");
    const worker = new ReportsWorker(
      queue,
      { runOnce },
      { prepareScheduled: jest.fn() },
      claim.workerId,
    );
    await expect(worker.runOnce()).resolves.toBe("idle");
    expect(runOnce).toHaveBeenCalledTimes(1);
  });
  it("treats source authorization loss as a durable recipient failure", async () => {
    const failRecipient = jest.fn().mockResolvedValue({});
    const queue = {
      scheduleDue: jest.fn().mockResolvedValue(0),
      claimRecipient: jest.fn().mockResolvedValue(claim),
      authorizeRecipient: jest.fn().mockResolvedValue(false),
      failRecipient,
    } as unknown as ReportsWorkerQueue;
    const worker = new ReportsWorker(
      queue,
      { runOnce: jest.fn() },
      { prepareScheduled: jest.fn() },
      claim.workerId,
    );
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(failRecipient).toHaveBeenCalledWith(claim, "access_changed");
    expect(safeReportWorkerFailure(new ExportAccessDeniedError())).toBe(
      "access_changed",
    );
  });
  it("pauses through admission when the current source schema changed", async () => {
    const admitExport = jest.fn().mockResolvedValue(null);
    const prepareScheduled = jest.fn();
    const queue = {
      scheduleDue: jest.fn().mockResolvedValue(0),
      claimRecipient: jest
        .fn()
        .mockResolvedValue({ ...claim, sourceSchemaDigest: "b".repeat(64) }),
      authorizeRecipient: jest.fn().mockResolvedValue(true),
      admitExport,
      failRecipient: jest.fn(),
    } as unknown as ReportsWorkerQueue;
    const worker = new ReportsWorker(
      queue,
      { runOnce: jest.fn() },
      { prepareScheduled },
      claim.workerId,
    );
    await worker.runOnce();
    expect(admitExport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        _sourceSchemaDigest: claim.sourceSchemaDigest,
      }),
    );
    expect(prepareScheduled).not.toHaveBeenCalled();
  });
  it("accepts a frozen config from an older source contract and pauses it", async () => {
    const retiredClaim = {
      ...claim,
      config: {
        ...(claim.config as Record<string, unknown>),
        report: {
          kind: "list",
          source: "retired.source",
          format: "csv",
          context: {},
          filters: {},
        },
      },
    };
    const admitExport = jest.fn().mockResolvedValue(null);
    const prepareScheduled = jest.fn();
    const queue = {
      scheduleDue: jest.fn().mockResolvedValue(0),
      claimRecipient: jest.fn().mockResolvedValue(retiredClaim),
      authorizeRecipient: jest.fn().mockResolvedValue(true),
      admitExport,
      failRecipient: jest.fn(),
    } as unknown as ReportsWorkerQueue;
    const worker = new ReportsWorker(
      queue,
      { runOnce: jest.fn() },
      { prepareScheduled },
      claim.workerId,
    );
    expect(() => reportRecipientClaimSchema.parse(retiredClaim)).not.toThrow();
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(admitExport).toHaveBeenCalledWith(
      retiredClaim,
      expect.objectContaining({ _sourceSchemaDigest: "0".repeat(64) }),
    );
    expect(prepareScheduled).not.toHaveBeenCalled();
  });
  it("pauses an invalid frozen config even when its source descriptor is unchanged", async () => {
    const malformedClaim = {
      ...claim,
      config: {
        ...(claim.config as Record<string, unknown>),
        report: { kind: "readiness", productId: "invalid-product-id" },
      },
    };
    const admitExport = jest.fn().mockResolvedValue(null);
    const queue = {
      scheduleDue: jest.fn().mockResolvedValue(0),
      claimRecipient: jest.fn().mockResolvedValue(malformedClaim),
      authorizeRecipient: jest.fn().mockResolvedValue(true),
      admitExport,
    } as unknown as ReportsWorkerQueue;
    const worker = new ReportsWorker(
      queue,
      { runOnce: jest.fn() },
      { prepareScheduled: jest.fn() },
      claim.workerId,
    );
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(admitExport).toHaveBeenCalledWith(
      malformedClaim,
      expect.objectContaining({ _sourceSchemaDigest: "0".repeat(64) }),
    );
  });
  it("checks source drift again for an already admitted export", async () => {
    const admittedClaim = {
      ...claim,
      exportJobId: claim.recipientId,
      sourceSchemaDigest: "b".repeat(64),
    };
    const admitExport = jest.fn().mockResolvedValue(null);
    const render = jest.fn();
    const queue = {
      scheduleDue: jest.fn().mockResolvedValue(0),
      claimRecipient: jest.fn().mockResolvedValue(admittedClaim),
      authorizeRecipient: jest.fn().mockResolvedValue(true),
      admitExport,
    } as unknown as ReportsWorkerQueue;
    const worker = new ReportsWorker(
      queue,
      { runOnce: render },
      { prepareScheduled: jest.fn() },
      claim.workerId,
    );
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(admitExport).toHaveBeenCalledWith(
      admittedClaim,
      expect.objectContaining({
        _sourceSchemaDigest: claim.sourceSchemaDigest,
      }),
    );
    expect(render).not.toHaveBeenCalled();
  });
  it("passes resolved list filters and trusted source context into admission", async () => {
    const listClaim = {
      ...claim,
      config: {
        ...(claim.config as Record<string, unknown>),
        report: {
          kind: "list" as const,
          source: "products.registry" as const,
          format: "csv" as const,
          context: {},
          filters: {},
        },
      },
      sourceSchemaDigest: sourceSchemaDigest({
        kind: "list",
        source: "products.registry",
        format: "csv",
        context: {},
        filters: {},
      }),
    } as ReportRecipientClaim;
    const admitExport = jest.fn().mockResolvedValue({ id: "job" });
    const prepareScheduled = jest.fn().mockResolvedValue({ trusted: true });
    const queue = {
      scheduleDue: jest.fn().mockResolvedValue(0),
      claimRecipient: jest.fn().mockResolvedValue(listClaim),
      authorizeRecipient: jest.fn().mockResolvedValue(true),
      admitExport,
      publishRecipient: jest.fn().mockResolvedValue({}),
      failRecipient: jest.fn(),
    } as unknown as ReportsWorkerQueue;
    const worker = new ReportsWorker(
      queue,
      { runOnce: jest.fn().mockResolvedValue("processed") },
      { prepareScheduled },
      claim.workerId,
    );
    await worker.runOnce();
    expect(prepareScheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "products.registry",
        ownerUserId: claim.ownerUserId,
        userId: claim.userId,
        requestId: claim.recipientId,
      }),
    );
    expect(admitExport).toHaveBeenCalledWith(
      listClaim,
      expect.objectContaining({ trusted: true, _resolvedFilters: {} }),
    );
  });
  it("uses a distinct audit snapshot request for each recipient in one run", async () => {
    const secondRecipientId = "99999999-9999-4999-8999-999999999999";
    const secondUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const report = {
      kind: "list" as const,
      source: "audit.events",
      format: "csv" as const,
      context: {},
      filters: {
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-08T00:00:00.000Z",
      },
    };
    const first = {
      ...claim,
      config: {
        ...(claim.config as Record<string, unknown>),
        report,
        recipientUserIds: [claim.userId, secondUserId],
      },
      sourceSchemaDigest: sourceSchemaDigest(report),
    };
    const second = {
      ...first,
      recipientId: secondRecipientId,
      userId: secondUserId,
    };
    const prepareScheduled = jest.fn().mockResolvedValue({ audit: true });
    const failRecipient = jest.fn();
    const queue = {
      scheduleDue: jest.fn().mockResolvedValue(0),
      claimRecipient: jest
        .fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(second),
      authorizeRecipient: jest.fn().mockResolvedValue(true),
      admitExport: jest.fn().mockResolvedValue({ id: claim.recipientId }),
      publishRecipient: jest.fn().mockResolvedValue({ outcome: "ready" }),
      failRecipient,
    } as unknown as ReportsWorkerQueue;
    const worker = new ReportsWorker(
      queue,
      { runOnce: jest.fn().mockResolvedValue("processed") },
      { prepareScheduled },
      claim.workerId,
    );
    await worker.runOnce();
    await worker.runOnce();
    expect(prepareScheduled).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ requestId: claim.recipientId }),
    );
    expect(prepareScheduled).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ requestId: secondRecipientId }),
    );
    expect(failRecipient).not.toHaveBeenCalled();
  });
  it("does not publish after a second authorization check fails", async () => {
    const failRecipient = jest.fn().mockResolvedValue({});
    const publishRecipient = jest.fn();
    const queue = {
      scheduleDue: jest.fn().mockResolvedValue(0),
      claimRecipient: jest
        .fn()
        .mockResolvedValue({ ...claim, exportJobId: claim.recipientId }),
      authorizeRecipient: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      admitExport: jest.fn().mockResolvedValue({ id: claim.recipientId }),
      failRecipient,
      publishRecipient,
    } as unknown as ReportsWorkerQueue;
    const worker = new ReportsWorker(
      queue,
      { runOnce: jest.fn() },
      { prepareScheduled: jest.fn() },
      claim.workerId,
    );
    await worker.runOnce();
    expect(failRecipient).toHaveBeenCalledWith(
      expect.anything(),
      "access_changed",
    );
    expect(publishRecipient).not.toHaveBeenCalled();
  });
  it("leaves stale fenced work for its current owner", async () => {
    const failRecipient = jest.fn();
    const queue = {
      scheduleDue: jest.fn().mockResolvedValue(0),
      claimRecipient: jest
        .fn()
        .mockResolvedValue({ ...claim, exportJobId: claim.recipientId }),
      authorizeRecipient: jest.fn().mockResolvedValue(true),
      admitExport: jest.fn().mockResolvedValue({ id: claim.recipientId }),
      publishRecipient: jest
        .fn()
        .mockRejectedValue(new Error("lease_conflict")),
      failRecipient,
    } as unknown as ReportsWorkerQueue;
    const worker = new ReportsWorker(
      queue,
      { runOnce: jest.fn().mockResolvedValue("processed") },
      { prepareScheduled: jest.fn() },
      claim.workerId,
    );
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(failRecipient).not.toHaveBeenCalled();
    expect(safeReportWorkerFailure(new ExportUnavailableError())).toBe(
      "provider_unavailable",
    );
    expect(safeReportWorkerFailure(new Error("secret provider message"))).toBe(
      "generation_failed",
    );
  });
  it("extends the recipient lease while rendering is still running", async () => {
    jest.useFakeTimers();
    let finishRender: (result: "processed") => void = () => undefined;
    const heartbeatRecipient = jest.fn().mockResolvedValue(true);
    const queue = {
      scheduleDue: jest.fn().mockResolvedValue(0),
      claimRecipient: jest
        .fn()
        .mockResolvedValue({ ...claim, exportJobId: claim.recipientId }),
      authorizeRecipient: jest.fn().mockResolvedValue(true),
      admitExport: jest.fn().mockResolvedValue({ id: claim.recipientId }),
      heartbeatRecipient,
      publishRecipient: jest.fn().mockResolvedValue({ outcome: "ready" }),
    } as unknown as ReportsWorkerQueue;
    const render = new Promise<"processed">((resolve) => {
      finishRender = resolve;
    });
    const worker = new ReportsWorker(
      queue,
      { runOnce: () => render },
      { prepareScheduled: jest.fn() },
      claim.workerId,
    );
    try {
      const work = worker.runOnce();
      await jest.advanceTimersByTimeAsync(30_000);
      finishRender("processed");
      await expect(work).resolves.toBe("processed");
      expect(heartbeatRecipient).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
  it("does not publish if scheduled export admission is unavailable", async () => {
    const publishRecipient = jest.fn();
    const queue = {
      scheduleDue: jest.fn().mockResolvedValue(0),
      claimRecipient: jest.fn().mockResolvedValue(claim),
      authorizeRecipient: jest.fn().mockResolvedValue(true),
      admitExport: jest.fn().mockResolvedValue(null),
      publishRecipient,
      failRecipient: jest.fn(),
    } as unknown as ReportsWorkerQueue;
    const worker = new ReportsWorker(
      queue,
      { runOnce: jest.fn() },
      { prepareScheduled: jest.fn() },
      claim.workerId,
    );
    await worker.runOnce();
    expect(publishRecipient).not.toHaveBeenCalled();
  });
  it("leaves a publication transport failure for fenced reclaim", async () => {
    const admittedClaim = { ...claim, exportJobId: claim.recipientId };
    const failRecipient = jest.fn();
    const render = jest.fn().mockResolvedValue("processed");
    const queue = {
      scheduleDue: jest.fn().mockResolvedValue(0),
      claimRecipient: jest.fn().mockResolvedValue(admittedClaim),
      authorizeRecipient: jest.fn().mockResolvedValue(true),
      admitExport: jest.fn().mockResolvedValue({ id: claim.recipientId }),
      publishRecipient: jest
        .fn()
        .mockRejectedValue(new Error("provider_unavailable")),
      failRecipient,
    } as unknown as ReportsWorkerQueue;
    const worker = new ReportsWorker(
      queue,
      { runOnce: render },
      { prepareScheduled: jest.fn() },
      claim.workerId,
    );
    await expect(worker.runOnce()).resolves.toBe("processed");
    expect(render).toHaveBeenCalledTimes(1);
    expect(failRecipient).not.toHaveBeenCalled();
  });
  it("publishes only after export worker returns", async () => {
    const events: string[] = [];
    const queue = {
      scheduleDue: jest.fn().mockResolvedValue(1),
      claimRecipient: jest.fn().mockResolvedValue(claim),
      authorizeRecipient: jest.fn().mockResolvedValue(true),
      admitExport: jest.fn().mockResolvedValue({ id: "job" }),
      publishRecipient: jest.fn().mockImplementation(() => {
        events.push("publish");
        return Promise.resolve({});
      }),
      failRecipient: jest.fn(),
    } as unknown as ReportsWorkerQueue;
    const exportWorker = {
      runOnce: jest.fn().mockImplementation(() => {
        events.push("render");
        return Promise.resolve("processed");
      }),
    };
    const worker = new ReportsWorker(
      queue,
      exportWorker,
      { prepareScheduled: jest.fn() },
      claim.workerId,
    );
    await worker.runOnce();
    expect(events).toEqual(["render", "publish"]);
  });
});
