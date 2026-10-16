import "reflect-metadata";
import { SupportDiagnosticsModule } from "./support-diagnostics.module";
import { SupportDiagnosticsUseCases } from "./application/support-diagnostics.use-cases";
import { DiagnosticPreviewTokens } from "./domain/diagnostic-preview-tokens";
import { DiagnosticArchive } from "./infrastructure/diagnostic-archive";
import { DiagnosticArtifactStore } from "./infrastructure/diagnostic-artifact.store";
it("wires and exports application and worker dependencies", () => {
  const providers = Reflect.getMetadata(
    "providers",
    SupportDiagnosticsModule,
  ) as { provide: unknown; useFactory?: (...args: unknown[]) => unknown }[];
  const make = (token: unknown, ...args: unknown[]) =>
    providers.find((provider) => provider.provide === token)!.useFactory!(
      ...args,
    );
  const tokens = make(DiagnosticPreviewTokens, {
    getOrThrow: jest.fn().mockReturnValue("x".repeat(16)),
  });
  const archive = make(DiagnosticArchive);
  const store = make(DiagnosticArtifactStore, {});
  expect(tokens).toBeInstanceOf(DiagnosticPreviewTokens);
  expect(archive).toBeInstanceOf(DiagnosticArchive);
  expect(store).toBeInstanceOf(DiagnosticArtifactStore);
  expect(
    make(SupportDiagnosticsUseCases, {}, tokens, store, archive),
  ).toBeInstanceOf(SupportDiagnosticsUseCases);
  expect(Reflect.getMetadata("exports", SupportDiagnosticsModule)).toContain(
    SupportDiagnosticsUseCases,
  );
});
