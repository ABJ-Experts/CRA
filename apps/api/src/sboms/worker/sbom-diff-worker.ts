import { Logger } from "@nestjs/common";
import { z } from "zod";

const uuidSchema = z.uuid();
const maximumClaimsPerCycle = 1_000;

export type SbomDiffCheckpoint = Readonly<{
  currentCursor?: string;
  baselineCursor?: string;
}>;

export type SbomDiffClaim =
  | Readonly<{
      outcome: "claimed";
      organizationId: string;
      reportId: string;
      sourceId: string;
      baselineSourceId: string;
      documentId: string;
      baselineDocumentId: string;
      checkpoint: SbomDiffCheckpoint;
    }>
  | Readonly<{ outcome: "none_available" | "conflict" }>;

export type SbomDiffComponentFact = Readonly<{
  componentId: string;
  identity: string | null;
  ecosystem: string | null;
  canonicalPurl: string | null;
  normalizedVersion: string | null;
  sourceOffset: number;
}>;

export type SbomDiffFactPage = Readonly<{
  facts: readonly SbomDiffComponentFact[];
  nextCursor: string | null;
}>;

export type SbomDiffChangeDraft = Readonly<{
  changeKey: string;
  changeType: "added" | "removed" | "unchanged" | "unresolved";
  identity: string | null;
  ecosystem: string | null;
  currentComponentId: string | null;
  baselineComponentId: string | null;
  currentVersion: string | null;
  baselineVersion: string | null;
  explanation: string;
}>;

export interface SbomDiffQueue {
  dueDiffOrganizationIds(): Promise<readonly string[]>;
  claimDiffReport(
    organizationId: string,
    input: Readonly<{ workerId: string; leaseSeconds: number }>,
  ): Promise<SbomDiffClaim>;
  readDiffFactPage(
    organizationId: string,
    input: Readonly<{
      reportId: string;
      workerId: string;
      side: "current" | "baseline";
      limit: number;
      cursor?: string;
    }>,
  ): Promise<SbomDiffFactPage>;
  persistDiffBatch(
    organizationId: string,
    input: Readonly<{
      reportId: string;
      workerId: string;
      changes: readonly SbomDiffChangeDraft[];
      checkpoint: SbomDiffCheckpoint;
      complete: boolean;
    }>,
  ): Promise<void>;
  failDiffReport(
    organizationId: string,
    input: Readonly<{
      reportId: string;
      workerId: string;
      errorCode:
        | "diff_persistence_unavailable"
        | "diff_statement_timeout"
        | "diff_calculation_failed"
        | "provider_unavailable";
      message: string;
    }>,
  ): Promise<void>;
}

/**
 * Streams two source-normalized projections in canonical identity order. It only
 * treats exact normalized versions as unchanged; version ordering stays behind
 * the M4 comparator boundary and is never approximated lexically.
 */
export class SbomDiffWorker {
  private readonly logger = new Logger(SbomDiffWorker.name);

  constructor(
    private readonly dependencies: Readonly<{
      workerId: string;
      leaseSeconds: number;
      queue: SbomDiffQueue;
      pageSize?: number;
      batchSize?: number;
      maximumIdentityGroup?: number;
    }>,
  ) {
    if (!uuidSchema.safeParse(dependencies.workerId).success) {
      throw new Error("invalid sbom diff worker id");
    }
    if (
      !Number.isInteger(dependencies.leaseSeconds) ||
      dependencies.leaseSeconds < 15 ||
      dependencies.leaseSeconds > 900
    ) {
      throw new Error("invalid sbom diff worker lease");
    }
    const bounds = [
      dependencies.pageSize ?? 1_000,
      dependencies.batchSize ?? 250,
      dependencies.maximumIdentityGroup ?? 100,
    ];
    if (
      bounds.some(
        (value) => !Number.isSafeInteger(value) || value < 1 || value > 5_000,
      )
    ) {
      throw new Error("invalid sbom diff worker bounds");
    }
  }

  async runOnce(): Promise<void> {
    let due = unique(await this.dependencies.queue.dueDiffOrganizationIds());
    let remaining = maximumClaimsPerCycle;
    while (due.length > 0 && remaining > 0) {
      const nextRound: string[] = [];
      for (const organizationId of due) {
        if (remaining === 0) break;
        if (await this.processOne(organizationId))
          nextRound.push(organizationId);
        remaining -= 1;
      }
      due = nextRound;
    }
  }

  private async processOne(organizationId: string): Promise<boolean> {
    const claim = await this.dependencies.queue.claimDiffReport(
      organizationId,
      {
        workerId: this.dependencies.workerId,
        leaseSeconds: this.dependencies.leaseSeconds,
      },
    );
    if (claim.outcome !== "claimed") return false;

    try {
      await this.compare(organizationId, claim);
    } catch (error) {
      await this.dependencies.queue.failDiffReport(organizationId, {
        reportId: claim.reportId,
        workerId: this.dependencies.workerId,
        errorCode:
          error instanceof DiffWorkerError ? error.code : errorCodeFor(error),
        message:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "SBOM diff worker failed.",
      });
      this.logger.warn({
        message: "sbom diff cycle failed",
        error: errorSummary(error),
      });
    }
    return true;
  }

