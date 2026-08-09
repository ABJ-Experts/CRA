import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NextFunction, Request, Response } from "express";
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
import type { RequestUser } from "../../auth/auth.types";

const requestUser: RequestUser = Object.freeze({
  id: "11111111-1111-4111-8111-111111111111",
  authUserId: "22222222-2222-4222-8222-222222222222",
  email: "owner@cra.test",
  isActive: true,
  organizationId: "33333333-3333-4333-8333-333333333333",
  role: "owner",
  accessToken: "access-token",
  aal: "aal2",
});

describe("controller request validation", () => {
  const invitations = { create: jest.fn() };
  const roles = { create: jest.fn() };
  const permissions = { effectivePermissions: jest.fn() };
  const users = { changeRole: jest.fn(), listMembers: jest.fn() };
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
    app.use(
      (
        req: Request & { user?: RequestUser },
        _res: Response,
        next: NextFunction,
      ) => {
        req.user = requestUser;
        next();
      },
    );
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

  it("rejects malformed UUID parameters before invoking the service", async () => {
    await request(app.getHttpServer())
      .patch("/users/not-a-uuid/role")
      .send({ role: "admin" })
      .expect(400);

    expect(users.changeRole).not.toHaveBeenCalled();
  });

  it("parses and normalizes query values before invoking the service", async () => {
    users.listMembers.mockResolvedValueOnce({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 100,
      pageCount: 1,
    });

    await request(app.getHttpServer())
      .get("/users?page=0&pageSize=1000&order=sideways&q=%20ada%20")
      .expect(200);

    expect(users.listMembers).toHaveBeenCalledWith(requestUser.organizationId, {
      page: 1,
      pageSize: 100,
      order: "asc",
      q: "ada",
    });
  });
});
