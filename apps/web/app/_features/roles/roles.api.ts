import { customRoleSchema } from "@repo/contracts/roles";
import {
  BASE_ROLES,
  PERMISSION_KEYS,
  type BaseRole,
  type PermissionSet,
} from "@repo/contracts/permissions";
import { z } from "zod";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { requestJson } from "../../_lib/http/api-client";

const permissionSetSchema = z.partialRecord(
  z.enum(PERMISSION_KEYS),
  z.boolean(),
);
const roleResponseSchema = customRoleSchema.extend({
  permissions: permissionSetSchema,
});
const listRolesResponseSchema = z
  .object({ rows: z.array(roleResponseSchema) })
  .strict();
const overridesResponseSchema = z
  .object({
    overrides: z.partialRecord(z.enum(BASE_ROLES), permissionSetSchema),
  })
  .strict();
const setOverrideResponseSchema = z.object({ ok: z.literal(true) }).strict();

export const rolesQueryKeys = Object.freeze({
  list: Object.freeze(["roles"] as const),
  overrides: Object.freeze(["roles", "overrides"] as const),
});

export const rolesApi = Object.freeze({
  list(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/roles",
      method: "GET",
      signal,
      schema: listRolesResponseSchema,
    });
  },

  getOverrides(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/roles/overrides",
      method: "GET",
      signal,
      schema: overridesResponseSchema,
    });
  },

  setOverride(
    baseRole: BaseRole,
    permissions: PermissionSet,
    signal?: AbortSignal,
  ) {
    return requestJson({
      path: "/api/v1/roles/overrides",
      method: "PUT",
      body: { baseRole, permissions },
      signal,
      schema: setOverrideResponseSchema,
    });
  },
});