  private async compare(
    organizationId: string,
    claim: Extract<SbomDiffClaim, { outcome: "claimed" }>,
  ): Promise<void> {
    const current = new FactReader({
      organizationId,
      reportId: claim.reportId,
      workerId: this.dependencies.workerId,
      side: "current",
      queue: this.dependencies.queue,
      pageSize: this.dependencies.pageSize ?? 1_000,
      cursor: claim.checkpoint.currentCursor,
    });
    const baseline = new FactReader({
      organizationId,
      reportId: claim.reportId,
      workerId: this.dependencies.workerId,
      side: "baseline",
      queue: this.dependencies.queue,
      pageSize: this.dependencies.pageSize ?? 1_000,
      cursor: claim.checkpoint.baselineCursor,
    });
    const batch: SbomDiffChangeDraft[] = [];
    const flush = async (complete: boolean): Promise<void> => {
      if (batch.length === 0 && !complete) return;
      await this.dependencies.queue.persistDiffBatch(organizationId, {
        reportId: claim.reportId,
        workerId: this.dependencies.workerId,
        changes: Object.freeze([...batch]),
        checkpoint: Object.freeze({
          currentCursor: current.checkpoint(),
          baselineCursor: baseline.checkpoint(),
        }),
        complete,
      });
      batch.length = 0;
    };
    const append = async (changes: readonly SbomDiffChangeDraft[]) => {
      batch.push(...changes);
      if (batch.length >= (this.dependencies.batchSize ?? 250))
        await flush(false);
    };

    while ((await current.peek()) || (await baseline.peek())) {
      const currentFact = await current.peek();
      const baselineFact = await baseline.peek();
      if (!currentFact) {
        await append(await this.singleSide(baseline, "removed"));
        continue;
      }
      if (!baselineFact) {
        await append(await this.singleSide(current, "added"));
        continue;
      }
      if (!currentFact.identity || !baselineFact.identity) {
        if (!currentFact.identity) {
          await current.take();
          await append([
            unresolved(
              currentFact,
              null,
              "A canonical PURL identity is required for comparison.",
            ),
          ]);
        }
        if (!baselineFact.identity) {
          await baseline.take();
          await append([
            unresolved(
              null,
              baselineFact,
              "A canonical PURL identity is required for comparison.",
            ),
          ]);
        }
        continue;
      }
      const order = compareIdentity(
        currentFact.identity,
        baselineFact.identity,
      );
      if (order < 0) {
        await append(await this.singleSide(current, "added"));
      } else if (order > 0) {
        await append(await this.singleSide(baseline, "removed"));
      } else {
        await append(
          await this.matchIdentity(current, baseline, currentFact.identity),
        );
      }
    }
    await flush(true);
  }

  private async singleSide(
    reader: FactReader,
    changeType: "added" | "removed",
  ): Promise<readonly SbomDiffChangeDraft[]> {
    const fact = await reader.take();
    if (!fact) return [];
    if (!fact.identity) {
      return [
        unresolved(
          changeType === "added" ? fact : null,
          changeType === "removed" ? fact : null,
          "A canonical PURL identity is required for comparison.",
        ),
      ];
    }
    return [
      draft({
        changeType,
        current: changeType === "added" ? fact : null,
        baseline: changeType === "removed" ? fact : null,
        explanation:
          changeType === "added"
            ? "The canonical component identity is absent from the baseline."
            : "The canonical component identity is absent from the current document.",
      }),
    ];
  }

  private async matchIdentity(
    current: FactReader,
    baseline: FactReader,
    identity: string,
  ): Promise<readonly SbomDiffChangeDraft[]> {
    const maximum = this.dependencies.maximumIdentityGroup ?? 100;
    const currentGroup = await current.takeIdentity(identity, maximum);
    const baselineGroup = await baseline.takeIdentity(identity, maximum);
    if (
      currentGroup.overflow ||
      baselineGroup.overflow ||
      currentGroup.facts.length !== 1 ||
      baselineGroup.facts.length !== 1
    ) {
      return [
        draft({
          changeType: "unresolved",
          current: currentGroup.facts[0] ?? null,
          baseline: baselineGroup.facts[0] ?? null,
          explanation:
            "Multiple components share this canonical identity; the change is retained as unresolved.",
        }),
      ];
    }
    const currentFact = currentGroup.facts[0];
    const baselineFact = baselineGroup.facts[0];
    if (!currentFact || !baselineFact) {
      throw new DiffWorkerError(
        "diff_calculation_failed",
        "A matched identity did not retain both component facts.",
      );
    }
    if (currentFact.normalizedVersion === baselineFact.normalizedVersion) {
      return [
        draft({
          changeType: "unchanged",
          current: currentFact,
          baseline: baselineFact,
          explanation:
            "The canonical identity and normalized version are unchanged.",
        }),
      ];
    }
    return [
      draft({
        changeType: "unresolved",
        current: currentFact,
        baseline: baselineFact,
        explanation:
          "The version changed, but ecosystem ordering is unavailable until the M4 comparator is installed.",
      }),
    ];
  }
}

