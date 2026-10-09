import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { utcZDateTimeSchema } from "../../products/schemas/release-market-lifecycle.schema.js";
import { apiErrorSchema } from "../../shared/schemas/http.schema.js";
import { z } from "zod";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const revisionSchema = requiredText(256);
const expectedVersionSchema = z.number().int().nonnegative();
const versionSchema = z.number().int().nonnegative();
const storedVersionSchema = z.number().int().positive();
const taskCommandFields = {
  expectedRouteVersion: expectedVersionSchema,
  expectedSourceRevision: revisionSchema,
  idempotencyKey: idempotencyKeySchema,
};

/** Source IDs are stable within their organization and type. */
export const taskTypeSchema = z.enum([
  "finding_triage",
  "finding_approval",
  "report_approval",
  "evidence_expiry",
  "supplier_request",
]);
export const taskScopeSchema = z.enum(["mine", "group", "available", "all"]);
export const taskStateSchema = z.enum(["open", "overdue", "unavailable"]);
export const taskCursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,2048}$/)
  .brand<"TaskCursor">();

export const taskListQuerySchema = z
  .object({
    scope: taskScopeSchema.default("mine"),
    taskType: taskTypeSchema.optional(),
    state: taskStateSchema.optional(),
    ownerUserId: z.uuid().optional(),
    dueFrom: utcZDateTimeSchema.optional(),
    dueTo: utcZDateTimeSchema.optional(),
    cursor: taskCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(
    ({ dueFrom, dueTo }) =>
      !dueFrom || !dueTo || Date.parse(dueFrom) <= Date.parse(dueTo),
    { path: ["dueTo"], message: "Due date range is reversed" },
  );

export const taskParamsSchema = z
  .object({ taskType: taskTypeSchema, sourceId: z.uuid() })
  .strict();

/** Source URLs are local application routes, never arbitrary redirects. */
const sourceUrlSchema = z
  .string()
  .max(2_048)
  .regex(/^\/(?!\/)[^\s\\]*$/);

export const taskRowSchema = z
  .object({
    organizationId: z.uuid(),
    taskType: taskTypeSchema,
    sourceId: z.uuid(),
    title: requiredText(500).nullable(),
    sourceUrl: sourceUrlSchema.nullable(),
    dueAt: utcZDateTimeSchema.nullable(),
    state: taskStateSchema,
    sourceRevision: revisionSchema.nullable(),
    routeVersion: versionSchema,
    accountableOwnerUserId: z.uuid().nullable(),
    effectiveAssigneeUserId: z.uuid().nullable(),
    actingUserId: z.uuid().nullable(),
    groupId: z.uuid().nullable(),
    delegatedToUserId: z.uuid().nullable(),
    delegationExpiresAt: utcZDateTimeSchema.nullable(),
    unresolvedAssignment: z.boolean(),
    canAssign: z.boolean(),
    canClaim: z.boolean(),
    canDelegate: z.boolean(),
  })
  .strict()
  .superRefine((task, context) => {
    if (
      task.state === "unavailable" &&
      (task.title !== null ||
        task.sourceUrl !== null ||
        task.sourceRevision !== null ||
        task.dueAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Unavailable sources cannot expose stale source details",
      });
    }
    if (
      task.state !== "unavailable" &&
      (task.title === null ||
        task.sourceUrl === null ||
        task.sourceRevision === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Available tasks require live source details",
      });
    }
    if (
      (task.delegatedToUserId === null) !==
      (task.delegationExpiresAt === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Delegation target and expiry must be present together",
      });
    }
  });

