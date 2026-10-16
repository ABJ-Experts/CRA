import { SiemController } from "./siem.controller";
import {
  SiemConflictError,
  SiemForbiddenError,
  SiemInputError,
  SiemNotFoundError,
  SiemUnavailableError,
} from "./siem.errors";
describe("SIEM thin parsed controller", () => {
  const execute = jest.fn();
  const controller = new SiemController({ execute } as never);
  beforeEach(() => execute.mockReset());
  it.each(["catalogue", "list", "create"] as const)(
    "delegates %s",
    async (operation) => {
      execute.mockResolvedValue({ ok: true });
      await controller[operation](
        { id: "actor" } as never,
        { requestId: "request", destinationId: "destination" } as never,
      );
      expect(execute).toHaveBeenCalledWith(
        expect.any(Object),
        operation,
        operation === "create" ? "destination" : null,
        expect.any(Object),
      );
    },
  );
  it.each([
    "get",
    "update",
    "rotate_credentials",
    "revoke_credentials",
    "test",
    "enable",
    "disable",
    "deliveries",
  ] as const)("delegates scoped %s", async (operation) => {
    execute.mockResolvedValue({ ok: true });
    await controller[operation](
      { id: "actor" } as never,
      { id: "destination" },
      { requestId: "request" } as never,
    );
    expect(execute).toHaveBeenCalledWith(
      expect.any(Object),
      operation,
      "destination",
      expect.any(Object),
    );
  });
  it.each(["delivery", "replay_preview", "replay"] as const)(
    "delegates delivery %s",
    async (operation) => {
      execute.mockResolvedValue({ ok: true });
      await controller[operation](
        { id: "actor" } as never,
        { id: "destination", deliveryId: "delivery" },
        { requestId: "request" } as never,
      );
      expect(execute).toHaveBeenCalledWith(
        expect.any(Object),
        operation,
        "destination",
        expect.objectContaining({ deliveryId: "delivery" }),
      );
    },
  );
  it.each([
    [SiemConflictError, 409],
    [SiemForbiddenError, 403],
    [SiemInputError, 400],
    [SiemNotFoundError, 404],
    [SiemUnavailableError, 503],
  ] as const)("maps %s to sanitized HTTP", async (ErrorType, status) => {
    execute.mockRejectedValue(new ErrorType());
    await expect(
      controller.list({} as never, { requestId: "request" }),
    ).rejects.toMatchObject({ status });
  });
  it("preserves unexpected errors for global sanitization", async () => {
    execute.mockRejectedValue(new Error("unexpected"));
    await expect(
      controller.list({} as never, { requestId: "request" }),
    ).rejects.toThrow("unexpected");
  });
});
