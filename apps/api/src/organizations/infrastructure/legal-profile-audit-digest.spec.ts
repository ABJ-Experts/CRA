import {
  canonicalContactAuditValue,
  contactAuditDigest,
} from "./legal-profile-audit-digest";

describe("contactAuditDigest", () => {
  it("is stable but domain-separates contact fields and null values", () => {
    const secret = "a-test-signing-secret-that-is-long-enough";

    expect(contactAuditDigest("manufacturer_contact_name", "Ada", secret)).toBe(
      contactAuditDigest("manufacturer_contact_name", "Ada", secret),
    );
    expect(
      contactAuditDigest("manufacturer_contact_name", "Ada", secret),
    ).not.toBe(contactAuditDigest("manufacturer_contact_email", "Ada", secret));
    expect(
      contactAuditDigest("manufacturer_contact_phone", null, secret),
    ).not.toBe(contactAuditDigest("manufacturer_contact_phone", "", secret));
  });

  it("never returns raw contact material", () => {
    const digest = contactAuditDigest(
      "manufacturer_contact_email",
      "ada.manufacturer@example.com",
      "a-test-signing-secret-that-is-long-enough",
    );

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain("ada");
    expect(digest).not.toContain("example");
  });

  it("canonicalizes values with the same rules used by the profile RPC", () => {
    expect(
      canonicalContactAuditValue(
        "manufacturer_contact_name",
        "  Ada   Manufacturer  ",
      ),
    ).toBe("Ada Manufacturer");
    expect(
      canonicalContactAuditValue(
        "manufacturer_contact_email",
        " ADA@EXAMPLE.TEST ",
      ),
    ).toBe("ada@example.test");
    expect(
      canonicalContactAuditValue("manufacturer_contact_phone", "   "),
    ).toBeNull();
  });
});
