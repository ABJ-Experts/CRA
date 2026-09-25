import { NextResponse } from "next/server";

const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:3333";

export async function POST(request: Request) {
  const upstream = await fetch(`${apiOrigin}/api/v1/auditor/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: await request.text(),
  });
  const response = new NextResponse(await upstream.text(), { status: upstream.status });
  const contentType = upstream.headers.get("content-type");
  if (contentType) response.headers.set("content-type", contentType);
  for (const cookie of upstream.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
  return response;
}
