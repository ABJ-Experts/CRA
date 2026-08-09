import type { SignInInput, SessionResponse } from "./auth/types/index.js";
import type { OkResponse } from "./shared/types/index.js";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  authNextResponseSchema,
  mfaConfirmInputSchema,
  sessionResponseSchema,
  signInInputSchema,
  signUpInputSchema,
} from "./auth/schemas/index.js";
import {
  acceptInvitationInputSchema,
  createInvitationInputSchema,
  invitationListResponseSchema,
} from "./invitations/schemas/index.js";
import {
  checkPermissionsInputSchema,
  effectivePermissionsResponseSchema,
} from "./permissions/schemas/index.js";
import {
  createRoleInputSchema,
  roleListResponseSchema,
} from "./roles/schemas/index.js";
import { idResponseSchema, okResponseSchema } from "./shared/schemas/index.js";
import {
  livenessResponseSchema,
  readinessResponseSchema,
} from "./system/schemas/index.js";
import {
  changeMemberRoleInputSchema,
  updateProfileInputSchema,
} from "./users/schemas/index.js";

describe("API boundary contracts", () => {
  it("returns parsed request values, including transforms and defaults", () => {
    expect(
      signUpInputSchema.parse({
        email: "  ADA@EXAMPLE.COM ",
        username: "ada",
        password: "Password1",
        unexpected: "preserved compatibility means strip, not reject",
      }),
    ).toEqual({
      email: "ada@example.com",
      username: "ada",
      password: "Password1",
    });
    expect(
      signInInputSchema.parse({
        email: "ada",
        password: "Password1",
      }),
    ).toMatchObject({ remember: false });
  });

  it("derives trusted request and response types from parsed schema outputs", () => {
    expectTypeOf(signInInputSchema.parse).returns.toEqualTypeOf<SignInInput>();
    expectTypeOf(
      sessionResponseSchema.parse,
    ).returns.toEqualTypeOf<SessionResponse>();
    expectTypeOf(okResponseSchema.parse).returns.toEqualTypeOf<OkResponse>();
  });

  it.each([
    [mfaConfirmInputSchema, { factorId: "factor-1", code: "123456" }],
    [
      createInvitationInputSchema,
      { email: "member@example.com", role: "member" },
    ],
    [acceptInvitationInputSchema, { token: "a".repeat(64) }],
    [checkPermissionsInputSchema, { permissions: ["can_view_users"] }],
    [createRoleInputSchema, { name: "Auditor" }],
    [changeMemberRoleInputSchema, { role: "admin" }],
    [updateProfileInputSchema, { firstName: "Ada" }],
  ] as const)("parses request contract %#", (schema, value) => {
    expect(schema.safeParse(value).success).toBe(true);
  });

  it.each([
    [okResponseSchema, { ok: true }],
    [idResponseSchema, { id: "11111111-1111-4111-8111-111111111111" }],
    [authNextResponseSchema, { next: "dashboard" }],
    [
      sessionResponseSchema,
      {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          email: "ada@example.com",
          username: "ada",
          firstName: "Ada",
          lastName: null,
          avatarUrl: null,
          isActive: true,
        },
        organization: null,
        organizations: [],
      },
    ],
    [invitationListResponseSchema, { rows: [] }],
    [
      effectivePermissionsResponseSchema,
      { organizationId: null, role: null, permissions: {} },
    ],
    [roleListResponseSchema, { rows: [] }],
    [livenessResponseSchema, { status: "ok", uptime: 1 }],
    [readinessResponseSchema, { status: "ok", database: true }],
  ] as const)("parses response contract %#", (schema, value) => {
    expect(schema.parse(value)).toEqual(value);
    expect(schema.safeParse({ ...value, unexpected: true }).success).toBe(
      false,
    );
  });
});
