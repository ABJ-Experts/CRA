import { describe, expect, it } from "vitest";

import { decideRoute, type RouteDecisionInput } from "./route-session-state";

const baseInput = {
  protected: false,
  authPage: false,
  flowException: false,
  verificationPage: false,
  mfaPage: false,
  token: "absent",
  marker: false,
  pending: false,
  mfa: false,
} as const satisfies RouteDecisionInput;

describe("decideRoute", () => {
  it.each([
    [
      {
        protected: true,
        token: "valid",
        marker: false,
        pending: false,
        mfa: false,
      },
      { kind: "next" },
    ],
    [
      {
        protected: true,
        token: "expired",
        marker: false,
        pending: false,
        mfa: false,
      },
      { kind: "refresh" },
    ],
    [
      {
        protected: true,
        token: "absent",
        marker: true,
        pending: false,
        mfa: false,
      },
      { kind: "refresh" },
    ],
    [
      {
        protected: true,
        token: "absent",
        marker: false,
        pending: false,
        mfa: false,
      },
      { kind: "sign_in" },
    ],
    [
      {
        protected: true,
        token: "invalid",
        marker: true,
        pending: false,
        mfa: false,
      },
      { kind: "clear_and_sign_in" },
    ],
    [
      {
        protected: true,
        token: "valid",
        marker: true,
        pending: true,
        mfa: false,
      },
      { kind: "verify_email" },
    ],
    [
      {
        protected: true,
        token: "valid",
        marker: true,
        pending: false,
        mfa: true,
      },
      { kind: "verify_mfa" },
    ],
  ] as const)("decides protected route state %#", (input, expected) => {
    expect(decideRoute({ ...baseInput, ...input })).toEqual(expected);
  });

  it.each([
    [
      "pending email precedes MFA",
      { protected: true, token: "valid", pending: true, mfa: true },
      { kind: "verify_email" },
    ],
    [
      "expired access precedes pending email",
      { protected: true, token: "expired", pending: true },
      { kind: "refresh" },
    ],
    [
      "invalid access precedes MFA",
      { protected: true, token: "invalid", mfa: true },
      { kind: "clear_and_sign_in" },
    ],
    [
      "pending auth flow is held on verification",
      { authPage: true, token: "valid", pending: true },
      { kind: "verify_email" },
    ],
    [
      "MFA applies outside protected and auth routes",
      { token: "absent", mfa: true },
      { kind: "verify_mfa" },
    ],
    [
      "authenticated auth page goes to dashboard",
      { authPage: true, token: "valid" },
      { kind: "dashboard" },
    ],
    [
      "authenticated mid-flow auth page remains reachable",
      { authPage: true, flowException: true, token: "valid" },
      { kind: "next" },
    ],
    [
      "an invalid token on an auth page is not treated as authenticated",
      { authPage: true, token: "invalid" },
      { kind: "next" },
    ],
    [
      "an expired token on an unprotected page is not refreshed",
      { token: "expired", marker: true },
      { kind: "next" },
    ],
  ] as const)("preserves precedence: %s", (_name, input, expected) => {
    expect(decideRoute({ ...baseInput, ...input })).toEqual(expected);
  });

  it("keeps the email verification page reachable while pending", () => {
    expect(
      decideRoute({
        ...baseInput,
        authPage: true,
        flowException: true,
        verificationPage: true,
        token: "valid",
        pending: true,
        mfa: false,
      }),
    ).toEqual({ kind: "next" });
  });

  it("still routes a pending user away from another flow exception", () => {
    expect(
      decideRoute({
        ...baseInput,
        authPage: true,
        flowException: true,
        token: "valid",
        pending: true,
      }),
    ).toEqual({ kind: "verify_email" });
  });

  it("keeps the MFA page reachable while MFA is owed", () => {
    expect(
      decideRoute({
        ...baseInput,
        authPage: true,
        flowException: true,
        mfaPage: true,
        token: "valid",
        mfa: true,
      }),
    ).toEqual({ kind: "next" });
  });

  it("still routes an MFA user away from another flow exception", () => {
    expect(
      decideRoute({
        ...baseInput,
        authPage: true,
        flowException: true,
        token: "valid",
        mfa: true,
      }),
    ).toEqual({ kind: "verify_mfa" });
  });
});
