import { z } from "zod";

const metadataSchema = z
  .record(z.string().min(1).max(80), z.unknown())
  .nullable();
const identifierSchema = z.string().min(1).max(200);
const eventKeySchema = z
  .string()
  .min(8)
  .max(200)
  .refine(
    (value) =>
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(
        value,
      ),
    "Event key requires a UUID component",
  );
export const auditRequestIdSchema = z.uuid();

export const auditEventInputSchema = z
  .object({
    organizationId: z.uuid().nullable(),
    scope: z.enum(["organization", "security"]),
    eventKey: eventKeySchema,
    actorType: z.enum(["user", "service_account", "system", "ai", "operator"]),
    actorId: identifierSchema,
    userId: z.uuid().nullable(),
    action: z.string().regex(/^[a-z][a-z0-9_.]{0,119}$/),
    entityType: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
    entityId: identifierSchema,
    outcome: z.enum(["intent", "completed", "failed", "denied"]),
    correlationId: auditRequestIdSchema,
    beforeRedacted: metadataSchema,
    afterRedacted: metadataSchema,
    reason: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,79}$/)
      .nullable(),
    ipAddress: z.union([z.ipv4(), z.ipv6()]).nullable(),
    userAgent: z.string().max(512).nullable(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.scope === "organization" && event.organizationId === null) {
      context.addIssue({
        code: "custom",
        message: "Organization scope requires organizationId",
      });
    }
    if (event.scope === "security" && event.organizationId !== null) {
      context.addIssue({
        code: "custom",
        message: "Security scope cannot carry organizationId",
      });
    }
  });
