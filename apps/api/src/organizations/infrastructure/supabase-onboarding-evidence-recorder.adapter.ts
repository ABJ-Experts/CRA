import { Injectable } from "@nestjs/common";

import { SupabaseService } from "../../supabase/supabase.service";
import { OnboardingEvidenceRecorder } from "../application/onboarding-evidence-recorder.port";
import { OrganizationRepositoryError } from "../application/organization-repository.port";

interface RpcResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

interface OrganizationRpcClient {
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<RpcResult>;
}

/**
 * Supabase implementation of the inward evidence port. It never has a
 * browser-triggered completion method: each method is named for an
 * authoritative feature commit that has already happened.
 */
@Injectable()
export class SupabaseOnboardingEvidenceRecorder extends OnboardingEvidenceRecorder {
  constructor(private readonly supabase: SupabaseService) {
    super();
  }

  async recordProductCreated(
    orgId: string,
    productId: string,
    actorId: string,
  ): Promise<void> {
    await this.recordEvidence(orgId, "first_product", productId, actorId);
  }

  async recordSbomCreated(
    orgId: string,
    sbomId: string,
    actorId: string,
  ): Promise<void> {
    await this.recordEvidence(orgId, "first_sbom", sbomId, actorId);
  }

  async recordInvitationDelivery(
    orgId: string,
    invitationId: string,
    actorId: string,
  ): Promise<void> {
    const result = await this.rpc(
      "record_invitation_delivery_onboarding_atomic",
      Object.freeze({
        p_organization_id: orgId,
        p_invitation_id: invitationId,
        p_actor_user_id: actorId,
      }),
    );
    this.assertRecorded(result);
  }

  private async recordEvidence(
    orgId: string,
    stage: "first_product" | "first_sbom",
    resourceId: string,
    actorId: string,
  ): Promise<void> {
    const result = await this.rpc(
      "record_organization_onboarding_evidence_atomic",
      Object.freeze({
        p_organization_id: orgId,
        p_stage: stage,
        p_resource_id: resourceId,
        p_actor_user_id: actorId,
        p_available: true,
      }),
    );
    this.assertRecorded(result);
  }

  private async rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<RpcResult> {
    // Generated database types are refreshed from migrations separately. Keep
    // the temporary dynamic boundary in this one adapter helper, never at a
    // controller or application call site.
    const client = this.supabase.admin() as unknown as OrganizationRpcClient;
    try {
      return await client.rpc(name, args);
    } catch {
      throw new OrganizationRepositoryError("unavailable");
    }
  }

  private assertRecorded(result: RpcResult): void {
    if (result.error) throw new OrganizationRepositoryError("unavailable");
    if (!Array.isArray(result.data) || result.data.length !== 1) {
      throw new OrganizationRepositoryError("malformed");
    }
    const row: unknown = result.data[0];
    if (
      row === null ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      (row as Readonly<Record<string, unknown>>).outcome !== "recorded"
    )
      throw new OrganizationRepositoryError("malformed");
  }
}
