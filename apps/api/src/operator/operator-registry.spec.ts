const anonKey = `e30.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.signature`;
import { OperatorRegistry, scopedCursor } from "./operator-registry";
import { NarrowRegistryClient } from "./operator-registry.client";
const instanceId = "20000000-0000-4000-8000-000000000001";
const tenantId = "30000000-0000-4000-8000-000000000001";
const identity = {
  fingerprint256: "AA:".repeat(31) + "AA",
  principalId: "10000000-0000-4000-8000-000000000001",
  revision: "r1",
  instanceIds: [instanceId],
  tenantScopes: [{ instanceId, tenantIds: [tenantId] }],
};
describe("operator scoped registry", () => {
  it("does not call storage for an instance outside explicit scopes", async () => {
    const reader = { read: jest.fn() };
    const registry = new OperatorRegistry(reader);
    await expect(
      registry.detail(identity, "40000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow();
    expect(reader.read).not.toHaveBeenCalled();
  });
  it("binds cursors to principal, live grants, route and instance", () => {
    const cursor = scopedCursor(identity, "tenants", instanceId, tenantId);
    expect(
      OperatorRegistry.decodeCursor(cursor, identity, "tenants", instanceId),
    ).toBe(tenantId);
    for (const current of [
      { ...identity, revision: "r2" },
      { ...identity, tenantScopes: [] },
      { ...identity, principalId: tenantId },
    ])
      expect(() =>
        OperatorRegistry.decodeCursor(cursor, current, "tenants", instanceId),
      ).toThrow();
    expect(() =>
      OperatorRegistry.decodeCursor(cursor, identity, "instances", null),
    ).toThrow();
    expect(() =>
      OperatorRegistry.decodeCursor(
        "eyJ4IjoxfQ",
        identity,
        "tenants",
        instanceId,
      ),
    ).toThrow();
  });
  it("rejects non-reader credentials before a request", () => {
    const key = (role: string) =>
      `e30.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
    for (const role of ["service_role", "authenticated", "anon"])
      expect(
        () =>
          new NarrowRegistryClient(
            "http://127.0.0.1:54321",
            key(role),
            anonKey,
          ),
      ).toThrow();
    expect(
      () =>
        new NarrowRegistryClient(
          "https://private.example",
          key("cra_operator_registry_reader"),
          anonKey,
        ),
    ).not.toThrow();
  });
  it("uses only the fixed audited RPC and redacts dependency errors", async () => {
    const key = `e30.${Buffer.from(JSON.stringify({ role: "cra_operator_registry_reader" })).toString("base64url")}.signature`;
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response("secret-provider-error", { status: 500 }),
      );
    const reader = new NarrowRegistryClient(
      "http://127.0.0.1:54321",
      key,
      anonKey,
      fetcher,
    );
    await expect(
      reader.read(identity, "instances", null, null, 50),
    ).rejects.toThrow("Operator registry unavailable");
    expect(fetcher.mock.calls[0]![0]).toBe(
      "http://127.0.0.1:54321/rest/v1/rpc/m15_03_operator_read",
    );
    const options = fetcher.mock.calls[0]![1]!;
    expect(options.redirect).toBe("error");
    expect(JSON.parse(options.body as string)).toMatchObject({
      p_operator_id: identity.principalId,
      p_instance_ids: [instanceId],
      p_tenant_ids: [],
    });
  });
});

describe("parsed registry success boundaries", () => {
  const stamp = "2026-01-01T00:00:00.000Z";
  const summary = { instanceId, label: "Scoped" };
  it("returns scoped instance pages/details and replaces raw keysets", async () => {
    const reader = {
      read: (_identity: unknown, kind: string) =>
        Promise.resolve(
          kind === "detail"
            ? { schemaVersion: 1, observedAt: stamp, instance: summary }
            : {
                schemaVersion: 1,
                observedAt: stamp,
                instances: [summary],
                nextCursor: instanceId.replace(/-/g, ""),
              },
        ),
    };
    const registry = new OperatorRegistry(reader);
    const data = await registry.list(identity, { limit: 50 });
    expect(data.instances[0]!.instanceId).toBe(instanceId);
    expect(
      OperatorRegistry.decodeCursor(
        data.nextCursor!,
        identity,
        "instances",
        null,
      ),
    ).toBe(instanceId);
    await registry.list(identity, { limit: 50, cursor: data.nextCursor! });
    expect(
      (await registry.detail(identity, instanceId)).instance.instanceId,
    ).toBe(instanceId);
  });
  it("returns only scoped tenant/source pages and denies malformed or overbroad storage results", async () => {
    let data: unknown = {
      schemaVersion: 1,
      observedAt: stamp,
      instanceId,
      tenants: [{ tenantId, label: "Tenant" }],
      nextCursor: tenantId.replace(/-/g, ""),
    };
    const registry = new OperatorRegistry({
      read: () => Promise.resolve(data),
    });
    const tenants = await registry.tenants(identity, instanceId, { limit: 50 });
    expect(tenants.tenants[0]!.tenantId).toBe(tenantId);
    await registry.tenants(identity, instanceId, {
      limit: 50,
      cursor: tenants.nextCursor!,
    });
    data = {
      schemaVersion: 1,
      observedAt: stamp,
      instanceId,
      tenants: [],
      nextCursor: null,
    };
    expect(
      (await registry.tenants(identity, instanceId, { limit: 50 })).nextCursor,
    ).toBeNull();
    data = {
      schemaVersion: 1,
      observedAt: stamp,
      sourceAt: stamp,
      revision: 1,
      instanceId,
      instance: summary,
      tenants: [{ tenantId, label: "Tenant" }],
      nextCursor: tenantId.replace(/-/g, ""),
    };
    const metadata = await registry.metadata(identity, instanceId, {
      limit: 100,
    });
    expect(metadata.instanceId).toBe(instanceId);
    await registry.metadata(identity, instanceId, {
      limit: 100,
      cursor: metadata.nextCursor!,
    });
    data = { ...(data as object), tenants: [], nextCursor: null };
    expect(
      (await registry.metadata(identity, instanceId, { limit: 50 })).nextCursor,
    ).toBeNull();
    data = {
      ...(data as object),
      tenants: [{ tenantId: instanceId, label: "Forbidden" }],
    };
    await expect(
      registry.metadata(identity, instanceId, { limit: 50 }),
    ).rejects.toThrow("scope violation");
    data = {
      schemaVersion: 1,
      observedAt: stamp,
      instanceId,
      tenants: [{ tenantId: instanceId, label: "Forbidden" }],
      nextCursor: null,
    };
    await expect(
      registry.tenants(identity, instanceId, { limit: 50 }),
    ).rejects.toThrow("scope violation");
    data = {
      schemaVersion: 1,
      observedAt: stamp,
      instances: [{ ...summary, instanceId: tenantId }],
      nextCursor: null,
    };
    await expect(registry.list(identity, { limit: 50 })).rejects.toThrow(
      "scope violation",
    );
    data = {
      schemaVersion: 1,
      observedAt: stamp,
      instance: { ...summary, instanceId: tenantId },
    };
    await expect(registry.detail(identity, instanceId)).rejects.toThrow(
      "scope violation",
    );
    data = {
      schemaVersion: 1,
      observedAt: stamp,
      instances: [],
      nextCursor: null,
    };
    expect(
      (await registry.list(identity, { limit: 50 })).nextCursor,
    ).toBeNull();
  });
  it("returns parsed audited JSON and rejects unsafe database URLs", async () => {
    const key = `e30.${Buffer.from(JSON.stringify({ role: "cra_operator_registry_reader" })).toString("base64url")}.signature`;
    const reader = new NarrowRegistryClient(
      "http://127.0.0.1:54321",
      key,
      anonKey,
      () => Promise.resolve(new Response('{"safe":true}')),
    );
    expect(await reader.read(identity, "instances", null, null, 50)).toEqual({
      safe: true,
    });
    for (const url of [
      "http://8.8.8.8",
      "https://user:secret@127.0.0.1",
      "https://127.0.0.1?secret=1",
    ])
      expect(() => new NarrowRegistryClient(url, key, anonKey)).toThrow();
  });
});
it("does not disclose a reused tenant UUID on another granted instance", async () => {
  const other = "40000000-0000-4000-8000-000000000001";
  const stamp = "2026-01-01T00:00:00.000Z";
  const scoped = {
    ...identity,
    instanceIds: [instanceId, other],
    tenantScopes: [{ instanceId, tenantIds: [tenantId] }],
  };
  const registry = new OperatorRegistry({
    read: () =>
      Promise.resolve({
        schemaVersion: 1,
        observedAt: stamp,
        instanceId: other,
        tenants: [{ tenantId, label: "Wrong instance tenant" }],
        nextCursor: null,
      }),
  });
  await expect(registry.tenants(scoped, other, { limit: 50 })).rejects.toThrow(
    "Registry scope violation",
  );
});
it("canonicalizes full tuple scopes and binds changes to a single tenant tuple", () => {
  const other = "40000000-0000-4000-8000-000000000001";
  const tuple = {
    ...identity,
    instanceIds: [instanceId, other],
    tenantScopes: [
      { instanceId, tenantIds: [tenantId] },
      { instanceId: other, tenantIds: [] },
    ],
  };
  const cursor = scopedCursor(tuple, "tenants", instanceId, tenantId);
  expect(
    OperatorRegistry.decodeCursor(
      cursor,
      { ...tuple, tenantScopes: [...tuple.tenantScopes].reverse() },
      "tenants",
      instanceId,
    ),
  ).toBe(tenantId);
  expect(() =>
    OperatorRegistry.decodeCursor(
      cursor,
      {
        ...tuple,
        tenantScopes: [
          { instanceId, tenantIds: [] },
          { instanceId: other, tenantIds: [tenantId] },
        ],
      },
      "tenants",
      instanceId,
    ),
  ).toThrow();
});
it("denies oversized provider bodies through the narrow read adapter and cancels them", async () => {
  const key = `e30.${Buffer.from(JSON.stringify({ role: "cra_operator_registry_reader" })).toString("base64url")}.signature`;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode("x".repeat(256 * 1024 + 1)));
    },
    cancel() {
      cancelled = true;
    },
  });
  const reader = new NarrowRegistryClient(
    "http://127.0.0.1:54321",
    key,
    anonKey,
    () => Promise.resolve(new Response(body)),
  );
  await expect(
    reader.read(identity, "instances", null, null, 50),
  ).rejects.toThrow("Operator registry unavailable");
  expect(cancelled).toBe(true);
});
