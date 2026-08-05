// FR-API-001 / DoD §26.1: regenerate the published OpenAPI contract (openapi.json)
// from the live Nest route decorators. This runs under vitest — the one runtime
// that boots the app with decorator metadata AND resolves the ESM TS workspace
// packages — so `pnpm --filter api openapi` just runs this file.
import './env';
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { AppModule } from './app.module';
import { CONTRACT_COMPONENTS, toOpenApiSchema } from './common';
import { closeDb } from './db';

let app: INestApplication | undefined;
let document: OpenAPIObject;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();

  const config = new DocumentBuilder()
    .setTitle('CRA Sentinel API')
    .setDescription(
      'Product Security & EU Cyber Resilience Act compliance operations platform',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  document = SwaggerModule.createDocument(app, config);

  // The routes' @ApiContract decorators emit $refs; this resolves them into real
  // component schemas. Without it the document names every path and describes no
  // payload — which is exactly what made packages/api-client an empty stub.
  document.components = {
    ...document.components,
    schemas: Object.fromEntries(
      Object.entries(CONTRACT_COMPONENTS).map(([name, schema]) => [
        name,
        toOpenApiSchema(schema),
      ]),
    ),
  };

  writeFileSync(
    join(process.cwd(), 'openapi.json'),
    `${JSON.stringify(document, null, 2)}\n`,
  );
});

afterAll(async () => {
  if (app) await app.close();
  await closeDb();
});

/** Every operation in the document, as [method, path, operation]. */
function operations(): [string, string, Record<string, unknown>][] {
  const out: [string, string, Record<string, unknown>][] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, op] of Object.entries(
      item as Record<string, unknown>,
    )) {
      if (['get', 'post', 'patch', 'put', 'delete'].includes(method)) {
        out.push([method, path, op as Record<string, unknown>]);
      }
    }
  }
  return out;
}

describe('FR-API-001 — OpenAPI document is generated and published', () => {
  it('covers every controller surface', () => {
    const paths = Object.keys(document.paths);
    for (const surface of [
      '/organisations',
      '/products',
      '/releases',
      '/findings',
      '/obligations',
      '/dashboard',
      '/evidence',
    ]) {
      expect(paths).toContain(surface);
    }
  });

  it('describes a response body for every operation', () => {
    // The gate this file previously lacked. A document that lists paths and no
    // payloads passes a "was it generated?" check while being useless to a
    // client generator — which is how the contract silently stopped being one.
    const undocumented = operations()
      .filter(([, path]) => path !== '/')
      .filter(([, , op]) => {
        const responses = (op.responses ?? {}) as Record<
          string,
          { content?: unknown }
        >;
        return !Object.entries(responses)
          .filter(([status]) => status.startsWith('2'))
          .some(([, r]) => Boolean(r.content));
      })
      .map(([method, path]) => `${method.toUpperCase()} ${path}`);

    expect(undocumented).toEqual([]);
  });

  it('resolves every $ref against a registered component', () => {
    // A typo'd component name yields a dangling $ref, which openapi-typescript
    // turns into `unknown` rather than an error — a silent loss of type safety.
    const declared = new Set(
      Object.keys(document.components?.schemas ?? {}).map(
        (n) => `#/components/schemas/${n}`,
      ),
    );
    const refs = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (k === '$ref' && typeof v === 'string') refs.add(v);
          else walk(v);
        }
      }
    };
    walk(document.paths);
    expect([...refs].filter((r) => !declared.has(r))).toEqual([]);
  });

  it('declares request bodies for unsafe methods that take one', () => {
    const missing = operations()
      .filter(([method]) => method === 'post' || method === 'patch')
      // The tick endpoint is a trigger with no payload.
      .filter(([, path]) => !path.endsWith('/tick'))
      .filter(([, , op]) => !op.requestBody)
      .map(([method, path]) => `${method.toUpperCase()} ${path}`);

    expect(missing).toEqual([]);
  });
});
