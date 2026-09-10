import type { z } from "zod";

import type {
  acquireReportingStageDraftLockInputSchema,
  acquireReportingStageDraftLockResponseSchema,
  applyReportingFamilyTemplateInputSchema,
  createReportingFamilyTemplateInputSchema,
  createReportingFamilyTemplateVersionInputSchema,
  createReportingStageDraftInputSchema,
  reportingFamilyTemplateListQuerySchema,
  reportingFamilyTemplateParamsSchema,
  reportingFamilyTemplateResponseSchema,
  reportingFamilyTemplateSchema,
  reportingFamilyTemplatesResponseSchema,
  reportingStageDraftConflictResponseSchema,
  reportingStageDraftSchema,
  reportingStageDraftParamsSchema,
  reportingStageDraftResponseSchema,
  reportingStageSubmissionSnapshotResponseSchema,
  saveReportingStageDraftInputSchema,
  submitReportingStageDraftInputSchema,
} from "../schemas/reporting-stage-drafts.schema.js";

export type ReportingStageDraft = z.output<typeof reportingStageDraftSchema>;
export type ReportingStageDraftParams = z.output<
  typeof reportingStageDraftParamsSchema
>;
export type CreateReportingStageDraftInput = z.output<
  typeof createReportingStageDraftInputSchema
>;
export type AcquireReportingStageDraftLockInput = z.output<
  typeof acquireReportingStageDraftLockInputSchema
>;
export type AcquireReportingStageDraftLockResponse = z.output<
  typeof acquireReportingStageDraftLockResponseSchema
>;
export type SaveReportingStageDraftInput = z.output<
  typeof saveReportingStageDraftInputSchema
>;
export type SubmitReportingStageDraftInput = z.output<
  typeof submitReportingStageDraftInputSchema
>;
export type ReportingStageDraftResponse = z.output<
  typeof reportingStageDraftResponseSchema
>;
export type ReportingStageDraftConflictResponse = z.output<
  typeof reportingStageDraftConflictResponseSchema
>;
export type ReportingStageSubmissionSnapshotResponse = z.output<
  typeof reportingStageSubmissionSnapshotResponseSchema
>;
export type ReportingFamilyTemplate = z.output<
  typeof reportingFamilyTemplateSchema
>;
export type ReportingFamilyTemplateParams = z.output<
  typeof reportingFamilyTemplateParamsSchema
>;
export type ReportingFamilyTemplateListQuery = z.output<
  typeof reportingFamilyTemplateListQuerySchema
>;
export type CreateReportingFamilyTemplateInput = z.output<
  typeof createReportingFamilyTemplateInputSchema
>;
export type CreateReportingFamilyTemplateVersionInput = z.output<
  typeof createReportingFamilyTemplateVersionInputSchema
>;
export type ApplyReportingFamilyTemplateInput = z.output<
  typeof applyReportingFamilyTemplateInputSchema
>;
export type ReportingFamilyTemplateResponse = z.output<
  typeof reportingFamilyTemplateResponseSchema
>;
export type ReportingFamilyTemplatesResponse = z.output<
  typeof reportingFamilyTemplatesResponseSchema
>;
