import type {
  ConnectorCapabilities,
  PullPage,
} from "../application/connector-port";
import { AgentBackedAdapter } from "./agent-backed-adapter";

const orgId = "00000000-0000-4000-8000-000000000001";
const connectorId = "00000000-0000-4000-8000-000000000002";
const capabilities: ConnectorCapabilities = {
  adapterVersion: "1.0.0",
  mappingVersion: "on-prem-agent-v1",
  entities: [],
};
const page: PullPage = {
  records: [],
  nextCursor: null,
  adapterSignal: "ok",
};
const config = {
  connectorType: "on_prem_agent" as const,
  organizationId: orgId,
  connectorId,
  secretReference: { provider: "vault" as const, reference: "" },
};

describe("AgentBackedAdapter", () => {
  function fixture() {
    const repository = {
      agentCapabilities: jest.fn().mockResolvedValue(capabilities),
      pullStagedPage: jest.fn().mockResolvedValue(page),
    };
    return { adapter: new AgentBackedAdapter(repository), repository };
  }

  it("reads staged pages only with trusted tenant and connector scope", async () => {
    const { adapter, repository } = fixture();
    await expect(adapter.pull(config, null, 200)).resolves.toEqual(page);
    expect(repository.pullStagedPage).toHaveBeenCalledWith(
      orgId,
      connectorId,
      null,
      200,
    );
    await expect(
      adapter.pull({ ...config, organizationId: undefined }, null, 200),
    ).rejects.toThrow();
    expect(repository.pullStagedPage).toHaveBeenCalledTimes(1);
  });

  it("requires an active agent and never writes back to an internal source", async () => {
    const { adapter, repository } = fixture();
    expect(await adapter.testConnection(config)).toMatchObject({
      outcome: "success",
    });
    expect(await adapter.discoverCapabilities(config)).toEqual(capabilities);
    repository.agentCapabilities.mockResolvedValueOnce(null);
    expect(await adapter.testConnection(config)).toMatchObject({
      outcome: "failure",
      errorCode: "unreachable",
    });
    await expect(adapter.push(config, [])).resolves.toEqual([]);
    await expect(
      adapter.push(config, [
        { entityType: "product", externalId: "p", fields: {} },
      ]),
    ).resolves.toEqual([
      expect.objectContaining({
        outcome: "rejected",
        errorCode: "unsupported_capability",
      }),
    ]);
  });
});
