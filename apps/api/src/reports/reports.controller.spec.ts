import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import type { RequestUser } from "../auth/auth.types";
import { PassThrough, Readable } from "node:stream";
import type { Request } from "express";
import {
  ReportsController,
  REPORT_GRANT_COOKIE,
  reportHttp,
} from "./reports.controller";
import type { ReportsUseCases } from "./application/reports.use-cases";
import {
  ReportAccessDeniedError,
  ReportConflictError,
  ReportInvalidRequestError,
  ReportUnavailableError,
} from "./domain/report.errors";

const user = { id: "11111111-1111-4111-8111-111111111111" } as RequestUser;
const runId = "22222222-2222-4222-8222-222222222222";
const recipientId = "33333333-3333-4333-8333-333333333333";
const grantId = "44444444-4444-4444-8444-444444444444";

describe("ReportsController", () => {
  it("connects every parsed report route to its application operation", async () => {
    const names = [
      "create",
      "list",
      "get",
      "update",
      "preview",
      "mutate",
      "listRuns",
      "getRun",
      "replay",
      "recipients",
      "manifest",
      "getEmailPreference",
      "setEmailPreference",
      "listAdministration",
      "adminPause",
    ] as const;
    const calls = Object.fromEntries(
      names.map((name) => [name, jest.fn().mockResolvedValue({})]),
    );
    const controller = new ReportsController(
      calls as unknown as ReportsUseCases,
      { get: jest.fn() } as unknown as ConfigService,
    );
    const definition = { definitionId: grantId };
    const run = { runId };
    const recipient = { runId, recipientId };
    const mutation = { expectedVersion: 1, idempotencyKey: grantId };
    await Promise.all([
      controller.create(user, {} as never),
      controller.list(user, { limit: 25 }),
      controller.get(user, definition),
      controller.update(user, definition, {} as never),
      controller.preview(user, definition, mutation),
      controller.activate(user, definition, mutation),
      controller.pause(user, definition, mutation),
      controller.resume(user, definition, mutation),
      controller.archive(user, definition, mutation),
      controller.listRuns(user, { limit: 25 }),
      controller.getRun(user, run),
      controller.replay(user, run, mutation),
      controller.recipients(user, { limit: 25 }),
      controller.manifest(user, recipient),
      controller.emailPreference(user),
      controller.setEmailPreference(user, { ...mutation, mode: "off" }),
      controller.listAdministration(user, { limit: 25 }),
      controller.adminPause(user, definition, mutation),
    ]);
    for (const name of names)
      expect((calls[name] as jest.Mock).mock.calls.length).toBeGreaterThan(0);
    expect(
      (calls.mutate as jest.Mock).mock.calls.map((args: unknown[]) => args[2]),
    ).toEqual(["activate", "pause", "resume", "archive"]);
  });
  it.each([
    [new ReportAccessDeniedError(), NotFoundException],
    [new ReportConflictError(), ConflictException],
    [new ReportInvalidRequestError(), BadRequestException],
    [new ReportUnavailableError(), ServiceUnavailableException],
  ])("maps report failures to safe HTTP errors", async (error, mapped) => {
    await expect(
      reportHttp(() => Promise.reject(error)),
    ).rejects.toBeInstanceOf(mapped);
  });
  it("preserves unexpected errors for the global error boundary", async () => {
    const failure = new Error("unexpected");
    await expect(reportHttp(() => Promise.reject(failure))).rejects.toBe(
      failure,
    );
  });
  it("issues an HttpOnly cookie scoped to one recipient and grant", async () => {
    const cookie = jest.fn();
    const response = { cookie } as unknown as Response;
    const grant = jest.fn().mockResolvedValue({
      response: {
        data: {
          grantId,
          url: `/api/v1/reports/runs/${runId}/recipients/${recipientId}/download/${grantId}`,
        },
      },
      cookieValue: "a".repeat(64),
    });
    const reports = { grant } as unknown as ReportsUseCases;
    const config = {
      get: jest.fn().mockReturnValue(false),
    } as unknown as ConfigService;
    const controller = new ReportsController(reports, config);
    const result = await controller.grant(
      user,
      { runId, recipientId },
      { artifactId: grantId },
      response,
    );
    expect(result.data.grantId).toBe(grantId);
    expect(cookie).toHaveBeenCalledWith(
      REPORT_GRANT_COOKIE,
      "a".repeat(64),
      expect.objectContaining({
        httpOnly: true,
        sameSite: "strict",
        maxAge: 300_000,
        path: `/api/v1/reports/runs/${runId}/recipients/${recipientId}/download/${grantId}`,
      }),
    );
  });
  it("streams a redeemed artifact with private headers and closes storage", async () => {
    const cleanup = jest.fn().mockResolvedValue(undefined);
    const download = jest.fn().mockResolvedValue({
      body: Readable.from([Buffer.from("report")]),
      byteLength: 6,
      mediaType: "text/csv",
      sha256: "a".repeat(64),
      name: "report.csv",
      cleanup,
    });
    const controller = new ReportsController(
      { download } as unknown as ReportsUseCases,
      { get: jest.fn() } as unknown as ConfigService,
    );
    const clearCookie = jest.fn();
    const headers = new Map<string, string>();
    const response = Object.assign(new PassThrough(), {
      clearCookie,
      setHeader: (key: string, value: string) => {
        headers.set(key, value);
      },
    }) as unknown as Response;
    await controller.download(
      user,
      { runId, recipientId, grantId },
      {
        cookies: { [REPORT_GRANT_COOKIE]: "b".repeat(64) },
      } as unknown as Request,
      response,
    );
    expect(download).toHaveBeenCalledWith(
      user,
      runId,
      recipientId,
      grantId,
      "b".repeat(64),
    );
    expect(clearCookie).toHaveBeenCalledWith(
      REPORT_GRANT_COOKIE,
      expect.objectContaining({
        path: `/api/v1/reports/runs/${runId}/recipients/${recipientId}/download/${grantId}`,
      }),
    );
    expect(headers.get("Cache-Control")).toBe("private, no-store");
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("delegates administrator pause without exposing configuration", async () => {
    const adminPause = jest.fn().mockResolvedValue({
      data: {
        id: grantId,
        ownerUserId: user.id,
        state: "paused",
        version: 2,
      },
    });
    const controller = new ReportsController(
      { adminPause } as unknown as ReportsUseCases,
      { get: jest.fn() } as unknown as ConfigService,
    );
    await expect(
      controller.adminPause(
        user,
        { definitionId: grantId },
        { expectedVersion: 1, idempotencyKey: grantId },
      ),
    ).resolves.toMatchObject({ data: { state: "paused" } });
    expect(adminPause).toHaveBeenCalledWith(user, grantId, {
      expectedVersion: 1,
      idempotencyKey: grantId,
    });
  });
});
