import { grantsSchema, operatorTenantIds } from "./operator-grants";
const instanceId = "00000000-0000-4000-8000-000000000001";
const base = {
  fingerprint256: Array(32).fill("AA").join(":"),
  principalId: instanceId,
  instanceIds: [instanceId],
  tenantScopes: [],
};
it("defaults deployment authority to none for existing metadata grants", () => {
  expect(
    grantsSchema.parse({ revision: "r1", grants: [base] }).grants[0]
      ?.upgradeScopes,
  ).toEqual([]);
});
it("rejects duplicate, foreign instance, and unknown deployment grants", () => {
  for (const upgradeScopes of [
    [{ instanceId, actions: ["upgrades.apply", "upgrades.apply"] }],
    [
      { instanceId, actions: [] },
      { instanceId, actions: [] },
    ],
    [
      {
        instanceId: "00000000-0000-4000-8000-000000000002",
        actions: ["upgrades.view"],
      },
    ],
    [{ instanceId, actions: ["backups.run"] }],
  ])
    expect(
      grantsSchema.safeParse({
        revision: "r1",
        grants: [{ ...base, upgradeScopes }],
      }).success,
    ).toBe(false);
});
it("accepts independent bounded deployment actions", () => {
  expect(
    grantsSchema.parse({
      revision: "r2",
      grants: [
        {
          ...base,
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
        },
      ],
    }).grants[0]?.upgradeScopes[0]?.actions,
  ).toHaveLength(4);
});
it("preserves bounded independent tenant and backup scopes", () => {
  const tenantScopes = [{ instanceId, tenantIds: [instanceId] }];
  const backupScopes = [{ instanceId, actions: ["backups.view"] }];
  expect(
    grantsSchema.safeParse({
      revision: "r1",
      grants: [{ ...base, tenantScopes, backupScopes }],
    }).success,
  ).toBe(true);
  expect(
    grantsSchema.safeParse({
      revision: "r1",
      grants: [
        {
          ...base,
          tenantScopes: [...tenantScopes, ...tenantScopes],
          backupScopes,
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    grantsSchema.safeParse({
      revision: "r1",
      grants: [
        {
          ...base,
          tenantScopes,
          backupScopes: [...backupScopes, ...backupScopes],
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    grantsSchema.safeParse({ revision: "r1", grants: [base, base] }).success,
  ).toBe(false);
});

it("keeps tenant lookup separate from deployment authority", () => {
  const identity = {
    ...base,
    revision: "r1",
    tenantScopes: [{ instanceId, tenantIds: [instanceId] }],
  };
  expect(operatorTenantIds(identity, instanceId)).toEqual([instanceId]);
  expect(operatorTenantIds(identity, null)).toEqual([]);
});
