import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type { AuditEventInput } from "@repo/contracts/audit/types";
import { z } from "zod";

export type AuthAuditContext = Readonly<{
  correlationId?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}>;

type AuditResult = Readonly<{
  outcome: "inserted" | "replayed" | "conflict";
  auditId: string | null;
}>;

export interface AuthAuditWriter {
  recordV2(organizationId: null, event: AuditEventInput): Promise<AuditResult>;
}

export type AuthAuditAttempt = Readonly<{
  action: string;
  operationId: string;
  actorId: string | null;
  correlationId: string;
  context: AuthAuditContext;
}>;

export class AuthAuditUnavailableError extends Error {
  constructor() {
    super("security audit unavailable");
    this.name = "AuthAuditUnavailableError";
  }
}

/** Keeps provider-facing auth operations independent of the audit adapter. */
export class AuthSecurityAudit {
  constructor(
    private readonly writer: AuthAuditWriter,
    private readonly newId: () => string = randomUUID,
  ) {}

  async beginCritical(
    action: string,
    actorId: string | null,
    context: AuthAuditContext = {},
  ): Promise<AuthAuditAttempt> {
    const operationId = this.newId();
    const correlationId = z.uuid().safeParse(context.correlationId).success
      ? context.correlationId!
      : operationId;
    const attempt = Object.freeze({
      action,
      operationId,
      actorId,
      correlationId,
      context,
    });
    await this.recordRequired(attempt, "intent", null);
    return attempt;
  }

  async finishCritical(
    attempt: AuthAuditAttempt,
    outcome: "completed" | "failed" | "denied",
    reason: string | null,
    resolvedActorId?: string | null,
  ): Promise<void> {
    await this.recordRequired(
      resolvedActorId
        ? Object.freeze({ ...attempt, actorId: resolvedActorId })
        : attempt,
      outcome,
      reason,
    );
  }

  async recordBestEffort(
    action: string,
    outcome: "intent" | "completed" | "failed" | "denied",
    actorId: string | null,
    context: AuthAuditContext = {},
    reason: string | null = null,
  ): Promise<boolean> {
    const operationId = this.newId();
    const attempt = Object.freeze({
      action,
      operationId,
      actorId,
      correlationId: z.uuid().safeParse(context.correlationId).success
        ? context.correlationId!
        : operationId,
      context,
    });
    try {
      const result = await this.writer.recordV2(
        null,
        this.event(attempt, outcome, reason),
      );
      return result.outcome !== "conflict";
    } catch {
      return false;
    }
  }

  private async recordRequired(
    attempt: AuthAuditAttempt,
    outcome: "intent" | "completed" | "failed" | "denied",
    reason: string | null,
  ): Promise<void> {
    try {
      const result = await this.writer.recordV2(
        null,
        this.event(attempt, outcome, reason),
      );
      if (result.outcome === "conflict") throw new AuthAuditUnavailableError();
    } catch {
      throw new AuthAuditUnavailableError();
    }
  }

  private event(
    attempt: AuthAuditAttempt,
    outcome: "intent" | "completed" | "failed" | "denied",
    reason: string | null,
  ): AuditEventInput {
    return Object.freeze({
      organizationId: null,
      scope: "security",
      eventKey: `${attempt.action}:${attempt.operationId}:${outcome}`,
      actorType: attempt.actorId ? "user" : "system",
      actorId: attempt.actorId ?? "anonymous",
      // The stable actor text survives deletion or pseudonymisation. The FK
      // must not make security evidence unavailable after an account vanishes.
      userId: null,
      action: attempt.action,
      entityType: "auth_security",
      entityId: attempt.actorId ?? "anonymous",
      outcome,
      correlationId: attempt.correlationId,
      beforeRedacted: null,
      afterRedacted: null,
      reason,
      ipAddress:
        attempt.context.ipAddress && isIP(attempt.context.ipAddress)
          ? attempt.context.ipAddress
          : null,
      userAgent: attempt.context.userAgent?.slice(0, 512) ?? null,
    });
  }
}
