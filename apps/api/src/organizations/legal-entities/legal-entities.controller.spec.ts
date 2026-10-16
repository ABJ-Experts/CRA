import type { ExecutionContext } from "@nestjs/common";
import { PATH_METADATA } from "@nestjs/common/constants";
import type {
  CreateLegalEntityInput,
  LegalEntityParams,
  LegalEntityVersionInput,
  UpdateLegalEntityInput,
} from "@repo/contracts/organizations";

import {
  REQUIRE_PERMISSIONS_KEY,
  REQUIRE_ROLE_KEY,
  type RequestUser,
} from "../../auth/auth.types";
import { PermissionsGuard } from "../../auth/permissions.guard";
import { LegalEntitiesController } from "./legal-entities.controller";

const organizationId = "00000000-0000-4000-8000-000000000001";
const entityId = "00000000-0000-4000-8000-000000000002";
const user: RequestUser = Object.freeze({
  id: "00000000-0000-4000-8000-000000000003",
  authUserId: "00000000-0000-4000-8000-000000000004",
  email: "owner@cra.test",
  isActive: true,
  organizationId,
  role: "owner",
  accessToken: "access-token",
  aal: "aal2",
  sessionId: "00000000-0000-4000-8000-000000000005",
});

const createInput: CreateLegalEntityInput = {
  idempotencyKey: "00000000-0000-4000-8000-000000000006",
  identifier: "acme-us",
  displayName: "Acme US",
  legalName: "Acme US LLC",
  registeredAddress: {
    addressLine1: "1 Market Street",
    locality: "San Francisco",
    postalCode: "94105",
    country: "US",
  },
  mainEstablishmentCountry: "US",
  manufacturerContactName: "Acme Compliance",
  manufacturerContactEmail: "compliance@acme.test",
};

describe("LegalEntitiesController", () => {
  it("uses the current-organization legal-entity route prefix", () => {
    expect(Reflect.getMetadata(PATH_METADATA, LegalEntitiesController)).toBe(
      "organizations/current/legal-entities",
    );
  });

  it("uses the shared legalEntityId parameter key on every entity route", () => {
    const routes = [
      ["get", ":legalEntityId"],
      ["update", ":legalEntityId"],
      ["activate", ":legalEntityId/activate"],
      ["deactivate", ":legalEntityId/deactivate"],
      ["softDelete", ":legalEntityId/delete"],
    ] as const;

    for (const [name, route] of routes) {
      const handler = Object.getOwnPropertyDescriptor(
        LegalEntitiesController.prototype,
        name,
      )?.value as object;
      expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(route);
    }
  });

  it("requires organization view permission for reads and owner plus edit permission for every mutation", () => {
    for (const name of ["list", "get"] as const) {
      const handler = Object.getOwnPropertyDescriptor(
        LegalEntitiesController.prototype,
        name,
      )?.value as unknown;
      expect(
        Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler as object),
      ).toEqual(["can_view_organization"]);
      expect(
        Reflect.getMetadata(REQUIRE_ROLE_KEY, handler as object),
      ).toBeUndefined();
    }
    for (const name of [
      "create",
      "update",
      "activate",
      "deactivate",
      "softDelete",
    ] as const) {
      const handler = Object.getOwnPropertyDescriptor(
        LegalEntitiesController.prototype,
        name,
      )?.value as unknown;
      expect(Reflect.getMetadata(REQUIRE_ROLE_KEY, handler as object)).toBe(
        "owner",
      );
      expect(
        Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler as object),
      ).toEqual(["can_edit_organization"]);
    }
  });

  it("forwards only guard-selected organization, actor, entity, and parsed inputs", async () => {
    const service = {
      list: jest.fn().mockResolvedValue({}),
      get: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      transition: jest.fn().mockResolvedValue({}),
    };
    const controller = new LegalEntitiesController(service as never);
    const params: LegalEntityParams = { legalEntityId: entityId };
    const updateInput: UpdateLegalEntityInput = {
      ...createInput,
      expectedVersion: 2,
    };
    const versionInput: LegalEntityVersionInput = { expectedVersion: 2 };

    await controller.list(user);
    await controller.get(params, user);
    await controller.create(createInput, user);
    await controller.update(params, updateInput, user);
    await controller.activate(params, versionInput, user);
    await controller.deactivate(params, versionInput, user);
    await controller.softDelete(params, versionInput, user);

    expect(service.list).toHaveBeenCalledWith(organizationId, user.id);
    expect(service.get).toHaveBeenCalledWith({
      organizationId,
      actorId: user.id,
      legalEntityId: entityId,
    });
    expect(service.create).toHaveBeenCalledWith({
      organizationId,
      actorId: user.id,
      input: createInput,
    });
    expect(service.update).toHaveBeenCalledWith({
      organizationId,
      actorId: user.id,
      legalEntityId: entityId,
      input: updateInput,
    });
    expect(service.transition.mock.calls).toEqual([
      [
        {
          organizationId,
          actorId: user.id,
          legalEntityId: entityId,
          expectedVersion: 2,
          status: "active",
        },
      ],
      [
        {
          organizationId,
          actorId: user.id,
          legalEntityId: entityId,
          expectedVersion: 2,
          status: "inactive",
        },
      ],
      [
        {
          organizationId,
          actorId: user.id,
          legalEntityId: entityId,
          expectedVersion: 2,
          status: "deleted",
        },
      ],
    ]);
  });

  it.each(["admin", "viewer"] as const)(
    "denies %s despite an additive organization-edit permission",
    async (role) => {
      const handler = Object.getOwnPropertyDescriptor(
        LegalEntitiesController.prototype,
        "create",
      )?.value as unknown;
      const reflector = {
        getAllAndOverride: jest.fn((key: string): unknown =>
          Reflect.getMetadata(key, handler as object),
        ),
      };
      const permissions = { can: jest.fn().mockResolvedValue(true) };
      const guard = new PermissionsGuard(
        reflector as never,
        permissions as never,
      );
      const execution = {
        getHandler: () => handler,
        getClass: () => LegalEntitiesController,
        switchToHttp: () => ({
          getRequest: () => ({ user: { ...user, role } }),
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(execution)).rejects.toMatchObject({
        response: { code: "insufficient_role" },
      });
      expect(permissions.can).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the auth guard has no selected organization", () => {
    const controller = new LegalEntitiesController({} as never);
    expect(() => controller.list({ ...user, organizationId: null })).toThrow();
  });
});
