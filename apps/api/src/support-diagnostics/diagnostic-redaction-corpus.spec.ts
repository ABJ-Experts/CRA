import "reflect-metadata";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as yauzl from "yauzl";
import { ServiceUnavailableException } from "@nestjs/common";
import type { SupportDiagnosticPayload } from "@repo/contracts/support-diagnostics";
import { diagnosticPayloadSchema } from "@repo/contracts/support-diagnostics";
import {
  projectDiagnosticLogs,
  projectDiagnosticMetrics,
} from "./domain/diagnostic-projector";
import { DiagnosticArchive } from "./infrastructure/diagnostic-archive";
import { DiagnosticSourcesAdapter } from "./infrastructure/diagnostic-sources.adapter";
import { SupabaseSupportDiagnosticsRepository } from "./infrastructure/supabase-support-diagnostics.repository";
import { diagnosticHttp } from "./support-diagnostics.controller";

interface CorpusVector {
  name: string;
  canary: string;
  forbiddenRepresentations: string[];
  unknownFields: Record<string, unknown>;
  trustedSubstitution: unknown;
}
const corpus = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../test/fixtures/m15-04-redaction-corpus.json"),
    "utf8",
  ),
) as { schemaVersion: number; vectors: CorpusVector[] };
const id = "11111111-1111-4111-8111-111111111111";
const at = "2026-10-14T00:00:00.000Z";
const selection = {
  categories: ["logs", "configuration", "metrics"] as const,
  from: "2026-10-13T00:00:00.000Z",
  to: at,
};
const log = {
  at,
  source: "audit",
  code: "operation_completed",
  outcome: "completed",
};
const observation = {
  id: "audit",
  status: "healthy",
  sourceAt: at,
  observedAt: at,
  pending: 2,
  running: 1,
  failedTerminal: 0,
  storageBytes: 7,
};
const configuration = {
  observedAt: at,
  accessTokenSeconds: 3600,
  refreshTokenSeconds: 604800,
  smtpTlsMode: "mailpit",
  maxBundleBytes: 10485760,
  maxLogRows: 5000,
};
const archive = new DiagnosticArchive(() => new Date(at));
const claim = { job: { id, organizationId: id, selection }, creatorUserId: id };

function expectCanaryAbsent(value: unknown, vector: CorpusVector): void {
  const serialized = Buffer.isBuffer(value)
    ? value.toString("utf8")
    : JSON.stringify(value);
  expect(serialized).toBeDefined();
  for (const needle of vector.forbiddenRepresentations) {
    expect(serialized).not.toContain(needle);
    // JSON escaping must not hide literal control/escape sequences from the test.
    expect(serialized).not.toContain(JSON.stringify(needle).slice(1, -1));
  }
}

