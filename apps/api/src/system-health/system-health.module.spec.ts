import { SystemHealthModule } from "./system-health.module";
import { SystemHealthUseCases } from "./application/system-health.use-cases";
import { RuntimeHealthAdapter } from "./infrastructure/runtime-health.adapter";
const providers = Reflect.getMetadata("providers", SystemHealthModule) as {
  provide: unknown;
  useFactory?: (...args: never[]) => unknown;
}[];
it("wires real runtime adapters", () => {
  const factory = providers.find(
    (p) => p.provide === RuntimeHealthAdapter,
  )!.useFactory!;
  expect(factory({} as never, {} as never, {} as never)).toBeInstanceOf(
    RuntimeHealthAdapter,
  );
});
it.each([
  undefined,
  {},
  JSON.stringify({
    version: "1.0",
    commit: null,
    builtAt: "2026-10-14T00:00:00.000Z",
  }),
])("uses strict configured build identity", async (manifest) => {
  const factory = providers.find(
    (p) => p.provide === SystemHealthUseCases,
  )!.useFactory!;
  const result = factory(
    {
      readSource: (_org: string, _actor: string, source: string) =>
        Promise.resolve({
          outcome: "withheld",
          source,
          sourceAt: null,
          observedAt: null,
          data: null,
          reasons: ["source_permission_withheld"],
        }),
    } as never,
    {
      database: () => Promise.resolve(true),
      audit: () => Promise.resolve(true),
      storage: () => Promise.resolve(true),
    } as never,
    { get: () => manifest } as never,
  ) as SystemHealthUseCases;
  const response = await result.read(
    "00000000-0000-4000-8000-000000000001",
    "actor",
  );
  expect(response.currentVersion.version).toBe(
    typeof manifest === "string" ? "1.0" : null,
  );
});
