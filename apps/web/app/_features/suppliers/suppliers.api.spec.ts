import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../_lib/http/authenticated-request", () => ({
  authenticatedRequestJson: request,
}));

import { suppliersApi } from "./suppliers.api";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("suppliersApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("validates list query and uses only the supplier API namespace", async () => {
    request.mockResolvedValue({ suppliers: { items: [], nextCursor: null } });
    await suppliersApi.list({ search: "  sensor ", includeArchived: true });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api/v1/suppliers?search=sensor&includeArchived=true&limit=25",
      }),
    );
  });

  it("rejects an invalid supplier identifier before making a request", async () => {
    expect(() => suppliersApi.detail("not-a-uuid")).toThrow(
      "supplier identifier",
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("uses a finding-scoped route for responsibility resolution", async () => {
    request.mockResolvedValue({
      resolution: { findingId: UUID, responsibility: "unknown", suppliers: [] },
    });
    await suppliersApi.resolveFinding(UUID);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/v1/findings/${UUID}/responsible-suppliers`,
      }),
    );
  });
});
