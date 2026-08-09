import type { BaseRole, PermissionSet } from "@repo/contracts/permissions";
import {
  roleListResponseSchema,
  roleOverridesResponseSchema,
  setRoleOverrideInputSchema,
} from "@repo/contracts/roles/schemas";
import { okResponseSchema } from "@repo/contracts/shared/schemas";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { requestJson } from "../../_lib/http/api-client";

export const rolesQueryKeys = Object.freeze({
  list: Object.freeze(["roles"] as const),
  overrides: Object.freeze(["roles", "overrides"] as const),
});

export class RolesApi {
  list(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/roles",
      method: "GET",
      signal,
      schema: roleListResponseSchema,
    });
  }

  getOverrides(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/roles/overrides",
      method: "GET",
      signal,
      schema: roleOverridesResponseSchema,
    });
  }

  setOverride(
    baseRole: BaseRole,
    permissions: PermissionSet,
    signal?: AbortSignal,
  ) {
    return requestJson({
      path: "/api/v1/roles/overrides",
      method: "PUT",
      body: { baseRole, permissions },
      inputSchema: setRoleOverrideInputSchema,
      signal,
      schema: okResponseSchema,
    });
  }
}

export const rolesApi = Object.freeze(new RolesApi());
