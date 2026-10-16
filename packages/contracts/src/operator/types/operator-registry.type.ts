import type { z } from "zod";
import type {
  operatorInstancesQuerySchema,
  operatorTenantsQuerySchema,
  operatorInstanceMetadataQuerySchema,
  operatorEmptyQuerySchema,
  operatorInstanceParamsSchema,
  operatorSourceObservationSchema,
  operatorLicenceSummarySchema,
  operatorInstanceSummarySchema,
  operatorTenantSummarySchema,
  operatorInstancesResponseSchema,
  operatorInstanceResponseSchema,
  operatorTenantsResponseSchema,
  operatorSessionResponseSchema,
  operatorInstanceMetadataResponseSchema,
  operatorRegistryPublicationSchema,
} from "../schemas/operator-registry.schema.js";

export type OperatorInstancesQuery = z.output<
  typeof operatorInstancesQuerySchema
>;
export type OperatorTenantsQuery = z.output<typeof operatorTenantsQuerySchema>;
export type OperatorInstanceMetadataQuery = z.output<
  typeof operatorInstanceMetadataQuerySchema
>;
export type OperatorEmptyQuery = z.output<typeof operatorEmptyQuerySchema>;
export type OperatorInstanceParams = z.output<
  typeof operatorInstanceParamsSchema
>;
export type OperatorSourceObservation = z.output<
  typeof operatorSourceObservationSchema
>;
export type OperatorLicenceSummary = z.output<
  typeof operatorLicenceSummarySchema
>;
export type OperatorInstanceSummary = z.output<
  typeof operatorInstanceSummarySchema
>;
export type OperatorTenantSummary = z.output<
  typeof operatorTenantSummarySchema
>;
export type OperatorInstancesResponse = z.output<
  typeof operatorInstancesResponseSchema
>;
export type OperatorInstanceResponse = z.output<
  typeof operatorInstanceResponseSchema
>;
export type OperatorTenantsResponse = z.output<
  typeof operatorTenantsResponseSchema
>;
export type OperatorSessionResponse = z.output<
  typeof operatorSessionResponseSchema
>;
export type OperatorInstanceMetadataResponse = z.output<
  typeof operatorInstanceMetadataResponseSchema
>;
export type OperatorRegistryPublication = z.output<
  typeof operatorRegistryPublicationSchema
>;
