"use client";

import { Button } from "@repo/ui/button";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { AuthOutcome } from "../_components/auth-outcome";
import { AuthTitle } from "../_components/auth-chrome";

/**
 * Accept an organization invitation.
 *
 * The only NEW screen in this migration — CRA shipped ten auth screens and none
 * of them covered this. It reuses `AuthOutcome` and the shared `(auth)` layout,
 * so it inherits the existing chrome rather than introducing a second visual
 * language.
 *
 * The flow it has to handle, and why each branch exists:
 *   - not signed in    -> send to sign-in with a returnUrl, because acceptance
 *                         binds the invitation to a SESSION; there is no safe
 *                         way to accept without one.
 *   - wrong account    -> the API answers 403 (the invitation names an address),
 *                         so a leaked link is not a way in for whoever finds it.
 *   - already accepted -> success, not an error. Double-clicking, a retry, or
 *                         revisiting the link from an inbox must not read as a
 *                         failure when the user IS a member.
 */

type State =
  | { kind: "working" }
  | { kind: "done"; organization: string; already: boolean }
  | { kind: "error"; message: string; needsSignIn: boolean };

function AcceptInvitation() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<State>({ kind: "working" });

  const accept = useCallback(async () => {
    if (!token) {
      setState({
        kind: "error",
        message: "That invitation link is missing its token.",
        needsSignIn: false,
      });
      return;
    }

    setState({ kind: "working" });

    try {
      const res = await fetch("/api/v1/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ token }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        alreadyAccepted?: boolean;
        organization?: { name: string };
      };

      if (res.status === 401) {
        // No session yet. Come back here after signing in, token intact.
        setState({
          kind: "error",
          message: "Sign in to accept this invitation.",
          needsSignIn: true,
        });
        return;
      }

      if (!res.ok) {
        setState({
          kind: "error",
          message: body.message ?? "We could not accept that invitation.",
          needsSignIn: false,
        });
        return;
      }

      setState({
        kind: "done",
        organization: body.organization?.name ?? "your organization",
        already: body.alreadyAccepted === true,
      });
    } catch {
      setState({
        kind: "error",
        message: "We could not reach the server. Check your connection.",
        needsSignIn: false,
      });
    }
  }, [token]);

  useEffect(() => {
    void accept();
  }, [accept]);

  if (state.kind === "working") {
    return (
      <div className="flex flex-col gap-4">
        <AuthTitle
          title="Joining…"
          description="One moment while we add you."
        />
      </div>
    );
  }

  if (state.kind === "done") {
    return (
      <AuthOutcome
        tone="success"
        icon={<CircleCheck aria-hidden="true" />}
        title={state.already ? "You are already a member" : "You are in"}
        description={`You now have access to ${state.organization}.`}
      >
        <Button fullWidth onClick={() => router.push("/dashboard")}>
          Go to dashboard
        </Button>
      </AuthOutcome>
    );
  }

  return (
    <AuthOutcome
      tone="danger"
      icon={<CircleAlert aria-hidden="true" />}
      title="We could not accept that invitation"
      description={state.message}
    >
      {state.needsSignIn ? (
        <Button
          fullWidth
          onClick={() =>
            router.push(
              `/sign-in?returnUrl=${encodeURIComponent(`/accept-invitation?token=${token}`)}`,
            )
          }
        >
          Sign in
        </Button>
      ) : (
        <Button fullWidth variant="outline" onClick={() => void accept()}>
          Try again
        </Button>
      )}
    </AuthOutcome>
  );
}

export default function AcceptInvitationPage() {
  /*
   * `useSearchParams` opts the route out of static rendering unless it is inside
   * a Suspense boundary — the same pattern the other token-reading screens
   * (verify, reset-password, check-email, success) already use.
   */
  return (
    <Suspense fallback={null}>
      <AcceptInvitation />
    </Suspense>
  );
}
