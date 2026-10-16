import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupAssuranceGateway } from "./backup-assurance.gateway";
const id = "11111111-1111-4111-8111-111111111111";
describe("scoped backup history transport", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("parses successful safe summaries and bounded queries", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(Response.json({ items: [], nextCursor: null })),
      );
    vi.stubGlobal("fetch", fetcher);
    const gateway = new BackupAssuranceGateway();
    await gateway.history(id);
    await gateway.history(id, { cursor: id, kind: "capture", limit: 100 });
    expect(fetcher.mock.calls[0]![0]).toBe(
      "/api/v1/system/backups/runs?limit=25",
    );
    expect(fetcher.mock.calls[1]![0]).toBe(
      `/api/v1/system/backups/runs?limit=100&cursor=${id}&kind=capture`,
    );
    await expect(gateway.history(id, { limit: 101 })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects global inventory fields and authorization failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            items: [],
            nextCursor: null,
            repositoryPath: "/mounted",
          }),
        )
        .mockResolvedValueOnce(Response.json({}, { status: 403 })),
    );
    const gateway = new BackupAssuranceGateway();
    await expect(gateway.history(id)).rejects.toMatchObject({
      kind: "invalid_response",
    });
    await expect(gateway.history(id)).rejects.toMatchObject({ status: 403 });
  });
});
