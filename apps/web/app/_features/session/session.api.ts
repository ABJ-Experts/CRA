import type { SessionResponse } from "@repo/contracts/auth";
import { BASE_ROLES, PERMISSION_KEYS } from "@repo/contracts/permissions";
import { MENU_KEYS } from "@repo/contracts/menu";
import { z } from "zod";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";

const sessionOrganizationSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1),
    slug: z.string().min(1),
    role: z.enum(BASE_ROLES),
  })
  .strict();

const sessionUserSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    username: z.string().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    isActive: z.boolean(),
  })
  .strict();

const sessionResponseSchema: z.ZodType<SessionResponse> = z
  .object({
    user: sessionUserSchema,
    organization: sessionOrganizationSchema.nullable(),
    organizations: z.array(sessionOrganizationSchema),
  })
  .strict();

const permissionSetSchema = z.partialRecord(
  z.enum(PERMISSION_KEYS),
  z.boolean(),
);

export const effectivePermissionsResponseSchema = z
  .object({
    organizationId: z.uuid().nullable(),
    role: z.enum(BASE_ROLES).nullable(),
    permissions: permissionSetSchema,
  })
  .strict();

export const menuResponseSchema = z
  .object({ menu: z.array(z.enum(MENU_KEYS)) })
  .strict();

export type EffectivePermissionsResponse = z.infer<
  typeof effectivePermissionsResponseSchema
>;

export interface SessionRequestOptions {
  readonly signal?: AbortSignal;
  readonly fetcher?: typeof fetch;
}

export const sessionApi = Object.freeze({
  identity(options: SessionRequestOptions = {}) {
    return authenticatedRequestJson({
      path: "/api/v1/auth/session",
      schema: sessionResponseSchema,
      ...options,
    });
  },

  permissions(options: SessionRequestOptions = {}) {
    return authenticatedRequestJson({
      path: "/api/v1/permissions/effective",
      schema: effectivePermissionsResponseSchema,
      ...options,
    });
  },

  menu(options: SessionRequestOptions = {}) {
    return authenticatedRequestJson({
      path: "/api/v1/permissions/menu",
      schema: menuResponseSchema,
      ...options,
    }).then(({ menu }) => menu);
  },
});
