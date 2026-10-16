import type { ExecutionContext } from "@nestjs/common";
import { PATH_METADATA } from "@nestjs/common/constants";
import type { UpdateOrganizationSettingsInput } from "@repo/contracts/organizations";

import {
  ALLOW_TENANT_RECOVERY_KEY,
  REQUIRE_PERMISSIONS_KEY,
  REQUIRE_ROLE_KEY,
  type RequestUser,
} from "../../auth/auth.types";
import { TenantAdministrationController } from "./tenant-administration.controller";
import { PermissionsGuard } from "../../auth/permissions.guard";

const organizationId = "00000000-0000-4000-8000-000000000001";
const sessionId = "00000000-0000-4000-8000-000000000002";
const user: RequestUser = Object.freeze({
  id: "00000000-0000-4000-8000-000000000003",
  authUserId: "00000000-0000-4000-8000-000000000004",
  email: "owner@cra.test",
  isActive: true,
  organizationId,
  role: "owner",
  accessToken: "access-token",
  aal: "aal2",
  sessionId,
});

describe("TenantAdministrationController", () => {
  it("uses the exact current-organization route prefix", () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, TenantAdministrationController),
    ).toBe("organizations/current");
  });

  it("requires owner plus export permission on every export route", () => {
    for (const name of [
      "requestExport",
      "latestExport",
      "exportStatus",
      "downloadExport",
    ] as const) {
      const handler = Object.getOwnPropertyDescriptor(
        TenantAdministrationController.prototype,
        name,
      )?.value as unknown;
      if (typeof handler !== "function") throw new Error("Missing handler");
      expect(Reflect.getMetadata(REQUIRE_ROLE_KEY, handler)).toBe("owner");
      expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler)).toEqual([
        "can_export_organization",
      ]);
    }
  });

  it("limits inactive-tenant recovery metadata to lifecycle recovery handlers", () => {
    for (const name of [
      "lifecycle",
      "reauthenticate",
      "schedulePurge",
      "recover",
    ] as const) {
      const handler = Object.getOwnPropertyDescriptor(
        TenantAdministrationController.prototype,
        name,
      )?.value as unknown;
      if (typeof handler !== "function") throw new Error("Missing handler");
      expect(Reflect.getMetadata(ALLOW_TENANT_RECOVERY_KEY, handler)).toEqual(
        expect.any(String),
      );
    }
    for (const name of [
      "settings",
      "settingsCatalog",
      "updateSettings",
      "retention",
      "updateRetention",
      "requestExport",
      "latestExport",
      "exportStatus",
      "downloadExport",
      "deactivate",
    ] as const) {
      const handler = Object.getOwnPropertyDescriptor(
        TenantAdministrationController.prototype,
        name,
      )?.value as unknown;
      if (typeof handler !== "function") throw new Error("Missing handler");
      expect(
        Reflect.getMetadata(ALLOW_TENANT_RECOVERY_KEY, handler),
      ).toBeUndefined();
    }
  });

  it("forwards only guard-selected tenant, actor, and verified session scope", async () => {
    const service = {
      updateSettings: jest.fn().mockResolvedValue({ settings: {} }),
    };
    const controller = new TenantAdministrationController(service as never);
    const input: UpdateOrganizationSettingsInput = {
      expectedVersion: 1,
      values: {
        timezone: "Asia/Kolkata",
        workingDays: ["monday"],
        holidays: [],
        notificationChannelIds: [],
        mfaEnforcementDate: null,
        maximumSessionAgeMinutes: 60,
        aiProviderId: "disabled",
        dataResidencyId: "in",
      },
    };

    await controller.updateSettings(input, user);

    expect(service.updateSettings).toHaveBeenCalledWith({
      organizationId,
      actorId: user.id,
      sessionId,
      input,
    });
  });

  it("uses the same export params schema path value for status and download", async () => {
    const service = {
      latestExport: jest.fn().mockResolvedValue({ export: null }),
      exportStatus: jest.fn().mockResolvedValue({ export: {} }),
      downloadExport: jest
        .fn()
        .mockResolvedValue({ url: "https://example.test" }),
    };
    const controller = new TenantAdministrationController(service as never);
    const params = { exportId: "00000000-0000-4000-8000-000000000005" };

    await controller.latestExport(user);
    await controller.exportStatus(params, user);
    await controller.downloadExport(params, user);

    expect(service.latestExport).toHaveBeenCalledWith(organizationId);
    expect(service.exportStatus).toHaveBeenCalledWith({
      organizationId,
      exportId: params.exportId,
    });
    expect(service.downloadExport).toHaveBeenCalledWith({
      organizationId,
      exportId: params.exportId,
      actorId: user.id,
    });
  });

  it.each(["admin", "viewer"] as const)(
    "denies %s even when an additive role could grant the destructive permission",
    async (role) => {
      const handler = Object.getOwnPropertyDescriptor(
        TenantAdministrationController.prototype,
        "requestExport",
      )?.value as unknown;
      if (typeof handler !== "function") throw new Error("Missing handler");
      const reflector = {
        getAllAndOverride: jest.fn(
          (key: string): unknown =>
            Reflect.getMetadata(key, handler) as unknown,
        ),
      };
      const permissions = { can: jest.fn().mockResolvedValue(true) };
      const guard = new PermissionsGuard(
        reflector as never,
        permissions as never,
      );
      const request = { user: { ...user, role } };
      const execution = {
        getHandler: () => handler,
        getClass: () => TenantAdministrationController,
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(execution)).rejects.toMatchObject({
        response: { code: "insufficient_role" },
      });
      expect(permissions.can).not.toHaveBeenCalled();
    },
  );

  it("delegates every remaining route with server-owned identity", async () => {
    const service = {
      settings: jest.fn().mockResolvedValue({}),
      settingsCatalog: jest.fn().mockResolvedValue({}),
      retention: jest.fn().mockResolvedValue({}),
      updateRetention: jest.fn().mockResolvedValue({}),
      requestExport: jest.fn().mockResolvedValue({}),
      latestExport: jest.fn().mockResolvedValue({}),
      lifecycle: jest.fn().mockResolvedValue({}),
      reauthenticate: jest.fn().mockResolvedValue({}),
      deactivate: jest.fn().mockResolvedValue({}),
      schedulePurge: jest.fn().mockResolvedValue({}),
      recover: jest.fn().mockResolvedValue({}),
    };
    const controller = new TenantAdministrationController(service as never);
    const grant = "00000000-0000-4000-8000-000000000006";

    await controller.settings(user);
    await controller.settingsCatalog(user);
    await controller.retention(user);
    await controller.updateRetention(
      {
        evidenceClass: "audit_log",
        expectedVersion: 1,
        requestedRetentionDays: 30,
      },
      user,
    );
    await controller.requestExport(
      { idempotencyKey: "00000000-0000-4000-8000-000000000007" },
      user,
    );
    await controller.latestExport(user);
    await controller.lifecycle(user);
    await controller.reauthenticate({ password: "secret" }, user);
    await controller.deactivate(
      {
        reauthenticationGrantId: grant,
        expectedVersion: 1,
        confirmation: "DEACTIVATE ORGANIZATION",
      },
      user,
    );
    await controller.schedulePurge(
      {
        reauthenticationGrantId: grant,
        expectedVersion: 1,
        confirmation: "DELETE acme",
      },
      user,
    );
    await controller.recover(
      { reauthenticationGrantId: grant, expectedVersion: 1 },
      user,
    );

    expect(service.settings.mock.calls).toEqual([[organizationId]]);
    expect(service.reauthenticate).toHaveBeenCalledWith({
      organizationId,
      actorId: user.id,
      sessionId,
      email: user.email,
      accessToken: user.accessToken,
      password: "secret",
    });
    expect(service.schedulePurge).toHaveBeenCalledWith({
      organizationId,
      actorId: user.id,
      sessionId,
      reauthenticationGrantId: grant,
      expectedVersion: 1,
      confirmation: "DELETE acme",
    });
  });

  it("fails closed when the guard has no tenant or verified session", () => {
    const controller = new TenantAdministrationController({} as never);

    expect(() =>
      controller.settings({ ...user, organizationId: null }),
    ).toThrow();
    expect(() =>
      controller.reauthenticate(
        { password: "secret" },
        { ...user, sessionId: undefined },
      ),
    ).toThrow();
  });
});
