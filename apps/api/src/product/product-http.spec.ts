// Step 4 HTTP pipeline end-to-end: JWT auth -> RBAC -> withTenant -> RFC 9457.
import '../env';
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { sign } from 'jsonwebtoken';
import { uuidv7 } from 'uuidv7';
import { Pool } from 'pg';
import { AppModule } from '../app.module';
import { OrgController } from '../org/org.controller';
import { ProductController } from './product.controller';
import { SbomController } from '../sbom/sbom.controller';
import { TriageController } from '../triage/triage.controller';
import { ObligationController } from '../workflow/obligation.controller';
import { AnalyticsController } from '../analytics/analytics.controller';
import { EvidenceController } from '../evidence/evidence.controller';
import { PERMISSIONS_KEY, PUBLIC_KEY, AUTH_ONLY_KEY } from '../common';
import { closeDb } from '../db';

const SECRET = process.env.SUPABASE_JWT_SECRET ?? '';
function bearer(sub: string, email: string, mfa = true): string {
  return `Bearer ${sign(
    { sub, email, aal: mfa ? 'aal2' : 'aal1', role: 'authenticated' },
    SECRET,
    { algorithm: 'HS256', expiresIn: '1h' },
  )}`;
}

let app: INestApplication;
let seed: Pool;
const OWNER = uuidv7();
const EXEC_SUPA = uuidv7();
const EXEC_USER = uuidv7();
let orgId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  seed = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
});

afterAll(async () => {
  await app.close();
  await seed.end();
  await closeDb();
});

describe('FR-IAM-001 — every route declares a permission (or @Public/@RequireAuth)', () => {
  type Ctor = new (...args: never[]) => object;
  function undeclared(controller: Ctor): string[] {
    const proto = controller.prototype as Record<string, unknown>;
    return Object.getOwnPropertyNames(proto)
      .filter((n) => n !== 'constructor' && typeof proto[n] === 'function')
      .filter((n) => {
        const fn = proto[n] as object;
        if (Reflect.getMetadata('path', fn) === undefined) return false; // not a route
        return (
          Reflect.getMetadata(PERMISSIONS_KEY, fn) === undefined &&
          Reflect.getMetadata(PUBLIC_KEY, fn) === undefined &&
          Reflect.getMetadata(AUTH_ONLY_KEY, fn) === undefined
        );
      });
  }

  // Every HTTP controller in the app must declare a permission (or @Public/
  // @RequireAuth) on every route — DoD §26.1 item 2. Adding a controller without
  // a decorator fails the build here.
  const ALL_CONTROLLERS: Ctor[] = [
    OrgController,
    ProductController,
    SbomController,
    TriageController,
    ObligationController,
    AnalyticsController,
    EvidenceController,
  ];

  it('no controller has an undeclared route', () => {
    const offenders = ALL_CONTROLLERS.flatMap((c) =>
      undeclared(c).map((route) => `${c.name}.${route}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe('product HTTP pipeline', () => {
  it('401 without a token', async () => {
    await request(app.getHttpServer())
      .get('/products')
      .set('x-organisation-id', uuidv7())
      .expect(401);
  });

  it('onboarding creates an org (RequireAuth, no active org yet)', async () => {
    const res = await request(app.getHttpServer())
      .post('/organisations')
      .set('authorization', bearer(OWNER, 'owner@http.test'))
      .send({ legalName: 'HTTP Co', countryMainEstablishment: 'DE' })
      .expect(201);
    orgId = (res.body as { id: string }).id;
    expect(orgId).toBeTruthy();
  });

  it('owner can create and list products', async () => {
    const token = bearer(OWNER, 'owner@http.test');
    await request(app.getHttpServer())
      .post('/products')
      .set('authorization', token)
      .set('x-organisation-id', orgId)
      .send({ name: 'Router', internalCode: 'R1' })
      .expect(201);
    const list = await request(app.getHttpServer())
      .get('/products')
      .set('authorization', token)
      .set('x-organisation-id', orgId)
      .expect(200);
    expect(
      (list.body as { internalCode: string }[]).map((p) => p.internalCode),
    ).toContain('R1');
  });

  it('an exec member is forbidden from creating a product (403)', async () => {
    await seed.query(
      `insert into user_account(id,supabase_user_id,email) values ($1,$2,'exec@http.test') on conflict do nothing`,
      [EXEC_USER, EXEC_SUPA],
    );
    await seed.query(
      `insert into org_member(id,organisation_id,user_account_id,role_id)
       values ($1,$2,$3,'01000000-0000-7000-8000-000000000007') on conflict do nothing`,
      [uuidv7(), orgId, EXEC_USER],
    );
    await request(app.getHttpServer())
      .post('/products')
      .set('authorization', bearer(EXEC_SUPA, 'exec@http.test'))
      .set('x-organisation-id', orgId)
      .send({ name: 'Nope', internalCode: 'N1' })
      .expect(403);
  });

  it('not-found returns RFC 9457 problem+json (404)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/products/${uuidv7()}`)
      .set('authorization', bearer(OWNER, 'owner@http.test'))
      .set('x-organisation-id', orgId)
      .expect(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 404 });
  });

  it('invalid body -> 400 (Zod validation at the boundary)', async () => {
    await request(app.getHttpServer())
      .post('/products')
      .set('authorization', bearer(OWNER, 'owner@http.test'))
      .set('x-organisation-id', orgId)
      .send({ name: '' })
      .expect(400);
  });
});
