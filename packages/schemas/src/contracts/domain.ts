// The domain enumerations, stated once.
//
// These mirror the CHECK constraints in the database (§8.1: "Enumerations are
// text with a CHECK constraint"). Keeping them here means the UI's filter
// dropdowns, the API's validation and the OpenAPI document cannot disagree about
// what a legal value is — a disagreement that otherwise only surfaces as a 500
// when someone picks the wrong one.

import { z } from "zod";

export const productType = z.enum([
  "hardware_with_software",
  "standalone_software",
  "component",
  "remote_data_processing",
]);

export const lifecycleState = z.enum([
  "development",
  "placed_on_market",
  "in_support",
  "end_of_support",
  "withdrawn",
]);

export const craClassification = z.enum([
  "default",
  "important_class_i",
  "important_class_ii",
  "critical",
  "out_of_scope",
  "undetermined",
]);

/** §8.4 finding state machine. */
export const findingState = z.enum([
  "open",
  "in_triage",
  "awaiting_approval",
  "closed",
  "suppressed",
  "reopened",
]);

export const vexStatus = z.enum([
  "not_assessed",
  "under_investigation",
  "affected",
  "not_affected",
  "fixed",
]);

/**
 * FR-TRI-005: constrained to the permitted VEX values. "Free text here would
 * make the VEX output useless downstream."
 */
export const vexJustification = z.enum([
  "component_not_present",
  "vulnerable_code_not_present",
  "vulnerable_code_not_in_execute_path",
  "vulnerable_code_cannot_be_controlled_by_adversary",
  "inline_mitigations_already_exist",
]);

/** FR-MATCH-004 — matcher quality, deliberately distinct from VEX. */
export const falsePositiveReason = z.enum([
  "wrong_version_range",
  "wrong_package",
  "cpe_too_broad",
  "advisory_withdrawn",
  "bad_sbom_data",
  "other",
]);

/** §10.2 match layers. */
export const matchMethod = z.enum(["purl_range", "cpe_match", "manual"]);

export const obligationType = z.enum([
  "actively_exploited_vulnerability",
  "severe_incident",
]);

export const obligationState = z.enum([
  "draft",
  "active",
  "submitted_partial",
  "complete",
  "cancelled",
]);

export const obligationStage = z.enum([
  "early_warning",
  "notification",
  "final_report",
]);

export const obligationStageState = z.enum([
  "pending_anchor",
  "running",
  "submitted",
  "overdue",
  "not_required",
]);

export const sbomValidationStatus = z.enum([
  "valid",
  "valid_with_warnings",
  "invalid",
]);

export const evidenceTamperState = z.enum(["unverified", "intact", "tampered"]);
