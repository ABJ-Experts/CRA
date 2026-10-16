import {
  ForbiddenException,
  NotFoundException,
  type ArgumentsHost,
} from "@nestjs/common";

import { AuditExplorerDeniedFilter } from "./audit-explorer-denied.filter";

const orgId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";

describe("AuditExplorerDeniedFilter", () => {
  it("durably records verified route denials and preserves the 403 response", async () => {
    const repository = {
      recordDenial: jest.fn().mockResolvedValue({
        receiptId: "33333333-3333-4333-8333-333333333333",
        replayed: false,
      }),
    };
    const response = responseDouble();
    const filter = new AuditExplorerDeniedFilter(
      repository as never,
      {
        digest: jest.fn().mockReturnValue("a".repeat(64)),
      } as never,
    );

    await filter.catch(
      new ForbiddenException({ message: "Forbidden", code: "forbidden" }),
      hostDouble({
        response,
        body: {
          requestId: "44444444-4444-4444-8444-444444444444",
          secret: "x",
        },
        query: { cursor: "opaque" },
      }),
    );

    expect(repository.recordDenial).toHaveBeenCalledWith({
      organizationId: orgId,
      actorId,
      requestId: "44444444-4444-4444-8444-444444444444",
      operationDigest: "a".repeat(64),
    });
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, code: "forbidden" }),
    );
  });

  it("durably records authorized audit not-found denials before preserving 404", async () => {
    const repository = {
      recordDenial: jest.fn().mockResolvedValue({
        receiptId: "33333333-3333-4333-8333-333333333333",
        replayed: false,
      }),
    };
    const response = responseDouble();
    const filter = new AuditExplorerDeniedFilter(
      repository as never,
      {
        digest: jest.fn().mockReturnValue("e".repeat(64)),
      } as never,
    );

    await filter.catch(
      new NotFoundException({ message: "Not found", code: "not_found" }),
      hostDouble({
        response,
        query: { requestId: "44444444-4444-4444-8444-444444444444" },
      }),
    );

    expect(repository.recordDenial).toHaveBeenCalledTimes(1);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, code: "not_found" }),
    );
  });

  it("generates an operation UUID when denial input has no valid requestId", async () => {
    const recordDenial = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockResolvedValue({});
    const repository = { recordDenial };
    const filter = new AuditExplorerDeniedFilter(
      repository as never,
      {
        digest: jest.fn().mockReturnValue("b".repeat(64)),
      } as never,
    );

    await filter.catch(
      new ForbiddenException(),
      hostDouble({ response: responseDouble(), body: { requestId: "bad" } }),
    );

    const denial = repository.recordDenial.mock.calls[0]?.[0] as
      { requestId: string } | undefined;
    expect(denial?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns safe 503 when a required denial receipt cannot be recorded", async () => {
    const repository = {
      recordDenial: jest.fn().mockRejectedValue(new Error("db down")),
    };
    const response = responseDouble();
    const filter = new AuditExplorerDeniedFilter(
      repository as never,
      {
        digest: jest.fn().mockReturnValue("c".repeat(64)),
      } as never,
    );

    await filter.catch(new ForbiddenException(), hostDouble({ response }));

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 503, code: "unavailable" }),
    );
  });
});

function responseDouble() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

function hostDouble(input: {
  response: ReturnType<typeof responseDouble>;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  user?: unknown;
}): ArgumentsHost {
  const request = {
    method: "GET",
    originalUrl: "/api/v1/audit/searches/token/events",
    path: "/api/v1/audit/searches/token/events",
    route: { path: "searches/:snapshotToken/events" },
    query: input.query ?? {},
    body: input.body ?? {},
    user: "user" in input ? input.user : { id: actorId, organizationId: orgId },
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => input.response,
    }),
  } as unknown as ArgumentsHost;
}

it("delegates unauthenticated denials without recording audit", async () => {
  const repository = { recordDenial: jest.fn() };
  const response = responseDouble();
  const filter = new AuditExplorerDeniedFilter(
    repository as never,
    {
      digest: jest.fn().mockReturnValue("d".repeat(64)),
    } as never,
  );
  const host = hostDouble({ response, user: undefined });

  await filter.catch(new ForbiddenException(), host);

  expect(repository.recordDenial).not.toHaveBeenCalled();
  expect(response.status).toHaveBeenCalledWith(403);
});
