import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";

import {
  SBOM_CI_CREDENTIALS,
  type SbomCiCredentialPort,
} from "./application/sbom-ci-credential.port";

export type SbomCiPrincipal = Readonly<{
  organizationId: string;
  credentialId: string;
}>;
export interface SbomCiRequest extends Request {
  sbomCiPrincipal?: SbomCiPrincipal;
}

/**
 * CI uses a narrow credential, never a browser session. Controllers receiving
 * it are explicitly @Public so the global session guard does not preempt this
 * guard; the public-route allowlist pins those two routes.
 */
@Injectable()
export class SbomCiCredentialGuard implements CanActivate {
  constructor(
    @Inject(SBOM_CI_CREDENTIALS)
    private readonly credentials: SbomCiCredentialPort,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SbomCiRequest>();
    const token = bearer(request.headers.authorization);
    if (!token)
      throw new UnauthorizedException({
        message: "CI credential is required.",
        code: "ci_credential_invalid",
      });
    try {
      const principal = await this.credentials.authenticate(token);
      if (!principal)
        throw new UnauthorizedException({
          message: "CI credential is not valid.",
          code: "ci_credential_invalid",
        });
      request.sbomCiPrincipal = principal;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException({
        message: "CI authentication is temporarily unavailable.",
        code: "unavailable",
      });
    }
  }
}

function bearer(value: string | undefined): string | null {
  const match = /^Bearer ([A-Za-z0-9._~-]{32,512})$/.exec(value ?? "");
  return match?.[1] ?? null;
}
