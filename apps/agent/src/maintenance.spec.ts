import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { agentMaintenanceClosed } from "./maintenance.js";
describe("installed agent maintenance", () => {
  it("fails closed on unknown state and acknowledges only between complete cycles", () => {
    const directory = mkdtempSync(join(tmpdir(), "cra-agent-drain-"));
    const env = {
      CRA_MAINTENANCE_DIRECTORY: directory,
      CRA_MAINTENANCE_ACK_DIRECTORY: directory,
      CRA_SERVICE_ID: "agent",
    };
    try {
      expect(agentMaintenanceClosed({})).toBe(false);
      expect(() =>
        agentMaintenanceClosed({ ...env, CRA_SERVICE_ID: "other" }),
      ).toThrow();
      expect(agentMaintenanceClosed(env)).toBe(true);
      const generation = "12345678-1234-4234-8234-123456789abc";
      writeFileSync(
        join(directory, "request.json"),
        JSON.stringify({ version: 1, generation, closed: false }),
      );
      expect(agentMaintenanceClosed(env)).toBe(false);
      writeFileSync(
        join(directory, "request.json"),
        JSON.stringify({ version: 1, generation, closed: true }),
      );
      expect(agentMaintenanceClosed(env)).toBe(true);
      expect(
        JSON.parse(readFileSync(join(directory, "ack.json"), "utf8")),
      ).toMatchObject({ generation, claimsClosed: true, drained: true });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
