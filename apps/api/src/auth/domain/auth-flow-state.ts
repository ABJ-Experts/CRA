import type { Result } from "../../common/application/result";

export type AuthFlowState =
  | Readonly<{ kind: "anonymous" }>
  | Readonly<{ kind: "pending_email"; userId: string }>
  | Readonly<{ kind: "mfa_required"; userId: string }>
  | Readonly<{
      kind: "authenticated";
      userId: string;
      aal: "aal1" | "aal2";
    }>
  | Readonly<{ kind: "locked"; email: string; until: string }>;

export type AuthFlowEvent =
  | Readonly<{ kind: "registration_created"; userId: string }>
  | Readonly<{
      kind: "credentials_verified";
      userId: string;
      requiresMfa: boolean;
    }>
  | Readonly<{ kind: "email_verified"; userId: string }>
  | Readonly<{ kind: "mfa_verified"; userId: string }>
  | Readonly<{
      kind: "session_verified";
      userId: string;
      aal: "aal1" | "aal2";
    }>
  | Readonly<{ kind: "lock_applied"; email: string; until: string }>
  | Readonly<{ kind: "lock_expired" }>
  | Readonly<{ kind: "signed_out" }>;

export type AuthFlowTransitionError = Readonly<{
  code: "invalid_auth_flow_transition";
  from: AuthFlowState["kind"];
  event: AuthFlowEvent["kind"];
}>;

const invalid = (
  from: AuthFlowState,
  event: AuthFlowEvent,
): Result<AuthFlowState, AuthFlowTransitionError> => ({
  ok: false,
  error: {
    code: "invalid_auth_flow_transition",
    from: from.kind,
    event: event.kind,
  },
});

const sameUser = (
  state: Extract<AuthFlowState, { userId: string }>,
  event: Readonly<{ userId: string }>,
): boolean => state.userId === event.userId;

/**
 * Apply facts established by the server to the authentication flow.
 *
 * Cookie and browser marker values intentionally have no event variant here;
 * they can select a screen, but cannot manufacture authentication state.
 */
export function transitionAuthFlow(
  from: AuthFlowState,
  event: AuthFlowEvent,
): Result<AuthFlowState, AuthFlowTransitionError> {
  if (event.kind === "signed_out") {
    return { ok: true, value: { kind: "anonymous" } };
  }

  if (from.kind === "anonymous") {
    if (event.kind === "registration_created") {
      return {
        ok: true,
        value: { kind: "pending_email", userId: event.userId },
      };
    }
    if (event.kind === "credentials_verified") {
      return {
        ok: true,
        value: event.requiresMfa
          ? { kind: "mfa_required", userId: event.userId }
          : { kind: "authenticated", userId: event.userId, aal: "aal1" },
      };
    }
    if (event.kind === "session_verified") {
      return {
        ok: true,
        value: {
          kind: "authenticated",
          userId: event.userId,
          aal: event.aal,
        },
      };
    }
    if (event.kind === "lock_applied") {
      return {
        ok: true,
        value: { kind: "locked", email: event.email, until: event.until },
      };
    }
  }

  if (
    from.kind === "pending_email" &&
    event.kind === "email_verified" &&
    sameUser(from, event)
  ) {
    return {
      ok: true,
      value: { kind: "authenticated", userId: from.userId, aal: "aal1" },
    };
  }

  if (
    from.kind === "mfa_required" &&
    event.kind === "mfa_verified" &&
    sameUser(from, event)
  ) {
    return {
      ok: true,
      value: { kind: "authenticated", userId: from.userId, aal: "aal2" },
    };
  }

  if (from.kind === "locked" && event.kind === "lock_expired") {
    return { ok: true, value: { kind: "anonymous" } };
  }

  return invalid(from, event);
}

export type AuthRouteHintDecision =
  | Readonly<{
      kind: "route_hint";
      route: "/verify-email" | "/two-factor" | "/dashboard";
    }>
  | Readonly<{ kind: "no_hint" }>;

/** Map browser markers to UX only; this function never returns auth state. */
export function routeForAuthHint(
  hint: string | null | undefined,
): AuthRouteHintDecision {
  if (hint === "cra_pending") {
    return { kind: "route_hint", route: "/verify-email" };
  }
  if (hint === "cra_mfa") {
    return { kind: "route_hint", route: "/two-factor" };
  }
  if (hint === "cra_session") {
    return { kind: "route_hint", route: "/dashboard" };
  }
  return { kind: "no_hint" };
}
