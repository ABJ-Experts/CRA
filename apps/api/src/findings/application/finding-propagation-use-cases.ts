import {
  createFindingProductImpactOverrideInputSchema,
  endFindingProductImpactOverrideInputSchema,
  findingProductImpactOverrideResponseSchema,
  findingImpactSummaryQuerySchema,
  findingImpactSummaryResponseSchema,
  findingPropagationSourceMutationResponseSchema,
  registerFindingPropagationSourceInputSchema,
  updateFindingPropagationSourceInputSchema,
  type FindingImpactSummaryResponse,
  type CreateFindingProductImpactOverrideInput,
  type EndFindingProductImpactOverrideInput,
  type FindingPropagationSourceMutationResponse,
  type RegisterFindingPropagationSourceInput,
  type UpdateFindingPropagationSourceInput,
} from "@repo/contracts/findings";
import { z } from "zod";

import type { Result } from "../../common/domain/result";
import { failure, success } from "../../common/domain/result";

type FindingProductImpactOverrideResponse = z.output<
  typeof findingProductImpactOverrideResponseSchema
>;

export type FindingPropagationProviderErrorCode = "unavailable" | "malformed";

export class FindingPropagationProviderError extends Error {
  readonly name = "FindingPropagationProviderError";

  constructor(readonly code: FindingPropagationProviderErrorCode) {
    super(code);
  }
}

export type FindingPropagationError = Readonly<{
  code:
    | "invalid_request"
    | "not_found"
    | "conflict"
    | "idempotency_mismatch"
    | "unavailable"
    | "malformed_provider";
}>;

export type FindingPropagationResult<T> = Result<T, FindingPropagationError>;

export type RegisterFindingPropagationSourceOutcome =
  | Readonly<{
      outcome: "created" | "replayed";
      response: FindingPropagationSourceMutationResponse;
    }>
  | Readonly<{
      outcome:
        "invalid_request" | "not_found" | "conflict" | "idempotency_mismatch";
    }>;

export type FindingImpactSummaryOutcome =
  | Readonly<{ outcome: "found"; response: FindingImpactSummaryResponse }>
  | Readonly<{ outcome: "not_found" | "invalid_request" }>;

export type CreateFindingProductImpactOverrideOutcome =
  | Readonly<{
      outcome: "created" | "replayed";
      response: FindingProductImpactOverrideResponse;
    }>
  | Readonly<{
      outcome:
        "invalid_request" | "not_found" | "conflict" | "idempotency_mismatch";
    }>;

export type EndFindingProductImpactOverrideOutcome =
  | Readonly<{
      outcome: "ended" | "replayed";
      response: FindingProductImpactOverrideResponse;
    }>
  | Readonly<{
      outcome:
        "invalid_request" | "not_found" | "conflict" | "idempotency_mismatch";
    }>;

export type UpdateFindingPropagationSourceOutcome =
  | Readonly<{
      outcome: "updated" | "replayed";
      response: FindingPropagationSourceMutationResponse;
    }>
  | Readonly<{
      outcome:
        "invalid_request" | "not_found" | "conflict" | "idempotency_mismatch";
    }>;

/**
 * Inward-owned persistence boundary for opaque finding propagation state.
 * Product graph traversal is intentionally absent: workers receive it only
 * through the Products module's published application port.
 */
export interface FindingPropagationRepository {
  registerSource(
    organizationId: string,
    actorId: string,
    input: RegisterFindingPropagationSourceInput,
  ): Promise<RegisterFindingPropagationSourceOutcome>;
  getProductImpactSummary(
    organizationId: string,
    actorId: string,
    productId: string,
    releaseId: string | null,
  ): Promise<FindingImpactSummaryOutcome>;
  createProductImpactOverride(
    organizationId: string,
    actorId: string,
    sourceId: string,
    productId: string,
    input: CreateFindingProductImpactOverrideInput,
  ): Promise<CreateFindingProductImpactOverrideOutcome>;
  endProductImpactOverride(
    organizationId: string,
    actorId: string,
    sourceId: string,
    productId: string,
    overrideId: string,
    input: EndFindingProductImpactOverrideInput,
  ): Promise<EndFindingProductImpactOverrideOutcome>;
  updateSource(
    organizationId: string,
    actorId: string,
    sourceId: string,
    input: UpdateFindingPropagationSourceInput,
  ): Promise<UpdateFindingPropagationSourceOutcome>;
}

export const FINDING_PROPAGATION_REPOSITORY = Symbol(
  "FINDING_PROPAGATION_REPOSITORY",
);

const sourceSummaryInputSchema = z
  .object({
    organizationId: z.uuid(),
    actorId: z.uuid(),
    productId: z.uuid(),
    releaseId: z.uuid().nullable(),
  })
  .strict();

export class FindingPropagationUseCases {
  constructor(private readonly repository: FindingPropagationRepository) {}

