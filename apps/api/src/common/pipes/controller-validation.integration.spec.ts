import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import type { App } from "supertest/types";

import { InvitationsController } from "../../invitations/invitations.controller";
import { InvitationsService } from "../../invitations/invitations.service";
import { CustomRolesController } from "../../permissions/custom-roles.controller";
import { CustomRolesService } from "../../permissions/custom-roles.service";
import { PermissionsController } from "../../permissions/permissions.controller";
import { PermissionsService } from "../../permissions/permissions.service";
import { UsersController } from "../../users/users.controller";
import { UsersService } from "../../users/users.service";

describe("controller request validation", () => {
  const invitations = { create: jest.fn() };
  const roles = { create: jest.fn() };
  const permissions = { effectivePermissions: jest.fn() };
  const users = { changeRole: jest.fn() };
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [
        InvitationsController,
        CustomRolesController,
        PermissionsController,
        UsersController,
      ],
      providers: [
        { provide: InvitationsService, useValue: invitations },
        { provide: CustomRolesService, useValue: roles },
        { provide: PermissionsService, useValue: permissions },
        { provide: UsersService, useValue: users },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    {
      method: "post" as const,
      path: "/invitations",
      body: { email: "not-an-email", role: "superuser" },
      service: invitations.create,
      field: "email",
    },
    {
      method: "post" as const,
      path: "/roles",
      body: { name: "", color: "red" },
      service: roles.create,
      field: "name",
    },
    {
      method: "post" as const,
      path: "/permissions/check",
      body: { permissions: [] },
      service: permissions.effectivePermissions,
      field: "permissions",
    },
    {
      method: "patch" as const,
      path: "/users/11111111-1111-4111-8111-111111111111/role",
      body: { role: "superuser" },
      service: users.changeRole,
      field: "role",
    },
  ])(
    "rejects invalid $method $path bodies before invoking the service",
    async ({ method, path, body, service, field }) => {
      const response = await request(app.getHttpServer())
        [method](path)
        .send(body)
        .expect(400);
      const responseBody = response.body as {
        code?: unknown;
        fieldErrors?: Record<string, unknown>;
      };

      expect(responseBody.code).toBe("validation_failed");
      expect(typeof responseBody.fieldErrors?.[field]).toBe("string");
      expect(service).not.toHaveBeenCalled();
    },
  );
});
