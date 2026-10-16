import { ReportsModule } from "./reports.module";
import { ReportsUseCases } from "./application/reports.use-cases";
import { ReportUnavailableError } from "./domain/report.errors";
import type { RequestUser } from "../auth/auth.types";

describe("ReportsModule", () => {
  it("honors the creation feature switch at composition", async () => {
    const providers = Reflect.getMetadata(
      "providers",
      ReportsModule,
    ) as unknown[];
    const binding = providers.find(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        "provide" in value &&
        value.provide === ReportsUseCases,
    ) as {
      useFactory: (
        repository: unknown,
        permissions: unknown,
        config: unknown,
      ) => ReportsUseCases;
    };
    const cases = binding.useFactory(
      {},
      { can: jest.fn().mockResolvedValue(true) },
      { get: () => "false" },
    );
    const user = {
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: "22222222-2222-4222-8222-222222222222",
      sessionId: "33333333-3333-4333-8333-333333333333",
      role: "owner",
      isActive: true,
    } as RequestUser;
    await expect(
      cases.create(user, {
        config: { report: { kind: "readiness", productId: user.id } },
      } as never),
    ).rejects.toBeInstanceOf(ReportUnavailableError);
  });
});
