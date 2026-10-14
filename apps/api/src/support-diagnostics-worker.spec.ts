import {
  bootstrapSupportDiagnosticsWorker,
  diagnosticWorkerFromContext,
  safeDiagnosticWorkerCode,
} from "./support-diagnostics-worker";
describe("diagnostic worker process", () => {
  it("closes context after one safe cycle and never logs provider text", async () => {
    const close = jest.fn();
    const error = jest.fn();
    await bootstrapSupportDiagnosticsWorker({
      argv: ["--once"],
      createApplicationContext: () =>
        Promise.resolve({ get: jest.fn(), close }),
      createWorker: () => ({
        runOnce: () => Promise.reject(new Error("private provider payload")),
      }),
      logger: { error },
      sleep: jest.fn(),
    });
    expect(close).toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "Diagnostic worker cycle failed code=unknown",
    );
  });
  it("allows only finite error codes", () => {
    expect(safeDiagnosticWorkerCode(new Error("access_changed"))).toBe(
      "access_changed",
    );
    expect(safeDiagnosticWorkerCode({ message: "secret" })).toBe("unknown");
  });
});

it("builds the concrete worker from application-owned providers", () => {
  const worker = diagnosticWorkerFromContext({
    get: () => ({}),
    close: () => Promise.resolve(),
  });
  expect(worker).toBeDefined();
});
