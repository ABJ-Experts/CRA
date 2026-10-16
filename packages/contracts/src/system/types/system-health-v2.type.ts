import type { z } from "zod";
import type {
  customerSystemHealthV2QuerySchema,
  customerSystemHealthV2ResponseSchema,
  customerSystemHealthVersionedQuerySchema,
  customerSystemHealthVersionedResponseSchema,
  systemHealthV2ComponentSchema,
} from "../schemas/system-health-v2.schema.js";
export type CustomerSystemHealthV2Query = z.output<
  typeof customerSystemHealthV2QuerySchema
>;
export type CustomerSystemHealthV2Response = z.output<
  typeof customerSystemHealthV2ResponseSchema
>;
export type CustomerSystemHealthVersionedQuery = z.output<
  typeof customerSystemHealthVersionedQuerySchema
>;
export type CustomerSystemHealthVersionedResponse = z.output<
  typeof customerSystemHealthVersionedResponseSchema
>;
export type SystemHealthV2Component = z.output<
  typeof systemHealthV2ComponentSchema
>;
