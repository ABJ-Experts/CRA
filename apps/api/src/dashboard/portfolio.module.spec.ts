import "reflect-metadata";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { DashboardModule } from "./dashboard.module";
import { PortfolioController } from "./portfolio.controller";
import { PortfolioUseCases } from "./application/portfolio-use-cases";
import { DashboardCursorCodec } from "./infrastructure/dashboard-cursor";
describe("portfolio composition", () => {
  it("wires the controller and inward-owned use case dependencies", () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      DashboardModule,
    ) as unknown[];
    expect(controllers).toContain(PortfolioController);
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      DashboardModule,
    ) as { provide: unknown; useFactory?: (...args: unknown[]) => unknown }[];
    const factory = providers.find(
      (provider) => provider.provide === PortfolioUseCases,
    )!;
    expect(
      factory.useFactory!(
        { read: jest.fn() },
        { snapshot: jest.fn() },
        new DashboardCursorCodec("test"),
      ),
    ).toBeInstanceOf(PortfolioUseCases);
  });
});
