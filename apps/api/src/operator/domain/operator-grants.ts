import { z } from "zod";
const tenantScopeSchema = z.strictObject({
  instanceId: z.uuid(),
  tenantIds: z
    .array(z.uuid())
    .max(10000)
    .refine((ids) => new Set(ids).size === ids.length),
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
  })
  .refine(
    (grant) =>
      new Set(grant.tenantScopes.map((scope) => scope.instanceId)).size ===
        grant.tenantScopes.length &&
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
export type OperatorIdentity = z.output<typeof grantSchema> & {
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