  async registerSource(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      input: RegisterFindingPropagationSourceInput;
    }>,
  ): Promise<
    FindingPropagationResult<FindingPropagationSourceMutationResponse>
  > {
    const input = registerFindingPropagationSourceInputSchema.safeParse(
      command.input,
    );
    if (
      !input.success ||
      !z.uuid().safeParse(command.organizationId).success ||
      !z.uuid().safeParse(command.actorId).success
    ) {
      return this.invalidRequest();
    }

    try {
      const result = await this.repository.registerSource(
        command.organizationId,
        command.actorId,
        input.data,
      );
      if (result.outcome === "created" || result.outcome === "replayed") {
        const parsed = findingPropagationSourceMutationResponseSchema.safeParse(
          result.response,
        );
        return parsed.success ? success(parsed.data) : this.malformedProvider();
      }
      return failure(Object.freeze({ code: result.outcome }));
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async updateSource(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      sourceId: string;
      input: UpdateFindingPropagationSourceInput;
    }>,
  ): Promise<
    FindingPropagationResult<FindingPropagationSourceMutationResponse>
  > {
    const input = updateFindingPropagationSourceInputSchema.safeParse(
      command.input,
    );
    const identifiers = z
      .object({
        organizationId: z.uuid(),
        actorId: z.uuid(),
        sourceId: z.uuid(),
      })
      .strict()
      .safeParse({
        organizationId: command.organizationId,
        actorId: command.actorId,
        sourceId: command.sourceId,
      });
    if (!input.success || !identifiers.success) return this.invalidRequest();

    try {
      const result = await this.repository.updateSource(
        identifiers.data.organizationId,
        identifiers.data.actorId,
        identifiers.data.sourceId,
        input.data,
      );
      if (result.outcome !== "updated" && result.outcome !== "replayed") {
        return failure(Object.freeze({ code: result.outcome }));
      }
      const parsed = findingPropagationSourceMutationResponseSchema.safeParse(
        result.response,
      );
      return parsed.success ? success(parsed.data) : this.malformedProvider();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async getProductImpactSummary(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      productId: string;
      query: Readonly<{ releaseId?: string }>;
    }>,
  ): Promise<FindingPropagationResult<FindingImpactSummaryResponse>> {
    const query = findingImpactSummaryQuerySchema.safeParse(command.query);
    if (!query.success) return this.invalidRequest();
    const parsed = sourceSummaryInputSchema.safeParse({
      organizationId: command.organizationId,
      actorId: command.actorId,
      productId: command.productId,
      releaseId: query.data.releaseId ?? null,
    });
    if (!parsed.success) return this.invalidRequest();

    try {
      const result = await this.repository.getProductImpactSummary(
        parsed.data.organizationId,
        parsed.data.actorId,
        parsed.data.productId,
        parsed.data.releaseId,
      );
      if (result.outcome !== "found") {
        return failure(Object.freeze({ code: result.outcome }));
      }
      const response = findingImpactSummaryResponseSchema.safeParse(
        result.response,
      );
      return response.success
        ? success(response.data)
        : this.malformedProvider();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async createProductImpactOverride(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      sourceId: string;
      productId: string;
      input: CreateFindingProductImpactOverrideInput;
    }>,
  ): Promise<FindingPropagationResult<FindingProductImpactOverrideResponse>> {
    const input = createFindingProductImpactOverrideInputSchema.safeParse(
      command.input,
    );
    const identifiers = z
      .object({
        organizationId: z.uuid(),
        actorId: z.uuid(),
        sourceId: z.uuid(),
        productId: z.uuid(),
      })
      .strict()
      .safeParse({
        organizationId: command.organizationId,
        actorId: command.actorId,
        sourceId: command.sourceId,
        productId: command.productId,
      });
    if (!input.success || !identifiers.success) return this.invalidRequest();

    try {
      const result = await this.repository.createProductImpactOverride(
        identifiers.data.organizationId,
        identifiers.data.actorId,
        identifiers.data.sourceId,
        identifiers.data.productId,
        input.data,
      );
      if (result.outcome !== "created" && result.outcome !== "replayed") {
        return failure(Object.freeze({ code: result.outcome }));
      }
      const parsed = findingProductImpactOverrideResponseSchema.safeParse(
        result.response,
      );
      return parsed.success ? success(parsed.data) : this.malformedProvider();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  async endProductImpactOverride(
    command: Readonly<{
      organizationId: string;
      actorId: string;
      sourceId: string;
      productId: string;
      overrideId: string;
      input: EndFindingProductImpactOverrideInput;
    }>,
  ): Promise<FindingPropagationResult<FindingProductImpactOverrideResponse>> {
    const input = endFindingProductImpactOverrideInputSchema.safeParse(
      command.input,
    );
    const identifiers = z
      .object({
        organizationId: z.uuid(),
        actorId: z.uuid(),
        sourceId: z.uuid(),
        productId: z.uuid(),
        overrideId: z.uuid(),
      })
      .strict()
      .safeParse({
        organizationId: command.organizationId,
        actorId: command.actorId,
        sourceId: command.sourceId,
        productId: command.productId,
        overrideId: command.overrideId,
      });
    if (!input.success || !identifiers.success) return this.invalidRequest();

    try {
      const result = await this.repository.endProductImpactOverride(
        identifiers.data.organizationId,
        identifiers.data.actorId,
        identifiers.data.sourceId,
        identifiers.data.productId,
        identifiers.data.overrideId,
        input.data,
      );
      if (result.outcome !== "ended" && result.outcome !== "replayed") {
        return failure(Object.freeze({ code: result.outcome }));
      }
      const parsed = findingProductImpactOverrideResponseSchema.safeParse(
        result.response,
      );
      return parsed.success ? success(parsed.data) : this.malformedProvider();
    } catch (error) {
      return this.providerFailure(error);
    }
  }

  private invalidRequest(): FindingPropagationResult<never> {
    return failure(Object.freeze({ code: "invalid_request" as const }));
  }

  private malformedProvider(): FindingPropagationResult<never> {
    return failure(Object.freeze({ code: "malformed_provider" as const }));
  }

  private providerFailure(error: unknown): FindingPropagationResult<never> {
    return failure(
      Object.freeze({
        code:
          error instanceof FindingPropagationProviderError &&
          error.code === "malformed"
            ? ("malformed_provider" as const)
            : ("unavailable" as const),
      }),
    );
  }
}
