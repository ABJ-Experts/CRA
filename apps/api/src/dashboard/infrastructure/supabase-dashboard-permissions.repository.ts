import { Injectable, Logger } from "@nestjs/common";
import {
  BASE_ROLES,
  resolveEffectivePermissions,
  type BaseRole,
} from "@repo/contracts/permissions";
import { z } from "zod";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  DashboardForbiddenError,
  DashboardUnavailableError,
  type DashboardPermissionsPort,
} from "../application/dashboard-read.port";

const contextSchema = z
  .object({
    organizationId: z.uuid(),
    userId: z.uuid(),
    role: z.enum(BASE_ROLES),
    permissionVersion: z.number().int().positive(),
    customRoles: z.array(
      z
        .object({
          id: z.uuid(),
          name: z.string(),
          base_role: z.enum(BASE_ROLES),
          permissions: z.unknown().refine((value) => value !== undefined),
          is_active: z.boolean(),
          is_deleted: z.boolean(),
        })
        .strict(),
    ),
    baseRoleOverrides: z.unknown().refine((value) => value !== undefined),
  })
  .strict();
const envelopeSchema = z.discriminatedUnion("outcome", [
  z
    .object({ outcome: z.literal("available"), context: contextSchema })
    .strict(),
  z.object({ outcome: z.enum(["not_found", "unavailable"]) }).strict(),
]);
@Injectable()
export class SupabaseDashboardPermissionsRepository implements DashboardPermissionsPort {
  private readonly logger = new Logger(
    SupabaseDashboardPermissionsRepository.name,
  );
  constructor(private readonly supabase: SupabaseService) {}
  async snapshot(orgId: string, actorId: string, role: BaseRole) {
    let classification = "provider_unavailable";
    try {
      const response = await this.supabase
        .admin()
        .rpc("get_dashboard_permission_context", {
          p_organization_id: orgId,
          p_actor_user_id: actorId,
          p_expected_role: role,
        });
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
      const parsed = envelopeSchema.parse(raw);
      if (parsed.outcome === "not_found") throw new DashboardForbiddenError();
      if (parsed.outcome !== "available") throw new DashboardUnavailableError();
      const context = parsed.context;
      if (context.organizationId !== orgId || context.userId !== actorId)
        throw new DashboardUnavailableError();
      if (context.role !== role) throw new DashboardForbiddenError();
      return Object.freeze({
        version: context.permissionVersion,
        permissions: Object.freeze(
          resolveEffectivePermissions({
            baseRole: context.role,
            customRoles: context.customRoles,
            baseRoleOverrides: context.baseRoleOverrides,
          }),
        ),
      });
    } catch (error) {
      if (error instanceof DashboardForbiddenError) throw error;
      try {
        this.logger.warn({
          endpoint: "permissions",
          classification:
            error instanceof z.ZodError
              ? "provider_contract_invalid"
              : classification,
        });
      } catch {
        /* Observability must retain the sanitized provider failure. */
      }
      throw new DashboardUnavailableError("Dashboard temporarily unavailable");
    }
  }
}
