import { createHmac } from "node:crypto";

import type { CiProviderReleaseBinding } from "@repo/contracts/sboms";
import type { CiConnectorConnection } from "../../connectors/application/ci-connector-credential-reader";
import type {
  CiConnectionReader,
  CiProviderVerifierPort,
  SbomCiIntegrationRepository,
} from "../application/sbom-ci-integration.port";
import {
  CiProviderWebhookUseCases,
  type CiWebhookEventLedger,
  type CiWebhookSecretReader,
} from "./ci-provider-webhook";

const orgId = "123e4567-e89b-12d3-a456-426614174000";
const bindingId = "123e4567-e89b-12d3-a456-426614174001";
const connectorId = "123e4567-e89b-12d3-a456-426614174002";
const deliveryId = "123e4567-e89b-12d3-a456-426614174003";
const binding = {
  id: bindingId,
  organizationId: orgId,
  connectorId,
  provider: "github_actions",
  providerHost: "github.com",
  repositoryId: "42",
  providerInstallationId: "9",
  projectKey: null,
  pipelineDefinitionId: null,
  allowedRef: "refs/heads/main",
  status: "active",
  connectionRevision: 1,
  credentialRevision: 1,
} as CiProviderReleaseBinding;
const connection = {
  connectorId,
  provider: "github_actions",
  config: { providerHost: "github.com", appId: "1", installationId: "9" },
  secret: "test-only-key",
  connectionRevision: 1,
  credentialRevision: 1,
} as CiConnectorConnection;

const verifiedRun = {
  provider: "github_actions" as const,
  providerHost: "github.com",
  repositoryId: "42",
  providerInstallationId: "9",
  runId: "81",
  runAttempt: "2",
  commitSha: "a".repeat(40),
  ref: "refs/heads/main",
  eventName: "push" as const,
  observedAt: "2026-09-30T10:00:00Z",
};

function fixture() {
  const getBindingMock = jest.fn().mockResolvedValue(binding);
  const bindings = { getBinding: getBindingMock } as Pick<
    SbomCiIntegrationRepository,
    "getBinding"
  >;
  const loadMock = jest.fn().mockResolvedValue(connection);
  const connections = { load: loadMock } as CiConnectionReader;
  const verifyRunMock = jest
    .fn()
    .mockResolvedValue({ outcome: "verified", run: verifiedRun });
  const verifier = {
    verifyRun: verifyRunMock,
  } as unknown as CiProviderVerifierPort;
  const secretLoadMock = jest
    .fn()
    .mockReturnValue({ mode: "github", secret: "hook-secret" });
  const secrets = { load: secretLoadMock } as CiWebhookSecretReader;
  const recordMock = jest
    .fn()
    .mockResolvedValue({ outcome: "recorded", eventId: deliveryId });
  const ledger = { record: recordMock } as CiWebhookEventLedger;
  return {
    useCases: new CiProviderWebhookUseCases(
      bindings,
      connections,
      verifier,
      secrets,
      ledger,
    ),
    bindings,
    getBindingMock,
    connections,
    loadMock,
    verifier,
    verifyRunMock,
    secrets,
    secretLoadMock,
    ledger,
    recordMock,
  };
}

function githubEvent() {
  const rawBody = Buffer.from(
    JSON.stringify({
      action: "completed",
      installation: { id: 9 },
      repository: { id: 42 },
      workflow_run: { id: 81, run_attempt: 2 },
    }),
  );
  return {
    provider: "github_actions" as const,
    organizationId: orgId,
    bindingId,
    rawBody,
    headers: {
      "x-github-delivery": deliveryId,
      "x-hub-signature-256": `sha256=${createHmac("sha256", "hook-secret").update(rawBody).digest("hex")}`,
    },
  };
}

