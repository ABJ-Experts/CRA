import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  auditDetailSchema,
  auditExportJobSchema,
  auditPageSchema,
  auditSnapshotSchema,
  auditVerificationResultSchema,
} from "@repo/contracts/audit/schemas";
import { sessionResponseSchema } from "@repo/contracts/auth/schemas";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { App } from "supertest/types";

import { AppModule } from "../src/app.module";
import { AuditService } from "../src/audit/audit.service";
import { SupabaseService } from "../src/supabase/supabase.service";
import { API_PREFIX } from "../src/auth/cookies.util";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";

/** Real HTTP/transaction regression: only append audit evidence; never reset/delete. */
describe("Audit explorer HTTP boundary (local stack)", () => {
  let app: INestApplication<App>;
  let audit: AuditService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(API_PREFIX);
    app.use(cookieParser());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    audit = app.get(AuditService);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  async function login(email = "owner@cra.test") {
    const client = request.agent(app.getHttpServer());
    await client
      .post(`/${API_PREFIX}/auth/sign-in`)
      .send({ email, password: "Password123", remember: false })
      .expect(200);
    const session = sessionResponseSchema.parse(
      (await client.get(`/${API_PREFIX}/auth/session`).expect(200)).body,
    );
    if (!session.organization)
      throw new Error("Seeded local account has no organization");
    return {
      client,
      userId: session.user.id,
      organizationId: session.organization.id,
    };
  }

  const filters = () => ({
    from: new Date(Date.now() - 60_000).toISOString(),
    to: new Date(Date.now() + 60_000).toISOString(),
    resourceType: "organization",
  });

  it("requires authentication and separate audit permission", async () => {
    await request(app.getHttpServer())
      .post(`/${API_PREFIX}/audit/searches`)
      .send({ requestId: randomUUID(), filters: filters() })
      .expect(401);
    const { client } = await login("viewer@cra.test");
    await client
      .post(`/${API_PREFIX}/audit/searches`)
      .send({ requestId: randomUUID(), filters: filters() })
      .expect(403);
    await client
      .post(`/${API_PREFIX}/audit/exports`)
      .send({
        requestId: randomUUID(),
        snapshotToken: "forged",
        format: "json",
      })
      .expect(403);
  }, 30_000);

  it("freezes filtered pages before its own receipts and concurrent appends; exposes redacted details and honest verification", async () => {
    const { client, userId, organizationId } = await login();
    const correlationId = randomUUID();
    const action = "organization.audit_explorer_test";
    async function append() {
      const result = await audit.recordV2(organizationId, {
        organizationId,
        scope: "organization",
        eventKey: `audit-http:${randomUUID()}`,
        actorType: "user",
        actorId: userId,
        userId,
        action,
        entityType: "organization",
        entityId: organizationId,
        outcome: "completed",
        correlationId,
        beforeRedacted: null,
        afterRedacted: {
          enabled: true,
          count: 3,
          secret: "DO_NOT_DISCLOSE_AUDIT_HTTP_FIXTURE",
        },
        reason: null,
        ipAddress: null,
        userAgent: null,
      });
      return result.auditId;
    }
    const first = await append();
    const second = await append();
    const input = {
      requestId: randomUUID(),
      filters: {
        ...filters(),
        actorId: userId,
        action,
        resourceId: organizationId,
        correlationId,
      },
    };
    const snapshot = auditSnapshotSchema.parse(
      (
        await client
          .post(`/${API_PREFIX}/audit/searches`)
          .send(input)
          .expect(200)
      ).body,
    );
    const replay = auditSnapshotSchema.parse(
      (
        await client
          .post(`/${API_PREFIX}/audit/searches`)
          .send(input)
          .expect(200)
      ).body,
    );
    expect(replay.expiresAt).toEqual(snapshot.expiresAt);
    expect(replay.filters).toEqual(snapshot.filters);
    // Randomized encrypted tokens can differ; the durable receipt count below
    // establishes replay identity without weakening token encryption.
    const searchReceipt = await app
      .get(SupabaseService)
      .admin()
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("actor_id", userId)
      .eq("action", "audit.search.created")
      .eq("correlation_id", input.requestId);
    expect(searchReceipt.error).toBeNull();
    expect(searchReceipt.count).toBe(1);

    await client
      .post(`/${API_PREFIX}/audit/searches`)
      .send({
        ...input,
        filters: { ...input.filters, action: "organization.changed" },
      })
      .expect(409);
    const concurrent = await append();
    const base = `/${API_PREFIX}/audit/searches/${snapshot.snapshotToken}`;
    const pageInput = { requestId: randomUUID(), limit: 1 };
    const page = auditPageSchema.parse(
      (await client.get(`${base}/events`).query(pageInput).expect(200)).body,
    );
    expect(
      auditPageSchema.parse(
        (await client.get(`${base}/events`).query(pageInput).expect(200)).body,
      ).items,
    ).toEqual(page.items);
    const pageReceipt = await app
      .get(SupabaseService)
      .admin()
      .from("audit_logs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("actor_id", userId)
      .eq("action", "audit.search.page")
      .eq("correlation_id", pageInput.requestId);
    expect(pageReceipt.error).toBeNull();
    expect(pageReceipt.count).toBe(1);
    expect(page.items.map((item) => item.id)).toEqual([second]);
    expect(page.nextCursor).not.toBeNull();
    const next = auditPageSchema.parse(
      (
        await client
          .get(`${base}/events`)
          .query({ requestId: randomUUID(), cursor: page.nextCursor, limit: 1 })
          .expect(200)
      ).body,
    );
    expect(next.items.map((item) => item.id)).toEqual([first]);
    expect(
      [...page.items, ...next.items].some((item) => item.id === concurrent),
    ).toBe(false);
    expect(page.items[0]?.verificationStatus).toBe("not_verified");
    const detail = auditDetailSchema.parse(
      (
        await client
          .get(`${base}/events/${second}`)
          .query({ requestId: randomUUID() })
          .expect(200)
      ).body,
    );
    expect(detail.after).toMatchObject({ enabled: true, count: 3 });
    expect(JSON.stringify(detail)).not.toContain(
      "DO_NOT_DISCLOSE_AUDIT_HTTP_FIXTURE",
    );
    expect(detail.event.actor.id).toBe(userId);
    const verified = auditVerificationResultSchema.parse(
      (
        await client
          .post(`${base}/verify`)
          .send({ requestId: randomUUID(), eventIds: [second] })
          .expect(200)
      ).body,
    );
    expect(verified.items).toEqual([
      { eventId: second, status: "event_hashes_checked" },
    ]);
    expect(verified.completenessProven).toBe(false);
    expect(verified.authenticityProven).toBe(false);
    await client
      .get(`${base}/events/${concurrent}`)
      .query({ requestId: randomUUID() })
      .expect(404);
  }, 30_000);

  it("rejects malformed criteria and tampered or different-principal tokens without exposing data", async () => {
    const { client } = await login();
    await client
      .post(`/${API_PREFIX}/audit/searches`)
      .send({
        requestId: randomUUID(),
        filters: { ...filters(), from: "2020-01-01T00:00:00Z" },
      })
      .expect(400);
    await client
      .post(`/${API_PREFIX}/audit/searches`)
      .send({
        requestId: randomUUID(),
        filters: filters(),
        organizationId: randomUUID(),
      })
      .expect(400);
    const snapshot = auditSnapshotSchema.parse(
      (
        await client
          .post(`/${API_PREFIX}/audit/searches`)
          .send({ requestId: randomUUID(), filters: filters() })
          .expect(200)
      ).body,
    );
    const position = Math.floor(snapshot.snapshotToken.length / 2);
    const tampered = `${snapshot.snapshotToken.slice(0, position)}${snapshot.snapshotToken[position] === "A" ? "B" : "A"}${snapshot.snapshotToken.slice(position + 1)}`;
    await client
      .get(`/${API_PREFIX}/audit/searches/${tampered}/events`)
      .query({ requestId: randomUUID() })
      .expect(404);
    const { client: other } = await login("admin@cra.test");
    await other
      .get(`/${API_PREFIX}/audit/searches/${snapshot.snapshotToken}/events`)
      .query({ requestId: randomUUID() })
      .expect(404);
  }, 30_000);

  it("preserves fully disclosed typed values for independent export proofs", async () => {
    const { client, userId, organizationId } = await login();
    const action = "organization.audit_export_verification_fixture";
    const correlationId = randomUUID();
    const recorded = await audit.recordV2(organizationId, {
      organizationId,
      scope: "organization",
      eventKey: `audit-export-proof:${randomUUID()}`,
      actorType: "user",
      actorId: userId,
      userId,
      action,
      entityType: "organization",
      entityId: organizationId,
      outcome: "completed",
      correlationId,
      beforeRedacted: null,
      afterRedacted: { count: 3, enabled: true },
      reason: null,
      ipAddress: null,
      userAgent: null,
    });
    const snapshot = auditSnapshotSchema.parse(
      (
        await client
          .post(`/${API_PREFIX}/audit/searches`)
          .send({
            requestId: randomUUID(),
            filters: { ...filters(), action, correlationId },
          })
          .expect(200)
      ).body,
    );
    const detail = auditDetailSchema.parse(
      (
        await client
          .get(
            `/${API_PREFIX}/audit/searches/${snapshot.snapshotToken}/events/${recorded.auditId}`,
          )
          .query({ requestId: randomUUID() })
          .expect(200)
      ).body,
    );
    expect(detail.before).toBeNull();
    expect(detail.after).toEqual({ count: 3, enabled: true });
  }, 30_000);

  it("queues an idempotent export and returns only safe requester-scoped status", async () => {
    const { client } = await login();
    const snapshot = auditSnapshotSchema.parse(
      (
        await client
          .post(`/${API_PREFIX}/audit/searches`)
          .send({ requestId: randomUUID(), filters: filters() })
          .expect(200)
      ).body,
    );
    const input = {
      requestId: randomUUID(),
      snapshotToken: snapshot.snapshotToken,
      format: "json",
    };
    const job = auditExportJobSchema.parse(
      (
        await client
          .post(`/${API_PREFIX}/audit/exports`)
          .send(input)
          .expect(202)
      ).body,
    );
    expect(job.status).toBe("queued");
    expect(
      auditExportJobSchema.parse(
        (
          await client
            .post(`/${API_PREFIX}/audit/exports`)
            .send(input)
            .expect(202)
        ).body,
      ).id,
    ).toBe(job.id);
    await client
      .post(`/${API_PREFIX}/audit/exports`)
      .send({ ...input, format: "csv" })
      .expect(409);
    const status = await client
      .get(`/${API_PREFIX}/audit/exports/${job.id}`)
      .query({ requestId: randomUUID() })
      .expect(200);
    expect(auditExportJobSchema.parse(status.body).id).toBe(job.id);
    for (const hidden of [
      "selected_event_ids",
      "object_path",
      "download_grant_digest",
      "lease_token",
      "scope_digest",
    ])
      expect(status.body).not.toHaveProperty(hidden);
    const { client: other } = await login("admin@cra.test");
    await other
      .get(`/${API_PREFIX}/audit/exports/${job.id}`)
      .query({ requestId: randomUUID() })
      .expect(404);
  }, 30_000);
});
