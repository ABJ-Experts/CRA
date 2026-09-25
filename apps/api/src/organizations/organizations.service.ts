import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  CreateOrganizationInput,
  OnboardingResponse,
  Organization,
  UpdateLegalProfileInput,
} from "@repo/contracts/organizations";

import type { Result } from "../common/domain/result";
import {
  OrganizationUseCases,
  type OrganizationActor,
  type OrganizationUseCaseError,
} from "./application/organization-use-cases";

/** Nest-facing facade; all organization decisions remain in the application layer. */
@Injectable()
export class OrganizationsService {
  constructor(private readonly useCases: OrganizationUseCases) {}

  async create(
    actor: OrganizationActor,
    input: CreateOrganizationInput,
  ): Promise<Organization> {
    return this.unwrap(await this.useCases.create({ actor, input }));
  }

  async current(
    organizationId: string | null,
    userId: string,
  ): Promise<Organization | null> {
    return this.unwrap(await this.useCases.current({ organizationId, userId }));
  }

  async updateLegalProfile(
    organizationId: string,
    actor: OrganizationActor,
    input: UpdateLegalProfileInput,
  ): Promise<Organization> {
    return this.unwrap(
      await this.useCases.updateLegalProfile({ organizationId, actor, input }),
    );
  }

  async onboarding(
    organizationId: string | null,
    userId: string,
  ): Promise<OnboardingResponse> {
    return this.unwrap(
      await this.useCases.onboarding({ organizationId, userId }),
    );
  }

  async switch(
    organizationId: string,
    actor: OrganizationActor,
  ): Promise<Organization> {
    return this.unwrap(await this.useCases.switch({ organizationId, actor }));
  }

  /** Root uses this immediately before setting the signed active-org cookie. */
  async verifyMembership(orgId: string, userId: string): Promise<boolean> {
    return this.unwrap(await this.useCases.verifyMembership(orgId, userId));
  }

  private unwrap<T>(result: Result<T, OrganizationUseCaseError>): T {
    if (result.ok) return result.value;
    throw this.httpFailure(result.error);
  }

  private httpFailure(error: OrganizationUseCaseError): Error {
    switch (error.code) {
      case "idempotency_mismatch":
        return new ConflictException({
          message:
            "This idempotency key was already used for different details.",
          code: error.code,
        });
      case "legal_identity_conflict":
        return new ConflictException({
          message: "An organization with these legal details already exists.",
          code: error.code,
        });
      case "version_conflict":
        return new ConflictException({
          message: "This legal profile changed. Refresh and try again.",
          code: error.code,
        });
      case "organization_not_found":
      case "no_active_organization":
        return new NotFoundException({
          message: "Organization not found.",
          code: "organization_not_found",
        });
      case "create_failed":
        return new BadRequestException({
          message: "We could not create that organization.",
          code: error.code,
        });
      case "update_failed":
        return new BadRequestException({
          message: "We could not save that legal profile.",
          code: error.code,
        });
      case "onboarding_failed":
        return new BadRequestException({
          message: "We could not load organization onboarding.",
          code: error.code,
        });
      case "provider_unavailable":
        return new ServiceUnavailableException({
          message: "Organization service is temporarily unavailable.",
          code: "organization_unavailable",
        });
      case "malformed_provider":
        return new InternalServerErrorException({
          statusCode: 500,
          message: "Organization service returned an invalid response.",
          code: "organization_provider_invalid",
        });
    }
  }
}
