import type { z } from "zod";

import type {
  claimFindingPropagationJobInputSchema,
  createFindingProductImpactOverrideInputSchema,
  createFindingProductImpactOverrideParamsSchema,
  endFindingProductImpactOverrideInputSchema,
  findingImpactAssociationSchema,
  findingImpactSummaryQuerySchema,
  findingImpactSummaryResponseSchema,
  findingProductImpactOverrideParamsSchema,
  findingProductImpactOverrideSchema,
  findingPropagationEnqueueScopeSchema,
  enqueueFindingPropagationSourcePageInputSchema,
  enqueueFindingPropagationSourcePageResultSchema,
  findingPropagationJobSchema,
  findingPropagationSourceParamsSchema,
  findingPropagationSourceMutationResponseSchema,
  findingPropagationSourceMutationSchema,
  findingPropagationSourceSchema,
  persistFindingPropagationPageInputSchema,
  registerFindingPropagationSourceInputSchema,
  updateFindingPropagationSourceInputSchema,
} from "../schemas/index.js";

export type RegisterFindingPropagationSourceInput = z.output<
  typeof registerFindingPropagationSourceInputSchema
>;
export type UpdateFindingPropagationSourceInput = z.output<
  typeof updateFindingPropagationSourceInputSchema
>;
export type FindingPropagationSourceParams = z.output<
  typeof findingPropagationSourceParamsSchema
>;
export type FindingPropagationSource = z.output<
  typeof findingPropagationSourceSchema
>;
export type FindingPropagationSourceMutation = z.output<
  typeof findingPropagationSourceMutationSchema
>;
export type FindingPropagationSourceMutationResponse = z.output<
  typeof findingPropagationSourceMutationResponseSchema
>;
export type FindingImpactAssociation = z.output<
  typeof findingImpactAssociationSchema
>;
export type FindingImpactSummaryQuery = z.output<
  typeof findingImpactSummaryQuerySchema
>;
export type FindingImpactSummaryResponse = z.output<
  typeof findingImpactSummaryResponseSchema
>;
export type FindingProductImpactOverrideParams = z.output<
  typeof findingProductImpactOverrideParamsSchema
>;
export type CreateFindingProductImpactOverrideInput = z.output<
  typeof createFindingProductImpactOverrideInputSchema
>;
export type CreateFindingProductImpactOverrideParams = z.output<
  typeof createFindingProductImpactOverrideParamsSchema
>;
export type EndFindingProductImpactOverrideInput = z.output<
  typeof endFindingProductImpactOverrideInputSchema
>;
export type FindingProductImpactOverride = z.output<
  typeof findingProductImpactOverrideSchema
>;
export type FindingPropagationEnqueueScope = z.output<
  typeof findingPropagationEnqueueScopeSchema
>;
export type EnqueueFindingPropagationSourcePageInput = z.output<
  typeof enqueueFindingPropagationSourcePageInputSchema
>;
export type EnqueueFindingPropagationSourcePageResult = z.output<
  typeof enqueueFindingPropagationSourcePageResultSchema
>;
export type FindingPropagationJob = z.output<
  typeof findingPropagationJobSchema
>;
export type ClaimFindingPropagationJobInput = z.output<
  typeof claimFindingPropagationJobInputSchema
>;
export type PersistFindingPropagationPageInput = z.output<
  typeof persistFindingPropagationPageInputSchema
>;
