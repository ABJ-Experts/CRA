import { describe, expect, it } from "vitest";
import {
  defaultPermissionsFor,
  hasPermission,
  resolveEffectivePermissions,
} from "../../permissions.js";
import {
  permissionKeySchema,
  permissionSetSchema,
} from "./permission-api.schema.js";

describe("support diagnostic permission", () => {
  it("recognizes the system health export permission in wire contracts", () => {
    expect(
      permissionKeySchema.safeParse("can_export_system_health").success,
    ).toBe(true);
    expect(
      permissionSetSchema.parse({ can_export_system_health: true }),
    ).toEqual({ can_export_system_health: true });
  });
  it("grants default export authority only to owner and admin", () => {
    for (const role of ["owner", "admin", "member", "viewer"] as const) {
      expect(
        hasPermission(defaultPermissionsFor(role), "can_export_system_health"),
      ).toBe(role === "owner" || role === "admin");
    }
  });
  it("retains final hard denial of an export grant", () => {
    const permissions = resolveEffectivePermissions({
      baseRole: "admin",
      baseRoleOverrides: { can_export_system_health: false },
    });
    expect(hasPermission(permissions, "can_export_system_health")).toBe(false);
  });
});
