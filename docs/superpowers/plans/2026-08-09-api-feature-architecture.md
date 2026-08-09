# API Feature Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the NestJS API into an incremental modular monolith whose controllers and compatibility services preserve today's API while pure use cases depend on explicit ports implemented by Supabase, JWT, SMTP, and audit adapters.

**Architecture:** Migrate one vertical slice at a time. Existing controllers, route decorators, route paths, response shapes, and public service methods remain compatibility facades; each facade delegates to application use cases, which depend on pure policies and ports rather than `SupabaseService` or Nest HTTP classes. Nest modules are composition roots and adapters are contract-tested.

**Tech Stack:** NestJS 11, TypeScript 5.9.2, Supabase JS 2, PostgreSQL, Zod 4 via `@repo/contracts`, Jest 30, `jose` 5, Nodemailer 9.

## Global Constraints

- Complete `2026-08-09-security-correctness-hotfixes.md`, the architecture foundation plan, and the additive database/RPC tasks needed by a slice before migrating that slice.
- Use Node 20+ and pnpm only.
- Preserve every existing controller path, decorator, status code, error code, response body, and exported service method until all callers migrate.
- Preserve deny-by-default auth, guard order, cookie names/paths/lifetimes, ES256/JWKS verification, zero session-epoch skew, and permission merge order.
- Application and domain code cannot import NestJS, Express, Supabase, Nodemailer, or `jose`.
- Handwritten Supabase imports are allowed only in `apps/api/src/supabase` and feature `infrastructure/` adapters.
- Every service-role tenant method takes `orgId` first and filters by `organization_id` before returning or mutating data.
- Never introduce a request-scoped tenant singleton; tenant scope stays an explicit argument.
- New and materially refactored modules require at least 80% statement, branch, function, and line coverage.
- Do not add a CQRS/event bus, abstract factory family, base repository hierarchy, or inheritance-based template method in this plan.
- Security-critical actions remain synchronous; notification/audit observers cannot determine authorization or revocation.

---

## File Structure

Create folders only when the corresponding code moves:

```text
apps/api/src/<feature>/
  domain/                 # pure immutable state and policy
  application/            # ports, commands/queries, use cases
  infrastructure/         # Supabase/provider adapters
  <feature>.controller.ts # HTTP presentation
  <feature>.service.ts    # temporary compatibility facade
  <feature>.module.ts     # composition root
```

Cross-cutting pure application primitives live under `apps/api/src/common/application`; Nest exception mapping remains in `apps/api/src/common/filters` or presentation-specific mappers.

### Task 1: Characterize Wire Contracts Before Moving Code

**Files:**

- Create: `packages/contracts/src/http.ts`
- Create: `packages/contracts/src/http.spec.ts`
- Create: `packages/contracts/src/users.ts`
- Create: `packages/contracts/src/users.spec.ts`
- Create: `packages/contracts/src/invitations.ts`
- Create: `packages/contracts/src/invitations.spec.ts`
- Create: `packages/contracts/src/roles.ts`
- Create: `packages/contracts/src/roles.spec.ts`
- Modify: `packages/contracts/src/pagination.ts:1-106`
- Modify: `packages/contracts/src/pagination.spec.ts:1-156`
- Modify: `packages/contracts/src/index.ts:1-4`
- Modify: `packages/contracts/package.json:8-31`
- Modify: `apps/api/src/users/users.service.ts:12-29`
- Modify: `apps/api/src/invitations/invitations.service.ts:22-31,332-365`
- Modify: `apps/api/src/permissions/custom-roles.service.ts:10-22`

**Interfaces:**

- Produces: `apiErrorSchema`, `pagedSchema`, `memberSchema`, `invitationSchema`, `acceptInvitationResponseSchema`, `customRoleSchema`, and their inferred readonly-compatible types.
- Preserves: bare success bodies; no success envelope is introduced.

- [ ] **Step 1: Write failing contract tests from current payloads**

```ts
import { describe, expect, it } from "vitest";

import {
  acceptInvitationResponseSchema,
  invitationSchema,
} from "./invitations";

describe("invitation wire contracts", () => {
  it("accepts the existing list and acceptance shapes", () => {
    expect(
      invitationSchema.parse({
        id: "2ad67e3b-6e5e-4cde-870f-2225e7da1200",
        email: "member@cra.test",
        role: "member",
        status: "pending",
        expiresAt: "2026-08-16T10:00:00.000Z",
      }),
    ).toBeDefined();
    expect(
      acceptInvitationResponseSchema.parse({
        ok: true,
        alreadyAccepted: false,
        organization: {
          id: "2ad67e3b-6e5e-4cde-870f-2225e7da1201",
          name: "CRA",
          slug: "cra",
        },
      }),
    ).toBeDefined();
  });

  it("rejects unknown invitation states", () => {
    expect(() =>
      invitationSchema.parse({
        id: "2ad67e3b-6e5e-4cde-870f-2225e7da1200",
        email: "member@cra.test",
        role: "member",
        status: "mystery",
        expiresAt: "2026-08-16T10:00:00.000Z",
      }),
    ).toThrow();
  });
});
```

