import { NextResponse } from "next/server";
import * as gotrue from "../../../../lib/gotrue";
import { clearSession, readSession, writeSession } from "../../../../lib/session";

/**
 * The server side of the auth handshake.
 *
 * Every screen in app/(auth) posts here rather than to GoTrue, so the tokens
 * land in an httpOnly cookie that page JavaScript cannot read. One handler with
 * an `action` segment keeps the cookie-writing in a single place — five
 * separate files would be five chances to forget a flag.
 *
 * Responses are deliberately thin: `{ ok, message?, next? }`. The screens do
 * the routing; this decides only what is true.
 */

type Action =
  | "sign-in"
  | "sign-up"
  | "sign-out"
  | "reset"
  | "refresh"
  | "organisation";

interface Body {
  email?: string;
  password?: string;
  organisationId?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
): Promise<NextResponse> {
  const { action } = await params;

  /* Sign-out and refresh carry no body; parsing one that isn't there would
   * throw before we ever reach the switch. */
  let body: Body = {};
  if (
    action === "sign-in" ||
    action === "sign-up" ||
    action === "reset" ||
    action === "organisation"
  ) {
    try {
      body = (await request.json()) as Body;
    } catch {
      return NextResponse.json(
        { ok: false, message: "Malformed request." },
        { status: 400 },
      );
    }
  }

  switch (action as Action) {
    case "sign-in": {
      if (!body.email || !body.password) {
        return NextResponse.json(
          { ok: false, message: "Email and password are required." },
          { status: 400 },
        );
      }
      const result = await gotrue.passwordGrant(body.email, body.password);
      if (!result.ok || !result.session) {
        /* 200, not 401: this is a form result the screen renders inline, not a
         * transport failure. A 401 here would also trip any global handler that
         * redirects to sign-in — which is the page we are already on. */
        return NextResponse.json({ ok: false, message: result.message });
      }
      await writeSession(result.session);
      return NextResponse.json({ ok: true, next: "/select-organisation" });
    }

    case "sign-up": {
      if (!body.email || !body.password) {
        return NextResponse.json(
          { ok: false, message: "Email and password are required." },
          { status: 400 },
        );
      }
      const result = await gotrue.signUp(body.email, body.password);
      if (!result.ok) return NextResponse.json({ ok: false, message: result.message });
      if (result.session) {
        await writeSession(result.session);
        return NextResponse.json({ ok: true, next: "/select-organisation" });
      }
      /* No session means GoTrue is holding the account for email confirmation. */
      return NextResponse.json({ ok: true, next: "/check-email" });
    }

    case "reset": {
      if (body.email) await gotrue.requestPasswordReset(body.email);
      return NextResponse.json({ ok: true });
    }

    case "sign-out": {
      const session = await readSession();
      if (session) await gotrue.signOut(session.accessToken);
      await clearSession();
      return NextResponse.json({ ok: true, next: "/sign-in" });
    }

    case "refresh": {
      const session = await readSession();
      if (!session) return NextResponse.json({ ok: false }, { status: 401 });
      const result = await gotrue.refresh(session.refreshToken);
      if (!result.ok || !result.session) {
        await clearSession();
        return NextResponse.json({ ok: false }, { status: 401 });
      }
      await writeSession({ ...result.session, organisationId: session.organisationId });
      return NextResponse.json({ ok: true });
    }

    case "organisation": {
      /* Select the active organisation. It is stored in the SESSION rather than
       * sent by the browser on each call, because apps/api trusts
       * X-Organisation-Id to resolve the principal — if the browser could set
       * it freely, any member could assert any tenant. The API still verifies
       * membership when resolving the principal, so a bad value fails closed. */
      const session = await readSession();
      if (!session) return NextResponse.json({ ok: false }, { status: 401 });
      if (!body.organisationId) {
        return NextResponse.json(
          { ok: false, message: "organisationId is required." },
          { status: 400 },
        );
      }
      await writeSession({ ...session, organisationId: body.organisationId });
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 404 });
  }
}
