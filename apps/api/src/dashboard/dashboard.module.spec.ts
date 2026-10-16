import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { DashboardModule } from "./dashboard.module";
import { DashboardUseCases } from "./application/dashboard-use-cases";
import { DashboardCursorCodec } from "./infrastructure/dashboard-cursor";

describe("dashboard composition root", () => {
  it("logs only source and safe classification when one provider section fails", async () => {
    const warn = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      DashboardModule,
    ) as { provide: unknown; useFactory?: (...args: unknown[]) => unknown }[];
    const application = providers.find(
      (provider) => provider.provide === DashboardUseCases,
    )!;
    const id = "11111111-1111-4111-8111-111111111111";
    const hidden = { state: "restricted", observedAt: null, updatedAt: null };
    const useCases = application.useFactory!(
      {
        read: () =>
          Promise.resolve({
            result: {
              organizationId: id,
              serverNow: "2026-10-07T12:00:00Z",
              generatedAt: "2026-10-07T12:00:00Z",
              products: { bad: "private" },
              findings: hidden,
              obligations: hidden,
              sbomCoverage: hidden,
              readiness: hidden,
              ingestion: hidden,
              feedFreshness: hidden,
            },
            nextPosition: null,
          }),
      },
      {
        snapshot: () =>
          Promise.resolve({
            version: 1,
            permissions: {
              can_view_dashboards: true,
              can_view_products: true,
            },
          }),
      },
      new DashboardCursorCodec("test-only"),
    ) as DashboardUseCases;
    await useCases.overview(
      {
        id,
        organizationId: id,
        role: "owner",
        isActive: true,
      } as import("../auth/auth.types").RequestUser,
      {},
    );
    expect(warn).toHaveBeenCalledWith({
      source: "products",
      classification: "provider_contract_invalid",
    });
    const unavailable = application.useFactory!(
      {},
      { snapshot: () => Promise.reject(new Error("secret-canary")) },
      new DashboardCursorCodec("test-only"),
    ) as DashboardUseCases;
    await expect(
      unavailable.overview(
        {
          id,
          organizationId: id,
          role: "owner",
          isActive: true,
        } as import("../auth/auth.types").RequestUser,
        {},
      ),
    ).rejects.toThrow("Dashboard temporarily unavailable");
    expect(warn).toHaveBeenCalledWith({
      endpoint: "overview",
      phase: "permission_snapshot",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-canary");
    warn.mockRestore();
  });
  it("constructs injected stateless use cases and isolated cursor key", () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      DashboardModule,
    ) as { provide: unknown; useFactory?: (...args: unknown[]) => unknown }[];
    const cursorProvider = providers.find(
      (provider) => provider.provide === DashboardCursorCodec,
    )!;
    const tokens = cursorProvider.useFactory!({
      getOrThrow: () => "test-only",
    });
    expect(tokens).toBeInstanceOf(DashboardCursorCodec);
    const application = providers.find(
      (provider) => provider.provide === DashboardUseCases,
    )!;
    expect(
      application.useFactory!(
        {},
        {
          snapshot: () => Promise.resolve({ version: 1, permissions: {} }),
        },
        tokens,
      ),
    ).toBeInstanceOf(DashboardUseCases);
  });
});
