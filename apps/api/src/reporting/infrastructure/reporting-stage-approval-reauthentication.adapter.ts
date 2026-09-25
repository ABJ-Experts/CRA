import { Injectable } from "@nestjs/common";

import { AuthService } from "../../auth/auth.service";
import { MfaService } from "../../auth/mfa/mfa.service";
import type { ReportingStageApprovalReauthenticationPort } from "../application/reporting-obligation.port";

/** Verifies fresh credentials without retaining them beyond this provider call. */
@Injectable()
export class ExistingAuthReportingStageApprovalReauthenticationAdapter implements ReportingStageApprovalReauthenticationPort {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
  ) {}

  async verify(
    input: Readonly<{
      email: string;
      password: string;
      accessToken: string;
      actorId: string;
      mfaCode?: string;
    }>,
  ) {
    try {
      if (!(await this.auth.verifyPassword(input.email, input.password)))
        return { outcome: "invalid" as const };
      if (!(await this.mfa.hasVerifiedFactor(input.accessToken)))
        return { outcome: "verified" as const };
      if (!input.mfaCode) return { outcome: "mfa_required" as const };
      await this.mfa.verify(input.accessToken, input.actorId, input.mfaCode);
      return { outcome: "verified" as const };
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "getStatus" in error
          ? (error as { getStatus(): number }).getStatus()
          : 503;
      return {
        outcome:
          status >= 500 ? ("unavailable" as const) : ("invalid" as const),
      };
    }
  }
}
