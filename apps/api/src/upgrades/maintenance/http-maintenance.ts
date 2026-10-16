import type { Request, Response, NextFunction } from "express";
import { mountedMaintenanceGate } from "./maintenance-gate";
/** Counts response completion, not handler return; keep mounted before parsers. */
export function httpMaintenance(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (
    request.method === "GET" &&
    ["/api/v1/health", "/api/v1/health/ready"].includes(request.path)
  ) {
    next();
    return;
  }
  const release = mountedMaintenanceGate().enter();
  if (!release) {
    response.status(503).setHeader("Retry-After", "30");
    response.end();
    return;
  }
  response.once("finish", release);
  // A disconnected client does not cancel database/provider effects. Without
  // positive handler completion retain the lease and require reconciliation.
  next();
}
