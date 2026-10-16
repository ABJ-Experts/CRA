import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  inspectionDigest,
  normalizedSchemaDigest,
} from "../control/native-upgrade-inspection";
import type {
  DeploymentImage,
  DeploymentObservation,
  DeploymentPlan,
} from "../../application/deployment-lifecycle.port";
import {
  ExactCliMigrations,
  type ExactCliMigrationConfiguration,
} from "./exact-cli-migrations";
import {
  parseSemanticReadiness,
  type LinuxDeploymentConfiguration,
  type LinuxDeploymentHost,
  type NativeCommandRunner,
} from "./linux-deployment.adapter";

const request = z
  .object({
    version: z.literal(1),
    generation: z.string().uuid(),
    closed: z.boolean(),
  })
  .strict();
const acknowledgement = z
  .object({
    version: z.literal(1),
    generation: z.string().uuid(),
    serviceId: z.string(),
    pid: z.number().int().positive(),
    claimsClosed: z.literal(true),
    drained: z.literal(true),
  })
  .strict();
const imagesSchema = z
  .array(
    z
      .object({
        service: z.enum(["api", "web"]),
        digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        platform: z.string().regex(/^linux\/(amd64|arm64)(\/v8)?$/),
      })
      .strict(),
  )
  .length(2);
const containersSchema = z.array(
  z
    .object({
      Image: z.string(),
      State: z
        .object({ Running: z.boolean(), StartedAt: z.string() })
        .passthrough(),
      Config: z
        .object({ Labels: z.record(z.string(), z.string()) })
        .passthrough(),
    })
    .passthrough(),
);
export interface NativeLinuxHostConfiguration {
  readonly deployment: LinuxDeploymentConfiguration;
  readonly maintenanceDirectory: string;
  readonly acknowledgementDirectory: string;
  readonly selectionDirectory: string;
  readonly selectionKey: Buffer;
  readonly drainServices: readonly string[];
  /** Fixed infrastructure/control services observed in this project, never replaced. */
  readonly fixedServices: readonly string[];
  readonly psqlExecutable: string;
  readonly pgDumpExecutable: string;
  readonly databaseEnvironment: Readonly<Record<string, string>>;
  readonly candidateReadinessUrl: string;
  readonly workerReadinessUrl: string;
  readonly readinessTimeoutMs?: number;
  /** Both exact previous and candidate image IDs are bound to their release version. */
  readonly organizationIds: readonly string[];
  readonly releaseVersions: Readonly<Record<string, string>>;
  readonly migrations: ExactCliMigrationConfiguration;
}
export interface NativeHostAuthorities {
  assertFresh(fingerprint: string): Promise<void>;
  holdVerifiedBackup(): Promise<void>;
}

