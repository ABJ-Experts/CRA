import "reflect-metadata";
import { DashboardController } from "./dashboard.controller";
import { DashboardUseCases } from "./application/dashboard-use-cases";
import {
  DashboardForbiddenError,
  DashboardInvalidCursorError,
  DashboardNotFoundError,
  DashboardUnavailableError,
} from "./application/dashboard-read.port";
import { REQUIRE_PERMISSIONS_KEY, type RequestUser } from "../auth/auth.types";

describe("dashboard routes", () => {
  const methods = [
    "overview",
    "posture",
    "obligations",
    "readiness",
    "ingestion",
  ] as const;
  const operations = Object.fromEntries(
    methods.map((method) => [method, jest.fn()]),
  ) as Record<(typeof methods)[number], jest.Mock>;
  const controller = new DashboardController(
    operations as unknown as DashboardUseCases,
  );
  const user = {} as RequestUser;
  beforeEach(() => methods.forEach((method) => operations[method].mockReset()));
  it.each(methods)(
    "%s is explicitly dashboard-authorized and delegates",
    async (method) => {
      expect(
        Reflect.getMetadata(
          REQUIRE_PERMISSIONS_KEY,
          // eslint-disable-next-line @typescript-eslint/unbound-method
          DashboardController.prototype[method],
        ),
      ).toContain("can_view_dashboards");
      operations[method].mockResolvedValue({ ok: true });
      const result =
        method === "posture"
          ? await controller.posture(user, { productId: "id" }, {})
          : await controller[method](user, {} as never);
      expect(result).toEqual({ ok: true });
      expect(operations[method]).toHaveBeenCalled();
    },
  );
  it.each([
    [new DashboardNotFoundError(), 404],
    [new DashboardForbiddenError(), 403],
    [new DashboardInvalidCursorError(), 400],
    [new DashboardUnavailableError(), 503],
  ])("maps safe status", async (error, status) => {
    operations.overview.mockRejectedValue(error);
    try {
      await controller.overview(user, {});
      throw new Error("missing");
    } catch (caught) {
      expect((caught as { getStatus(): number }).getStatus()).toBe(status);
    }
  });
  it("does not swallow unexpected programming errors", async () => {
    const error = new Error("unexpected");
    operations.overview.mockRejectedValue(error);
    await expect(controller.overview(user, {})).rejects.toBe(error);
  });
});
