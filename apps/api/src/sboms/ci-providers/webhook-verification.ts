import { createHmac, timingSafeEqual } from "node:crypto";

import type { CiProvider } from "./index";

type Headers = Readonly<Record<string, string | string[] | undefined>>;

const header = (headers: Headers, name: string): string | undefined => {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return typeof value === "string" ? value : undefined;
};

const constantTimeEqual = (expected: Buffer, received: Buffer): boolean =>
  expected.byteLength === received.byteLength &&
  timingSafeEqual(expected, received);

/** Caller stores this identity under a unique constraint before processing. */
export function providerDeliveryIdentity(
  provider: CiProvider,
  providerHost: string,
  deliveryId: string,
): string | null {
  if (
    !/^[a-z0-9.-]{3,253}$/.test(providerHost) ||
    !/^[A-Za-z0-9_-]{1,160}$/.test(deliveryId)
  )
    return null;
  return `${provider}:${providerHost}:${deliveryId}`;
}

export function verifyGithubWebhook(
  rawBody: Buffer,
  headers: Headers,
  secret: string,
): boolean {
  const signature = header(headers, "x-hub-signature-256");
  const delivery = header(headers, "x-github-delivery");
  if (
    !secret ||
    !delivery ||
    !providerDeliveryIdentity("github_actions", "github.com", delivery) ||
    !signature ||
    !/^sha256=[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return constantTimeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}

/** GitLab 19 uses Standard Webhooks; earlier versions use a shared token only. */
export function verifyGitlabWebhook(
  rawBody: Buffer,
  headers: Headers,
  secret: string,
  mode: "signed" | "legacy",
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret) return false;
  if (mode === "legacy") {
    const delivery =
      header(headers, "webhook-id") ??
      header(headers, "idempotency-key") ??
      header(headers, "x-gitlab-event-uuid");
    const supplied = header(headers, "x-gitlab-token");
    return Boolean(
      delivery &&
      providerDeliveryIdentity("gitlab_ci", "gitlab.com", delivery) &&
      supplied &&
      constantTimeEqual(Buffer.from(secret), Buffer.from(supplied)),
    );
  }
  const delivery = header(headers, "webhook-id");
  const timestamp = header(headers, "webhook-timestamp");
  const signatures = header(headers, "webhook-signature");
  if (
    !delivery ||
    !providerDeliveryIdentity("gitlab_ci", "gitlab.com", delivery) ||
    !timestamp ||
    !/^\d{1,12}$/.test(timestamp) ||
    Math.abs(nowSeconds - Number(timestamp)) > 300 ||
    !signatures ||
    !secret.startsWith("whsec_")
  )
    return false;
  const key = Buffer.from(secret.slice(6), "base64");
  if (key.byteLength !== 32) return false;
  const expected = createHmac("sha256", key)
    .update(`${delivery}.${timestamp}.`)
    .update(rawBody)
    .digest();
  return signatures.split(" ").some((entry) => {
    if (!/^v1,[A-Za-z0-9+/=]{44}$/.test(entry)) return false;
    return constantTimeEqual(expected, Buffer.from(entry.slice(3), "base64"));
  });
}
