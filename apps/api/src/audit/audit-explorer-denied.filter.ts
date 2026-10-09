import { randomUUID } from "node:crypto";

import {
  ArgumentsHost,
  Catch,
  ForbiddenException,
  Inject,
  NotFoundException,
  Injectable,
  ServiceUnavailableException,
  type ExceptionFilter,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import type { AuthedRequest, RequestUser } from "../auth/auth.types";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import {
  AUDIT_EXPLORER_REPOSITORY,
  type AuditExplorerRepository,
} from "./application/audit-explorer.port";
import { AuditExplorerTokenService } from "./audit-explorer-token.service";

@Catch(ForbiddenException, NotFoundException)
@Injectable()
export class AuditExplorerDeniedFilter implements ExceptionFilter {
  private readonly delegate = new AllExceptionsFilter();

  constructor(
    @Inject(AUDIT_EXPLORER_REPOSITORY)
    private readonly repository: AuditExplorerRepository,
    private readonly tokens: AuditExplorerTokenService,
  ) {}

  async catch(
    exception: ForbiddenException | NotFoundException,
    host: ArgumentsHost,
  ): Promise<void> {
    const request = host.switchToHttp().getRequest<Request & AuthedRequest>();
    const user = request.user;
    if (!user?.organizationId) {
      this.delegate.catch(exception, host);
      return;
    }

    try {
      await this.recordDenied(user, request, readRequestId(request));
    } catch {
      this.delegate.catch(
        new ServiceUnavailableException({
          message: "Audit explorer is unavailable",
          code: "unavailable",
        }),
        host,
      );
      return;
    }
    this.delegate.catch(exception, host);
  }

  private async recordDenied(
    user: RequestUser,
    request: Request,
    requestId: string,
  ): Promise<void> {
    await this.repository.recordDenial({
      organizationId: user.organizationId!,
      actorId: user.id,
      requestId,
      operationDigest: this.tokens.digest({
        method: request.method,
        route: routePath(request),
        queryKeys: boundedKeys(request.query),
        bodyKeys: boundedKeys(request.body),
      }),
    });
  }
}

function routePath(request: Request): string {
  const route = request.route as { path?: unknown } | undefined;
  return typeof route?.path === "string" ? route.path : request.path;
}

function readRequestId(request: Request): string {
  const queryValue = (request.query as Record<string, unknown>).requestId;
  if (
    typeof queryValue === "string" &&
    z.uuid().safeParse(queryValue).success
  ) {
    return queryValue;
  }
  const body = request.body as { requestId?: unknown } | undefined;
  if (
    typeof body?.requestId === "string" &&
    z.uuid().safeParse(body.requestId).success
  ) {
    return body.requestId;
  }
  return randomUUID();
}

function boundedKeys(value: unknown): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value).sort().slice(0, 20);
}
