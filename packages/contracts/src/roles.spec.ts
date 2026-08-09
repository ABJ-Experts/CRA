import { describe, expect, it } from "vitest";

import { customRoleSchema } from "./roles.js";

const customRole = {
  id: "2ad67e3b-6e5e-4cde-870f-2225e7da1203",
  name: "Billing reviewer",
  description: null,
  color: "neutral",
  baseRole: "viewer",
  permissions: {},
  isSystem: false,
  isActive: true,
  memberCount: 0,
};

describe("custom role wire contract", () => {
  it("accepts the existing custom role shape", () => {
    expect(customRoleSchema.parse(customRole)).toEqual(customRole);
  });

  it.each([
    { ...customRole, id: "not-a-uuid" },
    { ...customRole, name: "" },
    { ...customRole, color: "" },
    { ...customRole, baseRole: "super-admin" },
    { ...customRole, permissions: [] },
    { ...customRole, permissions: { can_view_users: "yes" } },
    { ...customRole, memberCount: -1 },
    { ...customRole, memberCount: 0.5 },
    { ...customRole, unrecognized: true },
  ])("rejects an invalid role boundary fixture", (value) => {
    expect(customRoleSchema.safeParse(value).success).toBe(false);
  });
});
