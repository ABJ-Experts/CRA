import { afterEach, describe, expect, it, vi } from "vitest";
import { agentsApi } from "./agents.api";

const connectorId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";
const idempotencyKey = "33333333-3333-4333-8333-333333333333";

describe("AgentsApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects invalid IDs and inputs before transport", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(() => agentsApi.status("bad")).toThrow();
    await expect(
      agentsApi.issueEnrollment(connectorId, { idempotencyKey: "bad" }),
    ).rejects.toThrow();
    expect(() =>
      agentsApi.revoke(connectorId, "bad", { idempotencyKey }),
    ).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("parses health responses and rejects credential echoes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              agent: null,
              batches: { rows: [], nextCursor: null },
            }),
            { status: 200 },
          ),
      ),
    );
    await expect(agentsApi.status(connectorId)).resolves.toEqual({
      agent: null,
      batches: { rows: [], nextCursor: null },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              agent: { id: agentId, secret: "canary" },
              batches: { rows: [], nextCursor: null },
            }),
            { status: 200 },
          ),
      ),
    );
    await expect(agentsApi.status(connectorId)).rejects.toThrow();
  });

  it("sends owner mutations to scoped routes without refresh replay", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      return new Response(
        JSON.stringify(
          url.endsWith("/enrollments")
            ? { token: "a".repeat(32), expiresAt: "2026-10-01T12:15:00.000Z" }
            : {
                agent: {
                  id: agentId,
                  status: "revoked",
                  lastContactAt: null,
                  version: null,
                  capabilities: [],
                  backlogCount: 0,
                  backlogBytes: 0,
                  lastErrorCode: null,
                },
              },
        ),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetcher);
    await agentsApi.issueEnrollment(connectorId, { idempotencyKey });
    await agentsApi.revoke(connectorId, agentId, { idempotencyKey });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `/api/v1/connectors/${connectorId}/agents/enrollments`,
      `/api/v1/connectors/${connectorId}/agents/${agentId}/revoke`,
    ]);
    expect(
      fetcher.mock.calls.every(([, init]) => init?.method === "POST"),
    ).toBe(true);
  });
});
