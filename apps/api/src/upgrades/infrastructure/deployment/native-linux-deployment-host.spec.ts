import { createHash } from "node:crypto";
/* eslint-disable @typescript-eslint/require-await -- Controlled async test doubles do not access dynamic this. */
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  NativeLinuxDeploymentHost,
  type NativeLinuxHostConfiguration,
} from "./native-linux-deployment-host";
const image = {
  service: "api",
  digest: `sha256:${"b".repeat(64)}`,
  imageId: `sha256:${"b".repeat(64)}`,
  platform: "linux/amd64",
};
const images = [image, { ...image, service: "web" }];
const healthy = { status: "ok", database: true, audit: true };
describe("native host durable maintenance and observations", () => {
  let directory: string;
  let config: NativeLinuxHostConfiguration;
  let host: NativeLinuxDeploymentHost;
  const run = jest.fn();
  const authority = {
    assertFresh: jest.fn(async () => undefined),
    holdVerifiedBackup: jest.fn(async () => undefined),
  };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "upgrade-host-"));
    await mkdir(join(directory, "maintenance"), { mode: 0o700 });
    await mkdir(join(directory, "selection"), { mode: 0o700 });
    config = {
      deployment: {
        dockerExecutable: "/usr/bin/docker",
        composeFile: "/private/compose.yml",
        cwd: "/private",
        project: "cra",
        candidateServices: ["api", "web"],
        workerServices: ["worker"],
        serviceRoles: { api: "api", web: "web", worker: "api" },
        imageVariables: { api: "CRA_API_IMAGE", web: "CRA_WEB_IMAGE" },
        environment: {},
        expectedVersion: "2",
      },
      maintenanceDirectory: join(directory, "maintenance"),
      acknowledgementDirectory: join(directory, "acks"),
      selectionDirectory: join(directory, "selection"),
      selectionKey: Buffer.alloc(32, 7),
      drainServices: ["api", "worker", "edge"],
      fixedServices: ["edge"],
      psqlExecutable: "/usr/bin/psql",
      pgDumpExecutable: "/usr/bin/pg_dump",
      databaseEnvironment: {
        PGHOST: "127.0.0.1",
        PGPORT: "54322",
        PGUSER: "postgres",
        PGDATABASE: "postgres",
      },
      candidateReadinessUrl: "http://127.0.0.1/candidate",
      workerReadinessUrl: "http://127.0.0.1/workers",
      readinessTimeoutMs: 0,
      organizationIds: ["10000000-0000-4000-8000-000000000001"],
      releaseVersions: { [image.imageId]: "2" },
      migrations: {
        cliExecutable: "/private/supabase",
        cliVersion: "2.0.0",
        cwd: directory,
        migrationDirectory: directory,
        databaseUrl: "postgresql://postgres@127.0.0.1:54322/postgres",
        environment: {},
        atomicLedgerQualified: false,
        baselineFiles: {},
      },
    };
    run.mockReset().mockImplementation(async (exe: string, args: string[]) => {
      if (exe.endsWith("psql"))
        return args.some((arg) => arg.includes("organization_license_states"))
          ? JSON.stringify({ total: 1, blocked: 0 })
          : JSON.stringify([
              {
                version: "20261014000000",
                name: "old",
                statements: ["select 1;"],
              },
            ]);
      if (exe.endsWith("pg_dump")) return "\n";
      if (args[0] === "ps") return "a".repeat(64);
      return JSON.stringify(
        ["api", "web", "worker", "edge"].map((service) => ({
          Image: image.imageId,
          State: { Running: true, StartedAt: "2026-01-01T00:00:00Z" },
          Config: { Labels: { "com.docker.compose.service": service } },
        })),
      );
    });
    jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify(healthy)));
    for (const service of config.drainServices)
      await mkdir(join(config.acknowledgementDirectory, service), {
        mode: 0o700,
        recursive: true,
      });
    host = new NativeLinuxDeploymentHost(config, { run }, authority);
    await host.closeIngress();
    await host.selectImages(images);
    await acknowledge();
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    await rm(directory, { recursive: true, force: true });
  });
  async function acknowledge(generationOverride?: string) {
    const state = JSON.parse(
      await readFile(join(config.maintenanceDirectory, "request.json"), "utf8"),
    ) as { generation: string };
    for (const serviceId of config.drainServices)
      await writeFile(
        join(config.acknowledgementDirectory, serviceId, "ack.json"),
        JSON.stringify({
          version: 1,
          generation: generationOverride ?? state.generation,
          serviceId,
          pid: 1,
          claimsClosed: true,
          drained: true,
        }),
        { mode: 0o600 },
      );
  }
  it("requires live positive process drain receipts and semantic readiness", async () => {
    const observed = await host.observe();
    expect(observed).toEqual({
      maintenance: true,
      claimsStopped: true,
      drained: true,
      effectsCertain: true,
      images,
      ledger: ["20261014000000"],
      ledgerDigest: createHash("sha256")
        .update(
          JSON.stringify([
            {
              version: "20261014000000",
              name: "old",
              statements: ["select 1;"],
            },
          ]),
        )
        .digest("hex"),
      schemaDigest: createHash("sha256").update("\n").digest("hex"),
      candidateReady: true,
      workersReady: false,
    });
    await host.stopClaims();
    await host.drain();
    await host.assertFresh("review");
    await host.holdVerifiedBackup();
    expect(authority.assertFresh).toHaveBeenCalledWith("review");
    await host.openIngress();
    const state = JSON.parse(
      await readFile(join(config.maintenanceDirectory, "request.json"), "utf8"),
    ) as { generation: string };
    await writeFile(
      join(config.acknowledgementDirectory, "worker", "live.json"),
      JSON.stringify({
        version: 1,
        serviceId: "worker",
        pid: 1,
        imageId: image.imageId,
        generation: state.generation,
        claimsOpen: true,
        dependenciesReady: true,
        observedAt: new Date().toISOString(),
      }),
    );
    const activated = await host.observe();
    expect(activated.maintenance).toBe(false);
    expect(activated.workersReady).toBe(true);
    const livePath = join(
      config.acknowledgementDirectory,
      "worker",
      "live.json",
    );
    const live = JSON.parse(await readFile(livePath, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      livePath,
      JSON.stringify({ ...live, dependenciesReady: false }),
    );
    expect((await host.observe()).workersReady).toBe(false);
    await writeFile(
      livePath,
      JSON.stringify({ ...live, observedAt: "2020-01-01T00:00:00.000Z" }),
    );
    expect((await host.observe()).workersReady).toBe(false);
    await expect(host.stopClaims()).rejects.toThrow("maintenance_open");
  });
  it("invalidates every old acknowledgement when closing a new generation", async () => {
    await host.closeIngress();
    expect((await host.observe()).drained).toBe(false);
  });
  it("rejects missing or dead process evidence without guessing from exit", async () => {
    await rm(join(config.acknowledgementDirectory, "worker", "ack.json"));
    expect((await host.observe()).effectsCertain).toBe(false);
  });
  it("blocks unknown container inventory and substituted runtime images", async () => {
    run.mockImplementation(async (exe: string, args: string[]) =>
      exe.endsWith("psql")
        ? JSON.stringify([
            {
              version: "20261014000000",
              name: "old",
              statements: ["select 1;"],
            },
          ])
        : args[0] === "ps"
          ? "a".repeat(64)
          : JSON.stringify([
              {
                Image: "other",
                State: { Running: true, StartedAt: "2026-01-01" },
                Config: {
                  Labels: { "com.docker.compose.service": "unmanaged" },
                },
              },
            ]),
    );
    const observed = await host.observe();
    expect(observed.effectsCertain).toBe(false);
    expect(observed.images).toEqual([]);
    expect(observed.candidateReady).toBe(false);
  });
  it("reports degraded 200 as unhealthy", async () => {
    jest
      .mocked(fetch)
      .mockImplementation(
        async () => new Response(JSON.stringify({ status: "degraded" })),
      );
    const observed = await host.observe();
    expect(observed.candidateReady).toBe(false);
    expect(observed.workersReady).toBe(false);
  });
  it("authenticates durable image selection", async () => {
    const path = join(config.selectionDirectory, "selection.json");
    const record = JSON.parse(await readFile(path, "utf8")) as {
      payload: string;
      mac: string;
    };
    await writeFile(path, JSON.stringify({ ...record, mac: "0".repeat(64) }));
    await expect(host.selectedImages()).rejects.toThrow("integrity");
  });
  it("rejects unknown image release selection and bad config", async () => {
    await expect(
      host.selectImages(
        images.map((entry) => ({
          ...entry,
          imageId: `sha256:${"c".repeat(64)}`,
        })),
      ),
    ).rejects.toThrow("identity");
    expect(
      () =>
        new NativeLinuxDeploymentHost(
          { ...config, selectionKey: Buffer.alloc(2) },
          { run },
          authority,
        ),
    ).toThrow();
    expect(
      () =>
        new NativeLinuxDeploymentHost(
          { ...config, candidateReadinessUrl: "file:///etc/passwd" },
          { run },
          authority,
        ),
    ).toThrow();
  });
  it("rejects invalid ledger and failed probes", async () => {
    const implementation = run.getMockImplementation()!;
    run.mockResolvedValue(
      JSON.stringify([{ version: "invalid", name: null, statements: null }]),
    );
    await expect(host.readLedger()).rejects.toThrow();
    run.mockImplementation(implementation);
    jest
      .mocked(fetch)
      .mockResolvedValue(new Response("error", { status: 503 }));
    await expect(host.verifyCandidate()).rejects.toThrow(
      "readiness_unavailable",
    );
  });
  it("does not execute migrations without pinned CLI qualification", async () => {
    await expect(
      host.migrate({
        runId: "x",
        fingerprint: "x",
        migrations: [],
        baselineLedger: [],
        expectedLedgerDigest: "target-ledger",
        targetSchemaDigest: "target-schema",
        candidateImages: images,
        previousImages: images,
        previousCompatibleAfterCandidateWrites: true,
      }),
    ).rejects.toThrow("atomicity");
  });
  it("bounds probe content and rejects unknown inventory output", async () => {
    jest.mocked(fetch).mockResolvedValue(new Response("a".repeat(65537)));
    await expect(host.verifyActivated()).rejects.toThrow("oversized");
    run.mockResolvedValue("not-container-id");
    await expect(host.observe()).rejects.toThrow("process_inventory");
  });
  it("initializes first deployment observation without permitting old bootstrap writes", async () => {
    await rm(join(config.selectionDirectory, "selection.json"));
    await host.closeIngress();
    await host.initializeSelection(images);
    await acknowledge();
    expect((await host.observe()).drained).toBe(true);
    expect(
      JSON.parse(
        await readFile(
          join(config.maintenanceDirectory, "candidate-start.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ serviceIds: [] });
    await host.initializeSelection([]);
    expect(await host.selectedImages()).toEqual(images);
  });
});
