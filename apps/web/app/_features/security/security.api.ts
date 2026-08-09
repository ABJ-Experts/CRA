import {
  mfaConfirmInputSchema,
  mfaConfirmResponseSchema,
  mfaEnrollmentResponseSchema,
  mfaFactorsResponseSchema,
} from "@repo/contracts/auth/schemas";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { requestJson } from "../../_lib/http/api-client";

export const securityQueryKeys = Object.freeze({
  factors: Object.freeze(["mfa", "factors"] as const),
  all: Object.freeze(["mfa"] as const),
});

export class SecurityApi {
  listFactors(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/auth/mfa/factors",
      method: "GET",
      signal,
      schema: mfaFactorsResponseSchema,
    });
  }

  enroll(signal?: AbortSignal) {
    return requestJson({
      path: "/api/v1/auth/mfa/enroll",
      method: "POST",
      signal,
      schema: mfaEnrollmentResponseSchema,
    });
  }

  confirmEnrollment(factorId: string, code: string, signal?: AbortSignal) {
    return requestJson({
      path: "/api/v1/auth/mfa/enroll/confirm",
      method: "POST",
      body: { factorId, code },
      inputSchema: mfaConfirmInputSchema,
      signal,
      schema: mfaConfirmResponseSchema,
    });
  }
}

export const securityApi = Object.freeze(new SecurityApi());
