import { Injectable } from "@nestjs/common";
import { supplierEvidenceEligibleSbomRequestsResponseSchema } from "@repo/contracts/supplier-evidence";

import { SupabaseService } from "../../supabase/supabase.service";
import type { SupplierEvidenceSbomRepository } from "../application/supplier-evidence-sbom.use-cases";
import {
  SupplierEvidenceForbiddenError,
  SupplierEvidenceUnavailableError,
} from "../application/supplier-evidence-use-cases";

type Rpc = Readonly<{
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<{ data: unknown; error: unknown }>>;
}>;

@Injectable()
export class SupabaseSupplierEvidenceSbomRepository implements SupplierEvidenceSbomRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async activate(
    input: Parameters<SupplierEvidenceSbomRepository["activate"]>[0],
  ) {
    const row = await this.row(
      "activate_supplier_evidence_sbom_session_atomic",
      {
        p_session_token_hash: input.sessionTokenHash,
        p_request_item_id: input.checklistItemId,
        p_sbom_session_token_hash: input.sbomSessionTokenHash,
      },
    );
    if (row.outcome === "created" || row.outcome === "replayed") {
      return { outcome: row.outcome } as const;
    }
    if (row.outcome === "not_found") return { outcome: "not_found" } as const;
    throw unavailable();
  }

  async eligible(
    organizationId: string,
    input: Parameters<SupplierEvidenceSbomRepository["eligible"]>[1],
  ) {
    const row = await this.row(
      "list_eligible_supplier_evidence_sbom_requests",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_supplier_id: input.supplierId,
        p_product_id: input.productId,
        p_limit: input.limit,
        p_cursor: input.cursor ?? null,
      },
    );
    if (row.outcome === "forbidden") throw new SupplierEvidenceForbiddenError();
    if (row.outcome !== "found") throw unavailable();
    return supplierEvidenceEligibleSbomRequestsResponseSchema.parse(row.result);
  }

  private async row(name: string, args: Readonly<Record<string, unknown>>) {
    const response = await (this.supabase.admin() as unknown as Rpc).rpc(
      name,
      args,
    );
    if (response.error || !Array.isArray(response.data)) throw unavailable();
    const value: unknown = response.data[0];
    if (typeof value !== "object" || value === null) throw unavailable();
    const row = value as Record<string, unknown>;
    if (typeof row.outcome !== "string") throw unavailable();
    return row;
  }
}

function unavailable() {
  return new SupplierEvidenceUnavailableError(
    "Supplier SBOM operation unavailable.",
  );
}
