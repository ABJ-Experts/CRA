import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  DashboardNotFoundError,
  DashboardUnavailableError,
} from "../application/dashboard-read.port";
import { DashboardDatasetConflictError } from "../application/dashboard-trends.port";
import type { DashboardTrendsReadPort } from "../application/dashboard-trends.port";
const envelope = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("found"),
      result: z.unknown(),
      snapshot: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({ outcome: z.enum(["not_found", "forbidden", "conflict"]) })
    .strict(),
]);
@Injectable()
export class SupabaseDashboardTrendsRepository implements DashboardTrendsReadPort {
  constructor(private readonly supabase: SupabaseService) {}
  async read(
    orgId: string,
    input: Parameters<DashboardTrendsReadPort["read"]>[1],
  ) {
    try {
      const client = this.supabase.admin();
      const response = await client.rpc(
        input.endpoint === "trends"
          ? "get_dashboard_trends"
          : "get_dashboard_trend_sources",
        {
          p_organization_id: orgId,
          p_actor_user_id: input.actorId,
          p_filters: z.json().parse(input.filters),
          p_snapshot: input.snapshot ? z.json().parse(input.snapshot) : null,
        },
      );
      if (response.error) throw new DashboardUnavailableError();
      const parsed = envelope.parse(response.data);
      if (parsed.outcome === "conflict")
        throw new DashboardDatasetConflictError();
      if (parsed.outcome !== "found") throw new DashboardNotFoundError();
      return { result: parsed.result, snapshot: parsed.snapshot };
    } catch (error) {
      if (
        error instanceof DashboardDatasetConflictError ||
        error instanceof DashboardNotFoundError
      )
        throw error;
      throw new DashboardUnavailableError();
    }
  }
}
