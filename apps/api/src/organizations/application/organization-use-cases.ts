import type {
  CreateOrganizationInput,
  OnboardingResponse,
  Organization,
  UpdateLegalProfileInput,
} from "@repo/contracts/organizations";

import type { Result } from "../../common/domain/result";
import { failure, success } from "../../common/domain/result";
import type {
  OrganizationRepository,
  SwitchOrganizationAtomicOutcome,
  UpdateLegalProfileAtomicOutcome,
} from "./organization-repository.port";
import { OrganizationRepositoryError } from "./organization-repository.port";

export type OrganizationActor = Readonly<{ id: string; email: string }>;

export type CreateOrganizationCommand = Readonly<{
  actor: OrganizationActor;
  input: CreateOrganizationInput;
}>;

export type CurrentOrganizationQuery = Readonly<{
  organizationId: string | null;
  userId: string;
}>;

export type UpdateLegalProfileCommand = Readonly<{
  organizationId: string;
  actor: OrganizationActor;
  input: UpdateLegalProfileInput;
}>;

export type OnboardingQuery = CurrentOrganizationQuery;

export type SwitchOrganizationCommand = Readonly<{
  organizationId: string;
  actor: OrganizationActor;
}>;

export type OrganizationUseCaseError =
  | Readonly<{ code: "idempotency_mismatch" }>
  | Readonly<{ code: "legal_identity_conflict" }>
  | Readonly<{ code: "create_failed" }>
  | Readonly<{ code: "organization_not_found" }>
  | Readonly<{ code: "version_conflict" }>
  | Readonly<{ code: "update_failed" }>
  | Readonly<{ code: "no_active_organization" }>
  | Readonly<{ code: "onboarding_failed" }>
  | Readonly<{ code: "provider_unavailable" }>
  | Readonly<{ code: "malformed_provider" }>;

type OrganizationResult<T> = Result<T, OrganizationUseCaseError>;

/** Framework-free organization commands and tenant-scoped queries. */
export class OrganizationUseCases {
  constructor(private readonly repository: OrganizationRepository) {}

  async create(
    command: CreateOrganizationCommand,
  ): Promise<OrganizationResult<Organization>> {
    try {
      const outcome = await this.repository.createAtomic(
        command.actor.id,
        cloneCreateInput(command.input),
      );
      switch (outcome.outcome) {
        case "created":
        case "replayed":
          return success(cloneOrganization(outcome.organization));
        case "idempotency_mismatch":
          return failure(
            Object.freeze({ code: "idempotency_mismatch" as const }),
          );
        case "legal_identity_conflict":
          return failure(
            Object.freeze({ code: "legal_identity_conflict" as const }),
          );
        case "user_not_found":
          return failure(Object.freeze({ code: "create_failed" as const }));
      }
    } catch (error) {
      return this.repositoryFailure(error);
    }
  }

  async current(
    query: CurrentOrganizationQuery,
  ): Promise<OrganizationResult<Organization | null>> {
    if (!query.organizationId) return success(null);

    try {
      return success(
        cloneOptionalOrganization(
          await this.repository.currentForMember(
            query.organizationId,
            query.userId,
          ),
        ),
      );
    } catch (error) {
      return this.repositoryFailure(error);
    }
  }

  async updateLegalProfile(
    command: UpdateLegalProfileCommand,
  ): Promise<OrganizationResult<Organization>> {
    try {
      const outcome = await this.repository.updateLegalProfileAtomic(
        command.organizationId,
        command.actor.id,
        cloneUpdateInput(command.input),
      );
      return this.mapProfileUpdate(outcome);
    } catch (error) {
      return this.repositoryFailure(error);
    }
  }

  async onboarding(
    query: OnboardingQuery,
  ): Promise<OrganizationResult<OnboardingResponse>> {
    if (!query.organizationId) {
      return failure(
        Object.freeze({ code: "no_active_organization" as const }),
      );
    }

    try {
      const result = await this.repository.onboardingForMember(
        query.organizationId,
        query.userId,
      );
      if (!result) {
        return failure(
          Object.freeze({ code: "organization_not_found" as const }),
        );
      }
      return success(cloneOnboarding(result));
    } catch (error) {
      return this.repositoryFailure(error);
    }
  }

