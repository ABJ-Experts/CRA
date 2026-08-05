// Shared primitives for every contract.
//
// BRD §5.1: "Zod, shared package. One schema per contract, used by API, worker
// and UI." A schema defined here is the SINGLE definition of that shape — the
// API validates against it, the OpenAPI document is generated from it, and the
// UI's types are derived from that document. There is no second copy to drift.

import { z } from "zod";

export const uuid = z.uuid();

/**
 * A timestamp on the wire.
 *
 * §13.1: "ISO 8601 with an explicit UTC offset, always." Contracts model the
 * JSON representation, not the in-process one — several services currently
 * return a Date that Nest serialises on the way out, and stating `string` here
 * is what stops the UI from being handed a type it never actually receives.
 */
export const isoDateTime = z.iso.datetime({ offset: true });

/** Cursor pagination envelope (§13.1 bans offset pagination on collections). */
export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });
}

/**
 * RFC 9457 Problem Details — the error shape for every endpoint (§13.1).
 * Declared once so the generated client can narrow on it.
 */
export const problemDetails = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  /** Matches the server log line for this request (FR-API-004). */
  correlationId: z.string().optional(),
});
export type ProblemDetails = z.infer<typeof problemDetails>;
