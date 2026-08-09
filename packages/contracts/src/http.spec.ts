import { describe, expect, it } from "vitest";

import { apiErrorSchema } from "./http.js";

const apiError = {
  statusCode: 503,
  message: "Permissions are temporarily unavailable. Please try again.",
  code: "permissions_unavailable",
  fieldErrors: { email: "Enter a valid email address." },
};

describe("API error wire contract", () => {
  it("accepts the existing error body", () => {
    expect(apiErrorSchema.parse(apiError)).toEqual(apiError);
  });

  it.each([
    { ...apiError, statusCode: 0 },
    { ...apiError, statusCode: 503.5 },
    { ...apiError, message: "" },
    { ...apiError, code: "" },
    { ...apiError, fieldErrors: { email: 1 } },
    { ...apiError, unrecognized: true },
  ])("rejects an invalid error boundary fixture", (value) => {
    expect(apiErrorSchema.safeParse(value).success).toBe(false);
  });
});
