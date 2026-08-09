import { z } from "zod";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { requestJson } from "../../_lib/http/api-client";

const factorsResponseSchema = z.object({ enrolled: z.boolean() }).strict();
const enrollResponseSchema = z
  .object({
    factorId: z.string().min(1),
    qrCode: z.string().min(1),
    secret: z.string().min(1),
    uri: z.string().min(1),
  })
  .strict();
const confirmEnrollmentResponseSchema = z
  .object({ recoveryCodes: z.array(z.string().min(1)) })
  .strict();

export const securityQueryKeys = Object.freeze({
  factors: Object.freeze(["mfa", "factors"] as const),
  all: Object.freeze(["mfa"] as const),
});

export const securityApi = Object.freeze({
  listFactors(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/auth/mfa/factors",
      method: "GET",
      signal,
      schema: factorsResponseSchema,
    });
  },

  enroll(signal?: AbortSignal) {
    return requestJson({
      path: "/api/v1/auth/mfa/enroll",
      method: "POST",
      signal,
      schema: enrollResponseSchema,
    });
  },

  confirmEnrollment(factorId: string, code: string, signal?: AbortSignal) {
    return requestJson({
      path: "/api/v1/auth/mfa/enroll/confirm",
      method: "POST",
      body: { factorId, code },
      signal,
      schema: confirmEnrollmentResponseSchema,
    });
  },
});
