import type { AuthedRequest } from "./auth.types";
import type { AuthAuditContext } from "./application/auth-security-audit";

/** req.ip is set by Express after the configured trusted-proxy policy. */
export const authRequestAuditContext = (
  request: AuthedRequest,
): AuthAuditContext =>
  Object.freeze({
    correlationId:
      typeof request.headers["x-correlation-id"] === "string"
        ? request.headers["x-correlation-id"]
        : undefined,
    ipAddress: request.ip ?? null,
    userAgent:
      typeof request.headers["user-agent"] === "string"
        ? request.headers["user-agent"]
        : null,
  });
