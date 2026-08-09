import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { lastValueFrom, of } from "rxjs";
import { z } from "zod";

import {
  ZodResponseInterceptor,
  ZodResponseContractError,
} from "./zod-response.interceptor";

describe("ZodResponseInterceptor", () => {
  const context = {
    getHandler: () => ZodResponseInterceptor,
    getClass: () => ZodResponseInterceptor,
  } as unknown as ExecutionContext;

  it("returns the parsed schema output rather than the untrusted value", async () => {
    const reflector = {
      getAllAndOverride: jest.fn(() =>
        z.object({ count: z.coerce.number() }).strict(),
      ),
    } as unknown as Reflector;
    const interceptor = new ZodResponseInterceptor(reflector);
    const next = { handle: () => of({ count: "2" }) } as CallHandler;

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).resolves.toEqual({ count: 2 });
  });

  it("fails closed without exposing the invalid response payload", async () => {
    const reflector = {
      getAllAndOverride: jest.fn(() =>
        z.object({ ok: z.literal(true) }).strict(),
      ),
    } as unknown as Reflector;
    const interceptor = new ZodResponseInterceptor(reflector);
    const next = {
      handle: () => of({ ok: false, secret: "must-not-escape" }),
    } as CallHandler;

    const result = lastValueFrom(interceptor.intercept(context, next));
    await expect(result).rejects.toBeInstanceOf(ZodResponseContractError);
    await expect(result).rejects.not.toThrow("must-not-escape");
  });

  it("leaves redirect and stream handlers without metadata unchanged", async () => {
    const reflector = {
      getAllAndOverride: jest.fn(() => undefined),
    } as unknown as Reflector;
    const interceptor = new ZodResponseInterceptor(reflector);
    const next = { handle: () => of(undefined) } as CallHandler;

    await expect(
      lastValueFrom(interceptor.intercept(context, next)),
    ).resolves.toBeUndefined();
  });
});