Add these concrete contract fixtures:

```ts
const member = {
  id: "2ad67e3b-6e5e-4cde-870f-2225e7da1202",
  email: "member@cra.test",
  username: null,
  firstName: null,
  lastName: null,
  avatarUrl: null,
  jobTitle: null,
  isActive: true,
  role: "member",
  joinedAt: "2026-08-09T10:00:00.000Z",
  roles: [],
};

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

const emptyMembersPage = {
  rows: [],
  total: 0,
  page: 1,
  pageSize: 15,
  pageCount: 1,
};

const apiError = {
  statusCode: 503,
  message: "Permissions are temporarily unavailable. Please try again.",
  code: "permissions_unavailable",
  fieldErrors: { email: "Enter a valid email address." },
};

it("accepts current member, role, page, and error payloads", () => {
  expect(memberSchema.parse(member)).toEqual(member);
  expect(customRoleSchema.parse(customRole)).toEqual(customRole);
  expect(pagedSchema(memberSchema).parse(emptyMembersPage)).toEqual(
    emptyMembersPage,
  );
  expect(apiErrorSchema.parse(apiError)).toEqual(apiError);
});

it.each([
  [memberSchema, { ...member, id: "not-a-uuid" }],
  [memberSchema, { ...member, email: "not-an-email" }],
  [memberSchema, { ...member, joinedAt: "yesterday" }],
  [customRoleSchema, { ...customRole, memberCount: -1 }],
  [pagedSchema(memberSchema), { ...emptyMembersPage, pageSize: 101 }],
  [pagedSchema(memberSchema), { ...emptyMembersPage, total: -1 }],
  [apiErrorSchema, { ...apiError, statusCode: 0 }],
] as const)("rejects an invalid boundary fixture", (schema, value) => {
  expect(schema.safeParse(value).success).toBe(false);
});
```

Configure object schemas as strict and add one `unrecognized` property to each valid fixture in a rejection test. This makes provider drift observable instead of silently discarding it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter contracts run test -- http users invitations roles`

Expected: FAIL because the contract modules do not exist.

- [ ] **Step 3: Implement strict schemas and inferred types**

The invitation module must contain:

```ts
import { z } from "zod";

import { BASE_ROLES } from "./permissions";

export const invitationStatusSchema = z.enum([
  "pending",
  "accepted",
  "revoked",
  "declined",
  "expired",
]);

export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: z.enum(BASE_ROLES),
  status: invitationStatusSchema,
  expiresAt: z.iso.datetime(),
});

export const organizationSummarySchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  slug: z.string().min(1),
});

export const acceptInvitationResponseSchema = z.object({
  ok: z.literal(true),
  alreadyAccepted: z.boolean(),
  organization: organizationSummarySchema,
});

export type Invitation = z.infer<typeof invitationSchema>;
export type AcceptInvitationResponse = z.infer<
  typeof acceptInvitationResponseSchema
>;
```

`http.ts` must export the existing error shape and a generic parser helper, not a success wrapper:

```ts
import { z } from "zod";

