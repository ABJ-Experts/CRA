import { describe, expect, it, vi } from "vitest";
import { BackupsGateway } from "./backups-gateway";
import { instanceId, observedAt } from "./operator.fixture";
import { backupPolicy, backupQueued } from "./backups.fixture";

const configuration = {
  sourceAlias: "local-source",
  repositoryAlias: "off-host",
  stagingAlias: "private-ram",
  keyAlias: "backup-key-v1",
  targetProfile: "isolated-saas",
  residency: "eu",
};
const request = { configuration };
const validation = {
  valid: false,
  checkedAt: observedAt,
  configurationDigest: "a".repeat(64),
  checks: [{ code: "key_unavailable", status: "failed" }],
};

describe("private backup transport", () => {
  it("parses both boundaries and uses private same-origin JSON without replay", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(validation));
    const gateway = new BackupsGateway(fetcher);
    await expect(gateway.validate(instanceId, request)).resolves.toEqual(
      validation,
    );
    expect(fetcher).toHaveBeenCalledWith(
      `/api/v1/operator/instances/${instanceId}/backups/policy/validate`,
      expect.objectContaining({
        method: "POST",
        mode: "same-origin",
        credentials: "same-origin",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(
      JSON.parse(fetcher.mock.calls[0]![1].body as string).configuration
        .schedulingEnabled,
    ).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("rejects paths and invalid input before transport", async () => {
    const fetcher = vi.fn();
    const gateway = new BackupsGateway(fetcher);
    await expect(gateway.policy("../source")).rejects.toThrow();
    await expect(
      gateway.validate(instanceId, {
        ...request,
        configuration: { ...configuration, sourceAlias: "/data" },
      }),
    ).rejects.toThrow();
    await expect(gateway.history(instanceId, { limit: 101 })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([401, 403, 409, 503])(
    "keeps %s failures safe without refreshing or replaying",
    async (status) => {
      const fetcher = vi
        .fn()
        .mockResolvedValue(
          Response.json({ message: "/private/key" }, { status }),
        );
      await expect(
        new BackupsGateway(fetcher).validate(instanceId, request),
      ).rejects.toMatchObject({ status });
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it("rejects malformed successful responses", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ ...validation, key: "secret" }));
    await expect(
      new BackupsGateway(fetcher).validate(instanceId, request),
    ).rejects.toMatchObject({ status: 502 });
  });
  it("covers configuration, bounded history and every versioned lifecycle endpoint", async () => {
    const review = {
      runId: instanceId,
      version: 1,
      eligible: false,
      blockers: ["last_recoverable_chain"],
      reviewFingerprint: "a".repeat(64),
      reviewedAt: observedAt,
    };
    const child = {
      ...backupQueued,
      kind: "verification",
      parentRunId: instanceId,
    };
    const outputs = [
      { policy: null },
      backupPolicy,
      { items: [backupQueued], nextCursor: null },
      backupQueued,
      backupQueued,
      backupQueued,
      child,
      review,
      backupQueued,
    ];
    const fetcher = vi.fn();
    for (const output of outputs)
      fetcher.mockResolvedValueOnce(Response.json(output));
    const gateway = new BackupsGateway(fetcher);
    const mutation = { expectedVersion: 1, idempotencyKey: instanceId };
    expect(await gateway.policy(instanceId)).toBeNull();
    await gateway.save(instanceId, { ...mutation, configuration });
    await gateway.history(instanceId, { cursor: instanceId, kind: "capture" });
    await gateway.run(instanceId, mutation);
    await gateway.detail(instanceId, instanceId);
    await gateway.cancel(instanceId, instanceId, mutation);
    await gateway.verify(instanceId, instanceId, {
      ...mutation,
      targetProfile: "isolated-saas",
    });
    await gateway.cleanupReview(instanceId, instanceId, { expectedVersion: 1 });
    await gateway.cleanup(instanceId, instanceId, {
      ...mutation,
      reviewFingerprint: "a".repeat(64),
    });
    expect(fetcher.mock.calls[2]![0]).toContain(
      `limit=25&cursor=${instanceId}&kind=capture`,
    );
    expect(fetcher.mock.calls[1]![1].method).toBe("PUT");
    expect(fetcher).toHaveBeenCalledTimes(9);
  });
  it("rejects foreign instance and run identities after successful parsing", async () => {
    const foreign = "22222222-2222-4222-8222-222222222222";
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ policy: { ...backupPolicy, instanceId: foreign } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [{ ...backupQueued, instanceId: foreign }],
          nextCursor: null,
        }),
      )
      .mockResolvedValueOnce(Response.json({ ...backupQueued, id: foreign }));
    const gateway = new BackupsGateway(fetcher);
    await expect(gateway.policy(instanceId)).rejects.toMatchObject({
      status: 409,
    });
    await expect(gateway.history(instanceId)).rejects.toMatchObject({
      status: 409,
    });
    await expect(gateway.detail(instanceId, instanceId)).rejects.toMatchObject({
      status: 409,
    });
  });
  it("calls the browser fetch with its global receiver", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(function (this: unknown) {
        if (this !== globalThis) throw new Error("receiver");
        return Promise.resolve(Response.json({ policy: null }));
      }),
    );
    try {
      expect(await new BackupsGateway().policy(instanceId)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
