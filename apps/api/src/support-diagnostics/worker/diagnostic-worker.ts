import { ZodError } from "zod";
import { DiagnosticArchive } from "../infrastructure/diagnostic-archive";
import { DiagnosticArtifactStore } from "../infrastructure/diagnostic-artifact.store";
import type {
  DiagnosticClaim,
  DiagnosticWorkerRepository,
  DiagnosticSourcePort,
} from "./diagnostic-worker.port";
export class DiagnosticWorker {
  constructor(
    private readonly options: {
      workerId: string;
      repository: DiagnosticWorkerRepository;
      sources: DiagnosticSourcePort;
      storage: DiagnosticArtifactStore;
      archive: DiagnosticArchive;
    },
  ) {}
  async runOnce(): Promise<void> {
    await this.options.storage.reconcileTemporaryFiles();
    await this.cleanup();
    const claim = await this.options.repository.claim();
    if (!claim) return;
    const controller = new AbortController();
    const signal = controller.signal;
    let current = claim;
    let queue: Promise<unknown> = Promise.resolve();
    const active = () => {
      if (signal.aborted)
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error("access_changed");
    };
    const serial = <T>(operation: () => Promise<T>): Promise<T> => {
      const task = queue.then(() => {
        active();
        return operation();
      });
      queue = task.catch(() => undefined);
      return task;
    };
    const checkpoint = (
      stage: "collecting" | "redacting" | "packaging",
      completed: number,
      omissions: DiagnosticClaim["job"]["omissions"],
    ) =>
      serial(async () => {
        current = await this.options.repository.checkpoint(
          current,
          stage,
          completed,
          omissions,
          signal,
        );
      });
    const interval = setInterval(() => {
      void serial(async () => {
        try {
          await this.options.repository.heartbeat(current, signal);
        } catch {
          controller.abort(new Error("authority_lost"));
        }
      }).catch(() => undefined);
    }, 10_000);
    const timeout = setTimeout(
      () => controller.abort(new Error("generation_timeout")),
      60_000,
    );
    try {
      current = await serial(() =>
        this.options.repository.authorize(current, signal),
      );
      await checkpoint("collecting", 0, []);
      active();
      const payload = await this.options.sources.collect(current, signal);
      active();
      if (
        !current.job.selection.categories.some(
          (category) => payload[category] !== undefined,
        )
      )
        throw new Error("no_sources");
      const completed = current.job.selection.categories.length;
      await checkpoint("redacting", completed, payload.omissions);
      active();
      const packed = await this.options.archive.pack(
        current.job.id,
        current.job.selection,
        payload,
      );
      active();
      await checkpoint("packaging", completed, payload.omissions);
      active();
      await this.options.storage.put(
        current.job.organizationId,
        current.objectPath,
        packed.bytes,
        signal,
      );
      active();
      await this.options.storage.read(
        current.job.organizationId,
        current.objectPath,
        packed.artifact,
        signal,
      );
      active();
      await serial(async () => {
        current = await this.options.repository.authorize(current, signal);
        active();
        await this.options.repository.complete(
          current,
          packed.artifact,
          packed.manifest,
          signal,
        );
      });
    } catch (error) {
      const failure: unknown = signal.aborted ? signal.reason : error;
      const message =
        failure instanceof Error ? failure.message : "source_unavailable";
      const code =
        message === "generation_timeout"
          ? "generation_timeout"
          : ["access_changed", "authority_lost"].includes(message)
            ? "authority_lost"
            : message === "storage_unavailable"
              ? "storage_unavailable"
              : failure instanceof ZodError ||
                  ["bundle_limit", "invalid_value"].includes(message)
                ? "invalid_value"
                : "source_unavailable";
      controller.abort();
      try {
        await this.options.repository.fail(
          current,
          code,
          AbortSignal.timeout(5000),
        );
      } catch {
        /* Lost leases/cancellation own terminal state; no unscoped recovery. */
      }
    } finally {
      clearInterval(interval);
      clearTimeout(timeout);
      controller.abort();
      await queue;
    }
  }
  private async cleanup(): Promise<void> {
    const signal = AbortSignal.timeout(60_000);
    const claim = await this.options.repository.claimCleanup(signal);
    if (!claim) return;
    try {
      for (const path of claim.objectPaths) {
        await this.options.repository.authorizeCleanup(claim, signal);
        await this.options.storage.remove(
          claim.job.organizationId,
          path,
          signal,
        );
      }
      await this.options.repository.finishCleanup(claim, true, signal);
    } catch {
      try {
        await this.options.repository.finishCleanup(
          claim,
          false,
          AbortSignal.timeout(5000),
        );
      } catch {
        /* Later cleanup requires a new reviewed, scoped claim. */
      }
    }
  }
}
