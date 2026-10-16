import { Logger } from "@nestjs/common";
import { SupabasePortfolioRepository } from "./supabase-portfolio.repository";
import {
  DashboardNotFoundError,
  DashboardForbiddenError,
  DashboardInvalidCursorError,
  DashboardUnavailableError,
} from "../application/dashboard-read.port";
import { PortfolioScopeChangedError } from "../application/portfolio-read.port";
import type { SupabaseService } from "../../supabase/supabase.service";
describe("portfolio provider boundary", () => {
  const rpc = jest.fn();
  const repository = new SupabasePortfolioRepository({
    admin: () => ({ rpc }),
  } as unknown as SupabaseService);
  const input = {
    actorId: "actor",
    endpoint: "products" as const,
    filters: { includeArchived: false },
  };
  beforeEach(() => {
    rpc.mockReset();
  });
  it("calls only the organization-qualified RPC and parses singleton envelopes", async () => {
    const envelope = {
      outcome: "found",
      result: {},
      nextPosition: null,
      revision: "r1",
    };
    rpc.mockResolvedValueOnce({ data: [envelope], error: null });
    expect(await repository.read("org", input)).toEqual({
      result: {},
      nextPosition: null,
      revision: "r1",
    });
    expect(rpc).toHaveBeenCalledWith("get_portfolio_projection", {
      p_org: "org",
      p_actor: "actor",
      p_endpoint: "products",
      p_filters: input.filters,
    });
    rpc.mockResolvedValueOnce({ data: envelope, error: null });
    await expect(repository.read("org", input)).resolves.toHaveProperty(
      "revision",
      "r1",
    );
  });
  it.each([
    ["not_found", DashboardNotFoundError],
    ["forbidden", DashboardForbiddenError],
    ["scope_changed", PortfolioScopeChangedError],
    ["invalid_request", DashboardInvalidCursorError],
  ])("preserves %s classification", async (outcome, error) => {
    rpc.mockResolvedValueOnce({ data: { outcome }, error: null });
    await expect(repository.read("org", input)).rejects.toBeInstanceOf(error);
  });
  it.each([null, [], [{}, {}], { outcome: "found", secret: true }])(
    "sanitizes invalid envelopes %p",
    async (data) => {
      rpc.mockResolvedValueOnce({ data, error: null });
      await expect(repository.read("org", input)).rejects.toBeInstanceOf(
        DashboardUnavailableError,
      );
    },
  );
  it("sanitizes timeouts, network failures and diagnostic failure", async () => {
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {
      throw new Error("private");
    });
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "57014", message: "private" },
    });
    await expect(repository.read("org", input)).rejects.toThrow(
      "Portfolio temporarily unavailable",
    );
    rpc.mockRejectedValueOnce(new Error("private"));
    await expect(repository.read("org", input)).rejects.toThrow(
      "Portfolio temporarily unavailable",
    );
    warn.mockRestore();
  });
});