async function archiveEntries(bytes: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolveEntries, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error("missing archive"));
      const entries = new Map<string, Buffer>();
      zip.on("error", reject);
      zip.on("end", () => resolveEntries(entries));
      zip.on("entry", (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream)
            return reject(streamError ?? new Error("missing entry"));
          const chunks: Buffer[] = [];
          stream.on("error", reject);
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

async function expectSafeArchive(
  payload: SupportDiagnosticPayload,
  vector: CorpusVector,
): Promise<void> {
  const packed = await archive.pack(
    id,
    { ...selection, categories: [...selection.categories] },
    payload,
  );
  const inspected = await archive.inspect(packed.bytes);
  expectCanaryAbsent(payload, vector);
  expectCanaryAbsent(inspected, vector);
  expectCanaryAbsent(packed.bytes, vector);
  expectCanaryAbsent(packed.manifest, vector);
  const entries = await archiveEntries(packed.bytes);
  expect(entries.has("manifest.json")).toBe(true);
  expect(entries.has("omissions.json")).toBe(true);
  expect([...entries.keys()].sort()).toEqual(
    [
      ...packed.manifest.entries.map((entry) => entry.name),
      "manifest.json",
    ].sort(),
  );
  for (const [name, bytes] of entries) {
    expectCanaryAbsent(name, vector);
    expectCanaryAbsent(bytes, vector);
    expectCanaryAbsent(JSON.parse(bytes.toString("utf8")), vector);
  }
}

describe("published adversarial diagnostic redaction corpus", () => {
  it("keeps distinct named synthetic vectors, encoded needles, and prototype keys", () => {
    expect(corpus.schemaVersion).toBe(1);
    expect(corpus.vectors).toHaveLength(14);
    expect(new Set(corpus.vectors.map((vector) => vector.name)).size).toBe(14);
    for (const vector of corpus.vectors) {
      expect(vector.forbiddenRepresentations).toContain(vector.canary);
      expect(vector.forbiddenRepresentations).toContain(
        Buffer.from(vector.canary).toString("base64"),
      );
      const injected = JSON.stringify(vector.unknownFields);
      expect(
        vector.forbiddenRepresentations.some(
          (needle) =>
            injected.includes(needle) ||
            injected.includes(JSON.stringify(needle).slice(1, -1)),
        ),
      ).toBe(true);
    }
    expect(
      Object.hasOwn(
        corpus.vectors.find((vector) => vector.name === "prototype_keys")!
          .unknownFields,
        "__proto__",
      ),
    ).toBe(true);
  });

  it.each(corpus.vectors)(
    "drops $name unknown fields through projection, inspection and every archive entry",
    async (vector) => {
      const pollutedLog = { ...log, ...vector.unknownFields };
      const pollutedComponent = { ...observation, ...vector.unknownFields };
      const pollutedQueue = {
        ...observation,
        id: "exports",
        ...vector.unknownFields,
      };
      const projected = projectDiagnosticLogs([pollutedLog]);
      const metrics = projectDiagnosticMetrics({
        ...vector.unknownFields,
        components: [pollutedComponent],
        queues: [pollutedQueue],
        storage: { ...observation, customerBytes: 7, ...vector.unknownFields },
      });
      expect(projected).toEqual({ logs: [log], omissions: [] });
      expect(metrics).toHaveLength(3);
      expect(metrics.map((metric) => metric.source)).toEqual([
        "audit",
        "exports",
        "storage",
      ]);
      expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
      await expectSafeArchive(
        diagnosticPayloadSchema.parse({
          logs: projected.logs,
          configuration,
          metrics,
          omissions: projected.omissions,
        }),
        vector,
      );
    },
  );

  it.each(corpus.vectors)(
    "rejects $name in every consumed trusted log and metric field",
    async (vector) => {
      const logFields = ["at", "source", "code", "outcome"] as const;
      const metricFields = [
        "id",
        "status",
        "sourceAt",
        "observedAt",
        "pending",
        "running",
        "failedTerminal",
        "storageBytes",
      ] as const;
      const storageFields = [
        "status",
        "sourceAt",
        "observedAt",
        "pending",
        "running",
        "failedTerminal",
        "customerBytes",
      ] as const;
      const logs = logFields.map((field) => ({
        ...log,
        [field]: vector.trustedSubstitution,
      }));
      const components = metricFields.map((field) => ({
        ...observation,
        [field]: vector.trustedSubstitution,
      }));
      const queues = metricFields.map((field) => ({
        ...observation,
        id: "exports",
        [field]: vector.trustedSubstitution,
      }));
      const projected = projectDiagnosticLogs(logs);
      expect(projected.logs).toEqual([]);
      expect(projected.omissions).toEqual([
        { category: "logs", code: "invalid_value" },
      ]);
      const metrics = projectDiagnosticMetrics({
        components,
        queues,
        storage: {},
      });
      expect(metrics).toEqual([]);
      for (const field of storageFields) {
        expect(
          projectDiagnosticMetrics({
            storage: {
              ...observation,
              customerBytes: 7,
              [field]: vector.trustedSubstitution,
            },
          }),
        ).toEqual([]);
      }
      await expectSafeArchive(
        { logs: [], metrics, omissions: projected.omissions },
        vector,
      );
    },
  );

  it.each(corpus.vectors)(
    "contains $name source exceptions in safe omissions and archive bytes",
    async (vector) => {
      const error = new Error(
        `${vector.canary}: ${JSON.stringify(vector.unknownFields)}`,
      );
      error.stack = `Error: ${vector.canary}\n at provider (${JSON.stringify(vector.unknownFields)})`;
      const adapter = new DiagnosticSourcesAdapter(
        {
          authorize: () => Promise.resolve(claim),
          logs: () => Promise.reject(error),
        } as never,
        {
          read: () => Promise.reject(error),
        } as never,
        {
          getOrThrow: () => {
            throw error;
          },
        } as never,
        () => new Date(at),
      );
      const payload = await adapter.collect(
        claim as never,
        new AbortController().signal,
      );
      expect(payload).toEqual({
        omissions: [
          { category: "logs", code: "source_unavailable" },
          { category: "configuration", code: "source_unavailable" },
          { category: "metrics", code: "source_unavailable" },
        ],
      });
      await expectSafeArchive(payload, vector);
    },
  );

  it.each(corpus.vectors)(
    "withholds $name trusted configuration substitutions from inspection and archive bytes",
    async (vector) => {
      const values: Record<string, unknown> = {
        ACCESS_TOKEN_MAX_AGE: 3600,
        REFRESH_TOKEN_MAX_AGE: 604800,
        SMTP_TLS_MODE: "mailpit",
      };
      for (const field of Object.keys(values)) {
        const adapter = new DiagnosticSourcesAdapter(
          { authorize: () => Promise.resolve(claim) } as never,
          {} as never,
          {
            getOrThrow: (key: string) =>
              key === field ? vector.trustedSubstitution : values[key],
          } as never,
          () => new Date(at),
        );
        const payload = await adapter.collect(
          {
            ...claim,
            job: {
              ...claim.job,
              selection: { ...selection, categories: ["configuration"] },
            },
          } as never,
          new AbortController().signal,
        );
        expect(payload).toEqual({
          omissions: [{ category: "configuration", code: "invalid_value" }],
        });
        await expectSafeArchive(payload, vector);
      }
    },
  );

  it.each(corpus.vectors)(
    "maps $name provider error metadata to a safe client HTTP response",
    async (vector) => {
      const providerError = {
        code: "XX000",
        message: vector.canary,
        details: vector.unknownFields,
        hint: vector.forbiddenRepresentations.join(" "),
      };
      const repository = new SupabaseSupportDiagnosticsRepository({
        admin: () => ({
          rpc: () => Promise.resolve({ data: null, error: providerError }),
        }),
      } as never);
      let failure: unknown;
      try {
        await diagnosticHttp(() =>
          repository.list(
            id,
            { organizationId: id, actorId: id, sessionId: id },
            { limit: 25 },
          ),
        );
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(ServiceUnavailableException);
      const http = failure as ServiceUnavailableException;
      expect(http.getStatus()).toBe(503);
      expect(http.getResponse()).toEqual({
        code: "diagnostic_unavailable",
        message: "Diagnostic service is temporarily unavailable",
      });
      expectCanaryAbsent(http.getResponse(), vector);
      expectCanaryAbsent({ message: http.message, stack: http.stack }, vector);
    },
  );
});
