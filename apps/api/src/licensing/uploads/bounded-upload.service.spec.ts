import { Readable } from "node:stream";
import { ConfigService } from "@nestjs/config";
import { BoundedUploadService } from "./bounded-upload.service";

const org = "10000000-0000-4000-8000-000000000001";
const actor = "10000000-0000-4000-8000-000000000002";
const operation = "10000000-0000-4000-8000-000000000003";
const token = "a".repeat(43);
const scope = { kind: "member" as const, organizationId: org, actorId: actor };
function setup(outcome = "claimed") {
  const upload = jest
    .fn<
      Promise<{ error: unknown }>,
      [string, Readable, Readonly<Record<string, unknown>>]
    >()
    .mockImplementation(async (_path, stream) => {
      for await (const value of stream) {
        void value;
      }
      return { error: null };
    });
  const rpc = jest
    .fn<
      Promise<{ error: null; data: Record<string, unknown> }>,
      [string, Readonly<Record<string, unknown>>]
    >()
    .mockImplementation((name: string) =>
      Promise.resolve({
        error: null,
        data:
          name === "m15_01_reconcile_abandoned_reservations"
            ? (0 as unknown as Record<string, unknown>)
            : name === "m15_01_reserve_storage"
              ? { outcome: "reserved", operationId: operation }
              : name === "m15_01_prepare_storage_publication"
                ? { outcome: "authorized" }
                : name === "m15_01_complete_storage"
                  ? { outcome: "completed" }
                  : {
                      outcome,
                      organizationId: org,
                      actorUserId: actor,
                      bucket: "evidence-documents",
                      objectPath: `${org}/object`,
                      bytes: 3,
                      contentType: "text/plain",
                      expiresAt: new Date(Date.now() + 60_000).toISOString(),
                    },
      }),
    );
  const supabase = {
    admin: () => ({ rpc, storage: { from: () => ({ upload }) } }),
  };
  const licensing = {
    canClaim: jest.fn().mockResolvedValue(true),
    getWorkerPolicy: jest
      .fn()
      .mockResolvedValue({ customerWritesAllowed: false }),
  };
  return {
    licensing,
    service: new BoundedUploadService(
      supabase as never,
      new ConfigService({ API_PUBLIC_ORIGIN: "https://api.example.test" }),
      licensing as never,
    ),
    rpc,
    upload,
  };
}
describe("bounded upload authority", () => {
  it("issues API URLs and persists only the random token digest", async () => {
    const { service, rpc } = setup();
    const issued = await service.issue({
      bucket: "evidence-documents",
      objectKey: `${org}/object`,
      byteSize: 3,
      contentType: "text/plain",
      scope,
    });
    const url = new URL(issued.uploadUrl);
    expect(url.origin).toBe("https://api.example.test");
    expect(url.pathname).toMatch(/^\/api\/v1\/licensing\/uploads\//);
    const args = rpc.mock.calls.find(
      ([name]) => name === "m15_01_reserve_storage",
    )![1];
    expect(args.p_actor_user_id).toBe(actor);
    expect(args.p_token_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(args)).not.toContain(url.pathname.split("/").at(-1));
  });
  it("reclaims only source-confirmed abandoned reservations before admission", async () => {
    const { service, rpc } = setup();
    await service.issue({
      bucket: "product-imports",
      objectKey: `${org}/object`,
      byteSize: 3,
      contentType: "text/plain",
      scope,
    });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "m15_01_reconcile_abandoned_reservations",
      "m15_01_reserve_storage",
    ]);
    expect(rpc).toHaveBeenCalledWith(
      "m15_01_reconcile_abandoned_reservations",
      { p_organization_id: org, p_limit: 100 },
    );
  });
  it("refreshes runtime proof before reporting reservation without denying a protected duty", async () => {
    const { service, rpc, licensing } = setup();
    const receiptScope = {
      kind: "reporting_receipt" as const,
      organizationId: org,
      actorId: actor,
      sessionId: operation,
      obligationId: operation,
      stageId: operation,
      packageId: operation,
      approvalId: operation,
      proofId: operation,
      idempotencyKey: operation,
      isRehearsal: false,
    };
    await service.issue({
      bucket: "reporting-evidence",
      objectKey: `${org}/receipt.txt`,
      byteSize: 3,
      contentType: "text/plain",
      scope: receiptScope,
    });
    expect(licensing.canClaim).not.toHaveBeenCalled();
    expect(licensing.getWorkerPolicy).toHaveBeenCalledWith(org);
    expect(licensing.getWorkerPolicy.mock.invocationCallOrder[0]).toBeLessThan(
      rpc.mock.invocationCallOrder[0]!,
    );
    expect(rpc).toHaveBeenCalledWith(
      "m15_01_reserve_storage",
      expect.objectContaining({
        p_actor_user_id: actor,
        p_source_context: receiptScope,
        p_capability: "reporting",
      }),
    );
  });
  it("fails closed before reservation when reporting runtime proof cannot refresh", async () => {
    const { service, rpc, licensing } = setup();
    licensing.getWorkerPolicy.mockRejectedValue(
      new Error("database unavailable"),
    );
    await expect(
      service.issue({
        bucket: "reporting-evidence",
        objectKey: `${org}/receipt.txt`,
        byteSize: 3,
        contentType: "text/plain",
        scope: {
          ...scope,
          kind: "reporting_receipt",
          sessionId: operation,
          obligationId: operation,
          stageId: operation,
          packageId: operation,
          approvalId: operation,
          proofId: operation,
          idempotencyKey: operation,
          isRehearsal: false,
        },
      }),
    ).rejects.toThrow("database unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["completed", "conflict", "forbidden"])(
    "checks source and exact bytes before receipt retry: %s",
    async (outcome) => {
      const { service, rpc, upload, licensing } = setup();
      rpc.mockResolvedValueOnce({ error: null, data: { outcome } });
      const receiptScope = {
        ...scope,
        kind: "reporting_receipt" as const,
        sessionId: operation,
        obligationId: operation,
        stageId: operation,
        packageId: operation,
        approvalId: operation,
        proofId: operation,
        idempotencyKey: operation,
        isRehearsal: false,
      };
      const result = service.write({
        bucket: "reporting-evidence",
        objectKey: `${org}/receipt.txt`,
        bytes: Buffer.from("abc"),
        contentType: "text/plain",
        scope: receiptScope,
      });
      if (outcome === "completed")
        await expect(result).resolves.toBeUndefined();
      else
        await expect(result).rejects.toThrow(
          "Receipt replay authority unavailable",
        );
      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("m15_01_replay_reporting_receipt", {
        p_organization_id: org,
        p_actor_user_id: actor,
        p_object_path: `${org}/receipt.txt`,
        p_bytes: 3,
        p_content_type: "text/plain",
        p_sha256:
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        p_context: receiptScope,
      });
      expect(
        licensing.getWorkerPolicy.mock.invocationCallOrder[0],
      ).toBeLessThan(rpc.mock.invocationCallOrder[0]!);
      expect(upload).not.toHaveBeenCalled();
    },
  );
  it("accepts the UTC offset emitted by Postgres admission timestamps", async () => {
    const { service, rpc, upload } = setup();
    rpc.mockResolvedValueOnce({
      error: null,
      data: {
        outcome: "claimed",
        organizationId: org,
        actorUserId: actor,
        bucket: "evidence-documents",
        objectPath: `${org}/object`,
        bytes: 3,
        contentType: "text/plain",
        expiresAt: new Date(Date.now() + 60_000)
          .toISOString()
          .replace("Z", "+00:00"),
      },
    });
    await expect(
      service.accept(
        operation,
        token,
        "3",
        Readable.from([Buffer.from("abc")]),
      ),
    ).resolves.toBeUndefined();
    expect(upload).toHaveBeenCalledTimes(1);
  });
  it("publishes only exact staged bytes after fresh authority validation", async () => {
    const { service, rpc, upload } = setup();
    await service.accept(
      operation,
      token,
      "3",
      Readable.from([Buffer.from("abc")]),
    );
    expect(upload).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.map((call) => call[0])).toContain(
      "m15_01_prepare_storage_publication",
    );
    expect(rpc.mock.calls.at(-1)![0]).toBe("m15_01_complete_storage");
  });
  it.each([actor, null])(
    "publishes generic evidence authority with the inspected media type for actor %s",
    async (actorUserId) => {
      const { service, rpc, upload } = setup();
      const original = rpc.getMockImplementation()!;
      rpc.mockImplementation(async (name, args) => {
        const response = await original(name, args);
        return name === "m15_01_claim_storage_upload"
          ? {
              ...response,
              data: {
                ...response.data,
                actorUserId,
                contentType: "application/octet-stream",
              },
            }
          : response;
      });
      await service.accept(
        operation,
        token,
        "3",
        Readable.from([Buffer.from("abc")]),
      );
      expect(upload.mock.calls[0]![2]).toMatchObject({
        contentType: "text/plain",
      });
    },
  );
  it.each(["text/plain", "application/octet-stream"])(
    "preserves other bucket comparison for declared type %s",
    async (contentType) => {
      const { service, rpc, upload } = setup();
      const original = rpc.getMockImplementation()!;
      rpc.mockImplementation(async (name, args) => {
        const response = await original(name, args);
        return name === "m15_01_claim_storage_upload"
          ? {
              ...response,
              data: {
                ...response.data,
                bucket: "security-update-artifacts",
                contentType,
              },
            }
          : response;
      });
      const accepted = service.accept(
        operation,
        token,
        "3",
        Readable.from([Buffer.from([0xff, 0xd8, 0xff])]),
      );
      if (contentType === "text/plain") {
        await expect(accepted).rejects.toThrow("Upload content mismatch");
        expect(upload).not.toHaveBeenCalled();
      } else {
        await expect(accepted).resolves.toBeUndefined();
        expect(upload.mock.calls[0]![2]).toMatchObject({ contentType });
      }
    },
  );
  it("rejects unsupported evidence bytes before publication", async () => {
    const { service, rpc, upload } = setup();
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) => {
      const response = await original(name, args);
      return name === "m15_01_claim_storage_upload"
        ? {
            ...response,
            data: {
              ...response.data,
              contentType: "application/octet-stream",
            },
          }
        : response;
    });
    await expect(
      service.accept(
        operation,
        token,
        "3",
        Readable.from([Buffer.from([0, 1, 2])]),
      ),
    ).rejects.toThrow("Unsupported or disguised evidence content");
    expect(upload).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain(
      "m15_01_prepare_storage_publication",
    );
    expect(rpc.mock.calls.map(([name]) => name)).toContain(
      "m15_01_reset_storage_upload",
    );
  });
  it.each(["forbidden", "conflict"])(
    "refuses revoked or concurrently claimed grants",
    async (outcome) => {
      const { service, upload } = setup(outcome);
      await expect(
        service.accept(
          operation,
          token,
          "3",
          Readable.from([Buffer.from("abc")]),
        ),
      ).rejects.toThrow();
      expect(upload).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["2", "abc"],
    ["3", "ab"],
    ["3", "abcd"],
    [undefined, "abc"],
  ])("rejects length mismatch without publication", async (length, bytes) => {
    const { service, upload } = setup();
    await expect(
      service.accept(
        operation,
        token,
        length,
        Readable.from([Buffer.from(bytes)]),
      ),
    ).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });
  it("keeps ambiguous publication charged without completing the reservation", async () => {
    const { service, rpc, upload } = setup();
    upload.mockResolvedValue({ error: { message: "outage" } });
    await expect(
      service.accept(
        operation,
        token,
        "3",
        Readable.from([Buffer.from("abc")]),
      ),
    ).rejects.toThrow();
    expect(rpc.mock.calls.map((call) => call[0])).not.toContain(
      "m15_01_complete_storage",
    );
    expect(rpc.mock.calls.map((call) => call[0])).not.toContain(
      "m15_01_reset_storage_upload",
    );
  });
  it("denies wrong tokens before any database/storage request", async () => {
    const { service, rpc } = setup();
    await expect(
      service.accept(operation, "wrong", "3", Readable.from([])),
    ).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("writes bounded server ingress through the same admission", async () => {
    const { service, upload } = setup();
    await service.write({
      objectKey: `${org}/object`,
      bytes: Buffer.from("abc"),
      contentType: "text/plain",
      bucket: "product-imports",
      scope,
    });
    expect(upload).toHaveBeenCalledTimes(1);
  });
  it.each([0, -1, 1.5, 100 * 1024 * 1024 + 1])(
    "rejects invalid issue sizes before RPC",
    async (byteSize) => {
      const { service, rpc } = setup();
      await expect(
        service.issue({
          objectKey: `${org}/object`,
          byteSize,
          contentType: "text/plain",
          bucket: "evidence-documents",
          scope,
        }),
      ).rejects.toThrow();
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it("resolves supplier scope through its hashed source identity", async () => {
    const { service, rpc } = setup();
    rpc.mockResolvedValueOnce({ error: null, data: org as never });
    await service.issue({
      objectKey: "supplier-object",
      byteSize: 3,
      contentType: "text/plain",
      bucket: "evidence-documents",
      scope: { kind: "supplier_evidence", sessionTokenHash: "b".repeat(64) },
    });
    expect(
      rpc.mock.calls.find(([name]) => name === "m15_01_reserve_storage")![1],
    ).toMatchObject({
      p_organization_id: org,
      p_actor_user_id: null,
      p_source_context: { kind: "supplier_evidence" },
    });
  });
  it.each(["quota_exceeded", "accounting_unavailable"])(
    "fails closed on admission %s",
    async (outcome) => {
      const { service, rpc } = setup();
      rpc.mockResolvedValueOnce({ error: null, data: { outcome } });
      await expect(
        service.issue({
          objectKey: `${org}/object`,
          byteSize: 3,
          contentType: "text/plain",
          bucket: "evidence-documents",
          scope,
        }),
      ).rejects.toThrow();
    },
  );
  it("rejects revocation while the upload is staged", async () => {
    const { service, rpc, upload } = setup();
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementation((name, args) =>
      name === "m15_01_prepare_storage_publication"
        ? Promise.resolve({ error: null, data: { outcome: "forbidden" } })
        : original(name, args),
    );
    await expect(
      service.accept(
        operation,
        token,
        "3",
        Readable.from([Buffer.from("abc")]),
      ),
    ).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });
  it("rejects malformed admission projections", async () => {
    const { service, rpc } = setup();
    rpc.mockResolvedValueOnce({ error: null, data: { outcome: "claimed" } });
    await expect(
      service.accept(operation, token, "3", Readable.from([])),
    ).rejects.toThrow();
  });
  it("rejects a content-addressed hash mismatch before publication", async () => {
    const { service, rpc, upload } = setup();
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) => {
      const response = await original(name, args);
      return name === "m15_01_claim_storage_upload"
        ? {
            ...response,
            data: { ...response.data, objectPath: `${org}/${"b".repeat(64)}` },
          }
        : response;
    });
    await expect(
      service.accept(
        operation,
        token,
        "3",
        Readable.from([Buffer.from("abc")]),
      ),
    ).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });
  it("retains accounting after failed completion", async () => {
    const { service, rpc } = setup();
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementation((name, args) =>
      name === "m15_01_complete_storage"
        ? Promise.resolve({ error: null, data: { outcome: "forbidden" } })
        : original(name, args),
    );
    await expect(
      service.accept(
        operation,
        token,
        "3",
        Readable.from([Buffer.from("abc")]),
      ),
    ).rejects.toThrow();
  });
  it("rejects nonlocal insecure configured upload origins", async () => {
    const { rpc } = setup();
    const service = new BoundedUploadService(
      { admin: () => ({ rpc }) } as never,
      new ConfigService({ API_PUBLIC_ORIGIN: "http://external.example.test" }),
      { canClaim: () => Promise.resolve(true) } as never,
    );
    await expect(
      service.issue({
        objectKey: `${org}/object`,
        byteSize: 3,
        contentType: "text/plain",
        bucket: "evidence-documents",
        scope,
      }),
    ).rejects.toThrow();
  });
  it("allows loopback origin defaults for local development", async () => {
    const { rpc } = setup();
    const service = new BoundedUploadService(
      { admin: () => ({ rpc }) } as never,
      new ConfigService(),
      { canClaim: () => Promise.resolve(true) } as never,
    );
    const issued = await service.issue({
      objectKey: `${org}/object`,
      byteSize: 3,
      contentType: "text/plain",
      bucket: "evidence-documents",
      scope,
    });
    expect(new URL(issued.uploadUrl).origin).toBe("http://localhost:3333");
  });
  it("allows retry of a deterministic prepublication failure while retaining its reservation", async () => {
    const { service, rpc, upload } = setup();
    await expect(
      service.accept(operation, token, "3", Readable.from([Buffer.from("ab")])),
    ).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map((call) => call[0])).toContain(
      "m15_01_reset_storage_upload",
    );
  });
  it("uses APP_URL for same-origin browser uploads", async () => {
    const { rpc } = setup();
    const service = new BoundedUploadService(
      { admin: () => ({ rpc }) } as never,
      new ConfigService({ APP_URL: "https://app.example.test" }),
      { canClaim: () => Promise.resolve(true) } as never,
    );
    const issued = await service.issue({
      objectKey: `${org}/object`,
      byteSize: 3,
      contentType: "text/plain",
      bucket: "evidence-documents",
      scope,
    });
    expect(new URL(issued.uploadUrl).origin).toBe("https://app.example.test");
  });
  it("preserves admission for security artifacts larger than 100MiB without allocating their bytes", async () => {
    const { service, rpc } = setup();
    const issued = await service.issue({
      objectKey: `${org}/${"b".repeat(64)}`,
      byteSize: 2_147_483_647,
      contentType: "application/octet-stream",
      bucket: "security-update-artifacts",
      scope,
    });
    expect(issued.uploadUrl).toContain("/licensing/uploads/");
    expect(
      rpc.mock.calls.find(([name]) => name === "m15_01_reserve_storage")![1]
        .p_bytes,
    ).toBe(2_147_483_647);
  });
  it.each([
    ["evidence-documents", 50 * 1024 * 1024],
    ["sbom-originals", 100 * 1024 * 1024],
    ["security-update-artifacts", 2_147_483_647],
    ["product-imports", 10 * 1024 * 1024],
    ["organization-branding", 2 * 1024 * 1024],
  ] as const)(
    "preserves %s exact source ceiling and rejects its next byte",
    async (bucket, limit) => {
      const { service, rpc } = setup();
      await service.issue({
        objectKey: `${org}/object`,
        byteSize: limit,
        contentType: "application/octet-stream",
        bucket,
        scope,
      });
      rpc.mockClear();
      await expect(
        service.issue({
          objectKey: `${org}/object`,
          byteSize: limit + 1,
          contentType: "application/octet-stream",
          bucket,
          scope,
        }),
      ).rejects.toThrow();
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it("rejects provider claim bytes beyond the bound for its source bucket", async () => {
    const { service, rpc, upload } = setup();
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (name, args) => {
      const response = await original(name, args);
      return name === "m15_01_claim_storage_upload"
        ? {
            ...response,
            data: { ...response.data, bytes: 50 * 1024 * 1024 + 1 },
          }
        : response;
    });
    await expect(
      service.accept(
        operation,
        token,
        String(50 * 1024 * 1024 + 1),
        Readable.from([]),
      ),
    ).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });
  it.each([
    ["security-update-artifacts", 2 * 60 * 60_000],
    ["evidence-documents", 15 * 60_000],
    ["sbom-originals", 10 * 60_000],
  ] as const)("preserves the %s upload window", async (bucket, lifetime) => {
    const { service } = setup();
    const before = Date.now();
    const issued = await service.issue({
      objectKey: `${org}/object`,
      byteSize: 3,
      contentType: "application/octet-stream",
      bucket,
      scope,
    });
    expect(Date.parse(issued.expiresAt)).toBeGreaterThanOrEqual(
      before + lifetime,
    );
    expect(Date.parse(issued.expiresAt)).toBeLessThanOrEqual(
      Date.now() + lifetime,
    );
  });
  it("reconciles proven publication after a completion outage without source workflow changes", async () => {
    const { service, rpc, upload } = setup();
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementation((name, args) =>
      name === "m15_01_complete_storage"
        ? Promise.resolve({ error: null, data: { outcome: "forbidden" } })
        : name === "m15_01_reconcile_storage_upload"
          ? Promise.resolve({ error: null, data: { outcome: "completed" } })
          : original(name, args),
    );
    await expect(
      service.accept(
        operation,
        token,
        "3",
        Readable.from([Buffer.from("abc")]),
      ),
    ).resolves.toBeUndefined();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]![2]).toMatchObject({
      metadata: {
        sha256:
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        operationId: operation,
      },
    });
    expect(rpc.mock.calls.map((call) => call[0])).toContain(
      "m15_01_reconcile_storage_upload",
    );
  });
  it("does not acknowledge an uncertain publication and retains its reservation", async () => {
    const { service, rpc, upload } = setup();
    const original = rpc.getMockImplementation()!;
    upload.mockResolvedValue({ error: { message: "timeout" } });
    rpc.mockImplementation((name, args) =>
      name === "m15_01_reconcile_storage_upload"
        ? Promise.resolve({ error: null, data: { outcome: "uncertain" } })
        : original(name, args),
    );
    await expect(
      service.accept(
        operation,
        token,
        "3",
        Readable.from([Buffer.from("abc")]),
      ),
    ).rejects.toThrow();
    expect(rpc.mock.calls.map((call) => call[0])).not.toContain(
      "m15_01_reset_storage_upload",
    );
  });
  it("recovers a process restart or lost completion response without publishing a second object", async () => {
    const { service, rpc, upload } = setup("conflict");
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementation((name, args) =>
      name === "m15_01_reconcile_storage_upload"
        ? Promise.resolve({ error: null, data: { outcome: "replayed" } })
        : original(name, args),
    );
    await expect(
      service.accept(
        operation,
        token,
        "3",
        Readable.from([Buffer.from("abc")]),
      ),
    ).resolves.toBeUndefined();
    expect(upload).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map((call) => call[0])).not.toContain(
      "m15_01_reset_storage_upload",
    );
  });
});
