import { REQUIRE_ROLE_KEY, type RequestUser } from "../auth/auth.types";
import {
  VulnerabilityFeedUnavailableError,
  VulnerabilityFeedUseCases,
} from "./application/vulnerability-feed-use-cases";
import { OfflineBundleImportUseCases } from "./application/offline-bundle-import-use-cases";
import { VulnerabilityFeedsController } from "./vulnerabilities.controller";

const now = "2026-08-26T00:00:00.000Z";
const feed = {
  feedKey: "nvd" as const,
  enabled: true,
  status: "healthy" as const,
  freshness: "fresh" as const,
  scheduleIntervalSeconds: 86_400,
  staleAfterSeconds: 172_800,
  lastAttemptedAt: now,
  lastSuccessfulCompleteAt: now,
  lastCompleteSnapshotAt: now,
  mirrorAgeSeconds: 0,
  nextScheduledAt: now,
  currentRunId: null,
  currentRecordCount: 1,
  queueDepth: 0,
  oldestQueuedAgeSeconds: null,
  deadLetterCount: 0,
  failureCount: 0,
  latestFailureCode: null,
  latestFailureAt: null,
};

const user: RequestUser = {
  id: "actor",
  authUserId: "auth-actor",
  email: "owner@cra.test",
  isActive: true,
  organizationId: null,
  role: "owner",
  accessToken: "test-token",
  aal: "aal2",
};

describe("VulnerabilityFeedsController", () => {
  it("requires the admin base role, which includes owners by rank", () => {
    expect(
      Reflect.getMetadata(REQUIRE_ROLE_KEY, VulnerabilityFeedsController),
    ).toBe("admin");
  });

  it("returns database-derived feed health without tenant parameters", async () => {
    const health = jest.fn().mockResolvedValue([
      feed,
      { ...feed, feedKey: "osv" },
      { ...feed, feedKey: "cisa_kev" },
      { ...feed, feedKey: "epss" },
      {
        ...feed,
        feedKey: "github_advisory",
        enabled: false,
        status: "disabled",
        freshness: "disabled",
        lastAttemptedAt: null,
        lastSuccessfulCompleteAt: null,
        lastCompleteSnapshotAt: null,
        mirrorAgeSeconds: null,
        nextScheduledAt: null,
      },
    ]);
    const controller = new VulnerabilityFeedsController(
      {
        health,
      } as unknown as VulnerabilityFeedUseCases,
      {} as OfflineBundleImportUseCases,
    );

    const response = await controller.health();

    expect(response.feeds).toHaveLength(5);
    expect(health).toHaveBeenCalledWith();
  });

  it("maps paginated runs and leaves database paging authoritative", async () => {
    const runs = jest.fn().mockResolvedValue({ rows: [], total: 23 });
    const controller = new VulnerabilityFeedsController(
      {
        runs,
      } as unknown as VulnerabilityFeedUseCases,
      {} as OfflineBundleImportUseCases,
    );

    await expect(
      controller.listRuns({
        feedKey: "nvd",
        page: 2,
        pageSize: 10,
        order: "asc",
      }),
    ).resolves.toEqual({
      rows: [],
      total: 23,
      page: 2,
      pageSize: 10,
      pageCount: 3,
    });
    expect(runs).toHaveBeenCalledWith({
      feedKey: "nvd",
      limit: 10,
      offset: 10,
    });
  });

  it("forwards actor-bound sync and replay requests with fresh correlations", async () => {
    const requestSync = jest.fn().mockResolvedValue({ id: "run" });
    const replay = jest.fn().mockResolvedValue({ id: "replay" });
    const controller = new VulnerabilityFeedsController(
      {
        requestSync,
        replay,
      } as unknown as VulnerabilityFeedUseCases,
      {} as OfflineBundleImportUseCases,
    );
    await expect(
      controller.requestSync({ feedKey: "nvd" }, { force: false }, user),
    ).resolves.toEqual({ run: { id: "run" } });
    await expect(
      controller.replay(
        { feedKey: "nvd", runId: "11111111-1111-4111-8111-111111111111" },
        { reason: "retry" },
        user,
      ),
    ).resolves.toEqual({ run: { id: "replay" } });
    expect(requestSync).toHaveBeenCalledWith(
      expect.objectContaining({
        feedKey: "nvd",
        actorId: "actor",
        force: false,
      }),
    );
    expect(replay).toHaveBeenCalledWith(
      expect.objectContaining({
        feedKey: "nvd",
        runId: "11111111-1111-4111-8111-111111111111",
        actorId: "actor",
      }),
    );
  });

  it("returns the existing unavailable envelope for every operational failure", async () => {
    const unavailable = new VulnerabilityFeedUnavailableError();
    const controller = new VulnerabilityFeedsController(
      {
        health: jest.fn().mockRejectedValue(unavailable),
        runs: jest.fn().mockRejectedValue(unavailable),
        requestSync: jest.fn().mockRejectedValue(unavailable),
        replay: jest.fn().mockRejectedValue(unavailable),
      } as unknown as VulnerabilityFeedUseCases,
      {} as OfflineBundleImportUseCases,
    );

    await expect(controller.health()).rejects.toMatchObject({ status: 503 });
    await expect(
      controller.listRuns({ page: 1, pageSize: 20, order: "asc" }),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      controller.requestSync({ feedKey: "nvd" }, {}, user),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      controller.replay(
        { feedKey: "nvd", runId: "11111111-1111-4111-8111-111111111111" },
        { reason: "retry" },
        user,
      ),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("keeps the same safe envelope for an unexpected adapter error", async () => {
    const controller = new VulnerabilityFeedsController(
      {
        health: jest.fn().mockRejectedValue(new Error("provider token=secret")),
      } as unknown as VulnerabilityFeedUseCases,
      {} as OfflineBundleImportUseCases,
    );

    await expect(controller.health()).rejects.toMatchObject({
      status: 503,
    });
  });
});