export const taskListResponseSchema = z
  .object({
    rows: z.array(taskRowSchema).max(100),
    nextCursor: taskCursorSchema.nullable(),
    counts: z
      .object({
        mine: z.number().int().nonnegative(),
        group: z.number().int().nonnegative(),
        available: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export const taskDetailResponseSchema = z
  .object({ task: taskRowSchema })
  .strict();
export const taskMutationResponseSchema = taskDetailResponseSchema;
/** Task routes use the API's existing error envelope and safe error codes. */
export const taskErrorResponseSchema = apiErrorSchema;

export const taskMemberCandidateSchema = z
  .object({ id: z.uuid(), displayName: requiredText(200) })
  .strict();
export const taskMemberCandidatesResponseSchema = z
  .object({ users: z.array(taskMemberCandidateSchema).max(1_000) })
  .strict();
export const taskEligibleAssigneesResponseSchema = z
  .object({
    users: z.array(taskMemberCandidateSchema).max(1_000),
    groups: z
      .array(z.object({ id: z.uuid(), name: requiredText(100) }).strict())
      .max(1_000),
  })
  .strict();

export const assignTaskInputSchema = z
  .object({
    assigneeUserId: z.uuid().nullable(),
    groupId: z.uuid().nullable(),
    ...taskCommandFields,
  })
  .strict()
  .refine(({ assigneeUserId, groupId }) => !(assigneeUserId && groupId), {
    message: "Choose a user or group, not both",
  });
export const claimTaskInputSchema = z.object(taskCommandFields).strict();
export const releaseTaskInputSchema = claimTaskInputSchema;
export const delegateTaskInputSchema = z
  .object({
    substituteUserId: z.uuid(),
    expiresAt: utcZDateTimeSchema,
    ...taskCommandFields,
  })
  .strict();
export const revokeTaskDelegationInputSchema = claimTaskInputSchema;

export const taskGroupSchema = z
  .object({
    id: z.uuid(),
    name: requiredText(100),
    version: storedVersionSchema,
    memberCount: z.number().int().nonnegative(),
  })
  .strict();
export const taskGroupMemberSchema = z
  .object({ id: z.uuid(), displayName: requiredText(200) })
  .strict();
export const taskGroupsResponseSchema = z
  .object({ groups: z.array(taskGroupSchema).max(1_000) })
  .strict();
export const taskGroupDetailResponseSchema = z
  .object({
    group: taskGroupSchema,
    members: z.array(taskGroupMemberSchema).max(1_000),
  })
  .strict();
export const taskGroupMutationResponseSchema = z
  .object({ group: taskGroupSchema })
  .strict();
export const taskGroupParamsSchema = z.object({ groupId: z.uuid() }).strict();
export const taskGroupMemberParamsSchema = z
  .object({ groupId: z.uuid(), userId: z.uuid() })
  .strict();
export const createTaskGroupInputSchema = z
  .object({ name: requiredText(100), idempotencyKey: idempotencyKeySchema })
  .strict();
export const updateTaskGroupInputSchema = createTaskGroupInputSchema
  .extend({ expectedVersion: storedVersionSchema })
  .strict();
export const taskGroupMemberInputSchema = z
  .object({
    userId: z.uuid(),
    expectedVersion: storedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const removeTaskGroupMemberInputSchema = taskGroupMemberInputSchema
  .omit({ userId: true })
  .strict();

const taskAbsenceIntervalFields = {
  substituteUserId: z.uuid(),
  startsAt: utcZDateTimeSchema,
  endsAt: utcZDateTimeSchema,
};
const boundedInterval = ({
  startsAt,
  endsAt,
}: {
  startsAt: string;
  endsAt: string;
}) => {
  const duration = Date.parse(endsAt) - Date.parse(startsAt);
  return duration > 0 && duration <= 365 * 24 * 60 * 60 * 1_000;
};
export const taskAbsenceSchema = z
  .object({
    id: z.uuid(),
    userId: z.uuid(),
    ...taskAbsenceIntervalFields,
    version: storedVersionSchema,
  })
  .strict()
  .refine(boundedInterval, {
    path: ["endsAt"],
    message: "Absence must last between one moment and 365 days",
  });
export const taskAbsencesResponseSchema = z
  .object({ absences: z.array(taskAbsenceSchema).max(1_000) })
  .strict();
export const taskAbsenceMutationResponseSchema = z
  .object({ absence: taskAbsenceSchema.nullable() })
  .strict();
export const taskAbsenceParamsSchema = z
  .object({ absenceId: z.uuid() })
  .strict();
export const createTaskAbsenceInputSchema = z
  .object({
    ...taskAbsenceIntervalFields,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .refine(boundedInterval, {
    path: ["endsAt"],
    message: "Absence must last between one moment and 365 days",
  });
export const deleteTaskAbsenceInputSchema = z
  .object({
    expectedVersion: storedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