describe("CI inbound provider webhooks", () => {
  it("verifies raw GitHub payload, refetches run, then records a durable delivery", async () => {
    const { useCases, recordMock, verifyRunMock } = fixture();
    expect(await useCases.receive(githubEvent())).toEqual({
      outcome: "recorded",
    });
    expect(verifyRunMock).toHaveBeenCalledWith(connection, binding, {
      bindingId,
      runId: "81",
      runAttempt: "2",
    });
    expect(recordMock).toHaveBeenCalledWith(
      orgId,
      expect.objectContaining({
        bindingId,
        provider: "github_actions",
        deliveryId,
        runId: "81",
        runAttempt: "2",
      }),
    );
  });

  it("rejects tampered payload before parsing or provider calls", async () => {
    const { useCases, verifyRunMock, recordMock } = fixture();
    const event = { ...githubEvent(), rawBody: Buffer.from("{}") };
    expect(await useCases.receive(event)).toEqual({ outcome: "unauthorized" });
    expect(verifyRunMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("rejects repository substitution and changed release ref", async () => {
    const { useCases, verifyRunMock, recordMock } = fixture();
    const wrong = githubEvent();
    const rawBody = Buffer.from(
      JSON.stringify({
        action: "completed",
        installation: { id: 9 },
        repository: { id: 99 },
        workflow_run: { id: 81, run_attempt: 2 },
      }),
    );
    expect(
      await useCases.receive({
        ...wrong,
        rawBody,
        headers: {
          ...wrong.headers,
          "x-hub-signature-256": `sha256=${createHmac("sha256", "hook-secret").update(rawBody).digest("hex")}`,
        },
      }),
    ).toEqual({ outcome: "untrusted" });
    expect(verifyRunMock).not.toHaveBeenCalled();
    const good = fixture();
    good.verifyRunMock.mockResolvedValueOnce({
      outcome: "verified",
      run: { ...verifiedRun, ref: "other" },
    });
    expect(await good.useCases.receive(githubEvent())).toEqual({
      outcome: "untrusted",
    });
    expect(good.recordMock).not.toHaveBeenCalled();
    expect(recordMock).not.toHaveBeenCalled();
  });

  it("returns replayed when the atomic ledger already saw this exact delivery", async () => {
    const { useCases, recordMock } = fixture();
    recordMock.mockResolvedValueOnce({
      outcome: "replayed",
      eventId: deliveryId,
    });
    expect(await useCases.receive(githubEvent())).toEqual({
      outcome: "replayed",
    });
  });

  it("verifies signed GitLab events and refetches their pipeline before recording", async () => {
    const key = Buffer.alloc(32, 7);
    const secret = `whsec_${key.toString("base64")}`;
    const signedBinding = {
      ...binding,
      provider: "gitlab_ci" as const,
      providerHost: "gitlab.com",
      repositoryId: "44",
      providerInstallationId: null,
    } as CiProviderReleaseBinding;
    const signedConnection = {
      connectorId,
      provider: "gitlab_ci",
      config: { providerHost: "gitlab.com", projectId: "44" },
      secret: "project-token",
      connectionRevision: 1,
      credentialRevision: 1,
    } as CiConnectorConnection;
    const fixtureValue = fixture();
    fixtureValue.getBindingMock.mockResolvedValue(signedBinding);
    fixtureValue.loadMock.mockResolvedValue(signedConnection);
    fixtureValue.secretLoadMock.mockReturnValue({ mode: "signed", secret });
    fixtureValue.verifyRunMock.mockResolvedValue({
      outcome: "verified",
      run: {
        ...verifiedRun,
        provider: "gitlab_ci",
        providerHost: "gitlab.com",
        repositoryId: "44",
        providerInstallationId: undefined,
        runId: "71",
        runAttempt: "1",
      },
    });
    const rawBody = Buffer.from(
      JSON.stringify({
        object_kind: "pipeline",
        project: { id: 44 },
        object_attributes: { id: 71 },
      }),
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", key)
      .update(`${deliveryId}.${timestamp}.`)
      .update(rawBody)
      .digest("base64");
    const event = {
      provider: "gitlab_ci" as const,
      organizationId: orgId,
      bindingId,
      rawBody,
      headers: {
        "webhook-id": deliveryId,
        "webhook-timestamp": timestamp,
        "webhook-signature": `v1,${signature}`,
      },
    };
    expect(await fixtureValue.useCases.receive(event)).toEqual({
      outcome: "recorded",
    });
    expect(fixtureValue.verifyRunMock).toHaveBeenCalledWith(
      signedConnection,
      signedBinding,
      {
        bindingId,
        runId: "71",
        runAttempt: "1",
      },
    );
    expect(fixtureValue.recordMock).toHaveBeenCalledTimes(1);
    expect(
      await fixtureValue.useCases.receive({
        ...event,
        headers: { ...event.headers, "webhook-signature": "v1,invalid" },
      }),
    ).toEqual({ outcome: "unauthorized" });
    expect(fixtureValue.recordMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed on missing secrets, provider outage, and stale connector revisions", async () => {
    const noSecret = fixture();
    noSecret.secretLoadMock.mockReturnValue(null);
    expect(await noSecret.useCases.receive(githubEvent())).toEqual({
      outcome: "unauthorized",
    });
    expect(noSecret.verifyRunMock).not.toHaveBeenCalled();

    const unavailable = fixture();
    unavailable.verifyRunMock.mockResolvedValue({
      outcome: "rate_limited",
      retryAfterSeconds: 10,
    });
    expect(await unavailable.useCases.receive(githubEvent())).toEqual({
      outcome: "unavailable",
    });
    expect(unavailable.recordMock).not.toHaveBeenCalled();

    const stale = fixture();
    stale.loadMock.mockResolvedValue({ ...connection, credentialRevision: 2 });
    expect(await stale.useCases.receive(githubEvent())).toEqual({
      outcome: "unauthorized",
    });
  });
});
