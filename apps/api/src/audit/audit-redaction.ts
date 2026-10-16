const REDACTED = "[REDACTED]";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slugPattern = /^[a-z0-9][a-z0-9._-]{0,119}$/i;

const referenceKeys = new Set([
  "actorId",
  "artifactId",
  "attemptId",
  "eventId",
  "evidenceVersionId",
  "factorId",
  "fieldId",
  "memberId",
  "organizationId",
  "productId",
  "requestId",
  "roleId",
  "runId",
  "sessionId",
  "sourceId",
  "submissionId",
  "userId",
]);
const codeKeys = new Set([
  "baseRole",
  "decision",
  "model",
  "outcome",
  "permissionKey",
  "promptVersion",
  "reasonCode",
  "role",
  "stage",
  "state",
  "status",
]);
const integerKeys = new Set([
  "attemptCount",
  "count",
  "newVersion",
  "oldVersion",
  "version",
]);
const booleanKeys = new Set([
  "active",
  "accepted",
  "enabled",
  "isActive",
  "isDeleted",
  "member",
  "verified",
]);

/** Project metadata to known non-content fields before it reaches SQL. */
export function redactAuditMetadata(
  input: Readonly<Record<string, unknown>> | null,
): Record<string, string | number | boolean | null> | null {
  if (input === null) return null;
  return Object.fromEntries(
    Object.entries(input)
      .slice(0, 64)
      .map(([key, value]) => {
        if (value === null) return [key, null];
        if (
          referenceKeys.has(key) &&
          typeof value === "string" &&
          uuidPattern.test(value)
        )
          return [key, value];
        if (
          codeKeys.has(key) &&
          typeof value === "string" &&
          slugPattern.test(value)
        )
          return [key, value];
        if (
          integerKeys.has(key) &&
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0
        )
          return [key, value];
        if (booleanKeys.has(key) && typeof value === "boolean")
          return [key, value];
        return [key, REDACTED];
      }),
  ) as Record<string, string | number | boolean | null>;
}
