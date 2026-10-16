import {
  projectDiagnosticLogs,
  projectDiagnosticMetrics,
} from "./diagnostic-projector";
describe("closed diagnostic projection", () => {
  const at = "2026-10-14T00:00:00.000Z";
  it("drops every unknown field including nested, encoded, URL and stack canaries", () => {
    const canary = "PRIVATE_CANARY_secret@example.test";
    const source = {
      at,
      source: "audit",
      code: "operation_completed",
      outcome: "completed",
      email: canary,
      details: { nested: canary },
      url: `https://user:${canary}@example.test`,
      stack: `Error ${canary}`,
      encoded: Buffer.from(canary).toString("base64"),
    };
    expect(projectDiagnosticLogs([source])).toEqual({
      logs: [
        {
          at,
          source: "audit",
          code: "operation_completed",
          outcome: "completed",
        },
      ],
      omissions: [],
    });
    expect(JSON.stringify(projectDiagnosticLogs([source]))).not.toContain(
      canary,
    );
  });
  it("withholds invalid finite values and bounds log rows", () => {
    const valid = {
      at,
      source: "audit",
      code: "operation_completed",
      outcome: "completed",
    };
    expect(
      projectDiagnosticLogs([{ ...valid, source: "secret@example.test" }])
        .omissions,
    ).toEqual([{ category: "logs", code: "invalid_value" }]);
    expect(projectDiagnosticLogs(Array(5001).fill(valid)).logs).toHaveLength(
      5000,
    );
    expect(projectDiagnosticLogs(Array(5001).fill(valid)).omissions).toEqual([
      { category: "logs", code: "row_limit" },
    ]);
  });
  it("projects health sources without labels, IDs, URLs or reasons", () => {
    const metrics = projectDiagnosticMetrics({
      components: [
        {
          id: "audit",
          status: "healthy",
          sourceAt: at,
          observedAt: at,
          label: "secret",
        },
        { id: "unknown-secret", status: "healthy" },
      ],
      queues: [],
      storage: {
        customerBytes: 7,
        status: "healthy",
        sourceAt: at,
        observedAt: at,
      },
    });
    expect(metrics).toHaveLength(2);
    expect(JSON.stringify(metrics)).not.toContain("secret");
  });
});

it("retains finite queue IDs and observed aggregate counts", () => {
  const at = "2026-10-14T00:00:00.000Z";
  const metrics = projectDiagnosticMetrics({
    components: [],
    queues: [
      {
        id: "exports",
        availability: "ready",
        status: "healthy",
        sourceAt: at,
        observedAt: at,
        pending: 2,
        running: 1,
        failedTerminal: 0,
        label: "PRIVATE_CANARY",
      },
    ],
    storage: {},
  });
  expect(metrics).toEqual([
    {
      source: "exports",
      status: "healthy",
      sourceAt: at,
      observedAt: at,
      pending: 2,
      running: 1,
      failedTerminal: 0,
      storageBytes: null,
    },
  ]);
});
