import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
it("hourly nonce pruning uses the same closed gate and never invokes the source while closed", async () => {
  jest.resetModules();
  jest.useFakeTimers();
  const original = { ...process.env };
  const directory = mkdtempSync(join(tmpdir(), "cra-nonce-gate-"));
  try {
    Object.assign(process.env, {
      CRA_MAINTENANCE_DIRECTORY: directory,
      CRA_MAINTENANCE_ACK_DIRECTORY: directory,
      CRA_SERVICE_ID: "agent-ingress",
    });
    const generation = "12345678-1234-4234-8234-123456789abc";
    writeFileSync(
      join(directory, "request.json"),
      JSON.stringify({ version: 1, generation, closed: true }),
    );
    const module = jest.requireActual<
      typeof import("./agent-nonce-maintenance")
    >("./agent-nonce-maintenance");
    const repository = {
      pruneExpiredNonces: jest.fn().mockResolvedValue(undefined),
    };
    const timer = module.startAgentNonceMaintenance(repository);
    await jest.advanceTimersByTimeAsync(60 * 60_000);
    expect(repository.pruneExpiredNonces).not.toHaveBeenCalled();
    writeFileSync(
      join(directory, "request.json"),
      JSON.stringify({ version: 1, generation, closed: false }),
    );
    await jest.advanceTimersByTimeAsync(60 * 60_000);
    expect(repository.pruneExpiredNonces).toHaveBeenCalledTimes(1);
    clearInterval(timer);
  } finally {
    process.env = original;
    jest.useRealTimers();
    jest.resetModules();
    rmSync(directory, { recursive: true, force: true });
  }
});
