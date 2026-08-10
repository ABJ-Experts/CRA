import {
  createOrganizationInputSchema,
  currentOrganizationResponseSchema,
  onboardingResponseSchema,
  organizationSchema,
  switchOrganizationInputSchema,
  switchOrganizationResponseSchema,
  updateLegalProfileInputSchema,
  type CreateOrganizationInput,
  type UpdateLegalProfileInput,
} from "@repo/contracts";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";

/** Typed browser boundary for the server-authoritative organization workflow. */
export class OrganizationsApi {
  create(input: CreateOrganizationInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations",
      method: "POST",
      body: input,
      inputSchema: createOrganizationInputSchema,
      signal,
      schema: organizationSchema,
    });
  }

  current(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current",
      method: "GET",
      signal,
      schema: currentOrganizationResponseSchema,
    });
  }

  updateLegalProfile(input: UpdateLegalProfileInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/legal-profile",
      method: "PATCH",
      body: input,
      inputSchema: updateLegalProfileInputSchema,
      signal,
      schema: organizationSchema,
    });
  }

  switch(organizationId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/switch",
      method: "POST",
      body: { organizationId },
      inputSchema: switchOrganizationInputSchema,
      signal,
      schema: switchOrganizationResponseSchema,
    });
  }

  onboarding(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/organizations/current/onboarding",
      method: "GET",
      signal,
      schema: onboardingResponseSchema,
    });
  }
}

export const organizationsApi = Object.freeze(new OrganizationsApi());
