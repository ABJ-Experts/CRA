import {
  Injectable,
  ForbiddenException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import type { AuthedRequest } from "../../auth/auth.types";
import { licensingHttp } from "./licensing-http";
import { LicensingService } from "../application/licensing.service";
import { getLicenceRouteOperation } from "../operations/licence-operation.registry";
/** Runs after authentication and RBAC. Source workflows recheck inside their own transactional authority. */
@Injectable()
export class LicensingGuard implements CanActivate {
  constructor(private readonly licensing: LicensingService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const operation = getLicenceRouteOperation(
      context.getClass().name,
      context.getHandler().name,
    );
    if (!operation)
      throw new ForbiddenException({
        code: "license_operation_unclassified",
        message: "Route licence policy is not classified",
      });
    if (
      ["evidence", "security", "protective", "renewal"].includes(operation.kind)
    )
      return true;
    // The global guard precedes schema pipes and source-credential guards; it cannot trust raw bodies.
    // These explicit classes use parsed source/application authority and the DB gate instead.
    if (
      ["source", "mixed", "regulatory", "admission-finalization"].includes(
        operation.kind,
      )
    )
      return true;
    const user = context.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user?.organizationId)
      throw new ForbiddenException({
        code: "forbidden",
        message: "A verified tenant identity is required",
      });
    await licensingHttp(() =>
      this.licensing.assertOperation(user.organizationId!, user.id, operation),
    );
    return true;
  }
}
