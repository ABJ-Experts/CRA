import { maintenanceRun } from "./upgrades/maintenance/maintenance-gate";
import type { OperatorInstanceMetadataResponse } from "@repo/contracts";
import { setTimeout as workerSleep } from "node:timers/promises";
import { loadWorkerRuntime } from "./operator/operator-runtime";
import { OperatorWorkerRepository } from "./operator/worker/operator-worker.repository";
import { createHash } from "node:crypto";
import { OperatorLocalMetadataEnricher } from "./operator/worker/operator-local-metadata";
import { createLocalMetadataEnricher } from "./operator/worker/operator-local-sources";
import {
  OperatorCollector,
  canonicalJson,
  validateSourcePage,
} from "./operator/operator-collector";
import { PrivateMetadataTransport } from "./operator/operator-transport";
import { registryKeyId } from "./operator/operator-registry";
export async function runOperatorObserver(
  instanceId: string,
  repository: Pick<OperatorWorkerRepository, "observe"> &
    Partial<Pick<OperatorWorkerRepository, "publish">>,
  now: () => number = Date.now,
  enricher: OperatorLocalMetadataEnricher = new OperatorLocalMetadataEnricher(
    null,
    null,
    null,
  ),
  progress?: {
    afterId: string | null;
    onProgress: (afterId: string | null) => void;
  },
): Promise<void> {
  const signal = AbortSignal.timeout(30_000);
  const started = now();
  const deadline = started + 30_000;
  const observedAt = new Date(started).toISOString();
  let afterId: string | null = progress?.afterId ?? null;
  let baseline: Pick<
    OperatorInstanceMetadataResponse,
    "revision" | "sourceAt" | "instance"
  > | null = null;
  const seen = new Set<string>();
  for (let count = 0; count < 101; count++) {
    // Reserve 3s read + 25 groups of four 250ms licences + 3s publication.
    if (deadline - now() < 13_000) return;
    signal.throwIfAborted();
    const metadata = validateSourcePage(
      await repository.observe(instanceId, observedAt, afterId),
      instanceId,
      now(),
    );
    const enriched = await enricher.enrich(metadata, signal);
    baseline ??= {
      revision: metadata.revision,
      sourceAt: metadata.sourceAt,
      instance: enriched.instance,
    };
    if (metadata.revision !== baseline.revision)
      throw new Error("Local observer revision changed");
    const publication = {
      ...enriched,
      sourceAt: baseline.sourceAt,
      instance: baseline.instance,
    };
    signal.throwIfAborted();
    if (repository.publish)
      await repository.publish(instanceId, {
        metadata: publication,
        digest: createHash("sha256")
          .update(canonicalJson(publication))
          .digest("hex"),
      });
    if (!metadata.nextCursor) {
      progress?.onProgress(null);
      return;
    }
    const next = registryKeyId(metadata.nextCursor);
    if (seen.has(next)) throw new Error("Repeated local observer cursor");
    seen.add(next);
    afterId = next;
    progress?.onProgress(next);
  }
  throw new Error("Local observer page bound exceeded");
}
export function createOperatorWorkerRepository(
  url: string,
  credential: string,
): OperatorWorkerRepository {
  return new OperatorWorkerRepository(url, credential);
}
export async function bootstrapOperatorRegistryWorker(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
  factory: (
    url: string,
    credential: string,
  ) => OperatorWorkerRepository = createOperatorWorkerRepository,
  sleep: (milliseconds: number) => Promise<void> = workerSleep,
): Promise<void> {
  const config = await loadWorkerRuntime(env);
  if (!config) return;
  const repository = factory(config.databaseUrl, config.credential);
  const enricher = createLocalMetadataEnricher(env, config.credential);
  const collector = new OperatorCollector(
    config.targets,
    new PrivateMetadataTransport(),
    repository,
  );
  let observerAfterId: string | null = null;
  do {
    const started = Date.now();
    try {
      if (config.observeLocal)
        await maintenanceRun(() =>
          runOperatorObserver(
            config.instanceId,
            repository,
            Date.now,
            enricher,
            {
              afterId: observerAfterId,
              onProgress: (next) => {
                observerAfterId = next;
              },
            },
          ),
        );
    } catch {
      process.stderr.write("Operator observation cycle unavailable\n");
    }
    try {
      await maintenanceRun(() => collector.runOnce());
    } catch {
      process.stderr.write("Operator registry collection unavailable\n");
    }
    if (!argv.includes("--once"))
      await sleep(Math.max(0, 30_000 - (Date.now() - started)));
  } while (!argv.includes("--once"));
}
/* istanbul ignore next -- executable runtime guard */
if (require.main === module)
  void bootstrapOperatorRegistryWorker().catch(() => {
    process.stderr.write("Operator worker failed to start\n");
    process.exitCode = 1;
  });
