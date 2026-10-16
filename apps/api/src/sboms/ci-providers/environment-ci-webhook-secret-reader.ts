import type { CiWebhookSecretReader } from "./ci-provider-webhook";

/** V1 deployment secrets: GitHub App-wide, GitLab signing keys per connector. */
export class EnvironmentCiWebhookSecretReader implements CiWebhookSecretReader {
  constructor(
    private readonly environment: Readonly<
      Record<string, string | undefined>
    > = process.env,
  ) {}

  load(provider: "github_actions" | "gitlab_ci", connectorId: string) {
    if (provider === "github_actions") {
      const secret = this.environment.CI_GITHUB_WEBHOOK_SECRET;
      return secret && secret.length >= 32
        ? { mode: "github" as const, secret }
        : null;
    }
    const signing = secretMap(
      this.environment.CI_GITLAB_WEBHOOK_SIGNING_TOKENS,
    )[connectorId];
    if (
      signing &&
      /^whsec_[A-Za-z0-9+/=]+$/.test(signing) &&
      Buffer.from(signing.slice(6), "base64").byteLength === 32
    )
      return { mode: "signed" as const, secret: signing };
    const legacy = secretMap(this.environment.CI_GITLAB_WEBHOOK_LEGACY_TOKENS)[
      connectorId
    ];
    return legacy && legacy.length >= 32
      ? { mode: "legacy" as const, secret: legacy }
      : null;
  }
}

function secretMap(
  value: string | undefined,
): Readonly<Record<string, string>> {
  if (!value || value.length > 65_536) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, secret]) =>
          /^[a-f0-9-]{36}$/.test(key) && typeof secret === "string",
      ),
    );
  } catch {
    return {};
  }
}
