import { bootstrapUpgradeSupervisor } from "./upgrade-supervisor";
import * as runtime from "./upgrades/infrastructure/control/upgrade-supervisor-runtime";
import * as composition from "./upgrades/infrastructure/control/upgrade-supervisor-runtime-compose";
import * as transport from "./upgrades/infrastructure/control/local-upgrade-control";
afterEach(() => jest.restoreAllMocks());
it("starts nothing by default", async () =>
  expect(await bootstrapUpgradeSupervisor({})).toBeNull());
it("binds authenticated local ingress only after successful private composition", async () => {
  const mounted = {
    config: { socketPath: "/run/socket", instanceId: "instance" },
    controlKey: Buffer.alloc(32, 1),
  };
  jest
    .spyOn(runtime, "loadUpgradeSupervisorRuntime")
    .mockResolvedValue(mounted as never);
  const control = {} as Awaited<
    ReturnType<typeof composition.composeUpgradeSupervisor>
  >;
  jest
    .spyOn(composition, "composeUpgradeSupervisor")
    .mockResolvedValue(control);
  const server = {} as Awaited<
    ReturnType<typeof transport.createUpgradeControlServer>
  >;
  jest.spyOn(transport, "createUpgradeControlServer").mockResolvedValue(server);
  expect(
    await bootstrapUpgradeSupervisor({ UPGRADE_SUPERVISOR_ENABLED: "true" }),
  ).toBe(server);
  expect(transport.createUpgradeControlServer).toHaveBeenCalledWith(
    {
      socketPath: "/run/socket",
      instanceId: "instance",
      key: mounted.controlKey,
    },
    control,
  );
});
it("uses process defaults when invoked as an entrypoint", async () => {
  jest.spyOn(runtime, "loadUpgradeSupervisorRuntime").mockResolvedValue(null);
  expect(await bootstrapUpgradeSupervisor()).toBeNull();
  expect(runtime.loadUpgradeSupervisorRuntime).toHaveBeenCalledWith(
    process.env,
  );
});
