import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  onboardingResponseSchema,
  organizationSchema,
  type CreateOrganizationInput,
  type OnboardingResponse,
  type Organization,
  type UpdateLegalProfileInput,
} from "@repo/contracts/organizations";
import type { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import type {
  CreateOrganizationAtomicOutcome,
  OrganizationRepository,
  SwitchOrganizationAtomicOutcome,
  UpdateLegalProfileAtomicOutcome,
} from "../application/organization-repository.port";
import { OrganizationRepositoryError } from "../application/organization-repository.port";
import {
  canonicalContactAuditValue,
  contactAuditDigest,
} from "./legal-profile-audit-digest";

interface ProviderResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

interface ProviderQuery {
  select(columns: string): ProviderQuery;
  eq(column: string, value: string): ProviderQuery;
  order(
    column: string,
    options?: Readonly<{ ascending: boolean }>,
  ): ProviderQuery;
  maybeSingle(): Promise<ProviderResult>;
  then<TResult1 = ProviderResult, TResult2 = never>(
    onfulfilled?:
      ((value: ProviderResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2>;
}

interface OrganizationProviderClient {
  from(table: string): ProviderQuery;
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ProviderResult>;
}

type ProviderRecord = Readonly<Record<string, unknown>>;
type EvidenceIds = Readonly<{
  resourceIds: readonly string[];
  unavailableResourceIds: readonly string[];
}>;

const CREATE_OUTCOMES = new Set([
  "created",
  "replayed",
  "idempotency_mismatch",
  "legal_identity_conflict",
  "user_not_found",
]);
const UPDATE_OUTCOMES = new Set([
  "updated",
  "not_found",
  "version_conflict",
  "legal_identity_conflict",
]);
const SWITCH_OUTCOMES = new Set(["switched", "not_found"]);

/**
 * Service-role persistence adapter. All organization reads first check the
 * exact `(organization_id, user_id)` membership pair and every data query
 * carries the organization filter, because service_role bypasses RLS.
 */
@Injectable()
export class SupabaseOrganizationRepository implements OrganizationRepository {
  private readonly signingSecret: string;

  constructor(
    private readonly supabase: SupabaseService,
    config: ConfigService,
  ) {
    this.signingSecret = config.getOrThrow<string>("COOKIE_SIGNING_SECRET");
  }

  async createAtomic(
    userId: string,
    input: CreateOrganizationInput,
  ): Promise<CreateOrganizationAtomicOutcome> {
    const result = await this.rpc(
      "create_organization_atomic",
      Object.freeze({
        p_actor_user_id: userId,
        p_idempotency_key: input.idempotencyKey,
        ...this.profileParameters(input),
      }),
    );
    const row = this.singleRow(result);
    const outcome = this.outcome(row, CREATE_OUTCOMES);

    if (outcome === "idempotency_mismatch") {
      return Object.freeze({ outcome });
    }
    if (outcome === "legal_identity_conflict") {
      return Object.freeze({ outcome });
    }
    if (outcome === "user_not_found") return Object.freeze({ outcome });
    if (outcome !== "created" && outcome !== "replayed") {
      throw new OrganizationRepositoryError("malformed");
    }

    const orgId = this.requiredString(row, "organization_id");
    const organization = await this.currentForMember(orgId, userId);
    if (!organization) throw new OrganizationRepositoryError("malformed");
    return Object.freeze({ outcome, organization });
  }

  async currentForMember(
    orgId: string,
    userId: string,
  ): Promise<Organization | null> {
    if (!(await this.verifyMembership(orgId, userId))) return null;

    const organizationResult = await this.query(
      this.client()
        .from("organizations")
        .select("id, name, slug")
        .eq("id", orgId)
        .maybeSingle(),
    );
    if (!organizationResult.data) return null;
    const organizationRow = this.record(organizationResult.data);
    if (!organizationRow) throw new OrganizationRepositoryError("malformed");

    const profileResult = await this.query(
      this.client()
        .from("organization_legal_profiles")
        .select(
          "id, organization_id, legal_name, registered_address_line_1, registered_address_line_2, registered_address_locality, registered_address_administrative_area, registered_address_postal_code, registered_address_country, main_establishment_country, manufacturer_contact_name, manufacturer_contact_email, manufacturer_contact_phone, version, created_at, updated_at, created_by, updated_by",
        )
        .eq("organization_id", orgId)
        .maybeSingle(),
    );
    const legalProfile = profileResult.data
      ? this.profile(this.recordOrFail(profileResult.data))
      : null;
    const parsed = organizationSchema.safeParse({
      id: organizationRow.id,
      name: organizationRow.name,
      slug: organizationRow.slug,
      legalProfile,
    });
    if (!parsed.success) throw new OrganizationRepositoryError("malformed");
    return Object.freeze(parsed.data);
  }

  async updateLegalProfileAtomic(
    orgId: string,
    userId: string,
    input: UpdateLegalProfileInput,
  ): Promise<UpdateLegalProfileAtomicOutcome> {
    const current = await this.currentForMember(orgId, userId);
    if (!current) return Object.freeze({ outcome: "not_found" });

    const result = await this.rpc(
      "update_organization_legal_profile_atomic",
      Object.freeze({
        p_organization_id: orgId,
        p_actor_user_id: userId,
        p_expected_version: input.expectedVersion,
        ...this.profileParameters(input),
        ...this.contactAuditParameters(current.legalProfile, input),
      }),
    );
    const outcome = this.outcome(this.singleRow(result), UPDATE_OUTCOMES);
    if (outcome === "not_found" || outcome === "version_conflict") {
      return Object.freeze({ outcome });
    }
    if (outcome === "legal_identity_conflict") {
      return Object.freeze({ outcome });
    }
    if (outcome !== "updated") {
      throw new OrganizationRepositoryError("malformed");
    }

    const organization = await this.currentForMember(orgId, userId);
    if (!organization) throw new OrganizationRepositoryError("malformed");
    return Object.freeze({ outcome, organization });
  }

  async onboardingForMember(
    orgId: string,
    userId: string,
  ): Promise<OnboardingResponse | null> {
    const organization = await this.currentForMember(orgId, userId);
    if (!organization) return null;

    const stagesResult = await this.query(
      this.client()
        .from("organization_onboarding_stages")
        .select(
          "stage, status, completed_at, completed_by, block_reason, stage_order",
        )
        .eq("organization_id", orgId)
        .order("stage_order", { ascending: true }),
    );
    if (!Array.isArray(stagesResult.data)) {
      throw new OrganizationRepositoryError("malformed");
    }

    const evidenceResult = await this.query(
      this.client()
        .from("organization_onboarding_evidence")
        .select("stage, resource_id, is_available")
        .eq("organization_id", orgId),
    );
    if (!Array.isArray(evidenceResult.data)) {
      throw new OrganizationRepositoryError("malformed");
    }
    const evidenceIdsByStage = this.evidenceIdsByStage(evidenceResult.data);

    const stages = stagesResult.data.map((value) => {
      const row = this.recordOrFail(value);
      const stage = this.requiredString(row, "stage");
      const evidenceIds = evidenceIdsByStage.get(stage);
      return {
        stage,
        status: row.status,
        resourceIds:
          stage === "organization_details"
            ? [orgId]
            : (evidenceIds?.resourceIds ?? []),
        unavailableResourceIds:
          stage === "organization_details"
            ? []
            : (evidenceIds?.unavailableResourceIds ?? []),
        completedAt: row.completed_at,
        actorId: row.completed_by,
        blockReason: row.block_reason,
      };
    });
    const incomplete = stages.find((stage) => stage.status !== "completed");
    const parsed = onboardingResponseSchema.safeParse({
      organization,
      stages,
      nextIncompleteStage: incomplete?.stage ?? null,
      blocked: incomplete?.status === "blocked",
      integrationAvailability: {
        products: true,
        sbom: false,
        invitations: true,
      },
    });
    if (!parsed.success) throw new OrganizationRepositoryError("malformed");
    return Object.freeze(parsed.data);
  }

  async switchAtomic(
    orgId: string,
    userId: string,
  ): Promise<SwitchOrganizationAtomicOutcome> {
    const lifecycleResult = await this.query(
      this.client()
        .from("organization_lifecycles")
        .select("status")
        .eq("organization_id", orgId)
        .maybeSingle(),
    );
    if (!lifecycleResult.data) return Object.freeze({ outcome: "not_found" });
    const lifecycle = this.recordOrFail(lifecycleResult.data);
    if (lifecycle.status !== "active") {
      if (typeof lifecycle.status !== "string") {
        throw new OrganizationRepositoryError("malformed");
      }
      return Object.freeze({ outcome: "not_found" });
    }
    const result = await this.rpc(
      "switch_organization_atomic",
      Object.freeze({ p_organization_id: orgId, p_actor_user_id: userId }),
    );
    const outcome = this.outcome(this.singleRow(result), SWITCH_OUTCOMES);
    if (outcome === "not_found") return Object.freeze({ outcome });
    if (outcome !== "switched") {
      throw new OrganizationRepositoryError("malformed");
    }

    const organization = await this.currentForMember(orgId, userId);
    if (!organization) throw new OrganizationRepositoryError("malformed");
    return Object.freeze({ outcome, organization });
  }

  async verifyMembership(orgId: string, userId: string): Promise<boolean> {
    const result = await this.query(
      this.client()
        .from("organization_members")
        .select("id")
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .maybeSingle(),
    );
    if (!result.data) return false;
    this.requiredString(this.recordOrFail(result.data), "id");
    return true;
  }

  private profileParameters(
    input: CreateOrganizationInput | UpdateLegalProfileInput,
  ): Readonly<Record<string, string | null>> {
    return Object.freeze({
      p_legal_name: input.legalName,
      p_address_line_1: input.registeredAddress.addressLine1,
      p_address_line_2: input.registeredAddress.addressLine2 ?? null,
      p_locality: input.registeredAddress.locality,
      p_administrative_area: input.registeredAddress.administrativeArea ?? null,
      p_postal_code: input.registeredAddress.postalCode,
      p_registered_address_country: input.registeredAddress.country,
      p_main_establishment_country: input.mainEstablishmentCountry,
      p_manufacturer_contact_name: input.manufacturerContactName,
      p_manufacturer_contact_email: input.manufacturerContactEmail,
      p_manufacturer_contact_phone: input.phone ?? null,
    });
  }

  private contactAuditParameters(
    before: Organization["legalProfile"],
    after: UpdateLegalProfileInput,
  ): Readonly<Record<string, string>> {
    return Object.freeze({
      p_contact_name_before_digest: contactAuditDigest(
        "manufacturer_contact_name",
        canonicalContactAuditValue(
          "manufacturer_contact_name",
          before?.manufacturerContactName ?? null,
        ),
        this.signingSecret,
      ),
      p_contact_name_after_digest: contactAuditDigest(
        "manufacturer_contact_name",
        canonicalContactAuditValue(
          "manufacturer_contact_name",
          after.manufacturerContactName,
        ),
        this.signingSecret,
      ),
      p_contact_email_before_digest: contactAuditDigest(
        "manufacturer_contact_email",
        canonicalContactAuditValue(
          "manufacturer_contact_email",
          before?.manufacturerContactEmail ?? null,
        ),
        this.signingSecret,
      ),
      p_contact_email_after_digest: contactAuditDigest(
        "manufacturer_contact_email",
        canonicalContactAuditValue(
          "manufacturer_contact_email",
          after.manufacturerContactEmail,
        ),
        this.signingSecret,
      ),
      p_contact_phone_before_digest: contactAuditDigest(
        "manufacturer_contact_phone",
        canonicalContactAuditValue(
          "manufacturer_contact_phone",
          before?.phone ?? null,
        ),
        this.signingSecret,
      ),
      p_contact_phone_after_digest: contactAuditDigest(
        "manufacturer_contact_phone",
        canonicalContactAuditValue(
          "manufacturer_contact_phone",
          after.phone ?? null,
        ),
        this.signingSecret,
      ),
    });
  }

  private profile(
    row: ProviderRecord,
  ): z.output<typeof organizationSchema>["legalProfile"] {
    const registeredAddress = this.record(row.registered_address) ?? {
      addressLine1: row.registered_address_line_1,
      ...(typeof row.registered_address_line_2 === "string"
        ? { addressLine2: row.registered_address_line_2 }
        : {}),
      locality: row.registered_address_locality,
      ...(typeof row.registered_address_administrative_area === "string"
        ? {
            administrativeArea: row.registered_address_administrative_area,
          }
        : {}),
      postalCode: row.registered_address_postal_code,
      country: row.registered_address_country,
    };
    const candidate = {
      id: row.id,
      legalName: row.legal_name,
      registeredAddress,
      mainEstablishmentCountry: row.main_establishment_country,
      phone: row.manufacturer_contact_phone ?? row.phone ?? null,
      manufacturerContactName: row.manufacturer_contact_name,
      manufacturerContactEmail: row.manufacturer_contact_email,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
    };
    const parsed = organizationSchema.shape.legalProfile
      .unwrap()
      .safeParse(candidate);
    if (!parsed.success) throw new OrganizationRepositoryError("malformed");
    return Object.freeze(parsed.data);
  }

  private async rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ProviderResult> {
    try {
      const result = await this.client().rpc(name, args);
      if (result.error) throw new OrganizationRepositoryError("unavailable");
      return result;
    } catch (error) {
      if (error instanceof OrganizationRepositoryError) throw error;
      throw new OrganizationRepositoryError("unavailable");
    }
  }

  private async query(
    promise: PromiseLike<ProviderResult>,
  ): Promise<ProviderResult> {
    try {
      const result = await promise;
      if (result.error) throw new OrganizationRepositoryError("unavailable");
      return result;
    } catch (error) {
      if (error instanceof OrganizationRepositoryError) throw error;
      throw new OrganizationRepositoryError("unavailable");
    }
  }

  private client(): OrganizationProviderClient {
    // supabase-js generated RPC args currently model nullable SQL parameters
    // as strings. Keep the necessary structural bridge inside this adapter so
    // null address/contact fields never require casts at application callers.
    return this.supabase.admin() as unknown as OrganizationProviderClient;
  }

  private singleRow(result: ProviderResult): ProviderRecord {
    if (!Array.isArray(result.data) || result.data.length !== 1) {
      throw new OrganizationRepositoryError("malformed");
    }
    return this.recordOrFail(result.data[0]);
  }

  private outcome(
    values: ProviderRecord,
    allowed: ReadonlySet<string>,
  ): string {
    const value = this.requiredString(values, "outcome");
    if (!allowed.has(value)) throw new OrganizationRepositoryError("malformed");
    return value;
  }

  private record(value: unknown): ProviderRecord | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as ProviderRecord)
      : null;
  }

  private recordOrFail(value: unknown): ProviderRecord {
    const row = this.record(value);
    if (!row) throw new OrganizationRepositoryError("malformed");
    return row;
  }

  private requiredString(row: ProviderRecord, key: string): string {
    const value = row[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new OrganizationRepositoryError("malformed");
    }
    return value;
  }

  private evidenceIdsByStage(
    evidence: readonly unknown[],
  ): ReadonlyMap<string, EvidenceIds> {
    const values = new Map<
      string,
      {
        readonly resourceIds: readonly string[];
        readonly unavailableResourceIds: readonly string[];
      }
    >();
    for (const value of evidence) {
      const row = this.recordOrFail(value);
      const stage = this.requiredString(row, "stage");
      const resourceId = this.requiredString(row, "resource_id");
      if (typeof row.is_available !== "boolean") {
        throw new OrganizationRepositoryError("malformed");
      }
      const existing = values.get(stage) ?? {
        resourceIds: [],
        unavailableResourceIds: [],
      };
      values.set(
        stage,
        row.is_available
          ? Object.freeze({
              ...existing,
              resourceIds: [...existing.resourceIds, resourceId],
            })
          : Object.freeze({
              ...existing,
              unavailableResourceIds: [
                ...existing.unavailableResourceIds,
                resourceId,
              ],
            }),
      );
    }
    return new Map(
      [...values.entries()].map(([stage, evidenceIds]) => [
        stage,
        Object.freeze({
          resourceIds: Object.freeze([...evidenceIds.resourceIds]),
          unavailableResourceIds: Object.freeze([
            ...evidenceIds.unavailableResourceIds,
          ]),
        }),
      ]),
    );
  }
}
