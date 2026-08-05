// @repo/api-client — the typed client for the CRA Sentinel API (FR-API-001:
// "OpenAPI generated at build time and published, with a typed client generated
// from it for the frontend").
//
// src/generated.ts is produced by `pnpm --filter @repo/api-client generate` from
// apps/api/openapi.json and is committed, so a contract change shows up as a
// reviewable diff rather than being discovered at runtime. generated.spec.ts
// fails when the checked-in file drifts from the current document.
//
// The aliases below exist because `components['schemas']['Finding']` is not a
// type anybody wants to write in a component's props.

import type { components, paths } from "./generated";

export type * from "./generated";

export type Schemas = components["schemas"];
export type ApiPaths = paths;

export type Organisation = Schemas["Organisation"];
export type CreatedResource = Schemas["CreatedResource"];
export type Product = Schemas["Product"];
export type Release = Schemas["Release"];
export type SbomIngest = Schemas["SbomIngest"];
export type Finding = Schemas["Finding"];
export type FindingPage = Schemas["FindingPage"];
export type FalsePositiveRate = Schemas["FalsePositiveRate"];
export type Obligation = Schemas["Obligation"];
export type ObligationStage = Schemas["ObligationStage"];
export type ObligationTick = Schemas["ObligationTick"];
export type Evidence = Schemas["Evidence"];
export type Dashboard = Schemas["Dashboard"];

/**
 * RFC 9457 Problem Details (§13.1). Every error carries a stable machine
 * readable `type` and a correlationId matching the server log line.
 */
export type ProblemDetails = Schemas["ProblemDetails"];

/** A GET route's 200 body, keyed by path. */
export type GetResponse<P extends keyof ApiPaths> = ApiPaths[P] extends {
  get: { responses: { 200: { content: { "application/json": infer R } } } };
}
  ? R
  : never;

/** A POST route's success body, keyed by path (201 preferred, else 200). */
export type PostResponse<P extends keyof ApiPaths> = ApiPaths[P] extends {
  post: { responses: infer Responses };
}
  ? Responses extends { 201: { content: { "application/json": infer R } } }
    ? R
    : Responses extends { 200: { content: { "application/json": infer R } } }
      ? R
      : never
  : never;

/** A POST route's request body, keyed by path. */
export type PostBody<P extends keyof ApiPaths> = ApiPaths[P] extends {
  post: { requestBody?: { content: { "application/json": infer B } } };
}
  ? B
  : never;
