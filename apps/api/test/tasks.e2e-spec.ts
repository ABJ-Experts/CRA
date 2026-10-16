import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import {
  taskDetailResponseSchema,
  taskListResponseSchema,
} from "@repo/contracts/tasks";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { App } from "supertest/types";

import { AppModule } from "../src/app.module";
import { API_PREFIX } from "../src/auth/cookies.util";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";

/** Reads seeded local data only; no source or route records are changed. */
describe("Task inbox HTTP boundary (local stack)", () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(API_PREFIX);
    app.use(cookieParser());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("denies unauthenticated list and detail requests", async () => {
    await request(app.getHttpServer()).get(`/${API_PREFIX}/tasks`).expect(401);
    await request(app.getHttpServer())
      .get(
        `/${API_PREFIX}/tasks/finding_triage/00000000-0000-4000-8000-000000000001`,
      )
      .expect(401);
  });

  it("parses authorized list and source-linked detail from the local database", async () => {
    const session = request.agent(app.getHttpServer());
    await session
      .post(`/${API_PREFIX}/auth/sign-in`)
      .send({
        email: "owner@cra.test",
        password: "Password123",
        remember: false,
      })
      .expect(200);

    const listResponse = await session
      .get(`/${API_PREFIX}/tasks`)
      .query({ scope: "all", limit: 1 })
      .expect(200);
    const list = taskListResponseSchema.parse(listResponse.body);
    expect(list.rows).toHaveLength(1);
    expect(list.counts.mine).toBeGreaterThanOrEqual(0);
    expect(list.nextCursor).not.toBeNull();

    const nextResponse = await session
      .get(`/${API_PREFIX}/tasks`)
      .query({ scope: "all", limit: 1, cursor: list.nextCursor })
      .expect(200);
    const nextPage = taskListResponseSchema.parse(nextResponse.body);
    expect(nextPage.rows).toHaveLength(1);
    expect(nextPage.rows[0]?.sourceId).not.toBe(list.rows[0]?.sourceId);

    await session
      .get(`/${API_PREFIX}/tasks`)
      .query({ scope: "mine", limit: 1, cursor: list.nextCursor })
      .expect(400);

    const selected = list.rows[0]!;
    const detailResponse = await session
      .get(`/${API_PREFIX}/tasks/${selected.taskType}/${selected.sourceId}`)
      .expect(200);
    const detail = taskDetailResponseSchema.parse(detailResponse.body);
    expect(detail.task).toMatchObject({
      organizationId: selected.organizationId,
      taskType: selected.taskType,
      sourceId: selected.sourceId,
    });

    await session
      .get(`/${API_PREFIX}/tasks`)
      .query({ scope: "all", limit: 101 })
      .expect(400);

    const assignableResponse = await session
      .get(`/${API_PREFIX}/tasks`)
      .query({ scope: "all", limit: 100 })
      .expect(200);
    const assignable = taskListResponseSchema
      .parse(assignableResponse.body)
      .rows.find((task) => task.canAssign && task.sourceRevision !== null);
    expect(assignable).toBeDefined();

    const conflictResponse = await session
      .post(
        `/${API_PREFIX}/tasks/${assignable!.taskType}/${assignable!.sourceId}/assign`,
      )
      .send({
        assigneeUserId: null,
        groupId: null,
        expectedRouteVersion: assignable!.routeVersion + 1,
        expectedSourceRevision: assignable!.sourceRevision,
        idempotencyKey: randomUUID(),
      })
      .expect(409);
    expect(conflictResponse.body).toMatchObject({ code: "conflict" });

    const unchangedResponse = await session
      .get(
        `/${API_PREFIX}/tasks/${assignable!.taskType}/${assignable!.sourceId}`,
      )
      .expect(200);
    const unchanged = taskDetailResponseSchema.parse(unchangedResponse.body);
    expect(unchanged.task.routeVersion).toBe(assignable!.routeVersion);
    expect(unchanged.task.sourceRevision).toBe(assignable!.sourceRevision);
  }, 30_000);
});
