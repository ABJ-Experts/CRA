import { SupabaseAuditChainAdapter } from "./supabase-audit-chain.adapter";
const organizationId = "11111111-1111-4111-8111-111111111111";
const head = {
  organization_id: organizationId,
  protected_through: null,
  required_retention_days: 0,
  retention_status: "unknown" as const,
  retention_checked_at: null,
  legal_hold: false,
  activation_at: "2026-10-06T00:00:00Z",
  legacy_count: "9007199254740993",
  last_sequence: "0",
  last_event_id: null,
  last_hash: "0".repeat(64),
  chain_version: 1,
};
describe("SupabaseAuditChainAdapter", () => {
  it("parses snapshot and scopes RPC explicitly", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: head, error: null });
    expect(
      await new SupabaseAuditChainAdapter({ rpc }).snapshot(organizationId),
    ).toEqual(head);
    expect(rpc).toHaveBeenCalledWith("m13_02_audit_chain_snapshot", {
      p_organization_id: organizationId,
    });
  });
  it("parses keyset pages", async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [], error: null });
    expect(
      await new SupabaseAuditChainAdapter({ rpc }).page(
        organizationId,
        "9007199254740993",
        "9007199254740994",
        2,
      ),
    ).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("m13_02_audit_chain_page", {
      p_organization_id: organizationId,
      p_after_sequence: "9007199254740993",
      p_upper_sequence: "9007199254740994",
      p_limit: 2,
    });
  });
  it.each([
    { data: head, error: {} },
    { data: {}, error: null },
    {
      data: {
        ...head,
        organization_id: "33333333-3333-4333-8333-333333333333",
      },
      error: null,
    },
  ])("fails closed on snapshot failure", async (response) => {
    await expect(
      new SupabaseAuditChainAdapter({
        rpc: jest.fn().mockResolvedValue(response),
      }).snapshot(organizationId),
    ).rejects.toThrow();
  });
  it.each([
    { data: [], error: {} },
    { data: [{}], error: null },
  ])("fails closed on malformed pages", async (response) => {
    await expect(
      new SupabaseAuditChainAdapter({
        rpc: jest.fn().mockResolvedValue(response),
      }).page(organizationId, "0", "1", 1),
    ).rejects.toThrow();
  });
  it("validates ranges and limits before reads", async () => {
    const rpc = jest.fn();
    const adapter = new SupabaseAuditChainAdapter({ rpc });
    await expect(adapter.page(organizationId, "2", "1", 1)).rejects.toThrow();
    await expect(
      adapter.page(organizationId, "0", "1", 1001),
    ).rejects.toThrow();
    await expect(adapter.snapshot("invalid")).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
