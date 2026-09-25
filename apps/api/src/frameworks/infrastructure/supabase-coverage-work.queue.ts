import { Injectable, ServiceUnavailableException } from "@nestjs/common";

import { SupabaseService } from "../../supabase/supabase.service";
import type {
  CoverageScope,
  CoverageWorkQueue,
} from "../application/coverage-recalculation-worker";

const unavailable = () =>
  new ServiceUnavailableException({
    message: "Framework coverage processing is unavailable.",
    code: "framework_coverage_unavailable",
  });

@Injectable()
export class SupabaseCoverageWorkQueue implements CoverageWorkQueue {
  constructor(private readonly supabase: SupabaseService) {}

  async claim(workerId: string): Promise<CoverageScope | null> {
    const { data, error } = await this.supabase
      .admin()
      .rpc("m10_claim_coverage_scope", {
        p_worker_id: workerId,
      });
    if (error || !data) throw unavailable();
    const row = data[0];
    return row
      ? {
          organizationId: row.organization_id,
          productId: row.product_id,
          packKey: row.pack_key,
          versionKey: row.version_key,
        }
      : null;
  }

  async recalculate(orgId: string, workerId: string, scope: CoverageScope) {
    if (orgId !== scope.organizationId) throw unavailable();
    const { data, error } = await this.supabase
      .admin()
      .rpc("m10_recalculate_coverage_scope", {
        p_worker_id: workerId,
        p_organization_id: orgId,
        p_product_id: scope.productId,
        p_pack_key: scope.packKey,
        p_version_key: scope.versionKey,
      });
    if (error || !["current", "lease_lost", "unavailable"].includes(data ?? ""))
      throw unavailable();
    return data as "current" | "lease_lost" | "unavailable";
  }

  async fail(
    orgId: string,
    workerId: string,
    scope: CoverageScope,
    reason: string,
  ): Promise<void> {
    if (orgId !== scope.organizationId) throw unavailable();
    const { data, error } = await this.supabase
      .admin()
      .rpc("m10_fail_coverage_scope", {
        p_worker_id: workerId,
        p_organization_id: orgId,
        p_product_id: scope.productId,
        p_pack_key: scope.packKey,
        p_version_key: scope.versionKey,
        p_error: reason,
      });
    if (error || (data !== "retry" && data !== "lease_lost"))
      throw unavailable();
  }
}
