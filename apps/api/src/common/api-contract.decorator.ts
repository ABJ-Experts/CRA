// FR-API-001/002 — one decorator that ties a route to its Zod contract, so the
// published OpenAPI document carries real request and response bodies.
//
// Why this exists. SwaggerModule reflects over @ApiProperty-decorated DTO
// classes. This codebase validates with Zod and returns plain interfaces, so
// there was nothing for it to reflect: openapi.json listed 22 paths and not one
// schema, which is why packages/api-client was an empty stub. A document that
// names every route but describes no payload satisfies FR-API-001 on paper and
// is useless to a client generator.
//
// Zod 4 emits JSON Schema natively, so the contract in @repo/schemas can be the
// single source and the document is still generated from decorators (§13.1)
// rather than hand-maintained beside the code.

import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiQuery, ApiResponse } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { z } from 'zod';

/**
 * Named components, so the document (and the generated client) use $ref rather
 * than repeating a schema at every operation that returns it. Add a schema here
 * and reference it by this key from a route's contract.
 */
export const CONTRACT_COMPONENTS: Record<string, z.ZodType> = {};

/** Register a named component and return its key, for use in a route contract. */
export function registerComponent(name: string, schema: z.ZodType): string {
  CONTRACT_COMPONENTS[name] = schema;
  return name;
}

export function componentRef(name: string): SchemaObject {
  return { $ref: `#/components/schemas/${name}` } as SchemaObject;
}

/**
 * Convert a Zod contract to OpenAPI 3.0 JSON Schema.
 *
 * `io: 'output'` matters: a schema using z.coerce (every query filter does)
 * describes a permissive INPUT and a narrow OUTPUT. Documenting the output shape
 * for responses is what stops the client's types being wider than reality.
 */
export function toOpenApiSchema(
  schema: z.ZodType,
  io: 'input' | 'output' = 'output',
): SchemaObject {
  return z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    // A cycle would otherwise throw at generation time rather than at review.
    cycles: 'ref',
    unrepresentable: 'any',
  }) as SchemaObject;
}

export interface RouteContract {
  /** Component name for the response body, registered via registerComponent. */
  response: string;
  /** True when the route returns a collection of `response`. */
  array?: boolean;
  status?: number;
  body?: z.ZodType;
  /** Object schema whose top-level keys become query parameters. */
  query?: z.ZodObject;
  description?: string;
}

/** Query parameters, derived from the contract instead of restated by hand. */
function queryDecorators(schema: z.ZodObject): MethodDecorator[] {
  const shape = schema.shape;
  return Object.entries(shape).map(([name, field]) => {
    const f = field as z.ZodType;
    const required = !f.safeParse(undefined).success;
    return ApiQuery({
      name,
      required,
      schema: toOpenApiSchema(f, 'input'),
    });
  });
}

/**
 * Declare a route's contract. The response is mandatory: a route with no
 * documented response body is precisely the hole this decorator closes, and
 * openapi.spec.ts fails the build when one is missing.
 */
export function ApiContract(contract: RouteContract): MethodDecorator {
  const ref = componentRef(contract.response);
  const decorators: MethodDecorator[] = [
    ApiResponse({
      status: contract.status ?? 200,
      description: contract.description ?? '',
      schema: contract.array ? { type: 'array', items: ref } : ref,
    }),
  ];

  if (contract.body) {
    decorators.push(
      ApiBody({ schema: toOpenApiSchema(contract.body, 'input') }),
    );
  }
  if (contract.query) {
    decorators.push(...queryDecorators(contract.query));
  }

  return applyDecorators(...decorators);
}
