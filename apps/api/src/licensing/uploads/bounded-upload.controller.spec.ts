import type { Request } from "express";
import { Readable } from "node:stream";
import { uploadPathSchema } from "@repo/contracts/licensing/schemas";
import { BoundedUploadController } from "./bounded-upload.controller";

const params = {
  operationId: "10000000-0000-4000-8000-000000000001",
  token: "a".repeat(43),
};
describe("bounded upload route", () => {
  it("forwards validated path authority and raw stream without parsing the bytes", async () => {
    const accept = jest.fn().mockResolvedValue(undefined);
    const request = Object.assign(Readable.from([Buffer.from("abc")]), {
      headers: { "content-length": "3" },
    }) as unknown as Request;
    const controller = new BoundedUploadController({ accept } as never);
    await controller.upload(uploadPathSchema.parse(params), request);
    expect(accept).toHaveBeenCalledWith(
      params.operationId,
      params.token,
      "3",
      request,
    );
  });
  it("preserves admission failures and missing lengths for the bounded service to reject", async () => {
    const denied = new Error("upload authority revoked");
    const accept = jest.fn().mockRejectedValue(denied);
    const request = Object.assign(Readable.from([]), {
      headers: {},
    }) as unknown as Request;
    const controller = new BoundedUploadController({ accept } as never);
    await expect(
      controller.upload(uploadPathSchema.parse(params), request),
    ).rejects.toBe(denied);
    expect(accept).toHaveBeenCalledWith(
      params.operationId,
      params.token,
      undefined,
      request,
    );
  });
  it.each([
    { ...params, token: "wrong" },
    { ...params, operationId: "foreign" },
    { ...params, extra: "untrusted" },
  ])("rejects malformed or unrecognized path values", (input) => {
    expect(uploadPathSchema.safeParse(input).success).toBe(false);
  });
});
