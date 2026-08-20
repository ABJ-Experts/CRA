import {
  ConnectorSyncWorker,
  cursorAfterPage,
  cursorInputFor,
  toClaimedSyncRun,
} from "./connector-sync-worker";

describe("connector sync worker claim fairness", () => {
  it("claims only the organization selected for the current fair-scheduling turn", async () => {
    const repository = {
      listDueSyncRunOrganizations: jest
        .fn()
        .mockResolvedValue([
          { organization_id: "org-a" },
          { organization_id: "org-b" },
        ]),
      claimSyncRun: jest.fn().mockResolvedValue(null),
    };
    const worker = new ConnectorSyncWorker(
      repository as never,
      {} as never,
      new Map(),
      "test-key",
      "test-worker",
    );

    await worker.runOnce();

    expect(repository.claimSyncRun).toHaveBeenNthCalledWith(
      1,
      "org-a",
      "test-worker",
      60,
    );
    expect(repository.claimSyncRun).toHaveBeenNthCalledWith(
      2,
      "org-b",
      "test-worker",
      60,
    );
  });
});

describe("connector sync worker durable cursor handling", () => {
  it("maps an RPC JSON run into one canonical camel-case worker shape", () => {
    expect(
      toClaimedSyncRun({
        id: "run-1",
        organizationId: "org-1",
        connectorId: "connector-1",
        workKind: "dry_run",
        cursorFrom: null,
        fetchContentHash: null,
        correlationId: null,
      }),
    ).toMatchObject({ organizationId: "org-1", workKind: "dry_run" });
    expect(() =>
      toClaimedSyncRun({
        id: "run-1",
        organization_id: "org-1",
        connectorId: "connector-1",
        workKind: "dry_run",
      }),
    ).toThrow();
  });

  it("advances a terminal page to its final applied external record", () => {
    expect(
      cursorAfterPage(
        {
          records: [
            {
              externalUpdatedAt: "2026-08-20T00:00:00.000Z",
              externalId: "PLM-1",
            },
          ],
          nextCursor: null,
        },
        null,
      ),
    ).toBe("2026-08-20T00:00:00.000Z|PLM-1");
  });

  it("restores a composite durable cursor as its exact token and watermark", () => {
    expect(cursorInputFor("2026-08-20T00:00:00.000Z|PLM-1")).toEqual({
      watermark: "2026-08-20T00:00:00.000Z",
      token: "2026-08-20T00:00:00.000Z|PLM-1",
    });
  });
});
