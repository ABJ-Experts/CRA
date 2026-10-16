import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { z } from "zod";
import type {
  DeploymentImage,
  DeploymentLifecyclePort,
  DeploymentObservation,
  DeploymentPlan,
} from "../../application/deployment-lifecycle.port";

export interface NativeCommandRunner {
  readonly signal?: AbortSignal;
  assertActive?(): void;
  run(
    executable: string,
    args: readonly string[],
    options: {
      readonly cwd: string;
      readonly environment: Readonly<Record<string, string>>;
      readonly stdin?: string;
    },
  ): Promise<string>;
}
/** Bounded shell-free child process; native error output is deliberately not propagated. */
export class ShellFreeCommandRunner implements NativeCommandRunner {
  private readonly cancellation = new AbortController();
  private readonly children = new Set<ChildProcessWithoutNullStreams>();
  get signal(): AbortSignal {
    return this.cancellation.signal;
  }
  assertActive(): void {
    if (this.signal.aborted)
      throw new Error("upgrade_execution_authority_lost");
  }
  abortAll(): void {
    this.cancellation.abort();
    for (const child of this.children) this.killOwnedGroup(child);
  }
  private killOwnedGroup(child: ChildProcessWithoutNullStreams): void {
    if (!child.pid) return;
    try {
      if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH")
        child.kill("SIGKILL");
    }
  }
  run(
    executable: string,
    args: readonly string[],
    options: {
      cwd: string;
      environment: Readonly<Record<string, string>>;
      stdin?: string;
    },
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      this.assertActive();
      const child = spawn(executable, [...args], {
        cwd: options.cwd,
        env: { ...options.environment },
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.children.add(child);
      let output = "";
      let bytes = 0;
      const timeout = setTimeout(() => {
        this.killOwnedGroup(child);
        reject(new Error("upgrade_native_timeout"));
      }, 120_000);
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) this.killOwnedGroup(child);
        else output += chunk.toString("utf8");
      });
      child.stderr.on("data", () => {
        /* private stderr is never included in reports */
      });
      child.on("error", () => {
        clearTimeout(timeout);
        reject(new Error("upgrade_native_unavailable"));
      });
      child.on("close", (code) => {
        this.killOwnedGroup(child);
        this.children.delete(child);
        clearTimeout(timeout);
        if (code !== 0 || bytes > 1024 * 1024)
          reject(new Error("upgrade_native_failed"));
        else resolve(output);
      });
      child.stdin.on("error", () => {
        /* process close carries failure */
      });
      child.stdin.end(options.stdin);
    });
  }
}
export interface LinuxDeploymentConfiguration {
  readonly dockerExecutable: string;
  readonly composeFile: string;
  readonly project: string;
  readonly cwd: string;
  readonly candidateServices: readonly string[];
  readonly workerServices: readonly string[];
  /** Host-owned service -> signed image role (api or web). */
  readonly serviceRoles: Readonly<Record<string, "api" | "web">>;
  readonly imageVariables: Readonly<Record<"api" | "web", string>>;
  readonly environment: Readonly<Record<string, string>>;
  readonly expectedVersion: string;
}
/** Required privileged controls, backed by authenticated supervisor-owned host state. */
export interface LinuxDeploymentHost {
  observe(): Promise<DeploymentObservation>;
  assertFresh(fingerprint: string): Promise<void>;
  closeIngress(): Promise<void>;
  stopClaims(): Promise<void>;
  drain(): Promise<void>;
  holdVerifiedBackup(): Promise<void>;
  migrate(plan: DeploymentPlan): Promise<void>;
  selectImages(images: readonly DeploymentImage[]): Promise<void>;
  selectedImages(): Promise<readonly DeploymentImage[]>;
  openIngress(): Promise<void>;
  verifyCandidate(): Promise<unknown>;
  verifyActivated(): Promise<unknown>;
}
const readiness = z
  .object({
    status: z.literal("healthy"),
    version: z.string(),
    database: z.literal(true).optional(),
    audit: z.literal(true).optional(),
    licensing: z.literal(true).optional(),
    contracts: z.literal(true).optional(),
    workers: z
      .array(
        z
          .object({
            service: z.string(),
            version: z.string(),
            claims: z.literal(true),
            live: z.literal(true),
            dependencies: z.literal(true),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();
export function parseSemanticReadiness(
  value: unknown,
  version: string,
  workers: readonly string[],
): void {
  const parsed = readiness.parse(value);
  if (parsed.version !== version) throw new Error("upgrade_readiness_version");
  if (workers.length === 0) {
    if (
      !parsed.database ||
      !parsed.audit ||
      !parsed.licensing ||
      !parsed.contracts
    )
      throw new Error("upgrade_candidate_unhealthy");
  } else if (
    parsed.workers?.length !== workers.length ||
    !workers.every((service) =>
      parsed.workers?.some(
        (worker) => worker.service === service && worker.version === version,
      ),
    )
  )
    throw new Error("upgrade_workers_unhealthy");
}
const inspection = z
  .array(
    z
      .object({
        Id: z.string(),
        Os: z.string(),
        Architecture: z.string(),
        Variant: z.string().optional(),
      })
      .passthrough(),
  )
  .length(1);
const composeConfig = z
  .object({
    services: z.record(
      z.string(),
      z
        .object({ image: z.string(), build: z.unknown().optional() })
        .passthrough(),
    ),
  })
  .passthrough();

export class LinuxDeploymentAdapter implements DeploymentLifecyclePort {
  constructor(
    private readonly config: LinuxDeploymentConfiguration,
    private readonly runner: NativeCommandRunner,
    private readonly host: LinuxDeploymentHost,
  ) {
    const services = [...config.candidateServices, ...config.workerServices];
    if (
      !config.dockerExecutable.startsWith("/") ||
      !config.composeFile.startsWith("/") ||
      !config.cwd.startsWith("/") ||
      !/^[a-z][a-z0-9_-]*$/.test(config.project) ||
      services.length === 0 ||
      new Set(services).size !== services.length ||
      services.some(
        (name) =>
          !/^[a-z][a-z0-9_-]*$/.test(name) || !config.serviceRoles[name],
      )
    )
      throw new Error("upgrade_host_configuration");
  }
  observe() {
    return this.host.observe();
  }
  assertFresh(fingerprint: string) {
    return this.host.assertFresh(fingerprint);
  }
  closeIngress() {
    return this.host.closeIngress();
  }
  stopClaims() {
    return this.host.stopClaims();
  }
  drain() {
    return this.host.drain();
  }
  holdVerifiedBackup() {
    return this.host.holdVerifiedBackup();
  }
  migrate(plan: DeploymentPlan) {
    return this.host.migrate(plan);
  }
  openIngress() {
    return this.host.openIngress();
  }
  async startCandidate(images: readonly DeploymentImage[]): Promise<void> {
    await this.validateImages(images);
    await this.host.selectImages(images);
    await this.up(this.config.candidateServices, images);
  }
  async restorePreviousImages(
    images: readonly DeploymentImage[],
  ): Promise<void> {
    await this.startCandidate(images);
    // Version-specific semantic verification is supplied by observation of selected images.
  }
  async startWorkers(): Promise<void> {
    await this.up(this.config.workerServices, await this.host.selectedImages());
  }
  async verifyCandidate(): Promise<void> {
    parseSemanticReadiness(
      await this.host.verifyCandidate(),
      this.config.expectedVersion,
      [],
    );
  }
  async verifyActivated(): Promise<void> {
    parseSemanticReadiness(
      await this.host.verifyActivated(),
      this.config.expectedVersion,
      this.config.workerServices,
    );
  }
  private async validateImages(images: readonly DeploymentImage[]) {
    if (
      images.length !== 2 ||
      !["api", "web"].every(
        (role) => images.filter((image) => image.service === role).length === 1,
      )
    )
      throw new Error("upgrade_image_inventory");
    for (const image of images) {
      if (
        !/^sha256:[a-f0-9]{64}$/.test(image.digest) ||
        !/^sha256:[a-f0-9]{64}$/.test(image.imageId)
      )
        throw new Error("upgrade_image_identity");
      const [actual] = inspection.parse(
        JSON.parse(
          await this.runner.run(
            this.config.dockerExecutable,
            ["image", "inspect", image.imageId],
            { cwd: this.config.cwd, environment: this.config.environment },
          ),
        ),
      );
      if (
        !actual ||
        actual.Id !== image.imageId ||
        image.digest !== image.imageId ||
        `${actual.Os}/${actual.Architecture}` !== image.platform
      )
        throw new Error("upgrade_image_substitution");
    }
  }
  private compose() {
    return [
      "compose",
      "--project-name",
      this.config.project,
      "--file",
      this.config.composeFile,
    ];
  }
  private async up(
    services: readonly string[],
    images: readonly DeploymentImage[],
  ) {
    await this.validateImages(images);
    const bindings = Object.fromEntries(
      images.map((image) => [
        this.config.imageVariables[image.service as "api" | "web"],
        image.imageId,
      ]),
    );
    const options = {
      cwd: this.config.cwd,
      environment: {
        ...this.config.environment,
        ...bindings,
        CRA_API_IMAGE_ID: images.find((image) => image.service === "api")!
          .imageId,
      },
    };
    const resolved = composeConfig.parse(
      JSON.parse(
        await this.runner.run(
          this.config.dockerExecutable,
          [...this.compose(), "config", "--format", "json"],
          options,
        ),
      ),
    );
    for (const service of [
      ...this.config.candidateServices,
      ...this.config.workerServices,
    ]) {
      const expected = images.find(
        (image) => image.service === this.config.serviceRoles[service],
      );
      if (
        !expected ||
        resolved.services[service]?.image !== expected.imageId ||
        resolved.services[service]?.build !== undefined
      )
        throw new Error("upgrade_compose_identity");
    }
    await this.runner.run(
      this.config.dockerExecutable,
      [
        ...this.compose(),
        "up",
        "--detach",
        "--no-deps",
        "--no-build",
        "--pull",
        "never",
        ...services,
      ],
      options,
    );
  }
}
