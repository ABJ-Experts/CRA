import { DiagnosticSourcesAdapter } from "./diagnostic-sources.adapter";
import { SystemHealthAuthorizationError } from "../../system-health/application/system-health.port";
const id = "11111111-1111-4111-8111-111111111111",
  at = "2026-10-14T00:00:00.000Z";
const claim = {
  job: {
    id,
    organizationId: id,
    selection: {
      categories: ["logs", "configuration", "metrics"],
      from: at,
      to: at,
    },
  },
  creatorUserId: id,
};
function fixture() {
  const repository = {
    authorize: jest.fn().mockResolvedValue(claim),
    logs: jest.fn().mockResolvedValue({ logs: [], omissions: [] }),
  };
  const health = {
    read: jest.fn().mockResolvedValue({
      components: [
        { id: "audit", status: "healthy", sourceAt: at, observedAt: at },
      ],
      queues: [],
      storage: {
        status: "healthy",
        customerBytes: 0,
        sourceAt: at,
        observedAt: at,
      },
    }),
  };
  const values: Record<string, unknown> = {
    ACCESS_TOKEN_MAX_AGE: 3600,
    REFRESH_TOKEN_MAX_AGE: 604800,
    SMTP_TLS_MODE: "mailpit",
    SMTP_PASS: "PRIVATE_CANARY",
  };
  const config = { getOrThrow: jest.fn((key: string) => values[key]) };
  const adapter = new DiagnosticSourcesAdapter(
    repository as never,
    health as never,
    config as never,
    () => new Date(at),
  );
  return { repository, health, config, adapter };
}
describe("diagnostic safe source adapter", () => {
  it("reads only consented finite fields and retains no environment secrets", async () => {
    const f = fixture();
    const result = await f.adapter.collect(
      claim as never,
      new AbortController().signal,
    );
    expect(result.configuration?.accessTokenSeconds).toBe(3600);
    expect(result.metrics).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_CANARY");
    expect(f.config.getOrThrow.mock.calls.map((c) => c[0])).toEqual([
      "ACCESS_TOKEN_MAX_AGE",
      "REFRESH_TOKEN_MAX_AGE",
      "SMTP_TLS_MODE",
    ]);
  });
  it("does not call unselected sources", async () => {
    const f = fixture();
    await f.adapter.collect(
      {
        ...claim,
        job: {
          ...claim.job,
          selection: { ...claim.job.selection, categories: ["logs"] },
        },
      } as never,
      new AbortController().signal,
    );
    expect(f.health.read).not.toHaveBeenCalled();
    expect(f.config.getOrThrow).not.toHaveBeenCalled();
  });
  it("turns source errors into omissions and preserves healthy selected sources", async () => {
    const f = fixture();
    f.repository.logs.mockRejectedValue(new Error("private provider"));
    f.health.read.mockRejectedValue(new Error("private provider"));
    expect(
      (await f.adapter.collect(claim as never, new AbortController().signal))
        .omissions,
    ).toEqual([
      { category: "logs", code: "source_unavailable" },
      { category: "metrics", code: "source_unavailable" },
    ]);
  });
  it.each([new SystemHealthAuthorizationError(), new Error("access_changed")])(
    "hard denies authority loss %#",
    async (error) => {
      const f = fixture();
      f.health.read.mockRejectedValue(error);
      await expect(
        f.adapter.collect(claim as never, new AbortController().signal),
      ).rejects.toThrow("access_changed");
    },
  );
  it("rejects revoked or aborted authority before source access", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      f.adapter.collect(claim as never, controller.signal),
    ).rejects.toThrow();
    expect(f.repository.logs).not.toHaveBeenCalled();
    f.repository.authorize.mockRejectedValue(new Error("access_changed"));
    await expect(
      f.adapter.collect(claim as never, new AbortController().signal),
    ).rejects.toThrow();
  });
});

it("uses an observation timestamp for the named typed configuration", async () => {
  const f = fixture();
  const adapter = new DiagnosticSourcesAdapter(
    f.repository as never,
    f.health as never,
    f.config as never,
  );
  const result = await adapter.collect(
    {
      ...claim,
      job: {
        ...claim.job,
        selection: { ...claim.job.selection, categories: ["configuration"] },
      },
    } as never,
    new AbortController().signal,
  );
  expect(Date.parse(result.configuration!.observedAt)).toBeGreaterThan(0);
});

it("omits invalid typed source values distinctly", async () => {
  const f = fixture();
  f.config.getOrThrow.mockReturnValue("invalid");
  const result = await f.adapter.collect(
    claim as never,
    new AbortController().signal,
  );
  expect(result.omissions).toContainEqual({
    category: "configuration",
    code: "invalid_value",
  });
});

it("does not count a wholly withheld log source as a successful section", async () => {
  const f = fixture();
  f.repository.logs.mockResolvedValue({
    logs: [],
    omissions: [{ category: "logs", code: "source_withheld" }],
  });
  const result = await f.adapter.collect(
    {
      ...claim,
      job: {
        ...claim.job,
        selection: { ...claim.job.selection, categories: ["logs"] },
      },
    } as never,
    new AbortController().signal,
  );
  expect(result.logs).toBeUndefined();
  expect(result.omissions).toEqual([
    { category: "logs", code: "source_withheld" },
  ]);
});
