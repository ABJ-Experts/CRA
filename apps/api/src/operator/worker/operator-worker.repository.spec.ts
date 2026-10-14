import { operatorInstanceSummarySchema } from "@repo/contracts";
import { OperatorWorkerRepository } from "./operator-worker.repository";
const id = "20000000-0000-4000-8000-000000000001";
describe("separate fixed worker RPC adapter", () => {
  it("validates service credential and uses only fixed observer/publication/outcome RPCs", async () => {
    const key = (role: string) =>
      `e30.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
    expect(
      () =>
        new OperatorWorkerRepository(
          "http://127.0.0.1:54321",
          key("cra_operator_registry_reader"),
        ),
    ).toThrow();
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockImplementation(() => Promise.resolve(new Response("{}")));
    const repo = new OperatorWorkerRepository(
      "http://127.0.0.1:54321",
      key("service_role"),
      fetcher,
    );
    await repo.observe(id, "2026-01-01T00:00:00.000Z", null);
    await repo.failure(
      id,
      "2026-01-01T00:00:00.000Z",
      "collection_unreachable",
    );
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      "http://127.0.0.1:54321/rest/v1/rpc/m15_03_observe_instance",
      "http://127.0.0.1:54321/rest/v1/rpc/m15_03_record_poll_outcome",
    ]);
  });
  it("redacts database failures", async () => {
    const key = `e30.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
    const repo = new OperatorWorkerRepository(
      "http://127.0.0.1:54321",
      key,
      () => Promise.resolve(new Response("secret", { status: 403 })),
    );
    await expect(
      repo.failure(id, "2026-01-01T00:00:00.000Z", "collection_unreachable"),
    ).rejects.toThrow("Operator worker storage unavailable");
  });
});
it("publishes only parsed metadata and fixed expected-instance binding", async () => {
  const stamp = "2026-01-01T00:00:00.000Z";
  const key = `e30.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
  const fetcher = jest
    .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
    .mockResolvedValue(new Response('{"outcome":"published"}'));
  const repository = new OperatorWorkerRepository(
    "http://127.0.0.1:54321",
    key,
    fetcher,
  );
  await repository.publish(id, {
    metadata: {
      schemaVersion: 1,
      instanceId: id,
      revision: 1,
      sourceAt: stamp,
      observedAt: stamp,
      instance: operatorInstanceSummarySchema.parse({
        instanceId: id,
        label: "Local",
      }),
      tenants: [],
      nextCursor: null,
    },
    digest: "a".repeat(64),
  });
  expect(fetcher.mock.calls[0]![0]).toBe(
    "http://127.0.0.1:54321/rest/v1/rpc/m15_03_publish_observation",
  );
  expect(() => new OperatorWorkerRepository("http://8.8.8.8", key)).toThrow();
});
it("rejects declared ordering/conflict/invalid publication outcomes instead of treating them as success", async () => {
  const stamp = "2026-01-01T00:00:00.000Z";
  const key = `e30.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.signature`;
  for (const outcome of ["out_of_order", "conflict", "invalid"]) {
    const repository = new OperatorWorkerRepository(
      "http://127.0.0.1:54321",
      key,
      () => Promise.resolve(new Response(JSON.stringify({ outcome }))),
    );
    await expect(
      repository.publish(id, {
        metadata: {
          schemaVersion: 1,
          instanceId: id,
          revision: 1,
          sourceAt: stamp,
          observedAt: stamp,
          instance: operatorInstanceSummarySchema.parse({
            instanceId: id,
            label: "Local",
          }),
          tenants: [],
          nextCursor: null,
        },
        digest: "a".repeat(64),
      }),
    ).rejects.toThrow("Operator publication rejected");
  }
});
