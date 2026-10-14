import "reflect-metadata";
import { Writable, Readable } from "node:stream";
import { ConfigService } from "@nestjs/config";
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  REQUIRE_PERMISSIONS_KEY,
  REQUIRE_ROLE_KEY,
  type RequestUser,
} from "../auth/auth.types";
import {
  ZOD_RESPONSE_SCHEMA,
  NON_JSON_RESPONSE_KIND,
} from "../common/http/zod-response.interceptor";
import {
  SupportDiagnosticsController,
  diagnosticHttp,
  DIAGNOSTIC_GRANT_COOKIE,
} from "./support-diagnostics.controller";
import {
  DiagnosticDeniedError,
  DiagnosticConflictError,
  DiagnosticUnavailableError,
  DiagnosticInvalidError,
} from "./application/diagnostic-repository.port";
const id = "11111111-1111-4111-8111-111111111111";
const params = { jobId: id };
const input = { expectedVersion: 1, idempotencyKey: id };
const user = {} as RequestUser;
function fixture(config: Record<string, unknown> = {}) {
  const names = [
    "preview",
    "create",
    "list",
    "get",
    "content",
    "cancel",
    "cleanupReview",
    "cleanup",
    "grant",
    "download",
  ] as const;
  const service = Object.fromEntries(
    names.map((name) => [name, jest.fn().mockResolvedValue({ safe: true })]),
  ) as Record<(typeof names)[number], jest.Mock>;
  return {
    service,
    controller: new SupportDiagnosticsController(
      service as never,
      { get: (key: string) => config[key] } as ConfigService,
    ),
  };
}
describe("support diagnostic controller", () => {
  it("declares admin role AND export permission, and schemas for every route", () => {
    for (const name of [
      "preview",
      "create",
      "list",
      "get",
      "content",
      "cancel",
      "cleanupReview",
      "cleanup",
      "grant",
      "download",
    ] as const) {
      const handler = Object.getOwnPropertyDescriptor(
        SupportDiagnosticsController.prototype,
        name,
      )!.value as object;
      expect(Reflect.getMetadata(REQUIRE_ROLE_KEY, handler)).toBe("admin");
      expect(Reflect.getMetadata(REQUIRE_PERMISSIONS_KEY, handler)).toEqual([
        "can_export_system_health",
      ]);
      expect(
        Reflect.getMetadata(
          name === "download" ? NON_JSON_RESPONSE_KIND : ZOD_RESPONSE_SCHEMA,
          handler,
        ),
      ).toBeDefined();
    }
  });
  it("delegates all bounded inputs to use cases", async () => {
    const f = fixture();
    const selection = {
      categories: ["logs" as const],
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-01T00:00:00Z",
    };
    await f.controller.preview(user, selection);
    await f.controller.create(user, {
      previewToken: "signed",
      consent: true,
      idempotencyKey: id,
    });
    await f.controller.list(user, { limit: 25 });
    await f.controller.get(user, params);
    await f.controller.content(user, params, {
      section: "logs",
      offset: 0,
      limit: 100,
    });
    await f.controller.cancel(user, params, input);
    await f.controller.cleanupReview(user, params);
    await f.controller.cleanup(user, params, {
      ...input,
      reviewFingerprint: "a".repeat(64),
    });
    for (const name of [
      "preview",
      "create",
      "list",
      "get",
      "content",
      "cancel",
      "cleanupReview",
      "cleanup",
    ] as const)
      expect(f.service[name]).toHaveBeenCalledTimes(1);
  });
  it.each([{}, { COOKIE_SECURE: true, COOKIE_DOMAIN: "cra.test" }])(
    "sets exact-path 60s HttpOnly strict cookie %#",
    async (config) => {
      const f = fixture(config);
      f.service.grant.mockResolvedValue({
        grant: { grantId: id },
        cookieValue: "secret",
      });
      const response = { cookie: jest.fn() };
      expect(
        await f.controller.grant(user, params, input, response as never),
      ).toEqual({ grantId: id });
      expect(response.cookie).toHaveBeenCalledWith(
        DIAGNOSTIC_GRANT_COOKIE,
        "secret",
        {
          httpOnly: true,
          secure: !!config.COOKIE_SECURE,
          sameSite: "strict",
          path: `/api/v1/system/diagnostics/bundles/${id}/download/${id}`,
          maxAge: 60000,
          ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
        },
      );
    },
  );
  it.each(["cookie", undefined, 123])(
    "clears grant once and sends verified stream %#",
    async (cookie) => {
      const f = fixture();
      f.service.download.mockResolvedValue({
        body: Readable.from([Buffer.from("zip")]),
        byteSize: 3,
        sha256: "a".repeat(64),
        fileName: `support-diagnostics-${id}.zip`,
      });
      const chunks: Buffer[] = [];
      const response = Object.assign(
        new Writable({
          write(chunk: Buffer, _encoding, done) {
            chunks.push(chunk);
            done();
          },
        }),
        { clearCookie: jest.fn(), setHeader: jest.fn() },
      );
      await f.controller.download(
        user,
        { jobId: id, grantId: id },
        { cookies: { [DIAGNOSTIC_GRANT_COOKIE]: cookie } } as never,
        response as never,
      );
      expect(Buffer.concat(chunks).toString()).toBe("zip");
      expect(response.clearCookie).toHaveBeenCalledWith(
        DIAGNOSTIC_GRANT_COOKIE,
        expect.objectContaining({
          path: `/api/v1/system/diagnostics/bundles/${id}/download/${id}`,
        }),
      );
      expect(f.service.download).toHaveBeenCalledWith(
        user,
        id,
        id,
        typeof cookie === "string" ? cookie : undefined,
      );
      expect(response.setHeader).toHaveBeenCalledWith(
        "Cache-Control",
        "private, no-store",
      );
    },
  );
  it.each([
    [new DiagnosticInvalidError(), BadRequestException],
    [new DiagnosticDeniedError(), NotFoundException],
    [new DiagnosticConflictError(), ConflictException],
    [new DiagnosticUnavailableError(), ServiceUnavailableException],
    [new Error("unknown"), Error],
  ] as const)("maps safe failures %#", async (error, kind) => {
    await expect(
      diagnosticHttp(() => Promise.reject(error)),
    ).rejects.toBeInstanceOf(kind);
  });
});
