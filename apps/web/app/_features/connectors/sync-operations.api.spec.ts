import { afterEach, describe, expect, it, vi } from "vitest";
import { connectorsApi } from "./connectors.api";
const id = "11111111-1111-4111-8111-111111111111";
const run = "22222222-2222-4222-8222-222222222222";
afterEach(() => vi.unstubAllGlobals());
describe("durable connector transport", () => {
  it("validates replay concurrency input before sending", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
      connectorsApi.previewReplay(id, run, {
        expectedVersion: -1,
        mappingMode: "preserve",
        sourceMode: "retained",
      }),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects malformed successful history responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ runs: { rows: [{ secret: "canary" }] } }),
            { status: 200 },
          ),
      ),
    );
    await expect(connectorsApi.syncHistory(id, {})).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });
  it("uses validated paths and bounded pagination for history", async () => {
    const response = {
      runs: { rows: [], page: 1, pageSize: 25, total: 0, pageCount: 0 },
    };
    const fetcher = vi.fn(async () => new Response(JSON.stringify(response)));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      connectorsApi.syncHistory("invalid", {}),
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
