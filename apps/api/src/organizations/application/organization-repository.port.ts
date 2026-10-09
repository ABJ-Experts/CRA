import type {
  CreateOrganizationInput,
  OnboardingResponse,
  Organization,
  UpdateLegalProfileInput,
} from "@repo/contracts/organizations";

/**
 * Provider-independent outcomes emitted by the atomic create RPC.
 *
 * A replay must carry the same committed representation as a fresh creation;
 * callers never construct an organization from a partial provider response.
 */
export type CreateOrganizationAtomicOutcome =
  | Readonly<{ outcome: "created" | "replayed"; organization: Organization }>
  | Readonly<{ outcome: "idempotency_mismatch" }>
  | Readonly<{ outcome: "legal_identity_conflict" }>
  | Readonly<{ outcome: "user_not_found" }>;

export type UpdateLegalProfileAtomicOutcome =
  | Readonly<{ outcome: "updated"; organization: Organization }>
  | Readonly<{ outcome: "not_found" }>
  | Readonly<{ outcome: "version_conflict" }>
  | Readonly<{ outcome: "legal_identity_conflict" }>;

/** Membership validation and its switch audit happen in the same RPC. */
export type SwitchOrganizationAtomicOutcome =
  | Readonly<{ outcome: "switched"; organization: Organization }>
  | Readonly<{ outcome: "not_found" }>;

/**
 * The sole organization data boundary. Every tenant-scoped method puts orgId
 * first so service-role calls cannot accidentally lose their tenant filter.
 */
export interface OrganizationRepository {
  createAtomic(
    userId: string,
    input: CreateOrganizationInput,
  ): Promise<CreateOrganizationAtomicOutcome>;
  currentForMember(orgId: string, userId: string): Promise<Organization | null>;
  updateLegalProfileAtomic(
    orgId: string,
    userId: string,
    input: UpdateLegalProfileInput,
  ): Promise<UpdateLegalProfileAtomicOutcome>;
  onboardingForMember(
    orgId: string,
    userId: string,
  ): Promise<OnboardingResponse | null>;
  switchAtomic(
    orgId: string,
    userId: string,
  ): Promise<SwitchOrganizationAtomicOutcome>;
  verifyMembership(orgId: string, userId: string): Promise<boolean>;
}

export const ORGANIZATION_REPOSITORY = Symbol("ORGANIZATION_REPOSITORY");

/** Stable adapter errors without raw database/provider messages. */
export class OrganizationRepositoryError extends Error {
  readonly name = "OrganizationRepositoryError";

  constructor(readonly code: "unavailable" | "malformed") {
    super(code);
  }
}
