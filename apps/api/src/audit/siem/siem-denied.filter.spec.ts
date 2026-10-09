import { ForbiddenException } from "@nestjs/common";
import { SiemDeniedFilter } from "./siem-denied.filter";
describe("SIEM durable denial filter", () => {
  const command = jest.fn();
  const filter = new SiemDeniedFilter({ command } as never);
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  function host(
    user: unknown,
    body: unknown = {},
    query: unknown = {},
    path = "/api/v1/audit/siem/catalogue",
  ) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          body,
          query,
          method: "GET",
          path,
          url: "/api/v1/audit/siem/catalogue",
        }),
        getResponse: () => ({ status, headersSent: false }),
      }),
    } as never;
  }
  beforeEach(() => jest.clearAllMocks());
  it("records verified-user denials using only structural digest", async () => {
    await filter.catch(
      new ForbiddenException(),
      host(
        { organizationId: "org", id: "actor" },
        { requestId: "10000000-0000-4000-8000-000000000001" },
      ),
    );
    expect(command).toHaveBeenCalledWith(
      "org",
      "actor",
      "denial",
      null,
      expect.objectContaining({
        requestId: "10000000-0000-4000-8000-000000000001",
      }),
    );
  });
  it("uses fresh identity for invalid operation UUID", async () => {
    await filter.catch(
      new ForbiddenException(),
      host({ organizationId: "org", id: "actor" }, undefined),
    );
    expect(command).toHaveBeenCalled();
  });
  it("does not invent a tenant for unauthenticated requests", async () => {
    await filter.catch(new ForbiddenException(), host(undefined));
    expect(command).not.toHaveBeenCalled();
  });
  it("fails unavailable if durable denial recording fails", async () => {
    command.mockRejectedValueOnce(new Error("secret"));
    await filter.catch(
      new ForbiddenException(),
      host({ organizationId: "org", id: "actor" }),
    );
    expect(status).toHaveBeenCalledWith(503);
  });
  it("distinguishes resource paths for the same logical denial UUID", async () => {
    const operationId = "10000000-0000-4000-8000-000000000001";
    await filter.catch(
      new ForbiddenException(),
      host(
        { organizationId: "org", id: "actor" },
        { requestId: operationId },
        {},
        "/api/v1/audit/siem/destinations/10000000-0000-4000-8000-000000000002",
      ),
    );
    const first = (
      command.mock.calls[0] as [
        unknown,
        unknown,
        unknown,
        unknown,
        { operationDigest: string },
      ]
    )[4].operationDigest;
    await filter.catch(
      new ForbiddenException(),
      host(
        { organizationId: "org", id: "actor" },
        { requestId: operationId },
        {},
        "/api/v1/audit/siem/destinations/10000000-0000-4000-8000-000000000003",
      ),
    );
    const second = (
      command.mock.calls[1] as [
        unknown,
        unknown,
        unknown,
        unknown,
        { operationDigest: string },
      ]
    )[4].operationDigest;
    expect(first).not.toBe(second);
  });
});
