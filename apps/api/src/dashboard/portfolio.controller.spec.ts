import "reflect-metadata";
import { PortfolioController } from "./portfolio.controller";
import { PortfolioUseCases } from "./application/portfolio-use-cases";
import {
  DashboardNotFoundError,
  DashboardForbiddenError,
  DashboardInvalidCursorError,
  DashboardUnavailableError,
} from "./application/dashboard-read.port";
import { PortfolioScopeChangedError } from "./application/portfolio-read.port";
import type { RequestUser } from "../auth/auth.types";
describe("portfolio transport", () => {
  const products = jest.fn();
  const concentration = jest.fn();
  const detail = jest.fn();
  const controller = new PortfolioController({
    products,
    concentration,
    detail,
  } as unknown as PortfolioUseCases);
  const user = {} as RequestUser;
  const query = { includeArchived: false, limit: 20 };
  it("delegates parsed queries", async () => {
    products.mockResolvedValueOnce("products");
    concentration.mockResolvedValueOnce("concentration");
    detail.mockResolvedValueOnce("detail");
    expect(await controller.products(user, query)).toBe("products");
    expect(await controller.concentration(user, query)).toBe("concentration");
    expect(
      await controller.detail(user, { ...query, componentRef: "ref" }),
    ).toBe("detail");
    expect(detail).toHaveBeenCalledWith(user, {
      ...query,
      componentRef: "ref",
    });
  });
  it.each([
    [DashboardNotFoundError, 404, "not_found"],
    [DashboardForbiddenError, 403, "forbidden"],
    [DashboardInvalidCursorError, 400, "invalid_cursor"],
    [PortfolioScopeChangedError, 409, "portfolio_scope_changed"],
    [DashboardUnavailableError, 503, "portfolio_unavailable"],
  ])(
    "maps %p without leaking internal text",
    async (ErrorType, status, code) => {
      products.mockRejectedValueOnce(new ErrorType("secret"));
      try {
        await controller.products(user, query);
        throw new Error("Expected rejection");
      } catch (error) {
        const response = error as {
          getStatus(): number;
          getResponse(): unknown;
        };
        expect(response.getStatus()).toBe(status);
        expect(response.getResponse()).toMatchObject({ code });
        expect(JSON.stringify(response.getResponse())).not.toContain("secret");
      }
    },
  );
  it("does not hide unexpected errors", async () => {
    const error = new Error("unexpected");
    products.mockRejectedValueOnce(error);
    await expect(controller.products(user, query)).rejects.toBe(error);
  });
});
