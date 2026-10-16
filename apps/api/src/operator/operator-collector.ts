import { createHash } from "node:crypto";
import { operatorInstanceMetadataResponseSchema } from "@repo/contracts";
import type {
  OperatorInstanceMetadataResponse,
  OperatorRegistryPublication,
} from "@repo/contracts";
export interface CollectorTarget {
  instanceId: string;
  endpoint: string;
  ca: Buffer;
  cert: Buffer;
  key: Buffer;
  cadenceSeconds?: number;
}
export interface SourceMetadataTransport {
  read(
    target: CollectorTarget,
    cursor: string | null,
    signal: AbortSignal,
  ): Promise<unknown>;
}
export interface ObservationPublisher {
  publish(
    instanceId: string,
    publication: OperatorRegistryPublication,
  ): Promise<void>;
  failure(
    instanceId: string,
    attemptedAt: string,
    reason: "collection_unreachable",
  ): Promise<void>;
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
export function validateSourcePage(
  value: unknown,
  instanceId: string,
  now: number,
): OperatorInstanceMetadataResponse {
  const data = operatorInstanceMetadataResponseSchema.parse(value);
  if (
    data.instanceId !== instanceId ||
    Date.parse(data.sourceAt) > Date.parse(data.observedAt)
  )
    throw new Error("Invalid source binding or chronology");
  const validateTimes = (item: unknown): void => {
    if (item === null || typeof item !== "object") return;
    for (const [key, current] of Object.entries(item)) {
      if (
        [
          "sourceAt",
          "observedAt",
          "attemptedAt",
          "succeededAt",
          "receivedAt",
          "lastObservedAt",
          "versionSourceAt",
          "licenceSourceAt",
        ].includes(key) &&
        typeof current === "string" &&
        Date.parse(current) > now
      )
        throw new Error("Future source timestamp");
      validateTimes(current);
    }
  };
  validateTimes(data);
  return data;
}
export class OperatorCollector {
  private running = false;
  private start = 0;
  private readonly nextPollAt = new Map<string, number>();
  private readonly continuations = new Map<
    string,
    {
      cursor: string;
      revision: number;
      sourceAt: string;
      seen: readonly string[];
    }
  >();
  constructor(
    private readonly targets: readonly CollectorTarget[],
    private readonly transport: SourceMetadataTransport,
    private readonly publisher: ObservationPublisher,
    private readonly now: () => number = Date.now,
  ) {}
  async runOnce(cancellation?: AbortSignal): Promise<boolean> {
    cancellation?.throwIfAborted();
    if (this.running) return false;
    this.running = true;
    const ordered = [
      ...this.targets.slice(this.start),
      ...this.targets.slice(0, this.start),
    ];
    const started = this.now();
    const cycleSignal = AbortSignal.any([
      AbortSignal.timeout(20_000),
      ...(cancellation ? [cancellation] : []),
    ]);
    let processed = 0;
    try {
      let storageUnavailable = false;
      for (let offset = 0; offset < ordered.length; offset += 4) {
        if (cycleSignal.aborted || this.now() - started >= 20_000) break;
        const batch = ordered.slice(offset, offset + 4);
        processed = offset + batch.length;
        const results = await Promise.allSettled(
          batch
            .filter(
              (target) =>
                this.now() >= (this.nextPollAt.get(target.instanceId) ?? 0),
            )
            .map((target) => this.poll(target, cycleSignal, started + 20_000)),
        );
        storageUnavailable ||= results.some(
          (result) => result.status === "rejected",
        );
      }
      if (storageUnavailable)
        throw new Error("Operator collector storage unavailable");
      return true;
    } finally {
      this.start =
        (this.start + (processed < ordered.length ? processed : 1)) %
        Math.max(this.targets.length, 1);
      this.running = false;
    }
  }
  private async poll(
    target: CollectorTarget,
    cycleSignal: AbortSignal,
    deadline: number,
  ): Promise<void> {
    const attemptedAt = new Date(this.now()).toISOString();
    const retained = this.continuations.get(target.instanceId);
    let cursor: string | null = retained?.cursor ?? null;
    let lastRevision: number | null = retained?.revision ?? null;
    let lastSourceAt: string | null = retained?.sourceAt ?? null;
    const seen = new Set<string>(retained?.seen);
    const signal = AbortSignal.any([cycleSignal, AbortSignal.timeout(20_000)]);
    try {
      for (let page = 0; page < 101; page++) {
        if (this.now() >= deadline) return;
        signal.throwIfAborted();
        const value = await this.transport.read(target, cursor, signal);
        signal.throwIfAborted();
        const data = validateSourcePage(value, target.instanceId, this.now());
        if (
          lastRevision !== null &&
          (data.revision !== lastRevision || data.sourceAt !== lastSourceAt)
        ) {
          const sourceMovedForward =
            data.revision > lastRevision &&
            Date.parse(data.sourceAt) >= Date.parse(lastSourceAt ?? "");
          if (!sourceMovedForward)
            throw new Error("Source revision changed during pagination");
        }
        if (data.nextCursor && seen.has(data.nextCursor))
          throw new Error("Repeated source cursor");
        if (data.nextCursor && seen.size >= 100)
          throw new Error("Source page bound exceeded");
        const digest = createHash("sha256")
          .update(canonicalJson(data))
          .digest("hex");
        await this.publisher.publish(target.instanceId, {
          metadata: data,
          digest,
        });
        lastRevision = data.revision;
        lastSourceAt = data.sourceAt;
        if (!data.nextCursor) {
          this.continuations.delete(target.instanceId);
          return;
        }
        seen.add(data.nextCursor);
        cursor = data.nextCursor;
        this.continuations.set(target.instanceId, {
          cursor,
          revision: lastRevision,
          sourceAt: data.sourceAt,
          seen: [...seen],
        });
      }
      throw new Error("Source page bound exceeded");
    } catch {
      if (!signal.aborted) this.continuations.delete(target.instanceId);
      await this.publisher.failure(
        target.instanceId,
        attemptedAt,
        "collection_unreachable",
      );
    } finally {
      this.nextPollAt.set(
        target.instanceId,
        this.now() + Math.max(target.cadenceSeconds ?? 60, 60) * 1000,
      );
    }
  }
}
