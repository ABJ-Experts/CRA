import { Controller, Get } from "@nestjs/common";
import {
  livenessResponseSchema,
  readinessResponseSchema,
} from "@repo/contracts/system/schemas";
import type {
  LivenessResponse,
  ReadinessResponse,
} from "@repo/contracts/system/types";

import {
  boundedProbe,
  collectBounded,
} from "../system-health/application/bounded-probe";

import { Public } from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { ReportingDeadlineMonitorHealthUseCases } from "../reporting/application/reporting-deadline-monitor-health.port";
import { SupabaseService } from "../supabase/supabase.service";
import { AuditService } from "../audit/audit.service";

/**
 * Liveness and readiness.
 *
 * This replaces the `nest new` AppController, whose `GET /` returning
 * "Hello World!" would 401 the moment the global auth guard lands in the next
 * phase — an unexplained break in a route nobody meant to keep.
 *
 * It stays deliberately unauthenticated and is listed in `public-routes.spec.ts`
 * as an intentional exemption, so the suite always has one guaranteed-open
 * target to assert against.
 */
@Public()
@Controller("health")
export class HealthController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly reportingDeadlineMonitor: ReportingDeadlineMonitorHealthUseCases,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ZodResponse(livenessResponseSchema)
  liveness(): LivenessResponse {
    return { status: "ok", uptime: Math.round(process.uptime()) };
  }

  @Get("ready")
  @ZodResponse(readinessResponseSchema)
  async readiness(): Promise<ReadinessResponse> {
    const databaseProbe = await boundedProbe((signal) =>
      this.supabase.ping(signal),
    );
    const database = databaseProbe.outcome === "ready" && databaseProbe.value;
    const dependent = database
      ? await collectBounded([
          (signal) => this.reportingDeadlineMonitor.isReady(signal),
          (signal) => this.audit.isReady(signal),
        ])
      : [];
    const reportingMonitor =
      dependent[0]?.outcome === "ready" && dependent[0].value;
    const audit =
      dependent[1]?.outcome === "ready" ? dependent[1].value : false;
    return {
      status: database && reportingMonitor && audit ? "ok" : "degraded",
      database,
      audit,
    };
  }
}