  async switch(
    command: SwitchOrganizationCommand,
  ): Promise<OrganizationResult<Organization>> {
    try {
      const outcome = await this.repository.switchAtomic(
        command.organizationId,
        command.actor.id,
      );
      return this.mapSwitch(outcome);
    } catch (error) {
      return this.repositoryFailure(error);
    }
  }

  async verifyMembership(
    orgId: string,
    userId: string,
  ): Promise<OrganizationResult<boolean>> {
    try {
      return success(await this.repository.verifyMembership(orgId, userId));
    } catch (error) {
      return this.repositoryFailure(error);
    }
  }

  private mapProfileUpdate(
    outcome: UpdateLegalProfileAtomicOutcome,
  ): OrganizationResult<Organization> {
    switch (outcome.outcome) {
      case "updated":
        return success(cloneOrganization(outcome.organization));
      case "not_found":
        return failure(
          Object.freeze({ code: "organization_not_found" as const }),
        );
      case "version_conflict":
        return failure(Object.freeze({ code: "version_conflict" as const }));
      case "legal_identity_conflict":
        return failure(
          Object.freeze({ code: "legal_identity_conflict" as const }),
        );
    }
  }

  private mapSwitch(
    outcome: SwitchOrganizationAtomicOutcome,
  ): OrganizationResult<Organization> {
    switch (outcome.outcome) {
      case "switched":
        return success(cloneOrganization(outcome.organization));
      case "not_found":
        return failure(
          Object.freeze({ code: "organization_not_found" as const }),
        );
    }
  }

  private repositoryFailure(error: unknown): OrganizationResult<never> {
    return failure(
      Object.freeze({
        code:
          error instanceof OrganizationRepositoryError &&
          error.code === "malformed"
            ? "malformed_provider"
            : "provider_unavailable",
      }),
    );
  }
}

function cloneCreateInput(
  input: CreateOrganizationInput,
): CreateOrganizationInput {
  return Object.freeze({
    ...input,
    registeredAddress: Object.freeze({ ...input.registeredAddress }),
  });
}

function cloneUpdateInput(
  input: UpdateLegalProfileInput,
): UpdateLegalProfileInput {
  return Object.freeze({
    ...input,
    registeredAddress: Object.freeze({ ...input.registeredAddress }),
  });
}

function cloneOptionalOrganization(
  organization: Organization | null,
): Organization | null {
  return organization ? cloneOrganization(organization) : null;
}

function cloneOrganization(organization: Organization): Organization {
  const legalProfile = organization.legalProfile
    ? Object.freeze({
        ...organization.legalProfile,
        registeredAddress: Object.freeze({
          ...organization.legalProfile.registeredAddress,
        }),
      })
    : null;
  return Object.freeze({ ...organization, legalProfile });
}

function cloneOnboarding(onboarding: OnboardingResponse): OnboardingResponse {
  const [organizationDetails, firstProduct, firstSbom, inviteTeam, completed] =
    onboarding.stages;
  const stages: OnboardingResponse["stages"] = [
    cloneStage(organizationDetails),
    cloneStage(firstProduct),
    cloneStage(firstSbom),
    cloneStage(inviteTeam),
    cloneStage(completed),
  ];
  return Object.freeze({
    ...onboarding,
    organization: cloneOrganization(onboarding.organization),
    stages,
    integrationAvailability: Object.freeze({
      ...onboarding.integrationAvailability,
    }),
  });
}

function cloneStage<T extends OnboardingResponse["stages"][number]>(
  stage: T,
): T {
  return Object.freeze({
    ...stage,
    resourceIds: Object.freeze([...stage.resourceIds]),
    unavailableResourceIds: Object.freeze([...stage.unavailableResourceIds]),
  }) as T;
}
