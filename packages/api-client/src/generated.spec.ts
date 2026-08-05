// FR-API-001: "Drift between specification and implementation fails CI."
//
// The generated client is committed so a contract change is reviewable, which
// only works if the checked-in file is provably the output of the current
// document. Regenerating into a temp file and comparing is the cheap half of
// that gate; the other half is apps/api's openapi.spec.ts, which regenerates
// openapi.json itself from the live route decorators.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const pkgRoot = join(import.meta.dirname, "..");

describe("generated client", () => {
  it("matches the published OpenAPI document", () => {
    const fresh = execFileSync(
      "pnpm",
      ["exec", "openapi-typescript", "../../apps/api/openapi.json"],
      { cwd: pkgRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const committed = readFileSync(join(pkgRoot, "src/generated.ts"), "utf8");

    expect(
      fresh.trim(),
      "src/generated.ts is stale. Run: pnpm --filter @repo/api-client generate",
    ).toBe(committed.trim());
  }, 60_000);
});
