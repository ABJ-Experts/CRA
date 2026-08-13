import { Injectable } from "@nestjs/common";
import {
  organizationBrandingDraftSchema,
  organizationBrandingSchema,
  type OrganizationBranding,
  type OrganizationBrandingDraft,
  type PublishOrganizationBrandingInput,
  type RemoveOrganizationBrandingInput,
  type UpdateOrganizationBrandingDraftInput,
} from "@repo/contracts/organizations";

import { SupabaseService } from "../../../supabase/supabase.service";
import {
  BrandingProviderError,
  type BrandingAssetFinalization,
  type BrandingAssetFinalizationOutcome,
  type BrandingAssetReservation,
  type BrandingPublishOutcome,
  type BrandingRepository,
  type BrandingWriteOutcome,
  type FoundBranding,
} from "../application/branding-use-cases";

type ProviderRow = Readonly<Record<string, unknown>>;
type ProviderResult = Readonly<{
  data: unknown;
  error: Readonly<{ message: string }> | null;
}>;

interface BrandingRpcClient {
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ProviderResult>;
}

const FOUND_OUTCOMES = new Set(["found", "not_found"]);
const RESERVE_OUTCOMES = new Set(["reserved", "not_found"]);
const WRITE_OUTCOMES = new Set([
  "updated",
  "conflict",
  "invalid_request",
  "not_found",
]);
const FINALIZE_OUTCOMES = new Set([
  "finalized",
  "invalid_request",
  "not_found",
]);
const PUBLISH_OUTCOMES = new Set([
  "published",
  "removed",
  "conflict",
  "invalid_request",
  "not_found",
]);

