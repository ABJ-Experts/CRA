import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  DashboardNotFoundError,
  DashboardUnavailableError,
  type DashboardReadPort,
} from "../application/dashboard-read.port";

const envelopeSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("found"),
      result: z.record(z.string(), z.unknown()),
      nextPosition: z.record(z.string(), z.unknown()).nullable().default(null),
    })
    .strict(),
  z.object({ outcome: z.enum(["not_found", "forbidden"]) }).strict(),
]);
type Client = {
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<{ data: unknown; error: unknown }>;
};

@Injectable()
export class SupabaseDashboardRepository implements DashboardReadPort {
  private readonly logger = new Logger(SupabaseDashboardRepository.name);

  constructor(private readonly supabase: SupabaseService) {}

  async read(orgId: string, input: Parameters<DashboardReadPort["read"]>[1]) {
    let classification = "provider_unavailable";
    try {
      const response = await (this.supabase.admin() as unknown as Client).rpc(
        "get_dashboard_projection",
        {
          p_organization_id: orgId,
          p_actor_user_id: input.actorId,
          p_endpoint: input.endpoint,
          p_filters: input.filters,
        },
      );
      if (response.error) {
        const code =
          typeof response.error === "object" && "code" in response.error
            ? response.error.code
            : undefined;
        if (code === "57014" || code === "PGRST003")
          classification = "provider_timeout";
        throw new DashboardUnavailableError();
      }
      const raw: unknown =
        Array.isArray(response.data) && response.data.length === 1
          ? response.data[0]
          : response.data;
      const envelope = envelopeSchema.parse(raw);
      if (envelope.outcome !== "found") throw new DashboardNotFoundError();
      return { result: envelope.result, nextPosition: envelope.nextPosition };
    } catch (error) {
      if (error instanceof DashboardNotFoundError) throw error;
      try {
        this.logger.warn({
          endpoint: input.endpoint,
          classification:
            error instanceof z.ZodError
              ? "provider_contract_invalid"
              : classification,
        });
      } catch {
        // Logging is observational; retain the sanitized provider failure.
      }
      throw new DashboardUnavailableError("Dashboard temporarily unavailable");
    }
  }
}
