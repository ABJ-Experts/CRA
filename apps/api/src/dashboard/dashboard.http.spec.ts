import type { Server } from "node:http";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DashboardController } from "./dashboard.controller";
import { DashboardUseCases } from "./application/dashboard-use-cases";
import { DashboardUnavailableError } from "./application/dashboard-read.port";

describe("dashboard HTTP parsing", () => {
  let app: INestApplication;
  const overview = jest.fn();
  const obligations = jest.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [DashboardController],
      providers: [
        { provide: DashboardUseCases, useValue: { overview, obligations } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    overview.mockReset();
    obligations.mockReset();
  });
  it.each([
    "overview?organizationId=forged",
    "products/not-a-uuid/posture",
    "obligations?limit=101",
    "obligations?limit=true",
    "readiness?unexpected=yes",
    "ingestion?cursor=../secret",
  ])("rejects malformed input %s", async (path) => {
    await request(app.getHttpServer() as Server)
      .get(`/api/v1/dashboard/${path}`)
      .expect(400);
    expect(overview).not.toHaveBeenCalled();
    expect(obligations).not.toHaveBeenCalled();
  });
  it("parses documented paging defaults before application", async () => {
    obligations.mockResolvedValue({});
    await request(app.getHttpServer() as Server)
      .get("/api/v1/dashboard/obligations")
      .expect(200);
    expect(obligations).toHaveBeenCalledWith(undefined, {
      limit: 20,
      state: "active",
    });
  });
  it("sanitizes provider failure as a retryable outage", async () => {
    overview.mockRejectedValue(
      new DashboardUnavailableError("private upstream failure"),
    );
    const response = await request(app.getHttpServer() as Server)
      .get("/api/v1/dashboard/overview")
      .expect(503);
    expect(JSON.stringify(response.body)).not.toContain("private");
    expect(response.body).toMatchObject({ code: "dashboard_unavailable" });
  });
});
