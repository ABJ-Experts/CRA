import { createHash, randomUUID } from "node:crypto";
import {
  ArgumentsHost,
  Catch,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  type ExceptionFilter,
} from "@nestjs/common";
import type { AuthedRequest } from "../../auth/auth.types";
import { AllExceptionsFilter } from "../../common/filters/all-exceptions.filter";
import {
  AUDIT_RANGE_REPOSITORY,
  type AuditRangeRepository,
} from "./application/audit-range.port";
import { z } from "zod";
@Catch(ForbiddenException, NotFoundException)
@Injectable()
export class AuditRangeDeniedFilter implements ExceptionFilter {
  private readonly delegate = new AllExceptionsFilter();
  constructor(
    @Inject(AUDIT_RANGE_REPOSITORY)
    private readonly repository: AuditRangeRepository,
  ) {}
  async catch(
    exception: ForbiddenException | NotFoundException,
    host: ArgumentsHost,
  ): Promise<void> {
    const request = host.switchToHttp().getRequest<AuthedRequest>();
    const user = request.user;
    if (user?.organizationId) {
      const body = request.body as { requestId?: unknown } | undefined;
      const requestId = z
        .uuid()
        .safeParse(request.query.requestId ?? body?.requestId);
      const route = request.route as { path?: unknown } | undefined;
      const safeRoute =
        typeof route?.path === "string"
          ? route.path
          : "audit/chain-verifications";
      const digest = createHash("sha256")
        .update(JSON.stringify({ method: request.method, route: safeRoute }))
        .digest("hex");
      try {
        await this.repository.recordDenial(
          user.organizationId,
          user.id,
          requestId.success ? requestId.data : randomUUID(),
          digest,
        );
      } catch {
        this.delegate.catch(
          new ServiceUnavailableException({
            message: "Audit verification is unavailable",
            code: "audit_unavailable",
          }),
          host,
        );
        return;
      }
    }
    this.delegate.catch(exception, host);
  }
}
