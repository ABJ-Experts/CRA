import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { auditRangeJobSchema } from "@repo/contracts/audit/schemas";
import { sessionResponseSchema } from "@repo/contracts/auth/schemas";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { App } from "supertest/types";
import { AppModule } from "../src/app.module";
import { AuditService } from "../src/audit/audit.service";
import { AuditRangeWorker } from "../src/audit/range/audit-range-worker";
import { SupabaseAuditRangeRepository } from "../src/audit/range/infrastructure/supabase-audit-range.repository";
import { SupabaseService } from "../src/supabase/supabase.service";
import { API_PREFIX } from "../src/auth/cookies.util";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";

/** Retained development evidence is append-only; corruption fixtures live elsewhere. */
describe("Audit range HTTP and worker (local stack)", () => {
  let app: INestApplication<App>;
  const path = `/${API_PREFIX}/audit/chain-verifications`;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(API_PREFIX);
    app.use(cookieParser());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  }, 30_000);
  afterAll(async () => {
    await app?.close();
  }, 30_000);
  async function login(email = "owner@cra.test") {
    const client = request.agent(app.getHttpServer());
    await client
      .post(`/${API_PREFIX}/auth/sign-in`)
      .send({ email, password: "Password123", remember: false })
      .timeout(15_000)
      .expect(200);
    const session = sessionResponseSchema.parse(
      (await client.get(`/${API_PREFIX}/auth/session`).expect(200)).body,
    );
    if (!session.organization) throw new Error("Missing seeded organization");
    return {
      client,
      userId: session.user.id,
      organizationId: session.organization.id,
    };
  }
  async function append(organizationId: string, userId: string) {
    const recorded = await app.get(AuditService).recordV2(organizationId, {
      organizationId,
      scope: "organization",
      eventKey: `range-http:${randomUUID()}`,
      actorType: "user",
      actorId: userId,
      userId,
      action: "organization.audit_range_test",
      entityType: "organization",
      entityId: organizationId,
      outcome: "completed",
      correlationId: randomUUID(),
      beforeRedacted: null,
      afterRedacted: { checked: true },
      reason: null,
      ipAddress: null,
      userAgent: null,
    });
    const row = await app
      .get(SupabaseService)
      .admin()
      .from("audit_logs")
      .select("chain_sequence")
      .eq("organization_id", organizationId)
      .eq("id", recorded.auditId)
      .single();
    if (row.error || row.data?.chain_sequence == null)
      throw new Error("Missing appended sequence");
    return String(row.data.chain_sequence);
  }
  it("denies unauthenticated and restricted identities before disclosure", async () => {
    await request(app.getHttpServer())
      .post(path)
      .send({ requestId: randomUUID() })
      .expect(401);
    const { client } = await login("viewer@cra.test");
    await client.post(path).send({ requestId: randomUUID() }).expect(403);
  }, 30_000);
  it("replays creation, freezes appends, and completes a source-authorized partial range", async () => {
    const { client, organizationId, userId } = await login();
    const first = await append(organizationId, userId);
    const second = await append(organizationId, userId);
    const input = {
      requestId: randomUUID(),
      fromSequence: first,
      toSequence: second,
    };
    const job = auditRangeJobSchema.parse(
      (await client.post(path).send(input).expect(202)).body,
    );
    expect(
      auditRangeJobSchema.parse(
        (await client.post(path).send(input).expect(202)).body,
      ).id,
    ).toBe(job.id);
    await client
      .post(path)
      .send({ ...input, fromSequence: second })
      .expect(409);
    await client
      .post(path)
      .send({ ...input, requestId: randomUUID(), organizationId: randomUUID() })
      .expect(400);
    const concurrent = await append(organizationId, userId);
    expect(BigInt(concurrent)).toBeGreaterThan(BigInt(second));
    const worker = new AuditRangeWorker({
      repository: app.get(SupabaseAuditRangeRepository),
    });
    let status = job;
    for (let iteration = 0; iteration < 30; iteration += 1) {
      await worker.runOnce();
      status = auditRangeJobSchema.parse(
        (
          await client
            .get(`${path}/${job.id}`)
            .query({ requestId: randomUUID() })
            .expect(200)
        ).body,
      );
      if (["completed", "failed", "stale"].includes(status.status)) break;
    }
    expect(status.status).toBe("completed");
    expect(status.result?.outcome).toBe("consistent");
    expect(status.result?.checkedRange).toEqual({ from: first, to: second });
    expect(status.result?.completeLedgerVerified).toBe(false);
    expect(status.result?.authenticityProven).toBe(false);
    const samples: number[] = [];
    for (let iteration = 0; iteration < 55; iteration += 1) {
      const started = performance.now();
      auditRangeJobSchema.parse(
        (
          await client
            .get(`${path}/${job.id}`)
            .query({ requestId: randomUUID() })
            .expect(200)
        ).body,
      );
      if (iteration >= 5) samples.push(performance.now() - started);
    }
    const sorted = [...samples].sort((left, right) => left - right);
    const p95 = sorted[47]!;
    const p99 = sorted[49]!;
    await writeFile(
      "/tmp/cra-m13-04-http-latency.json",
      JSON.stringify(
        {
          measuredPath:
            "Authenticated Nest HTTP status -> PostgREST -> retained CRA development database; 50 sequential samples after 5 warmups within the existing rate limit, separate from million-row disposable benchmark",
          samples: samples.length,
          p95Ms: p95,
          p99Ms: p99,
        },
        null,
        2,
      ),
    );
    expect(p95).toBeLessThan(400);
    expect(p99).toBeLessThan(1000);
  }, 60_000);
  it("fences cancellation, replays it, and resumes with optimistic versions", async () => {
    const { client, organizationId, userId } = await login();
    const sequence = await append(organizationId, userId);
    const job = auditRangeJobSchema.parse(
      (
        await client
          .post(path)
          .send({
            requestId: randomUUID(),
            fromSequence: sequence,
            toSequence: sequence,
          })
          .expect(202)
      ).body,
    );
    const operation = { requestId: randomUUID(), expectedVersion: job.version };
    const cancelled = auditRangeJobSchema.parse(
      (
        await client
          .post(`${path}/${job.id}/cancel`)
          .send(operation)
          .expect(200)
      ).body,
    );
    expect(cancelled.status).toBe("cancelled");
    expect(
      auditRangeJobSchema.parse(
        (
          await client
            .post(`${path}/${job.id}/cancel`)
            .send(operation)
            .expect(200)
        ).body,
      ).version,
    ).toBe(cancelled.version);
    await client
      .post(`${path}/${job.id}/resume`)
      .send({ requestId: randomUUID(), expectedVersion: job.version })
      .expect(409);
    const resumed = auditRangeJobSchema.parse(
      (
        await client
          .post(`${path}/${job.id}/resume`)
          .send({ requestId: randomUUID(), expectedVersion: cancelled.version })
          .expect(202)
      ).body,
    );
    expect(resumed.status).toBe("queued");
    await client
      .post(`${path}/${job.id}/cancel`)
      .send({ requestId: randomUUID(), expectedVersion: resumed.version })
      .expect(200);
  }, 30_000);
});
