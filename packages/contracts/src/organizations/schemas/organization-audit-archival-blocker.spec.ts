import { describe, expect, it } from "vitest";
import { organizationLifecycleBlockerSchema } from "./organization-lifecycle.schema.js";

describe("audit archival lifecycle blocker", () => {
  it("accepts the safe archival code without exposing ledger details", () => {
    expect(
      organizationLifecycleBlockerSchema.parse({
        kind: "audit_archival",
        code: "audit_archival_required",
      }),
    ).toEqual({ kind: "audit_archival", code: "audit_archival_required" });
  });
  it("rejects extra event data and unknown archival reasons", () => {
    expect(
      organizationLifecycleBlockerSchema.safeParse({
        kind: "audit_archival",
        code: "audit_archival_required",
        event: "private",
      }).success,
    ).toBe(false);
    expect(
      organizationLifecycleBlockerSchema.safeParse({
        kind: "audit_archival",
        code: "skip_chain",
      }).success,
    ).toBe(false);
  });
});
