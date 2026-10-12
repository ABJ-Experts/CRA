import { portalExportPrincipal } from "./portal-export-principal";
import { ExportAccessDeniedError } from "../domain/export.errors";
describe("portalExportPrincipal", () => {
  it("hashes opaque sessions without accepting a tenant", () => {
    const result = portalExportPrincipal("supplier_session", "a".repeat(64));
    expect(result.kind).toBe("supplier_session");
    expect(result.sessionDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(result.sessionDigest).not.toBe("a".repeat(64));
  });
  it.each([undefined, "short", "a".repeat(257)])(
    "denies malformed token %s",
    (token) =>
      expect(() => portalExportPrincipal("auditor_session", token)).toThrow(
        ExportAccessDeniedError,
      ),
  );
});
