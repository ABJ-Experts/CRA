import type { z } from "zod";

import type {
  archiveSupplierContactInputSchema,
  archiveSupplierInputSchema,
  associateSupplierRequestInputSchema,
  createSupplierContactInputSchema,
  createSupplierInputSchema,
  createSupplierResponsibilityInputSchema,
  endSupplierResponsibilityInputSchema,
  findingResponsibleSuppliersParamsSchema,
  findingResponsibleSuppliersResolutionSchema,
  findingResponsibleSuppliersResponseSchema,
  supplierContactResponseSchema,
  supplierContactSchema,
  supplierContactParamsSchema,
  supplierCriticalitySchema,
  supplierDetailSchema,
  supplierDuplicateCandidateSchema,
  supplierDuplicateCandidatesResponseSchema,
  supplierListQuerySchema,
  supplierParamsSchema,
  supplierRequestParamsSchema,
  supplierResponsibilityParamsSchema,
  supplierResponsibilityProvenanceSchema,
  supplierResponsibilityResponseSchema,
  supplierResponsibilitySchema,
  supplierResponseSchema,
  supplierSummarySchema,
  suppliersResponseSchema,
  updateSupplierContactInputSchema,
  updateSupplierInputSchema,
} from "../schemas/index.js";

export type SupplierCriticality = z.output<typeof supplierCriticalitySchema>;
export type SupplierResponsibilityProvenance = z.output<
  typeof supplierResponsibilityProvenanceSchema
>;
export type SupplierListQuery = z.output<typeof supplierListQuerySchema>;
export type SupplierParams = z.output<typeof supplierParamsSchema>;
export type SupplierContactParams = z.output<
  typeof supplierContactParamsSchema
>;
export type SupplierResponsibilityParams = z.output<
  typeof supplierResponsibilityParamsSchema
>;
export type SupplierRequestParams = z.output<
  typeof supplierRequestParamsSchema
>;
export type FindingResponsibleSuppliersParams = z.output<
  typeof findingResponsibleSuppliersParamsSchema
>;
export type CreateSupplierInput = z.output<typeof createSupplierInputSchema>;
export type UpdateSupplierInput = z.output<typeof updateSupplierInputSchema>;
export type ArchiveSupplierInput = z.output<typeof archiveSupplierInputSchema>;
export type CreateSupplierContactInput = z.output<
  typeof createSupplierContactInputSchema
>;
export type UpdateSupplierContactInput = z.output<
  typeof updateSupplierContactInputSchema
>;
export type ArchiveSupplierContactInput = z.output<
  typeof archiveSupplierContactInputSchema
>;
export type CreateSupplierResponsibilityInput = z.output<
  typeof createSupplierResponsibilityInputSchema
>;
export type EndSupplierResponsibilityInput = z.output<
  typeof endSupplierResponsibilityInputSchema
>;
export type AssociateSupplierRequestInput = z.output<
  typeof associateSupplierRequestInputSchema
>;
export type SupplierSummary = z.output<typeof supplierSummarySchema>;
export type SupplierDetail = z.output<typeof supplierDetailSchema>;
export type SupplierDuplicateCandidate = z.output<
  typeof supplierDuplicateCandidateSchema
>;
export type SupplierContact = z.output<typeof supplierContactSchema>;
export type SupplierResponsibility = z.output<
  typeof supplierResponsibilitySchema
>;
export type SupplierResponse = z.output<typeof supplierResponseSchema>;
export type SuppliersResponse = z.output<typeof suppliersResponseSchema>;
export type SupplierContactResponse = z.output<
  typeof supplierContactResponseSchema
>;
export type SupplierResponsibilityResponse = z.output<
  typeof supplierResponsibilityResponseSchema
>;
export type SupplierDuplicateCandidatesResponse = z.output<
  typeof supplierDuplicateCandidatesResponseSchema
>;
export type FindingResponsibleSuppliersResolution = z.output<
  typeof findingResponsibleSuppliersResolutionSchema
>;
export type FindingResponsibleSuppliersResponse = z.output<
  typeof findingResponsibleSuppliersResponseSchema
>;