export const apiErrorSchema = z.object({
  statusCode: z.number().int().positive(),
  message: z.string().min(1),
  code: z.string().min(1).optional(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
```

Add the runtime counterpart to the existing pagination type in `pagination.ts`:

```ts
import { z } from "zod";

export const pagedSchema = <T>(rowSchema: z.ZodType<T>) =>
  z
    .object({
      rows: z.array(rowSchema),
      total: z.number().int().nonnegative(),
      page: z.number().int().positive(),
      pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
      pageCount: z.number().int().positive(),
    })
    .strict();
```

Add pagination tests for an empty page, a full page, malformed rows, negative totals, page/pageCount zero, page size 0/101, and an unknown property.

Use the current service fields as the exact source for `memberSchema` and `customRoleSchema`. Reuse `paged` interfaces from `pagination.ts`; do not define a second `Paged<T>`.

- [ ] **Step 4: Replace local DTO type declarations with contract imports**

Import types using package subpaths and extend the `exports` map:

```json
"./invitations": {
  "types": "./dist/invitations.d.ts",
  "default": "./dist/invitations.js"
}
```

Repeat exact exports for `./http`, `./users`, and `./roles`. The server's mapping logic stays unchanged in this task.

- [ ] **Step 5: Verify contracts and API compatibility**

Run:

```sh
pnpm --filter contracts run test
pnpm --filter contracts run build
pnpm --filter api run test
pnpm --filter api run check-types
```

Expected: PASS with no response-shape change.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts apps/api/src/users/users.service.ts apps/api/src/invitations/invitations.service.ts apps/api/src/permissions/custom-roles.service.ts
git commit -m "refactor: centralize API wire contracts"
```

### Task 2: Pilot Ports, State, and Use Cases in Invitations

**Files:**

- Create: `apps/api/src/common/application/result.ts`
- Create: `apps/api/src/invitations/domain/invitation-state.ts`
- Create: `apps/api/src/invitations/domain/invitation-state.spec.ts`
- Create: `apps/api/src/invitations/application/invitation-repository.port.ts`
- Create: `apps/api/src/invitations/application/invitation-token.port.ts`
- Create: `apps/api/src/invitations/application/invitation-notifier.port.ts`
- Create: `apps/api/src/invitations/application/create-invitation.use-case.ts`
- Create: `apps/api/src/invitations/application/create-invitation.use-case.spec.ts`
- Create: `apps/api/src/invitations/application/accept-invitation.use-case.ts`
- Create: `apps/api/src/invitations/application/accept-invitation.use-case.spec.ts`
- Create: `apps/api/src/invitations/application/revoke-invitation.use-case.ts`
- Create: `apps/api/src/invitations/application/list-invitations.query.ts`
- Create: `apps/api/src/invitations/infrastructure/supabase-invitation.repository.ts`
- Create: `apps/api/src/invitations/infrastructure/node-invitation-token.adapter.ts`
- Create: `apps/api/src/invitations/infrastructure/mail-invitation-notifier.adapter.ts`
- Modify: `apps/api/src/invitations/invitations.service.ts:1-384`
- Modify: `apps/api/src/invitations/invitations.module.ts:1-10`

**Interfaces:**

- Produces: immutable `Result<T, E>` union, explicit invitation states, repository/token/notifier ports, and four use cases.
- Consumes: `accept_invitation_atomic` RPC from the infrastructure plan.
- Preserves: `InvitationsService.create/accept/revoke/list` signatures and Nest exception bodies.

- [ ] **Step 1: Add the pure result and state-machine tests**

```ts
import { describe, expect, it } from "@jest/globals";

import { transitionInvitation } from "./invitation-state";

describe("invitation state", () => {
  it.each([
    ["pending", "accept", "accepted"],
    ["pending", "revoke", "revoked"],
    ["pending", "decline", "declined"],
    ["pending", "expire", "expired"],
  ] as const)("allows %s -> %s", (from, event, to) => {
    expect(transitionInvitation(from, event)).toEqual({ ok: true, value: to });
  });

  it.each([
    ["accepted", "revoke"],
    ["revoked", "accept"],
    ["expired", "accept"],
    ["declined", "accept"],
  ] as const)("rejects %s -> %s", (from, event) => {
    expect(transitionInvitation(from, event)).toEqual({
      ok: false,
      error: { code: "invalid_invitation_transition", from, event },
    });
  });
});
```

- [ ] **Step 2: Run the state test to verify it fails**

Run: `pnpm --filter api run test -- invitation-state`

Expected: FAIL because the state module does not exist.

- [ ] **Step 3: Implement immutable state transitions**

```ts
import type { Result } from "../../common/application/result";

export type InvitationState =
  "pending" | "accepted" | "revoked" | "declined" | "expired";
export type InvitationEvent = "accept" | "revoke" | "decline" | "expire";

const TRANSITIONS = Object.freeze({
  pending: Object.freeze({
    accept: "accepted",
    revoke: "revoked",
    decline: "declined",
    expire: "expired",
  }),
} satisfies Partial<
  Record<InvitationState, Partial<Record<InvitationEvent, InvitationState>>>
>);

export function transitionInvitation(
  from: InvitationState,
  event: InvitationEvent,
): Result<
  InvitationState,
  {
    code: "invalid_invitation_transition";
    from: InvitationState;
    event: InvitationEvent;
  }
> {
  const next = TRANSITIONS[from]?.[event];
  return next
    ? { ok: true, value: next }
    : {
        ok: false,
        error: { code: "invalid_invitation_transition", from, event },
      };
}
```

`Result` is:

```ts
export type Result<T, E> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: E }>;
```

- [ ] **Step 4: Define the inward-owned ports**

```ts
import type {
  AcceptInvitationResponse,
  Invitation,
} from "@repo/contracts/invitations";
import type { BaseRole } from "@repo/contracts/permissions";

export interface InvitationRepository {
  findExistingUser(email: string): Promise<{ id: string } | null>;
  isMember(orgId: string, userId: string): Promise<boolean>;
  hasPending(orgId: string, email: string): Promise<boolean>;
  insert(
    orgId: string,
    input: Readonly<{
      invitedBy: string;
      email: string;
      role: BaseRole;
      firstName: string | null;
      lastName: string | null;
      tokenHash: string;
      expiresAt: string;
    }>,
  ): Promise<{ id: string }>;
  acceptAtomic(
    tokenHash: string,
    user: Readonly<{ id: string; email: string }>,
  ): Promise<AcceptInvitationResponse>;
  revoke(orgId: string, invitationId: string): Promise<void>;
  list(orgId: string): Promise<readonly Invitation[]>;
  organization(
    orgId: string,
  ): Promise<{ id: string; name: string; slug: string }>;
}

export interface InvitationTokenPort {
  create(): Readonly<{ raw: string; hash: string }>;
}

export interface InvitationNotifierPort {
  send(
    email: string,
    rawToken: string,
    organizationName: string,
    inviterName: string | null,
  ): Promise<void>;
}
```

Every repository method that accesses tenant-owned data has `orgId` first, except `acceptAtomic`, whose scope is derived from a high-entropy hashed invitation token and verified caller email inside the database RPC.

- [ ] **Step 5: Write use-case tests before implementations**

The `CreateInvitationUseCase` suite must cover self-invite, existing member, pending duplicate, existing non-member account, normalized email, clock/TTL boundary, token hash persistence, disabled mail, mail failure, repository failure, and successful return. The acceptance suite must cover invalid hash, wrong email, expired, revoked, already accepted with membership, already accepted without membership, concurrent double acceptance, and database outage.

Use plain in-memory fakes that implement the interfaces; do not mock Supabase query chains in use-case tests. A representative test is:

```ts
it("persists only the token hash and sends only the raw token", async () => {
  const repository = new InMemoryInvitationRepository();
  const notifier = new RecordingNotifier();
  const useCase = new CreateInvitationUseCase(
    repository,
    { create: () => ({ raw: "raw-token", hash: "hashed-token" }) },
    notifier,
    { now: () => new Date("2026-08-09T00:00:00.000Z") },
    7,
  );

  await useCase.execute({
    orgId: "org-1",
    actor: { id: "owner-1", email: "owner@cra.test" },
    input: { email: "member@cra.test", role: "member" },
  });

  expect(repository.lastInsert?.tokenHash).toBe("hashed-token");
  expect(JSON.stringify(repository.lastInsert)).not.toContain("raw-token");
  expect(notifier.sent[0]?.rawToken).toBe("raw-token");
});
```

- [ ] **Step 6: Implement use cases and adapters minimally**

Use cases return semantic result errors, never Nest exceptions. The compatibility facade maps errors to the exact current `BadRequestException`, `ConflictException`, `ForbiddenException`, or `NotFoundException` bodies. `NodeInvitationTokenAdapter` owns `randomBytes` and SHA-256. `SupabaseInvitationRepository` is the only invitation file importing `SupabaseService` and maps database records to contract fields.

In `InvitationsModule`, bind plain use cases through factory providers:

```ts
{
  provide: CreateInvitationUseCase,
  inject: [SupabaseInvitationRepository, NodeInvitationTokenAdapter, MailInvitationNotifierAdapter, ConfigService],
  useFactory: (repository, tokens, notifier, config) =>
    new CreateInvitationUseCase(
      repository,
      tokens,
      notifier,
      { now: () => new Date() },
      config.getOrThrow<number>("INVITATION_TTL_DAYS"),
    ),
},
```

Keep `InvitationsService` as an `@Injectable()` facade whose four public methods delegate and map failures. Do not change the controller in this task.

- [ ] **Step 7: Contract-test the Supabase adapter**

Test every `.eq("organization_id", orgId)` call, record mapping, PostgREST error mapping, RPC argument name, and duplicate acceptance result. Run the live concurrent acceptance test from the infrastructure plan.

- [ ] **Step 8: Verify and commit**

Run:

```sh
pnpm --filter api run test -- invitations
pnpm --filter api exec jest --coverage --runInBand --collectCoverageFrom='invitations/**/*.ts' invitations
pnpm --filter infrastructure run test
pnpm --filter api run test:e2e
```

Expected: PASS and at least 80% in the new/refactored invitation files.

```bash
git add apps/api/src/common/application apps/api/src/invitations
git commit -m "refactor: isolate invitation workflows"
```

### Task 3: Split Permission Calculation from Its Versioned Cache Proxy

**Files:**

- Create: `apps/api/src/permissions/application/permission-data.port.ts`
- Create: `apps/api/src/permissions/application/base-permission-resolver.ts`
- Create: `apps/api/src/permissions/application/base-permission-resolver.spec.ts`
- Create: `apps/api/src/permissions/application/versioned-permission-resolver.proxy.ts`
- Create: `apps/api/src/permissions/application/versioned-permission-resolver.proxy.spec.ts`
- Create: `apps/api/src/permissions/infrastructure/supabase-permission-data.adapter.ts`
- Create: `apps/api/src/permissions/infrastructure/supabase-permission-data.adapter.spec.ts`
- Modify: `apps/api/src/permissions/permissions.service.ts:1-245`
- Modify: `apps/api/src/permissions/permissions.module.ts:1-27`

**Interfaces:**

- Produces: `PermissionDataPort`, `PermissionResolver`, pure `BasePermissionResolver`, and protective/caching `VersionedPermissionResolver` proxy.
- Preserves: `PermissionsService.resolve/can/menu/canViewMenuKey` signatures and exact permission semantics.

- [ ] **Step 1: Define ports and write shared resolver contract tests**

```ts
export interface PermissionDataPort {
  version(orgId: string): Promise<number>;
  assignedRoles(
    orgId: string,
    userId: string,
  ): Promise<readonly AssignedCustomRole[]>;
  baseRoleOverrides(orgId: string, baseRole: BaseRole): Promise<unknown>;
  menuRules(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<Readonly<Partial<Record<MenuKey, boolean>>>>;
}

export interface PermissionResolution {
  readonly permissions: PermissionSet;
  readonly menuOverrides: Readonly<Partial<Record<MenuKey, boolean>>>;
}

export interface PermissionResolver {
  resolve(
    orgId: string,
    userId: string,
    baseRole: BaseRole,
  ): Promise<PermissionResolution>;
}
```

Create a reusable test function that runs against `BasePermissionResolver` and `VersionedPermissionResolver` and asserts the frozen merge order from `@repo/contracts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter api run test -- base-permission-resolver versioned-permission-resolver`

Expected: FAIL because the classes do not exist.

- [ ] **Step 3: Implement the base resolver**

`BasePermissionResolver` performs the three independent reads with `Promise.all`, calls `resolveEffectivePermissions`, and returns fresh frozen top-level objects. It does not cache and does not catch adapter errors.

- [ ] **Step 4: Implement the protective proxy**

```ts
export class VersionedPermissionResolver implements PermissionResolver {
  private readonly cache = new Map<
    string,
    Readonly<{
      version: number;
      value: PermissionResolution;
    }>
  >();

  constructor(
    private readonly data: PermissionDataPort,
    private readonly target: PermissionResolver,
  ) {}

  async resolve(orgId: string, userId: string, baseRole: BaseRole) {
    const version = await this.data.version(orgId);
    const key = `${orgId}:${userId}`;
    const cached = this.cache.get(key);
    if (cached?.version === version) return cached.value;

    const value = await this.target.resolve(orgId, userId, baseRole);
    this.cache.set(key, Object.freeze({ version, value }));
    return value;
  }
}
```

Tests must prove: same version hits cache, changed version recomputes, version read failure never serves cache, resolver failure never writes cache, users/orgs never share entries, returned state cannot poison future results, and version `0` is treated according to the hotfix's explicit failure posture rather than as a cacheable version.

- [ ] **Step 5: Implement the Supabase adapter and compatibility facade**

Move all four query chains and error logging out of `PermissionsService`. Adapter errors become a framework-free `PermissionDataUnavailableError`; the existing service or global exception mapper converts it to the exact `permissions_unavailable` 503 body introduced by the hotfix.

`PermissionsService` delegates `resolve` to `VersionedPermissionResolver` and keeps the existing convenience methods. `PermissionsGuard` remains unchanged.

- [ ] **Step 6: Verify and commit**

Run:

```sh
pnpm --filter api run test -- permissions
pnpm --filter contracts run test -- permissions menu
pnpm --filter infrastructure run test
```

Expected: PASS with at least 80% coverage for new resolver/adapter files.

```bash
git add apps/api/src/permissions
git commit -m "refactor: isolate permission resolution"
```

### Task 4: Extract Tenant-Scoped Member and Role Repositories

**Files:**

- Create: `apps/api/src/users/application/member-repository.port.ts`
- Create: `apps/api/src/users/application/member-use-cases.ts`
- Create: `apps/api/src/users/application/member-use-cases.spec.ts`
- Create: `apps/api/src/users/infrastructure/supabase-member.repository.ts`
- Create: `apps/api/src/users/infrastructure/supabase-member.repository.spec.ts`
- Create: `apps/api/src/permissions/application/role-repository.port.ts`
- Create: `apps/api/src/permissions/application/role-use-cases.ts`
- Create: `apps/api/src/permissions/application/role-use-cases.spec.ts`
- Create: `apps/api/src/permissions/infrastructure/supabase-role.repository.ts`
- Create: `apps/api/src/permissions/infrastructure/supabase-role.repository.spec.ts`
- Modify: `apps/api/src/users/users.service.ts:1-339`
- Modify: `apps/api/src/users/users.module.ts:1-12`
- Modify: `apps/api/src/permissions/custom-roles.service.ts:1-322`
- Modify: `apps/api/src/permissions/permissions.module.ts:1-27`

**Interfaces:**

- Produces: tenant-explicit repository ports and immutable command/query handlers.
- Preserves: `UsersService` and `CustomRolesService` public methods.

- [ ] **Step 1: Write compile-time and behavior tests for repository scope**

The ports must expose exactly:

```ts
export interface MemberRepository {
  list(orgId: string, params: PageParams): Promise<Paged<Member>>;
  findMembership(
    orgId: string,
    userId: string,
  ): Promise<{ role: BaseRole } | null>;
  changeRole(orgId: string, userId: string, role: BaseRole): Promise<void>;
  remove(orgId: string, userId: string): Promise<void>;
  setActive(orgId: string, userId: string, isActive: boolean): Promise<void>;
  updateOwnProfile(userId: string, patch: ProfilePatch): Promise<void>;
}

export interface RoleRepository {
  list(orgId: string): Promise<readonly CustomRole[]>;
  create(orgId: string, input: CreateRoleRecord): Promise<{ id: string }>;
  find(orgId: string, roleId: string): Promise<CustomRoleIdentity | null>;
  update(orgId: string, roleId: string, patch: UpdateRoleRecord): Promise<void>;
  softDelete(orgId: string, roleId: string, actorId: string): Promise<void>;
  overrides(orgId: string): Promise<Readonly<Record<string, PermissionSet>>>;
  setOverride(
    orgId: string,
    baseRole: BaseRole,
    permissions: PermissionSet,
  ): Promise<void>;
}
```

Use TypeScript assignment tests to ensure moving `orgId` away from the first position fails `@ts-expect-error` checks. Adapter tests inspect each query builder and prove the organization filter is present for list, find, update, delete, activation, and role operations.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter api run test -- member-use-cases supabase-member role-use-cases supabase-role`

Expected: FAIL because ports/use cases/adapters do not exist.

- [ ] **Step 3: Implement pure use cases with current invariants**

Use immutable command records:

```ts
export type ChangeMemberRoleCommand = Readonly<{
  orgId: string;
  actor: Readonly<{ id: string; email: string }>;
  targetUserId: string;
  role: BaseRole;
}>;
```

Handlers must keep self-demotion/removal/deactivation checks, last-owner error translation, profile self-scope, permission sanitization, system-role protections, soft deletion, and audit payload fields. Return semantic failures; compatibility facades map them to the existing Nest exceptions.

- [ ] **Step 4: Implement adapters and keep facades stable**

Move query composition and PostgREST-specific error interpretation into the two adapters. Keep pagination calculation in `@repo/contracts/pagination`. Do not create a generic `BaseRepository`; the two aggregates have different query and invariant needs.

- [ ] **Step 5: Replace hidden global coupling with explicit module imports**

Make `UsersModule` non-global and provide its own facade/use cases/adapters. Export only `UsersService` if another module currently consumes it. Provide `AuditService` from a dedicated `AuditModule` instead of defining it in `UsersModule`; import that module where needed.

- [ ] **Step 6: Verify and commit members, then roles separately**

Run after members:

```sh
pnpm --filter api run test -- users member
pnpm --filter infrastructure run test
pnpm --filter api run check-types
```

Commit:

```bash
git add apps/api/src/users apps/api/src/audit apps/api/src/app.module.ts
git commit -m "refactor: isolate member persistence"
```

Run after roles:

```sh
pnpm --filter api run test -- custom-roles role permissions
pnpm --filter contracts run test -- permissions
pnpm --filter infrastructure run test
```

Commit:

```bash
git add apps/api/src/permissions
git commit -m "refactor: isolate role persistence"
```

### Task 5: Extract Explicit JWT Strategies and Auth Use Cases Last

**Files:**

- Create: `apps/api/src/auth/token-verification/token-verifier.strategy.ts`
- Create: `apps/api/src/auth/token-verification/hs256.strategy.ts`
- Create: `apps/api/src/auth/token-verification/jwks.strategy.ts`
- Create: `apps/api/src/auth/token-verification/token-strategy-selector.ts`
- Create: `apps/api/src/auth/token-verification/token-strategies.spec.ts`
- Create: `apps/api/src/auth/domain/auth-flow-state.ts`
- Create: `apps/api/src/auth/domain/auth-flow-state.spec.ts`
- Create: `apps/api/src/auth/application/auth-identity-provider.port.ts`
- Create: `apps/api/src/auth/application/auth-profile-repository.port.ts`
- Create: `apps/api/src/auth/application/mfa-recovery-repository.port.ts`
- Create: `apps/api/src/auth/application/auth-use-cases.ts`
- Create: `apps/api/src/auth/application/auth-use-cases.spec.ts`
- Create: `apps/api/src/auth/infrastructure/supabase-auth-identity.adapter.ts`
- Create: `apps/api/src/auth/infrastructure/supabase-auth-profile.repository.ts`
- Create: `apps/api/src/auth/infrastructure/supabase-mfa-recovery.repository.ts`
- Create: `apps/api/src/auth/infrastructure/supabase-auth-adapters.spec.ts`
- Modify: `apps/api/src/auth/token-verifier.service.ts:1-144`
- Modify: `apps/api/src/auth/auth.service.ts:1-678`
- Modify: `apps/api/src/auth/mfa/mfa.service.ts:1-409`
- Modify: `apps/api/src/auth/auth.module.ts:1-34`

**Interfaces:**

- Produces: explicit `HS256` and `JWKS` strategies selected from an algorithm allowlist; focused auth/MFA use cases behind the existing `AuthService` and `MfaService` facades.
- Preserves: all controller methods, cookie utility calls, error bodies, timing behavior, and live auth-flow behavior.

- [ ] **Step 1: Characterize every existing auth/MFA public method**

Before extraction, add direct service tests for signup, signin, refresh, global sign-out, verification issue/consume, password-reset request/consume, session projection, password reauthentication/lockout, MFA enroll/confirm/verify/recovery/unenroll/factor discovery. Cover provider errors, missing rows, stale/consumed artifacts, attempt exhaustion, timing floor, epoch bump failure, concurrent recovery-code redemption, and cross-request user-client isolation.

Run: `pnpm --filter api run test -- auth.service mfa.service token-verifier`

Expected: RED tests expose current untested behavior; fix tests only if they assert a behavior that contradicts the current route/security contract.

- [ ] **Step 2: Write and implement the strategy contract**

```ts
export interface TokenVerifierStrategy {
  readonly name: "HS256" | "JWKS";
  supports(algorithm: string): boolean;
  verify(token: string): Promise<VerifyResult>;
}

export class TokenStrategySelector {
  constructor(private readonly strategies: readonly TokenVerifierStrategy[]) {}

  select(algorithm: string): TokenVerifierStrategy | null {
    if (!(["HS256", "ES256", "RS256"] as const).includes(algorithm as never)) {
      return null;
    }
    return (
      this.strategies.find((strategy) => strategy.supports(algorithm)) ?? null
    );
  }
}
```

Tests must reject `none`, symmetric/asymmetric algorithm confusion, missing algorithm, malformed protected headers, bad issuer, expired token, unknown key, JWKS outage, and key rotation. `TokenVerifierService.verify()` keeps its public result union and logging/statistics while delegating.

- [ ] **Step 3: Define auth state transitions**

Use a pure discriminated union for persisted flow facts, not browser-cookie authority:

```ts
export type AuthFlowState =
  | Readonly<{ kind: "anonymous" }>
  | Readonly<{ kind: "pending_email"; userId: string }>
  | Readonly<{ kind: "mfa_required"; userId: string }>
  | Readonly<{ kind: "authenticated"; userId: string; aal: "aal1" | "aal2" }>
  | Readonly<{ kind: "locked"; email: string; until: string }>;
```

Test legal/illegal transitions and assert that `cra_pending`, `cra_mfa`, and `cra_session` can route UX but cannot manufacture any server state.

- [ ] **Step 4: Define provider ports and focused use cases**

Split the current service responsibilities into:

```ts
RegisterUserUseCase;
AuthenticateUserUseCase;
RefreshSessionUseCase;
SignOutEverywhereUseCase;
ManageEmailVerificationUseCase;
ManagePasswordRecoveryUseCase;
ReadSessionQuery;
ReauthenticateUserUseCase;
EnrollMfaUseCase;
VerifyMfaUseCase;
RecoverMfaUseCase;
UnenrollMfaUseCase;
```

Each class has one `execute` method with a readonly command/query and depends only on identity/profile/artifact/recovery repository ports, clock/random/hash ports, and notifier ports. Do not hide refresh, deactivation, epoch bump, password reset, or MFA recovery behind an asynchronous observer.

The ports must expose the exact atomic operations introduced by the infrastructure plan:

```ts
export type VerificationOutcome =
  "verified" | "missing" | "expired" | "attempts_exhausted" | "invalid";

export type PasswordResetClaim = Readonly<
  | { outcome: "consumed"; userId: string; authUserId: string }
  | { outcome: "invalid" | "expired" | "profile_missing" }
>;

export interface AuthProfileRepository {
  verifyEmailCode(
    userId: string,
    codeHash: string,
    maxAttempts: number,
  ): Promise<VerificationOutcome>;
  consumePasswordReset(tokenHash: string): Promise<PasswordResetClaim>;
}

export interface MfaRecoveryRepository {
  claim(
    userId: string,
    codeHash: string,
  ): Promise<
    Readonly<{
      outcome: "claimed" | "resumed" | "invalid";
      operationId?: string;
      authUserId?: string;
      status?: "claimed" | "factors_removed" | "completed" | "failed";
    }>
  >;
  markFactorsRemoved(operationId: string, userId: string): Promise<void>;
  complete(operationId: string, userId: string): Promise<void>;
  fail(operationId: string, userId: string, errorCode: string): Promise<void>;
}
```

Hash raw codes/tokens before calling these ports. No raw verification code, recovery code, reset token, password, JWT, refresh token, or provider error body crosses a repository boundary or enters a log.

- [ ] **Step 5: Implement Supabase adapters and compatibility facades**

`SupabaseAuthIdentityAdapter` owns `anon()`/`asUser()` GoTrue calls. `SupabaseAuthProfileRepository` owns server-role profile/artifact/RPC access. `AuthService` and `MfaService` keep every public signature and delegate in small methods; controller imports remain unchanged.

Use Nest factory providers to compose plain use cases. Do not cache an anon/user client in any provider.

Adapter tests must assert the exact RPCs and argument keys:

```text
verify_email_code_atomic -> p_user_id, p_code_hash, p_max_attempts
consume_password_reset -> p_token_hash
claim_mfa_recovery -> p_user_id, p_code_hash
mark_mfa_factors_removed -> p_operation_id, p_user_id
complete_mfa_recovery -> p_operation_id, p_user_id
fail_mfa_recovery -> p_operation_id, p_user_id, p_error_code
```

Cover database failure before token consumption, GoTrue failure after password-reset consumption, global sign-out failure after password update, verification attempt exhaustion, concurrent MFA recovery claim, provider failure after one factor deletion, resume after `failed`, and completion replay. Preserve the conservative failure postures specified in the infrastructure plan.

- [ ] **Step 6: Verify auth in escalating gates**

Run:

```sh
pnpm --filter api run test -- token-verification auth.service mfa.service cookies.util supabase-auth.guard public-routes permission-coverage
pnpm --filter api run test:cov
pnpm --filter infrastructure run test
pnpm --filter api run build
pnpm --filter api run test:e2e
```

Expected: PASS; every new/refactored auth module reaches 80% coverage, and the live auth flow is unchanged.

- [ ] **Step 7: Commit strategies and auth extraction separately**

```bash
git add apps/api/src/auth/token-verification apps/api/src/auth/token-verifier.service.ts apps/api/src/auth/auth.module.ts
git commit -m "refactor: isolate token strategies"

git add apps/api/src/auth
git commit -m "refactor: isolate authentication workflows"
```

### Task 6: Centralize the Security Chain and Finish Composition Roots

**Files:**

- Create: `apps/api/src/common/security/security.module.ts`
- Create: `apps/api/src/common/security/security.module.spec.ts`
- Modify: `apps/api/src/app.module.ts:1-46`
- Modify: `apps/api/src/auth/auth.module.ts:1-34`
- Modify: `apps/api/src/permissions/permissions.module.ts:1-27`
- Modify: `apps/api/src/supabase/supabase.module.ts:1-17`
- Modify: `apps/api/src/mail/mail.module.ts:1-11`

**Interfaces:**

- Produces: one explicit `APP_GUARD` composition order: throttling -> authentication/session/MFA -> authorization.
- Preserves: global deny-by-default behavior and metadata allowlists.

- [ ] **Step 1: Write a failing provider-order test**

```ts
import { APP_GUARD } from "@nestjs/core";

import { SecurityModule, SECURITY_GUARD_ORDER } from "./security.module";

describe("SecurityModule", () => {
  it("pins the global guard chain", () => {
    expect(SECURITY_GUARD_ORDER).toEqual([
      "ThrottlerGuard",
      "SupabaseAuthGuard",
      "PermissionsGuard",
    ]);
    expect(SecurityModule).toBeDefined();
    expect(APP_GUARD).toBeDefined();
  });
});
```

Also extend route metadata specs so moving providers cannot make a route public or authorization-free.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter api run test -- security.module public-routes permission-coverage`

Expected: FAIL because `SecurityModule` does not exist.

- [ ] **Step 3: Register all guards in one module**

```ts
export const SECURITY_GUARD_ORDER = Object.freeze([
  ThrottlerGuard.name,
  SupabaseAuthGuard.name,
  PermissionsGuard.name,
]);

@Module({
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class SecurityModule {}
```

Remove duplicate `APP_GUARD` providers from feature modules. Import `SecurityModule` after its dependencies are available, and verify Nest resolves the same singleton services used by the guards.

- [ ] **Step 4: Remove hidden globals incrementally**

Make `PermissionsModule`, `SupabaseModule`, and `MailModule` non-global only after every consuming module has an explicit import. Use `rg` to enumerate consumers before each annotation removal. Never replace explicit tenant arguments with a global request context.

- [ ] **Step 5: Run the complete API gate**

Run:

```sh
pnpm --filter api run lint
pnpm --filter api run check-types
pnpm --filter api run test
pnpm --filter api run test:cov
pnpm --filter api run build
pnpm --filter infrastructure run test
pnpm --filter api run test:e2e
```

Expected: PASS with 80% coverage for all new/materially refactored modules and no route/guard drift.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/common/security apps/api/src/app.module.ts apps/api/src/auth/auth.module.ts apps/api/src/permissions/permissions.module.ts apps/api/src/supabase/supabase.module.ts apps/api/src/mail/mail.module.ts
git commit -m "refactor: centralize security composition"
```