@Injectable()
export class SupabaseBrandingRepository implements BrandingRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async getResolved(orgId: string, actorId: string): Promise<FoundBranding> {
    return this.readBranding("get_organization_branding", orgId, actorId);
  }

  async getDraft(orgId: string, actorId: string): Promise<FoundBranding> {
    return this.readBranding("get_organization_branding_draft", orgId, actorId);
  }

  async getRenderableLogo(orgId: string, actorId: string) {
    const row = await this.singleRpc("get_organization_branding_logo_render", {
      p_organization_id: orgId,
      p_actor_user_id: actorId,
    });
    const outcome = this.outcome(row, FOUND_OUTCOMES);
    if (outcome === "not_found") return Object.freeze({ outcome });
    if (outcome !== "found") throw new BrandingProviderError("malformed");
    return Object.freeze({
      outcome,
      objectKey: this.requiredString(row, "object_key"),
      sha256: this.requiredString(row, "sha256"),
    });
  }

  async getRenderablePublishedLogo(orgId: string, actorId: string) {
    const row = await this.singleRpc(
      "get_organization_branding_published_logo_render",
      {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
      },
    );
    const outcome = this.outcome(row, FOUND_OUTCOMES);
    if (outcome === "not_found") return Object.freeze({ outcome });
    if (outcome !== "found") throw new BrandingProviderError("malformed");
    return Object.freeze({
      outcome,
      objectKey: this.requiredString(row, "object_key"),
      sha256: this.requiredString(row, "sha256"),
    });
  }

  async reserveAsset(
    orgId: string,
    actorId: string,
    altText: string | null,
  ): Promise<BrandingAssetReservation> {
    const row = await this.singleRpc(
      "reserve_organization_branding_asset_upload_atomic",
      {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_alt_text: altText,
      },
    );
    const outcome = this.outcome(row, RESERVE_OUTCOMES);
    if (outcome === "not_found") return Object.freeze({ outcome });
    if (outcome !== "reserved") throw new BrandingProviderError("malformed");
    return Object.freeze({
      outcome,
      assetId: this.requiredString(row, "asset_id"),
      objectKeyPrefix: this.requiredString(row, "object_key"),
    });
  }

  async finalizeAsset(
    orgId: string,
    assetId: string,
    actorId: string,
    metadata: BrandingAssetFinalization,
  ): Promise<BrandingAssetFinalizationOutcome> {
    const row = await this.singleRpc(
      "finalize_organization_branding_asset_upload_atomic",
      {
        p_organization_id: orgId,
        p_asset_id: assetId,
        p_actor_user_id: actorId,
        p_content_hash: metadata.contentHash,
        p_input_bytes: metadata.inputBytes,
        p_width: metadata.width,
        p_height: metadata.height,
        p_scanner_status: metadata.scannerStatus,
      },
    );
    const outcome = this.outcome(row, FINALIZE_OUTCOMES);
    if (outcome === "not_found" || outcome === "invalid_request") {
      return Object.freeze({ outcome });
    }
    if (outcome !== "finalized") throw new BrandingProviderError("malformed");
    return Object.freeze({
      outcome,
      draft: this.draft(row.draft),
    });
  }

  async failAsset(
    orgId: string,
    assetId: string,
    actorId: string,
    failureCode: string,
    quarantined: boolean,
  ): Promise<void> {
    await this.singleRpc("fail_organization_branding_asset_upload_atomic", {
      p_organization_id: orgId,
      p_asset_id: assetId,
      p_actor_user_id: actorId,
      p_failure_code: failureCode,
      p_quarantined: quarantined,
    });
  }

  async saveDraft(
    orgId: string,
    actorId: string,
    input: UpdateOrganizationBrandingDraftInput,
  ): Promise<BrandingWriteOutcome> {
    const row = await this.singleRpc(
      "save_organization_branding_draft_atomic",
      {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_display_name: input.displayName,
        p_primary_color: input.palette.primary,
        p_secondary_color: input.palette.secondary,
        p_footer_text: input.footerText ?? null,
        p_contact_text: input.contactText ?? null,
        p_logo_asset_id: input.logoAssetId,
      },
    );
    return this.writeOutcome(row);
  }

  async publish(
    orgId: string,
    actorId: string,
    input: PublishOrganizationBrandingInput,
    requestDigest: string,
  ): Promise<BrandingPublishOutcome> {
    const row = await this.singleRpc("publish_organization_branding_atomic", {
      p_organization_id: orgId,
      p_actor_user_id: actorId,
      p_expected_version: input.expectedVersion,
      p_idempotency_key: input.idempotencyKey,
      p_request_digest: requestDigest,
    });
    return this.publishOutcome(row);
  }

  async removeLogo(
    orgId: string,
    actorId: string,
    input: RemoveOrganizationBrandingInput,
    requestDigest: string,
  ): Promise<BrandingPublishOutcome> {
    const row = await this.singleRpc(
      "remove_organization_branding_logo_atomic",
      {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_expected_version: input.expectedVersion,
        p_idempotency_key: input.idempotencyKey,
        p_request_digest: requestDigest,
      },
    );
    return this.publishOutcome(row);
  }

  private async readBranding(
    rpc: string,
    orgId: string,
    actorId: string,
  ): Promise<FoundBranding> {
    const row = await this.singleRpc(rpc, {
      p_organization_id: orgId,
      p_actor_user_id: actorId,
    });
    const outcome = this.outcome(row, FOUND_OUTCOMES);
    if (outcome === "not_found") return Object.freeze({ outcome });
    if (outcome !== "found") throw new BrandingProviderError("malformed");
    return Object.freeze({ outcome, branding: this.branding(row.branding) });
  }

  private writeOutcome(row: ProviderRow): BrandingWriteOutcome {
    const outcome = this.outcome(row, WRITE_OUTCOMES);
    if (outcome === "not_found" || outcome === "invalid_request") {
      return Object.freeze({ outcome });
    }
    if (outcome !== "updated" && outcome !== "conflict") {
      throw new BrandingProviderError("malformed");
    }
    return Object.freeze({
      outcome,
      draft: this.draft(row.draft),
    });
  }

  private publishOutcome(row: ProviderRow): BrandingPublishOutcome {
    const outcome = this.outcome(row, PUBLISH_OUTCOMES);
    if (
      outcome === "not_found" ||
      outcome === "invalid_request" ||
      outcome === "conflict"
    ) {
      return Object.freeze({ outcome });
    }
    if (outcome !== "published" && outcome !== "removed") {
      throw new BrandingProviderError("malformed");
    }
    if (typeof row.idempotent !== "boolean") {
      throw new BrandingProviderError("malformed");
    }
    return Object.freeze({
      outcome,
      branding: this.branding(row.branding),
      idempotent: row.idempotent,
    });
  }

  private branding(value: unknown): OrganizationBranding {
    const parsed = organizationBrandingSchema.safeParse(value);
    if (!parsed.success) throw new BrandingProviderError("malformed");
    return Object.freeze(parsed.data);
  }

  private draft(value: unknown): OrganizationBrandingDraft {
    const parsed = organizationBrandingDraftSchema.safeParse(value);
    if (!parsed.success) throw new BrandingProviderError("malformed");
    return Object.freeze(parsed.data);
  }

  private async singleRpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ProviderRow> {
    try {
      const result = await this.client().rpc(name, args);
      if (result.error) throw new BrandingProviderError("unavailable");
      if (!Array.isArray(result.data) || result.data.length !== 1) {
        throw new BrandingProviderError("malformed");
      }
      return this.recordOrFail(result.data[0]);
    } catch (error) {
      if (error instanceof BrandingProviderError) throw error;
      throw new BrandingProviderError("unavailable");
    }
  }

  private client(): BrandingRpcClient {
    return this.supabase.admin() as unknown as BrandingRpcClient;
  }

  private outcome(row: ProviderRow, allowed: ReadonlySet<string>): string {
    const outcome = this.requiredString(row, "outcome");
    if (!allowed.has(outcome)) throw new BrandingProviderError("malformed");
    return outcome;
  }

  private recordOrFail(value: unknown): ProviderRow {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BrandingProviderError("malformed");
    }
    return value as ProviderRow;
  }

  private requiredString(row: ProviderRow, key: string): string {
    const value = row[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new BrandingProviderError("malformed");
    }
    return value;
  }
}
