import { z } from "zod";
import { backupActionSchema } from "@repo/contracts/backups/schemas";
import { upgradeActionSchema } from "@repo/contracts/upgrades/schemas";
const upgradeScopeSchema = z.strictObject({
  instanceId: z.uuid(),
  actions: z
    .array(upgradeActionSchema)
    .max(4)
    .refine((actions) => new Set(actions).size === actions.length),
});
const tenantScopeSchema = z.strictObject({
  instanceId: z.uuid(),
  tenantIds: z
    .array(z.uuid())
    .max(10000)
    .refine((ids) => new Set(ids).size === ids.length),
});
export { backupActionSchema } from "@repo/contracts/backups/schemas";
const backupScopeSchema = z.strictObject({
  instanceId: z.uuid(),
  actions: z
    .array(backupActionSchema)
    .max(5)
    .refine((actions) => new Set(actions).size === actions.length),
});
const grantSchema = z
  .strictObject({
    fingerprint256: z.string().regex(/^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/),
    principalId: z.uuid(),
    instanceIds: z
      .array(z.uuid())
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length),
    tenantScopes: z.array(tenantScopeSchema).max(500),
    backupScopes: z.array(backupScopeSchema).max(500).default([]),
    upgradeScopes: z.array(upgradeScopeSchema).max(500).default([]),
  })
  .refine(
    (grant) =>
      new Set(grant.upgradeScopes.map((scope) => scope.instanceId)).size ===
        grant.upgradeScopes.length &&
      grant.upgradeScopes.every((scope) =>
        grant.instanceIds.includes(scope.instanceId),
      ) &&
      new Set(grant.tenantScopes.map((scope) => scope.instanceId)).size ===
        grant.tenantScopes.length &&
      new Set(grant.backupScopes.map((scope) => scope.instanceId)).size ===
        grant.backupScopes.length &&
      grant.backupScopes.every((scope) =>
        grant.instanceIds.includes(scope.instanceId),
      ) &&
      grant.tenantScopes.every((scope) =>
        grant.instanceIds.includes(scope.instanceId),
      ),
  );
export const grantsSchema = z
  .strictObject({
    revision: z.string().min(1).max(120),
    grants: z.array(grantSchema).max(500),
  })
  .refine(
    (value) =>
      new Set(value.grants.map((grant) => grant.fingerprint256)).size ===
      value.grants.length,
  );
export type OperatorIdentity = Omit<
  z.output<typeof grantSchema>,
  "backupScopes" | "upgradeScopes"
> & {
  backupScopes?: z.output<typeof grantSchema>["backupScopes"];
  upgradeScopes?: z.output<typeof grantSchema>["upgradeScopes"];
  revision: string;
};
export function operatorTenantIds(
  identity: OperatorIdentity,
  instanceId: string | null,
): readonly string[] {
  return (
    identity.tenantScopes.find((scope) => scope.instanceId === instanceId)
      ?.tenantIds ?? []
  );
}
