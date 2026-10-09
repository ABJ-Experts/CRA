import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { DashboardTrendsController } from "./dashboard-trends.controller";
import { DashboardTrendsUseCases } from "./application/dashboard-trends-use-cases";
import { DashboardDatasetConflictError } from "./application/dashboard-trends.port";
import {
  DashboardForbiddenError,
  DashboardNotFoundError,
  DashboardUnavailableError,
  DashboardInvalidCursorError,
} from "./application/dashboard-read.port";
import type { RequestUser } from "../auth/auth.types";
import type { Response } from "express";
import { REQUIRE_PERMISSIONS_KEY } from "../auth/auth.types";
import {
  ZOD_RESPONSE_SCHEMA,
  NON_JSON_RESPONSE_KIND,
} from "../common/http/zod-response.interceptor";
describe("trend HTTP boundaries", () => {
  const user = {} as RequestUser;
  const query = {
    from: "2026-10-01",
    to: "2026-10-08",
    timezone: "UTC",
    bucket: "day" as const,
  };
  function setup() {
    const usecases = {
      trends: jest.fn(),
      sources: jest.fn(),
      export: jest.fn(),
    };
    return {
      usecases,
      controller: new DashboardTrendsController(
        usecases as unknown as DashboardTrendsUseCases,
      ),
    };
  }
  it("protects every route and declares JSON or CSV contracts", () => {
    for (const method of ["trends", "sources", "export"] as const) {
      const fn = Object.getOwnPropertyDescriptor(
        DashboardTrendsController.prototype,
        method,
      )?.value as object;
      expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, fn)).toEqual([
        "can_view_dashboards",
      ]);
      expect(
        Reflect.getMetadata(
          method === "export" ? NON_JSON_RESPONSE_KIND : ZOD_RESPONSE_SCHEMA,
          fn,
        ),
      ).toBeTruthy();
    }
  });
  it("delegates parsed filters and source tokens", async () => {
    const { controller, usecases } = setup();
    usecases.trends.mockResolvedValue("result");
    usecases.sources.mockResolvedValue("sources");
    expect(await controller.trends(user, query)).toBe("result");
    expect(
      await controller.sources(user, {
        datasetToken: "token",
        metric: "activity",
        limit: 20,
      }),
    ).toBe("sources");
  });
  it("serves bounded CSV without caching", async () => {
    const { controller, usecases } = setup();
    usecases.export.mockResolvedValue('"metric"\r\n');
    const setHeader = jest.fn();
    expect(
      await controller.export(user, { datasetToken: "token" }, {
        setHeader,
      } as unknown as Response),
    ).toContain('"metric"');
    expect(setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });
  it.each([
    [new DashboardDatasetConflictError(), ConflictException],
    [new DashboardForbiddenError(), ForbiddenException],
    [new DashboardNotFoundError(), NotFoundException],
    [new DashboardUnavailableError(), ServiceUnavailableException],
    [new DashboardInvalidCursorError(), BadRequestException],
    [new Error("internal"), Error],
  ])("maps domain failures safely", async (error, expected) => {
    const { controller, usecases } = setup();
    usecases.trends.mockRejectedValue(error);
    await expect(controller.trends(user, query)).rejects.toBeInstanceOf(
      expected,
    );
  });
});
