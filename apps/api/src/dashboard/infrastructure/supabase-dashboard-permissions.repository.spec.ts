import { Logger } from "@nestjs/common";
import {
  resolveEffectivePermissions,
  hasPermission,
} from "@repo/contracts/permissions";
import type { SupabaseService } from "../../supabase/supabase.service";
import {
  DashboardForbiddenError,
  DashboardUnavailableError,
} from "../application/dashboard-read.port";
import { SupabaseDashboardPermissionsRepository } from "./supabase-dashboard-permissions.repository";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const roleId = "33333333-3333-4333-8333-333333333333";
const context = {
  organizationId,
  userId: actorId,
  role: "viewer",
  permissionVersion: 7,
  customRoles: [
    {
      id: roleId,
      name: "Limited reader",
      base_role: "admin",
      permissions: { can_edit_findings: true },
      is_active: true,
      is_deleted: false,
    },
  ],
  baseRoleOverrides: { can_view_findings: false },
};
describe("coherent dashboard permission context", () => {
  const rpc = jest.fn();
  const repository = new SupabaseDashboardPermissionsRepository({
    admin: () => ({ rpc }),
  } as unknown as SupabaseService);
  let warn: jest.SpyInstance;
  beforeEach(() => {
    rpc.mockReset();
    warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());
  it("resolves one parsed current snapshot through the existing pure merge", async () => {
    rpc.mockResolvedValue({
      data: { outcome: "available", context },
      error: null,
    });
    const result = await repository.snapshot(organizationId, actorId, "viewer");
    expect(result).toEqual({
      version: 7,
      permissions: resolveEffectivePermissions({
        baseRole: "viewer",
        customRoles: context.customRoles.map((value) => ({
          ...value,
          base_role: "admin" as const,
        })),
        baseRoleOverrides: context.baseRoleOverrides,
      }),
    });
    expect(result.permissions.can_view_findings).toBe(false);
    expect(result.permissions.can_edit_findings).toBe(true);
    expect(hasPermission(result.permissions, "can_delete_users")).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("get_dashboard_permission_context", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_expected_role: "viewer",
    });
  });
  it.each([
    { ...context, organizationId: actorId },
    { ...context, userId: organizationId },
    { ...context, permissionVersion: 0 },
    { ...context, permissionVersion: 1.5 },
    { ...context, permissionVersion: Number.MAX_SAFE_INTEGER + 1 },
    { ...context, customRoles: null },
    { ...context, baseRoleOverrides: undefined },
    {
      ...context,
      customRoles: [{ ...context.customRoles[0], permissions: undefined }],
    },
    {
      ...context,
      customRoles: [{ ...context.customRoles[0], is_active: "yes" }],
    },
    { ...context, privateContent: "secret-canary" },
  ])("withholds malformed or foreign context %p", async (invalid) => {
    rpc.mockResolvedValue({
      data: { outcome: "available", context: invalid },
      error: null,
    });
    await expect(
      repository.snapshot(organizationId, actorId, "viewer"),
    ).rejects.toBeInstanceOf(DashboardUnavailableError);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-canary");
  });
  it.each([
    { outcome: "not_found" },
    { outcome: "available", context: { ...context, role: "member" } },
  ])(
    "treats absent membership and current role disagreement as definitive denial",
    async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      await expect(
        repository.snapshot(organizationId, actorId, "viewer"),
      ).rejects.toBeInstanceOf(DashboardForbiddenError);
    },
  );
  it.each([
    null,
    {},
    { outcome: "unavailable" },
    { outcome: "unknown" },
    { outcome: "not_found", context },
  ])("rejects unavailable/invalid envelopes %p", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(
      repository.snapshot(organizationId, actorId, "viewer"),
    ).rejects.toThrow("Dashboard temporarily unavailable");
  });
  it("preserves inactive/deleted/unknown/additive semantics without granting role-label defaults", async () => {
    const customRoles = [
      {
        ...context.customRoles[0],
        permissions: {
          can_view_dashboards: false,
          can_view_technical_files: true,
          removed_permission: true,
        },
      },
      {
        ...context.customRoles[0],
        is_active: false,
        permissions: { can_delete_users: true },
      },
      {
        ...context.customRoles[0],
        is_deleted: true,
        permissions: { can_delete_users: true },
      },
    ];
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "available",
          context: { ...context, customRoles, baseRoleOverrides: {} },
        },
      ],
      error: null,
    });
    const result = await repository.snapshot(organizationId, actorId, "viewer");
    expect(result.permissions.can_view_dashboards).toBe(true);
    expect(result.permissions.can_view_technical_files).toBe(true);
    expect(hasPermission(result.permissions, "can_delete_users")).toBe(false);
    expect(result.permissions).not.toHaveProperty("removed_permission");
  });
  it.each(["57014", "PGRST003", "XX000"])(
    "sanitizes structured provider failure %s",
    async (code) => {
      rpc.mockResolvedValue({
        data: null,
        error: { code, message: "secret-canary" },
      });
      await expect(
        repository.snapshot(organizationId, actorId, "viewer"),
      ).rejects.toThrow("Dashboard temporarily unavailable");
      expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-canary");
      expect(JSON.stringify(warn.mock.calls)).not.toContain(code);
    },
  );
  it("contains thrown transport and diagnostic failures without fallback", async () => {
    warn.mockImplementation(() => {
      throw new Error("secret-sink");
    });
    rpc.mockRejectedValue(new Error("secret-transport"));
    await expect(
      repository.snapshot(organizationId, actorId, "viewer"),
    ).rejects.toThrow("Dashboard temporarily unavailable");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
