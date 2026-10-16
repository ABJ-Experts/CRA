import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import type { Json } from "../../supabase/database.types";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  DashboardForbiddenError,
  DashboardInvalidCursorError,
  DashboardNotFoundError,
  DashboardUnavailableError,
} from "../application/dashboard-read.port";
import {
  PortfolioScopeChangedError,
  type PortfolioReadPort,
} from "../application/portfolio-read.port";
const envelopeSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("found"),
      result: z.record(z.string(), z.unknown()),
      nextPosition: z.record(z.string(), z.unknown()).nullable(),
      revision: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      outcome: z.enum([
        "not_found",
        "forbidden",
        "scope_changed",
        "invalid_request",
      ]),
    })
    .strict(),
]);
@Injectable()
export class SupabasePortfolioRepository implements PortfolioReadPort {
  private readonly logger = new Logger(SupabasePortfolioRepository.name);
  constructor(private readonly supabase: SupabaseService) {}
  async read(orgId: string, input: Parameters<PortfolioReadPort["read"]>[1]) {
    try {
      const response = await this.supabase
        .admin()
        .rpc("get_portfolio_projection", {
          p_org: orgId,
          p_actor: input.actorId,
          p_endpoint: input.endpoint,
          p_filters: input.filters as Json,
        });
      if (response.error) throw new Error();
      const raw: unknown =
        Array.isArray(response.data) && response.data.length === 1
          ? response.data[0]
          : response.data;
      const envelope = envelopeSchema.parse(raw);
      if (envelope.outcome === "not_found") throw new DashboardNotFoundError();
      if (envelope.outcome === "forbidden") throw new DashboardForbiddenError();
      if (envelope.outcome === "scope_changed")
        throw new PortfolioScopeChangedError();
      if (envelope.outcome === "invalid_request")
        throw new DashboardInvalidCursorError();
      if (envelope.outcome !== "found") throw new Error();
      return {
        result: envelope.result,
        nextPosition: envelope.nextPosition,
        revision: envelope.revision,
      };
    } catch (error) {
      if (
        error instanceof DashboardNotFoundError ||
        error instanceof DashboardForbiddenError ||
        error instanceof PortfolioScopeChangedError ||
        error instanceof DashboardInvalidCursorError
      )
        throw error;
      try {
        this.logger.warn({
          endpoint: input.endpoint,
          classification:
            error instanceof z.ZodError
              ? "provider_contract_invalid"
              : "provider_unavailable",
        });
      } catch {
        /* Preserve sanitized failure if diagnostics are unavailable. */
      }
      throw new DashboardUnavailableError("Portfolio temporarily unavailable");
    }
  }
}