/** Native controls intentionally require provisioned semantic probes and positive drain receipts. */
export class NativeLinuxDeploymentHost implements LinuxDeploymentHost {
  private readonly migration: ExactCliMigrations;
  constructor(
    private readonly config: NativeLinuxHostConfiguration,
    private readonly runner: NativeCommandRunner,
    private readonly authority: NativeHostAuthorities,
  ) {
    if (
      config.selectionKey.length < 32 ||
      config.drainServices.length === 0 ||
      config.drainServices.some(
        (service) => !/^[a-z][a-z0-9-]{0,100}$/.test(service),
      )
    )
      throw new Error("upgrade_host_configuration");
    for (const endpoint of [
      config.candidateReadinessUrl,
      config.workerReadinessUrl,
    ]) {
      const url = new URL(endpoint);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error("upgrade_host_probe_configuration");
    }
    const database = new URL(config.migrations.databaseUrl);
    const environment = config.databaseEnvironment;
    if (
      database.hostname !== environment.PGHOST ||
      database.port !== environment.PGPORT ||
      decodeURIComponent(database.username) !== environment.PGUSER ||
      decodeURIComponent(database.pathname.slice(1)) !== environment.PGDATABASE
    )
      throw new Error("upgrade_database_target_mismatch");
    this.migration = new ExactCliMigrations(
      config.migrations,
      runner,
      () => this.readLedger(),
      () => this.readLedgerDigest(),
    );
  }
  assertFresh(fingerprint: string) {
    this.runner.assertActive?.();
    return this.authority.assertFresh(fingerprint);
  }
  holdVerifiedBackup() {
    this.runner.assertActive?.();
    return this.authority.holdVerifiedBackup();
  }
  migrate(plan: DeploymentPlan) {
    return this.migration.apply(plan);
  }
  async closeIngress(): Promise<void> {
    const generation = randomUUID();
    await this.write(this.config.maintenanceDirectory, "candidate-start.json", {
      version: 1,
      generation,
      serviceIds: [],
      imageId: "",
    });
    await this.write(this.config.maintenanceDirectory, "request.json", {
      version: 1,
      generation,
      closed: true,
    });
  }
  async stopClaims(): Promise<void> {
    this.runner.assertActive?.();
    const state = request.parse(
      await this.read(this.config.maintenanceDirectory, "request.json"),
    );
    if (!state.closed) throw new Error("upgrade_maintenance_open");
  }
  async drain(): Promise<void> {
    // Absence/expiry/process exit is never accepted as proof. Caller may reconcile later.
    const deadline = Date.now() + 30_000;
    do {
      const observed = await this.observe();
      if (
        observed.maintenance &&
        observed.claimsStopped &&
        observed.drained &&
        observed.effectsCertain
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    throw new Error("upgrade_drain_unconfirmed");
  }
  async openIngress(): Promise<void> {
    this.runner.assertActive?.();
    const state = request.parse(
      await this.read(this.config.maintenanceDirectory, "request.json"),
    );
    await this.write(this.config.maintenanceDirectory, "candidate-start.json", {
      version: 1,
      generation: state.generation,
      serviceIds: [],
      imageId: "",
    });
    await this.write(this.config.maintenanceDirectory, "request.json", {
      ...state,
      closed: false,
    });
  }
  /** Initializes observed previous images without granting any bootstrap permission. */
  async initializeSelection(images: readonly DeploymentImage[]): Promise<void> {
    try {
      await this.selectedImages();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parsed = imagesSchema.parse(images);
    if (
      new Set(parsed.map((image) => image.service)).size !== 2 ||
      parsed.some((image) => !this.config.releaseVersions[image.imageId])
    )
      throw new Error("upgrade_selection_identity");
    const payload = JSON.stringify(parsed);
    await this.write(this.config.selectionDirectory, "selection.json", {
      payload,
      mac: this.mac(payload),
    });
  }
  async selectImages(images: readonly DeploymentImage[]): Promise<void> {
    const parsed = imagesSchema.parse(images);
    if (
      new Set(parsed.map((image) => image.service)).size !== 2 ||
      parsed.some((image) => !this.config.releaseVersions[image.imageId])
    )
      throw new Error("upgrade_selection_identity");
    this.runner.assertActive?.();
    const state = request.parse(
      await this.read(this.config.maintenanceDirectory, "request.json"),
    );
    if (!state.closed)
      throw new Error("upgrade_selection_requires_maintenance");
    const payload = JSON.stringify(parsed);
    await this.write(this.config.selectionDirectory, "selection.json", {
      payload,
      mac: this.mac(payload),
    });
    await this.write(this.config.maintenanceDirectory, "candidate-start.json", {
      version: 1,
      generation: state.generation,
      serviceIds: ["api"],
      imageId: parsed.find((image) => image.service === "api")!.imageId,
    });
  }
  async selectedImages(): Promise<readonly DeploymentImage[]> {
    const record = z
      .object({ payload: z.string(), mac: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(await this.read(this.config.selectionDirectory, "selection.json"));
    if (
      !timingSafeEqual(
        Buffer.from(record.mac, "hex"),
        Buffer.from(this.mac(record.payload), "hex"),
      )
    )
      throw new Error("upgrade_selection_integrity");
    return imagesSchema.parse(JSON.parse(record.payload));
  }
  verifyCandidate() {
    return this.awaitReadiness(false);
  }
  verifyActivated() {
    return this.awaitReadiness(true);
  }
  private async awaitReadiness(activated: boolean): Promise<unknown> {
    const deadline = Date.now() + (this.config.readinessTimeoutMs ?? 30_000);
    for (;;) {
      this.runner.assertActive?.();
      try {
        await this.verifyImages(
          activated
            ? this.config.deployment.workerServices
            : this.config.deployment.candidateServices,
        );
        return await this.semanticReadiness(activated);
      } catch (error) {
        if (Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
  private async semanticReadiness(activated: boolean): Promise<unknown> {
    const health = z
      .object({
        status: z.enum(["ok", "degraded"]),
        database: z.literal(true),
        audit: z.literal(true),
      })
      .strict()
      .parse(
        await this.probe(
          activated
            ? this.config.workerReadinessUrl
            : this.config.candidateReadinessUrl,
        ),
      );
    if (activated && health.status !== "ok")
      throw new Error("upgrade_dependencies_unhealthy");
    const images = await this.selectedImages();
    const apiImage = images.find((image) => image.service === "api")!;
    const version = this.config.releaseVersions[apiImage.imageId];
    if (!version || !(await this.licenceReady()))
      throw new Error("upgrade_licence_unhealthy");
    if (!activated)
      return {
        status: "healthy",
        version,
        database: true,
        audit: true,
        licensing: true,
        contracts: true,
      };
    this.runner.assertActive?.();
    const state = request.parse(
      await this.read(this.config.maintenanceDirectory, "request.json"),
    );
    if (state.closed) throw new Error("upgrade_claims_closed");
    const workers = await Promise.all(
      this.config.deployment.workerServices.map(async (service) => {
        const live = z
          .object({
            version: z.literal(1),
            serviceId: z.literal(service),
            pid: z.number().int().positive(),
            imageId: z.literal(apiImage.imageId),
            generation: z.literal(state.generation),
            claimsOpen: z.literal(true),
            dependenciesReady: z.literal(true),
            observedAt: z.string().datetime(),
          })
          .strict()
          .parse(
            await this.read(
              join(this.config.acknowledgementDirectory, service),
              "live.json",
            ),
          );
        const age = Date.now() - Date.parse(live.observedAt);
        if (age < 0 || age > 5 * 60_000)
          throw new Error("upgrade_worker_stale");
        return {
          service,
          version,
          claims: true,
          live: true,
          dependencies: true,
        };
      }),
    );
    return { status: "healthy", version, workers };
  }
  private async licenceReady(): Promise<boolean> {
    if (
      this.config.organizationIds.length === 0 ||
      this.config.organizationIds.some(
        (id) => !z.string().uuid().safeParse(id).success,
      )
    )
      return false;
    const output = await this.runner.run(
      this.config.psqlExecutable,
      [
        "-X",
        "-qAt",
        "--no-password",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SELECT json_build_object('total',count(*),'blocked',count(*) FILTER (WHERE NOT public.m15_01_customer_write_allowed(organization_id,'administration'))) FROM public.organization_license_states WHERE organization_id IN (${this.config.organizationIds.map((id) => `'${id}'::uuid`).join(",")}); COMMIT;`,
      ],
      {
        cwd: this.config.deployment.cwd,
        environment: this.config.databaseEnvironment,
      },
    );
    const counts = z
      .object({ total: z.number().int(), blocked: z.number().int() })
      .strict()
      .parse(JSON.parse(output));
    return (
      counts.total === this.config.organizationIds.length &&
      counts.blocked === 0
    );
  }

  private async verifyImages(services: readonly string[]): Promise<void> {
    const images = await this.selectedImages();
    const containers = await this.containers();
    if (
      !services.every((service) =>
        containers.some(
          (container) =>
            container.Config.Labels["com.docker.compose.service"] === service &&
            container.State.Running &&
            container.Image ===
              images.find(
                (image) =>
                  image.service ===
                  this.config.deployment.serviceRoles[service],
              )?.imageId,
        ),
      )
    )
      throw new Error("upgrade_running_image_substitution");
  }
  async observe(): Promise<DeploymentObservation> {
    this.runner.assertActive?.();
    const state = request.parse(
      await this.read(this.config.maintenanceDirectory, "request.json"),
    );
    const selected = await this.selectedImages();
    const containers = await this.containers();
    const facts = await Promise.all(
      this.config.drainServices.map(async (service) => {
        const container = containers.find(
          (item) =>
            item.Config.Labels["com.docker.compose.service"] === service,
        );
        try {
          const ack = acknowledgement.parse(
            await this.read(
              join(this.config.acknowledgementDirectory, service),
              "ack.json",
            ),
          );
          const stat = await lstat(
            join(this.config.acknowledgementDirectory, service, "ack.json"),
          );
          return (
            !!container?.State.Running &&
            ack.serviceId === service &&
            ack.generation === state.generation &&
            stat.mtimeMs >= Date.parse(container.State.StartedAt)
          );
        } catch {
          return false;
        }
      }),
    );
    const imageMatch = this.config.deployment.candidateServices.every(
      (service) => {
        const container = containers.find(
          (item) =>
            item.Config.Labels["com.docker.compose.service"] === service,
        );
        return (
          container?.State.Running &&
          container.Image ===
            selected.find(
              (image) =>
                image.service === this.config.deployment.serviceRoles[service],
            )?.imageId
        );
      },
    );
    const version =
      this.config.releaseVersions[
        selected.find((image) => image.service === "api")!.imageId
      ];
    let candidateReady = false;
    let workersReady = false;
    try {
      if (version && imageMatch) {
        parseSemanticReadiness(
          await this.semanticReadiness(false),
          version,
          [],
        );
        candidateReady = true;
      }
    } catch {
      /* readiness failure is an observed failure */
    }
    try {
      if (version) {
        await this.verifyImages(this.config.deployment.workerServices);
        parseSemanticReadiness(
          await this.semanticReadiness(true),
          version,
          this.config.deployment.workerServices,
        );
        workersReady = true;
      }
    } catch {
      /* same fail-closed semantics */
    }
    const expectedServices = [
      ...this.config.deployment.candidateServices,
      ...this.config.deployment.workerServices,
      ...this.config.drainServices,
      ...this.config.fixedServices,
    ];
    const inventoryKnown = containers.every((item) =>
      expectedServices.includes(
        item.Config.Labels["com.docker.compose.service"] ?? "",
      ),
    );
    return {
      maintenance: state.closed,
      claimsStopped: state.closed && facts.every(Boolean),
      drained: facts.every(Boolean),
      effectsCertain: inventoryKnown && facts.every(Boolean),
      images: imageMatch ? selected : [],
      ledger: await this.readLedger(),
      ledgerDigest: await this.readLedgerDigest(),
      schemaDigest: await this.readSchemaDigest(),
      candidateReady,
      workersReady,
    };
  }
  private async containers() {
    const c = this.config.deployment;
    const ids = (
      await this.runner.run(
        c.dockerExecutable,
        [
          "ps",
          "--all",
          "--quiet",
          "--filter",
          `label=com.docker.compose.project=${c.project}`,
        ],
        { cwd: c.cwd, environment: c.environment },
      )
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!ids.length || ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id)))
      throw new Error("upgrade_process_inventory");
    return containersSchema.parse(
      JSON.parse(
        await this.runner.run(c.dockerExecutable, ["inspect", ...ids], {
          cwd: c.cwd,
          environment: c.environment,
        }),
      ),
    );
  }
  private async ledgerRows() {
    const output = await this.runner.run(
      this.config.psqlExecutable,
      [
        "-X",
        "-qAt",
        "--no-password",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        "BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SELECT coalesce(json_agg(json_build_object('version',version,'name',name,'statements',statements) ORDER BY version), '[]'::json) FROM supabase_migrations.schema_migrations; COMMIT;",
      ],
      {
        cwd: this.config.deployment.cwd,
        environment: this.config.databaseEnvironment,
      },
    );
    const rows = z
      .array(
        z
          .object({
            version: z.string().regex(/^\d{14}$/),
            name: z.string().nullable(),
            statements: z.array(z.string()).nullable(),
          })
          .strict(),
      )
      .parse(JSON.parse(output));
    if (new Set(rows.map((row) => row.version)).size !== rows.length)
      throw new Error("upgrade_ledger_invalid");
    return rows;
  }
  async readLedger(): Promise<readonly string[]> {
    return (await this.ledgerRows()).map((row) => row.version);
  }
  async readLedgerDigest(): Promise<string> {
    return inspectionDigest(await this.ledgerRows());
  }
  async readSchemaDigest(): Promise<string> {
    const dump = await this.runner.run(
      this.config.pgDumpExecutable,
      ["--schema-only", "--no-owner", "--no-privileges"],
      {
        cwd: this.config.deployment.cwd,
        environment: this.config.databaseEnvironment,
      },
    );
    return normalizedSchemaDigest(dump);
  }

  private mac(payload: string) {
    return createHmac("sha256", this.config.selectionKey)
      .update("CRA-UPGRADE-SELECTION-V1\0")
      .update(payload)
      .digest("hex");
  }
  private async probe(endpoint: string): Promise<unknown> {
    const response = await fetch(endpoint, {
      signal: AbortSignal.any([
        AbortSignal.timeout(5000),
        ...(this.runner.signal ? [this.runner.signal] : []),
      ]),
      redirect: "error",
    });
    if (!response.ok) throw new Error("upgrade_readiness_unavailable");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("upgrade_readiness_unavailable");
    let body = Buffer.alloc(0);
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        body = Buffer.concat([body, result.value]);
        if (body.length > 65536) throw new Error("upgrade_readiness_oversized");
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(body.toString("utf8")) as unknown;
  }
  private async read(directory: string, name: string): Promise<unknown> {
    const file = await open(
      join(directory, name),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 65536)
        throw new Error("upgrade_host_state_invalid");
      return JSON.parse(await file.readFile("utf8")) as unknown;
    } finally {
      await file.close();
    }
  }
  private async write(
    directory: string,
    name: string,
    value: unknown,
  ): Promise<void> {
    this.runner.assertActive?.();
    const stat = await lstat(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o022) !== 0
    )
      throw new Error("upgrade_host_directory");
    const temporary = join(directory, `.${name}.${randomUUID()}`);
    const file = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await file.writeFile(JSON.stringify(value));
      await file.sync();
    } finally {
      await file.close();
    }
    this.runner.assertActive?.();
    await rename(temporary, join(directory, name));
    const parent = await open(
      directory,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  }
}
