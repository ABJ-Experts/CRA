import { Injectable, Optional } from "@nestjs/common";
import { z } from "zod";

import type {
  TenantScopeAccessOutcome,
  TenantScopeAccessPort,
} from "../application/tenant-scope-access.port";
import { SupabaseService } from "../../supabase/supabase.service";

const lifecycleRowSchema = z.object({ status: z.string() }).strict();
const ownerRowSchema = z.object({ role: z.literal("owner") }).strict();
const revocationRowSchema = z.object({ session_id: z.uuid() }).strict();
const settingsRowSchema = z
  .object({
    maximum_session_age_minutes: z.number().int().positive().nullable(),
  })
  .strict();

interface TenantScopeClock {
  now(): Date;
}

const systemClock: TenantScopeClock = Object.freeze({ now: () => new Date() });

/** Tenant-local access enforcement; it never changes the global user epoch. */
@Injectable()
export class SupabaseTenantScopeAccessAdapter implements TenantScopeAccessPort {
  constructor(
    private readonly supabase: SupabaseService,
    @Optional()
    private readonly clock: TenantScopeClock = systemClock,
  ) {}

  async authorize(
    scope: Readonly<{
      organizationId: string;
      userId: string;
      sessionId: string;
      issuedAt: string;
      allowRecovery: boolean;
    }>,
  ): Promise<TenantScopeAccessOutcome> {
    try {
      return scope.allowRecovery
        ? await this.authorizeRecovery(scope)
        : await this.authorizeActive(scope);
    } catch {
      return Object.freeze({ outcome: "unavailable" });
    }
  }

  private async authorizeRecovery(
    scope: Readonly<{
      organizationId: string;
      userId: string;
      sessionId: string;
      issuedAt: string;
    }>,
  ): Promise<TenantScopeAccessOutcome> {
    const client = this.supabase.admin();
    const lifecycle = await client
      .from("organization_lifecycles")
      .select("status")
      .eq("organization_id", scope.organizationId)
      .maybeSingle();
    if (lifecycle.error) return this.unavailable();
    if (!lifecycle.data) return this.notFound();
    const parsed = lifecycleRowSchema.safeParse(lifecycle.data);
    if (!parsed.success) return Object.freeze({ outcome: "malformed" });
    if (parsed.data.status === "active") {
      return this.authorizeActive(scope);
    }
    if (
      !["deactivated", "purge_scheduled", "purge_blocked"].includes(
        parsed.data.status,
      )
    ) {
      return Object.freeze({ outcome: "inactive" });
    }

    const membership = await client
      .from("organization_members")
      .select("role")
      .eq("organization_id", scope.organizationId)
      .eq("user_id", scope.userId)
      .maybeSingle();
    if (membership.error) return this.unavailable();
    if (!membership.data) return this.notFound();
    if (!ownerRowSchema.safeParse(membership.data).success) {
      return Object.freeze({ outcome: "not_found" });
    }
    return this.register(scope);
  }

  private async authorizeActive(
    scope: Readonly<{
      organizationId: string;
      userId: string;
      sessionId: string;
      issuedAt: string;
    }>,
  ): Promise<TenantScopeAccessOutcome> {
    const client = this.supabase.admin();
    const registered = await this.register(scope);
    if (registered.outcome !== "allowed") return registered;

    const lifecycle = await this.lifecycle(scope.organizationId);
    if (lifecycle.outcome !== "allowed") return lifecycle;

    const revocation = await client
      .from("organization_session_revocations")
      .select("session_id")
      .eq("organization_id", scope.organizationId)
      .eq("user_id", scope.userId)
      .eq("session_id", scope.sessionId)
      .maybeSingle();
    if (revocation.error) return this.unavailable();
    if (revocation.data) {
      return revocationRowSchema.safeParse(revocation.data).success
        ? Object.freeze({ outcome: "revoked" })
        : Object.freeze({ outcome: "malformed" });
    }

    const settings = await client
      .from("organization_settings")
      .select("maximum_session_age_minutes")
      .eq("organization_id", scope.organizationId)
      .maybeSingle();
    if (settings.error) return this.unavailable();
    if (!settings.data) return Object.freeze({ outcome: "allowed" });
    const parsed = settingsRowSchema.safeParse(settings.data);
    if (!parsed.success) return Object.freeze({ outcome: "malformed" });
    const maximumAge = parsed.data.maximum_session_age_minutes;
    if (maximumAge === null) return Object.freeze({ outcome: "allowed" });
    const issuedAt = new Date(scope.issuedAt).getTime();
    if (!Number.isFinite(issuedAt))
      return Object.freeze({ outcome: "malformed" });
    return this.clock.now().getTime() >= issuedAt + maximumAge * 60_000
      ? Object.freeze({ outcome: "expired" })
      : Object.freeze({ outcome: "allowed" });
  }

  private async register(
    scope: Readonly<{
      organizationId: string;
      userId: string;
      sessionId: string;
      issuedAt: string;
    }>,
  ): Promise<TenantScopeAccessOutcome> {
    const registered = await this.supabase
      .admin()
      .rpc("register_organization_session_atomic", {
        p_organization_id: scope.organizationId,
        p_user_id: scope.userId,
        p_session_id: scope.sessionId,
        p_issued_at: scope.issuedAt,
      });
    if (registered.error) return this.unavailable();
    if (
      !Array.isArray(registered.data) ||
      registered.data.length !== 1 ||
      registered.data[0]?.outcome !== "registered"
    ) {
      return registered.data?.[0]?.outcome === "not_found"
        ? this.notFound()
        : Object.freeze({ outcome: "malformed" });
    }
    return Object.freeze({ outcome: "allowed" });
  }

  private async lifecycle(
    organizationId: string,
  ): Promise<TenantScopeAccessOutcome> {
    const result = await this.supabase
      .admin()
      .from("organization_lifecycles")
      .select("status")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (result.error) return this.unavailable();
    if (!result.data) return this.notFound();
    const parsed = lifecycleRowSchema.safeParse(result.data);
    if (!parsed.success) return Object.freeze({ outcome: "malformed" });
    return parsed.data.status === "active"
      ? Object.freeze({ outcome: "allowed" })
      : Object.freeze({ outcome: "inactive" });
  }

  private unavailable(): TenantScopeAccessOutcome {
    return Object.freeze({ outcome: "unavailable" });
  }

  private notFound(): TenantScopeAccessOutcome {
    return Object.freeze({ outcome: "not_found" });
  }
}
