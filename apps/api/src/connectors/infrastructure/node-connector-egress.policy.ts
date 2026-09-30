import type { ConnectorEgressPolicy } from "../application/connector-hub-repository.port";
import { ConnectorError } from "../application/connector-errors";
import { parseConnectorConfiguration } from "../application/connector-config-policy";
import { resolveApprovedHttpsTarget } from "../../products/infrastructure/node-product-compliance-external-reference-validator";

/** No private-network bypass: an approved production agent is a separate boundary. */
export class NodeConnectorEgressPolicy implements ConnectorEgressPolicy {
  private readonly allowedHosts: ReadonlySet<string>;
  constructor(
    allowedHosts: readonly string[],
    private readonly lookup?: (
      hostname: string,
    ) => Promise<readonly Readonly<{ address: string }>[]>,
  ) {
    this.allowedHosts = new Set(
      allowedHosts.map((host) => host.toLowerCase().trim()).filter(Boolean),
    );
  }
  async validate(
    config: Readonly<Record<string, unknown>>,
    connectorType = "reference_conformance",
  ): Promise<void> {
    let parsed;
    try {
      parsed = parseConnectorConfiguration(connectorType, config);
    } catch {
      throw new ConnectorError("invalid_request");
    }
    const targetUrl =
      "providerHost" in parsed
        ? `https://${parsed.providerHost}`
        : parsed.baseUrl;
    if (!targetUrl) return;
    const target = await resolveApprovedHttpsTarget(
      targetUrl,
      connectorType === "reference_conformance"
        ? this.allowedHosts
        : new Set([
            ...this.allowedHosts,
            "github.com",
            "gitlab.com",
            "dev.azure.com",
          ]),
      this.lookup ? { lookup: this.lookup } : undefined,
    );
    if (!target) throw new ConnectorError("invalid_request");
  }
}
