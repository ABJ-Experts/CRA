import { LicensingGuard } from "./licensing.guard";
import type { LicensingService } from "../application/licensing.service";
import type { ExecutionContext } from "@nestjs/common";
function context(
  controller: string,
  handler: string,
  user?: unknown,
): ExecutionContext {
  const klass = { [controller]: class {} }[controller]!;
  Object.defineProperty(klass, "name", { value: controller });
  const method = () => undefined;
  Object.defineProperty(method, "name", { value: handler });
  return {
    getClass: () => klass,
    getHandler: () => method,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}
describe("LicensingGuard", () => {
  it.each([
    ["TenantAdministrationController", "settings"],
    ["TenantAdministrationController", "settingsCatalog"],
    ["TenantAdministrationController", "retention"],
    ["LegalEntitiesController", "list"],
    ["LegalEntitiesController", "get"],
  ])(
    "preserves renewal administration reads through %s.%s",
    async (controller, handler) => {
      const service = { assertOperation: jest.fn() };
      const guard = new LicensingGuard(service as unknown as LicensingService);
      await expect(
        guard.canActivate(context(controller, handler)),
      ).resolves.toBe(true);
      expect(service.assertOperation).not.toHaveBeenCalled();
    },
  );
  it("denies unclassified routes", async () => {
    const guard = new LicensingGuard({
      assertOperation: jest.fn(),
    } as unknown as LicensingService);
    await expect(
      guard.canActivate(context("UnknownController", "run")),
    ).rejects.toThrow("Route licence policy is not classified");
  });
  it("preserves renewal and public source credential flow", async () => {
    const service = { assertOperation: jest.fn() };
    const guard = new LicensingGuard(service as unknown as LicensingService);
    await expect(
      guard.canActivate(context("LicensingController", "activate")),
    ).resolves.toBe(true);
    expect(service.assertOperation).not.toHaveBeenCalled();
  });
  it("passes verified tenant identity and retained-read route policy to authority", async () => {
    const service = { assertOperation: jest.fn().mockResolvedValue(undefined) };
    const guard = new LicensingGuard(service as unknown as LicensingService);
    await expect(
      guard.canActivate(
        context("ProductsController", "get", {
          organizationId: "org",
          id: "actor",
        }),
      ),
    ).resolves.toBe(true);
    expect(service.assertOperation).toHaveBeenCalledWith(
      "org",
      "actor",
      expect.objectContaining({ capability: "products", mutation: false }),
    );
  });

  it("passes verified tenant identity and route mutation to authority", async () => {
    const service = { assertOperation: jest.fn().mockResolvedValue(undefined) };
    const guard = new LicensingGuard(service as unknown as LicensingService);
    await expect(
      guard.canActivate(
        context("ProductsController", "create", {
          organizationId: "org",
          id: "actor",
        }),
      ),
    ).resolves.toBe(true);
    expect(service.assertOperation).toHaveBeenCalledWith(
      "org",
      "actor",
      expect.objectContaining({ capability: "products", mutation: true }),
    );
  });
  it("denies licensed member operation without scoped identity", async () => {
    const guard = new LicensingGuard({
      assertOperation: jest.fn(),
    } as unknown as LicensingService);
    await expect(
      guard.canActivate(context("ProductsController", "create")),
    ).rejects.toThrow("A verified tenant identity is required");
  });
});
