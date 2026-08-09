import { Controller, Get } from "@nestjs/common";

import { Public } from "../auth/auth.types";
import { SupabaseService } from "../supabase/supabase.service";

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
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  liveness(): { status: "ok"; uptime: number } {
    return { status: "ok", uptime: Math.round(process.uptime()) };
  }

  @Get("ready")
  async readiness(): Promise<{ status: "ok" | "degraded"; database: boolean }> {
    const database = await this.supabase.ping();
    return { status: database ? "ok" : "degraded", database };
  }
}