class FactReader {
  private facts: SbomDiffComponentFact[] = [];
  private nextCursor: string | undefined;
  private terminal = false;
  private lastConsumedCursor: string | undefined;

  constructor(
    private readonly input: Readonly<{
      organizationId: string;
      reportId: string;
      workerId: string;
      side: "current" | "baseline";
      queue: SbomDiffQueue;
      pageSize: number;
      cursor?: string;
    }>,
  ) {
    this.nextCursor = input.cursor;
    this.lastConsumedCursor = input.cursor;
  }

  async peek(): Promise<SbomDiffComponentFact | null> {
    await this.fill();
    return this.facts[0] ?? null;
  }

  async take(): Promise<SbomDiffComponentFact | null> {
    await this.fill();
    const fact = this.facts.shift() ?? null;
    if (fact && this.facts.length === 0)
      this.lastConsumedCursor = this.nextCursor;
    return fact;
  }

  async takeIdentity(
    identity: string,
    maximum: number,
  ): Promise<
    Readonly<{ facts: readonly SbomDiffComponentFact[]; overflow: boolean }>
  > {
    const facts: SbomDiffComponentFact[] = [];
    let overflow = false;
    while ((await this.peek())?.identity === identity) {
      const next = await this.take();
      if (!next) break;
      if (facts.length < maximum) facts.push(next);
      else overflow = true;
    }
    return Object.freeze({ facts: Object.freeze(facts), overflow });
  }

  checkpoint(): string | undefined {
    return this.lastConsumedCursor;
  }

  private async fill(): Promise<void> {
    while (this.facts.length === 0 && !this.terminal) {
      const page = await this.input.queue.readDiffFactPage(
        this.input.organizationId,
        {
          reportId: this.input.reportId,
          workerId: this.input.workerId,
          side: this.input.side,
          limit: this.input.pageSize,
          cursor: this.nextCursor,
        },
      );
      if (page.facts.length === 0 && page.nextCursor !== null) {
        throw new DiffWorkerError(
          "diff_calculation_failed",
          "The diff fact cursor advanced without component facts.",
        );
      }
      this.facts = [...page.facts];
      this.nextCursor = page.nextCursor ?? undefined;
      this.terminal = page.nextCursor === null;
      if (this.facts.length === 0) this.lastConsumedCursor = this.nextCursor;
    }
  }
}

function draft(
  input: Readonly<{
    changeType: SbomDiffChangeDraft["changeType"];
    current: SbomDiffComponentFact | null;
    baseline: SbomDiffComponentFact | null;
    explanation: string;
  }>,
): SbomDiffChangeDraft {
  const identity = input.current?.identity ?? input.baseline?.identity ?? null;
  return Object.freeze({
    changeKey: [
      input.changeType,
      input.current?.componentId ?? "-",
      input.baseline?.componentId ?? "-",
      identity ?? "unidentified",
    ].join(":"),
    changeType: input.changeType,
    identity,
    ecosystem: input.current?.ecosystem ?? input.baseline?.ecosystem ?? null,
    currentComponentId: input.current?.componentId ?? null,
    baselineComponentId: input.baseline?.componentId ?? null,
    currentVersion: input.current?.normalizedVersion ?? null,
    baselineVersion: input.baseline?.normalizedVersion ?? null,
    explanation: input.explanation,
  });
}

function unresolved(
  current: SbomDiffComponentFact | null,
  baseline: SbomDiffComponentFact | null,
  explanation: string,
): SbomDiffChangeDraft {
  return draft({ changeType: "unresolved", current, baseline, explanation });
}

class DiffWorkerError extends Error {
  constructor(
    readonly code:
      | "diff_persistence_unavailable"
      | "diff_statement_timeout"
      | "diff_calculation_failed"
      | "provider_unavailable",
    message: string,
  ) {
    super(message);
  }
}

function unique(values: readonly string[]): string[] {
  return [
    ...new Set(values.filter((value) => uuidSchema.safeParse(value).success)),
  ];
}

/** Canonical PURLs are ASCII; avoid host-locale collation in durable ordering. */
function compareIdentity(left: string, right: string): -1 | 0 | 1 {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : "unknown error";
}

function errorCodeFor(
  error: unknown,
): Extract<
  Parameters<SbomDiffQueue["failDiffReport"]>[1]["errorCode"],
  "diff_statement_timeout" | "provider_unavailable"
> {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("statement timeout") || message.includes("57014")
    ? "diff_statement_timeout"
    : "provider_unavailable";
}
