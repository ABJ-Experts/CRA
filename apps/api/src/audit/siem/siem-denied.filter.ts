import { createHash, randomUUID } from "node:crypto";
import {
  Catch,
  ForbiddenException,
  NotFoundException,
  Injectable,
  type ExceptionFilter,
  type ArgumentsHost,
  ServiceUnavailableException,
} from "@nestjs/common";
import { z } from "zod";
import type { AuthedRequest } from "../../auth/auth.types";
import { AllExceptionsFilter } from "../../common/filters/all-exceptions.filter";
import { SupabaseSiemRepository } from "./infrastructure/supabase-siem.repository";
@Catch(ForbiddenException, NotFoundException)
@Injectable()
export class SiemDeniedFilter implements ExceptionFilter {
  private readonly delegate = new AllExceptionsFilter();
  constructor(private readonly repository: SupabaseSiemRepository) {}
  async catch(
    exception: ForbiddenException | NotFoundException,
    host: ArgumentsHost,
  ) {
    const request = host.switchToHttp().getRequest<AuthedRequest>();
    if (request.user?.organizationId) {
      const body = request.body as { requestId?: unknown } | undefined;
      const requestId = z
        .uuid()
        .safeParse(body?.requestId ?? request.query.requestId);
      try {
        await this.repository.command(
          request.user.organizationId,
          request.user.id,
          "denial",
          null,
          {
            requestId: requestId.success ? requestId.data : randomUUID(),
            operationDigest: createHash("sha256")
              .update(
                JSON.stringify({
                  method: request.method.slice(0, 16),
                  path: request.path.slice(0, 512),
                }),
              )
              .digest("hex"),
          },
        );
      } catch {
        this.delegate.catch(
          new ServiceUnavailableException({
            message: "SIEM unavailable",
            code: "unavailable",
          }),
          host,
        );
        return;
      }
    }
    this.delegate.catch(exception, host);
  }
}
