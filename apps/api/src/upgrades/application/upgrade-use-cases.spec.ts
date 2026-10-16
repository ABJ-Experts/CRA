import { UpgradeUseCases, UpgradeScopeError } from "./upgrade-use-cases";
import type { OperatorIdentity } from "../../operator/domain/operator-grants";
const instanceId = "00000000-0000-4000-8000-000000000001";
const identity = {
  principalId: instanceId,
  fingerprint256: "AA",
  revision: "r1",
  instanceIds: [instanceId],
  tenantScopes: [],
  backupScopes: [],
  upgradeScopes: [
    {
      instanceId,
      actions: [
        "upgrades.view",
        "upgrades.stage",
        "upgrades.apply",
        "upgrades.rollback",
      ],
    },
  ],
} as OperatorIdentity;
describe("private upgrades", () => {
  const execute = jest.fn().mockResolvedValue({});
  const useCases = new UpgradeUseCases(instanceId, { execute });
  beforeEach(() =>
    execute.mockReset().mockResolvedValue({
      instanceId,
      enabled: false,
      actions: ["upgrades.view"],
      platform: { os: "linux", architecture: "amd64" },
      currentVersion: null,
      supervisorVersion: "1.0.0",
      maintenance: false,
      version: 0,
    }),
  );
  it.each([
    "capabilities/read",
    "media/list",
    "run/list",
    "run/read",
    "run/result",
    "media/stage",
    "run/preflight",
    "run/apply",
    "run/reconcile",
    "run/rollback",
  ] as const)("checks and forwards %s", async (action) => {
    await useCases.execute(identity, instanceId, action);
    expect(execute).toHaveBeenCalledWith(
      instanceId,
      { principalId: instanceId, fingerprint256: "AA", grantRevision: "r1" },
      action,
      {},
      undefined,
    );
  });
  it("denies metadata, tenant, backup, revoked, and wrong mounted scope", () => {
    for (const candidate of [
      { ...identity, upgradeScopes: [] },
      { ...identity, instanceIds: [] },
    ])
      expect(() =>
        useCases.execute(candidate, instanceId, "run/apply"),
      ).toThrow(UpgradeScopeError);
    expect(() =>
      new UpgradeUseCases("other", { execute }).execute(
        identity,
        instanceId,
        "run/apply",
      ),
    ).toThrow(UpgradeScopeError);
    expect(execute).not.toHaveBeenCalled();
  });
  it("does not let view grant mutate", () => {
    expect(() =>
      useCases.execute(
        {
          ...identity,
          upgradeScopes: [{ instanceId, actions: ["upgrades.view"] }],
        },
        instanceId,
        "run/apply",
      ),
    ).toThrow(UpgradeScopeError);
  });
});
it("filters capabilities to fresh grants and denies a cross-instance control response", async () => {
  const execute = jest.fn().mockResolvedValue({
    instanceId,
    enabled: true,
    actions: ["upgrades.view", "upgrades.apply"],
    platform: { os: "linux", architecture: "amd64" },
    currentVersion: null,
    supervisorVersion: "1.0.0",
    maintenance: false,
    version: 0,
  });
  const useCases = new UpgradeUseCases(instanceId, { execute });
  const scoped = {
    ...identity,
    upgradeScopes: [{ instanceId, actions: ["upgrades.view" as const] }],
  };
  await expect(
    useCases.execute(scoped, instanceId, "capabilities/read"),
  ).resolves.toMatchObject({ actions: ["upgrades.view"] });
  execute.mockResolvedValue({
    instanceId: "00000000-0000-4000-8000-000000000002",
    enabled: true,
    actions: [],
    platform: { os: "linux", architecture: "amd64" },
    currentVersion: null,
    supervisorVersion: "1.0.0",
    maintenance: false,
    version: 0,
  });
  await expect(
    useCases.execute(scoped, instanceId, "capabilities/read"),
  ).rejects.toThrow(UpgradeScopeError);
});
