import type { CiConnectorConnection } from "../../connectors/application/ci-connector-credential-reader";
import type {
  CiBuildReference,
  CiProviderReleaseBinding,
  UpsertCiProviderReleaseBindingInput,
} from "@repo/contracts/sboms";

import type { CiProviderVerifierPort } from "../application/sbom-ci-integration.port";
import {
  verifyCiRepository,
  verifyCiRun,
  type CiProviderSetupInput,
} from "../ci-providers";

type Identity = Pick<
  UpsertCiProviderReleaseBindingInput,
  | "provider"
  | "providerHost"
  | "repositoryId"
  | "providerInstallationId"
  | "projectKey"
  | "pipelineDefinitionId"
>;

function providerInput(
  connection: CiConnectorConnection,
  identity: Identity,
): CiProviderSetupInput {
  const base = {
    provider: connection.provider,
    providerHost: identity.providerHost,
    repositoryId: identity.repositoryId,
    ...(identity.providerInstallationId
      ? { providerInstallationId: identity.providerInstallationId }
      : {}),
    ...(identity.projectKey ? { projectKey: identity.projectKey } : {}),
    ...(identity.pipelineDefinitionId
      ? { pipelineDefinitionId: identity.pipelineDefinitionId }
      : {}),
  };
  switch (connection.provider) {
    case "github_actions":
      return {
        ...base,
        credentials: {
          kind: "github_app",
          appId: connection.config.appId,
          privateKeyPem: connection.secret,
        },
      };
    case "gitlab_ci":
      return {
        ...base,
        credentials: { kind: "gitlab_project_token", token: connection.secret },
        approvedHosts: [connection.config.providerHost],
      };
    case "azure_devops":
      return {
        ...base,
        azureOrganization: connection.config.organization,
        serviceConnectionId: connection.config.serviceConnectionId,
        credentials: { kind: "azure_access_token", token: connection.secret },
      };
  }
}

export class CiProviderVerifierAdapter implements CiProviderVerifierPort {
  verifyRepository(
    connection: CiConnectorConnection,
    binding: UpsertCiProviderReleaseBindingInput,
  ) {
    return verifyCiRepository(providerInput(connection, binding));
  }

  verifyRun(
    connection: CiConnectorConnection,
    binding: CiProviderReleaseBinding,
    reference: CiBuildReference,
  ) {
    const identity = {
      ...binding,
      providerInstallationId: binding.providerInstallationId ?? undefined,
      projectKey: binding.projectKey ?? undefined,
      pipelineDefinitionId: binding.pipelineDefinitionId ?? undefined,
    };
    return verifyCiRun({
      ...providerInput(connection, identity),
      runId: reference.runId,
      runAttempt: reference.runAttempt,
    });
  }
}
