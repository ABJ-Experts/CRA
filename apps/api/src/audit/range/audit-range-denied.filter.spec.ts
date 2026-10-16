import { ForbiddenException, type ArgumentsHost } from "@nestjs/common";
import { AuditRangeDeniedFilter } from "./audit-range-denied.filter";
const id = "11111111-1111-4111-8111-111111111111";
function fixture(
  user: unknown = { organizationId: "org", id: "actor" },
  body: unknown = undefined,
  query: unknown = {},
  route: unknown = undefined,
) {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const request = {
    user,
    body,
    query,
    route,
    method: "POST",
    originalUrl: "/api/v1/audit/chain-verifications",
  };
  return {
    response,
    host: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as ArgumentsHost,
  };
}
describe("AuditRangeDeniedFilter", () => {
  it.each([{ requestId: id }, { requestId: "invalid" }, undefined])(
    "records safe security receipt without content",
    async (body) => {
      const repository = {
        recordDenial: jest.fn().mockResolvedValue(undefined),
      };
      const f = fixture(undefined, body);
      await new AuditRangeDeniedFilter(repository as never).catch(
        new ForbiddenException(),
        f.host,
      );
      expect(repository.recordDenial).toHaveBeenCalledWith(
        "org",
        "actor",
        expect.stringMatching(/^[a-f0-9-]{36}$/),
        expect.stringMatching(/^[a-f0-9]{64}$/),
      );
      expect(f.response.status).toHaveBeenCalledWith(403);
    },
  );
  it("uses query identity and declared route only", async () => {
    const repository = { recordDenial: jest.fn().mockResolvedValue(undefined) };
    const f = fixture(
      undefined,
      { secret: "bearer" },
      { requestId: id },
      { path: ":jobId" },
    );
    await new AuditRangeDeniedFilter(repository as never).catch(
      new ForbiddenException(),
      f.host,
    );
    expect((repository.recordDenial.mock.calls as unknown[][])[0]?.[2]).toBe(
      id,
    );
  });
  it("does not record unverified or organizationless denials", async () => {
    const repository = { recordDenial: jest.fn() };
    const f = fixture(null);
    await new AuditRangeDeniedFilter(repository as never).catch(
      new ForbiddenException(),
      f.host,
    );
    expect(repository.recordDenial).not.toHaveBeenCalled();
  });
  it("fails closed when durable receipt fails", async () => {
    const repository = {
      recordDenial: jest.fn().mockRejectedValue(new Error("secret")),
    };
    const f = fixture();
    await new AuditRangeDeniedFilter(repository as never).catch(
      new ForbiddenException(),
      f.host,
    );
    expect(f.response.status).toHaveBeenCalledWith(503);
    expect(JSON.stringify(f.response.json.mock.calls)).not.toContain("secret");
  });
});
