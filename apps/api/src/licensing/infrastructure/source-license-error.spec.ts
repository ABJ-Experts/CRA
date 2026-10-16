import { sourceLicenseError } from "./source-license-error";

describe("sourceLicenseError", () => {
  it.each([
    ["licensing_product_limit", "license_product_limit", 409],
    ["licensing_seat_limit", "license_seat_limit", 409],
    ["licensing_customer_write_denied", "license_write_denied", 403],
  ])("maps exact SQL denial %s to a safe failure", (message, code, status) => {
    const result = sourceLicenseError({
      code: "42501",
      message,
      details: "secret",
      hint: "private",
    });
    expect(result).toMatchObject({ code, status });
    expect(JSON.stringify(result)).not.toMatch(/secret|private|licensing_/);
  });
  it.each([
    null,
    undefined,
    "licensing_product_limit",
    {},
    { code: "P0001", message: "licensing_product_limit" },
    { code: "42501", message: "prefix licensing_product_limit" },
    { code: "42501", message: "licensing_product_limit suffix" },
    { code: "42501", message: "permission denied for table products" },
    { code: "42501", message: "licensing_forbidden" },
  ])("preserves unrecognized provider failures: %p", (error) => {
    expect(sourceLicenseError(error)).toBeNull();
  });
});
