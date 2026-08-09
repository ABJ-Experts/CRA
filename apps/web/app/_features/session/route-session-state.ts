export type TokenState = "valid" | "expired" | "invalid" | "absent";

export type RouteDecisionInput = Readonly<{
  protected: boolean;
  authPage: boolean;
  flowException: boolean;
  verificationPage: boolean;
  mfaPage: boolean;
  token: TokenState;
  marker: boolean;
  pending: boolean;
  mfa: boolean;
}>;

export type RouteDecision =
  | Readonly<{ kind: "next" }>
  | Readonly<{ kind: "refresh" }>
  | Readonly<{ kind: "sign_in" }>
  | Readonly<{ kind: "clear_and_sign_in" }>
  | Readonly<{ kind: "verify_email" }>
  | Readonly<{ kind: "verify_mfa" }>
  | Readonly<{ kind: "dashboard" }>;

export function decideRoute(input: RouteDecisionInput): RouteDecision {
  if (input.protected && input.token === "expired") {
    return { kind: "refresh" };
  }
  if (input.protected && input.token === "absent") {
    return input.marker ? { kind: "refresh" } : { kind: "sign_in" };
  }
  if (input.protected && input.token === "invalid") {
    return { kind: "clear_and_sign_in" };
  }
  if (
    input.pending &&
    !input.verificationPage &&
    (input.protected || input.authPage)
  ) {
    return { kind: "verify_email" };
  }
  if (input.mfa && !input.mfaPage) {
    return { kind: "verify_mfa" };
  }
  if (input.authPage && input.token === "valid" && !input.flowException) {
    return { kind: "dashboard" };
  }
  return { kind: "next" };
}
