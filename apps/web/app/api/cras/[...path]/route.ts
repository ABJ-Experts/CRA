import { NextResponse } from "next/server";
import { refresh } from "../../../../lib/gotrue";
import { clearSession, readSession, writeSession } from "../../../../lib/session";

/**
 * Server-side proxy from the browser to apps/api.
 *
 * The browser cannot call the API directly: the access token lives in an
 * httpOnly cookie precisely so page JavaScript cannot read it, which also means
 * page JavaScript cannot attach it to an Authorization header. This handler is
 * the only place the two meet.
 *
 * It attaches exactly the two headers apps/api's CORS config allows alongside
 * content-type — `authorization` and `x-organisation-id`
 * (apps/api/src/main.ts). The organisation comes from the SESSION, never from
 * the caller: apps/api resolves the active-org principal from that header, so
 * letting the browser set it would let any member assert any tenant.
 */

const apiUrl = () => process.env.API_URL ?? "http://127.0.0.1:3333";

/** Hop-by-hop and body-framing headers that must not be forwarded verbatim. */
const STRIP = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "accept-encoding",
  "cookie",
]);

async function proxy(
  request: Request,
  segments: string[],
): Promise<NextResponse> {
  let session = await readSession();
  if (!session) {
    return NextResponse.json(
      {
        type: "about:blank",
        title: "Unauthorized",
        status: 401,
        detail: "No session",
      },
      { status: 401, headers: { "content-type": "application/problem+json" } },
    );
  }

  /* Refresh BEFORE the call rather than retrying on a 401. A retry would have
   * to replay the request body, which for a stream can only be read once. */
  if (session.expiresAt <= Math.floor(Date.now() / 1000)) {
    const refreshed = await refresh(session.refreshToken);
    if (!refreshed.ok || !refreshed.session) {
      await clearSession();
      return NextResponse.json(
        {
          type: "about:blank",
          title: "Unauthorized",
          status: 401,
          detail: "Session expired",
        },
        { status: 401, headers: { "content-type": "application/problem+json" } },
      );
    }
    session = { ...refreshed.session, organisationId: session.organisationId };
    await writeSession(session);
  }

  const incoming = new URL(request.url);
  const target = `${apiUrl()}/${segments.join("/")}${incoming.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!STRIP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("authorization", `Bearer ${session.accessToken}`);
  if (session.organisationId) {
    headers.set("x-organisation-id", session.organisationId);
  } else {
    /* Never inherit a caller-supplied value when the session has none. */
    headers.delete("x-organisation-id");
  }

  const method = request.method;
  const hasBody = method !== "GET" && method !== "HEAD";

  const upstream = await fetch(target, {
    method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    cache: "no-store",
    redirect: "manual",
  });

  /* Pass the upstream body and status through untouched — apps/api already
   * speaks RFC 9457 Problem Details on the error path, and rewrapping it here
   * would lose the correlationId that ties a failure to a server log line. */
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  }) as NextResponse;
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, { params }: Ctx) {
  return proxy(request, (await params).path);
}
export async function POST(request: Request, { params }: Ctx) {
  return proxy(request, (await params).path);
}
export async function PATCH(request: Request, { params }: Ctx) {
  return proxy(request, (await params).path);
}
export async function DELETE(request: Request, { params }: Ctx) {
  return proxy(request, (await params).path);
}
