"use client";

import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";
import { frameworksApi } from "./frameworks.api";

type Choice = Readonly<{
  action: "map" | "leave_gap";
  targetRequirementKeys: readonly string[];
}>;

export interface FrameworkUpgradePanelProps {
  readonly organizationId: string;
  readonly packKey: string;
  readonly sourceVersionKey: string;
  readonly targetVersionKey: string;
  readonly canManage: boolean;
  readonly canViewProducts: boolean;
  readonly canViewEvidence: boolean;
  readonly onCommitted: () => void;
}

function failureMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 409)
      return "The selection, control, or mappings changed. Refresh the preview and review every decision again. Your draft choices remain visible.";
    if (error.status === 403)
      return "Your permission to review this upgrade has changed. Your draft choices remain visible.";
    if (error.kind === "network")
      return "The server is unreachable. Your draft choices remain visible; retry when online.";
    if (error.kind === "invalid_request" || error.status === 400)
      return "Check every mapping decision and retry. Your draft choices remain visible.";
    return error.message;
  }
  return "The upgrade could not be completed. Your draft choices remain visible; retry.";
}

export function FrameworkUpgradePanel({
  organizationId,
  packKey,
  sourceVersionKey,
  targetVersionKey,
  canManage,
  canViewProducts,
  canViewEvidence,
  onCommitted,
}: FrameworkUpgradePanelProps) {
  const client = useQueryClient();
  const [choices, setChoices] = useState<Readonly<Record<string, Choice>>>({});
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const review = useRef<{ id: string; revision: number } | null>(null);
  const createKey = useRef(crypto.randomUUID());
  const decisionKeys = useRef(
    new Map<string, { signature: string; key: string }>(),
  );
  const commitKey = useRef(crypto.randomUUID());
  const previewKey = [
    "framework-upgrade",
    organizationId,
    packKey,
    sourceVersionKey,
    targetVersionKey,
  ] as const;
  const preview = useInfiniteQuery({
    queryKey: previewKey,
    enabled: canManage && canViewProducts && canViewEvidence,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      frameworksApi.upgradePreview(
        packKey,
        targetVersionKey,
        pageParam,
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const targetTree = useInfiniteQuery({
    queryKey: [
      "framework-upgrade-target",
      organizationId,
      packKey,
      targetVersionKey,
    ],
    enabled: canManage && canViewProducts && canViewEvidence,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      frameworksApi.tree(packKey, targetVersionKey, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const pages = useMemo(() => preview.data?.pages ?? [], [preview.data]);
  const baseline = pages[0];
  const impacts = useMemo(() => pages.flatMap((page) => page.impacts), [pages]);
  const requirements = useMemo(
    () => targetTree.data?.pages.flatMap((page) => page.requirements) ?? [],
    [targetTree.data],
  );
  const consistent =
    baseline !== undefined &&
    pages.every(
      (page) =>
        page.fingerprint === baseline.fingerprint &&
        page.selectionRevision === baseline.selectionRevision &&
        page.sourceHash === baseline.sourceHash &&
        page.targetHash === baseline.targetHash &&
        page.sourceVersionKey === sourceVersionKey &&
        page.targetVersionKey === targetVersionKey,
    );
  const complete =
    baseline !== undefined &&
    consistent &&
    !preview.hasNextPage &&
    impacts.length === baseline.totalImpacts;
  const allDecided =
    complete &&
    !targetTree.isError &&
    !targetTree.isLoading &&
    impacts.every((impact) => {
      const choice = choices[impact.mappingId];
      return (
        acknowledged.has(impact.mappingId) &&
        choice &&
        (choice.action === "leave_gap" ||
          choice.targetRequirementKeys.length > 0)
      );
    });

  function choose(mappingId: string, choice: Choice) {
    setChoices((current) => ({ ...current, [mappingId]: choice }));
    setAcknowledged((current) => new Set(current).add(mappingId));
    decisionKeys.current.delete(mappingId);
    setError(null);
  }

  async function refresh() {
    review.current = null;
    createKey.current = crypto.randomUUID();
    decisionKeys.current.clear();
    commitKey.current = crypto.randomUUID();
    setStale(false);
    setAcknowledged(new Set());
    setError(null);
    await client.resetQueries({ queryKey: previewKey, exact: true });
  }

  async function commit() {
    if (!baseline || !allDecided || stale || !canManage || saving) return;
    setSaving(true);
    setError(null);
    try {
      const recorded = new Map<string, Choice>();
      if (!review.current) {
        const created = await frameworksApi.createUpgradeReview(packKey, {
          targetVersionKey,
          expectedSelectionRevision: baseline.selectionRevision,
          idempotencyKey: createKey.current,
        });
        review.current = { id: created.reviewId, revision: created.revision };
      } else {
        let cursor: string | undefined;
        do {
          const current = await frameworksApi.upgradeReview(
            packKey,
            review.current.id,
            cursor,
          );
          if (current.status === "committed") {
            onCommitted();
            return;
          }
          review.current = { ...review.current, revision: current.revision };
          for (const decision of current.decisions) {
            recorded.set(decision.mappingId, {
              action: decision.action,
              targetRequirementKeys: decision.targetRequirementKeys,
            });
          }
          cursor = current.nextCursor ?? undefined;
        } while (cursor);
      }
      for (const impact of impacts) {
        const choice = choices[impact.mappingId]!;
        const existing = recorded.get(impact.mappingId);
        if (
          existing?.action === choice.action &&
          JSON.stringify([...existing.targetRequirementKeys].sort()) ===
            JSON.stringify([...choice.targetRequirementKeys].sort())
        )
          continue;
        const signature = JSON.stringify([impact.mappingId, choice]);
        let retry = decisionKeys.current.get(impact.mappingId);
        if (!retry || retry.signature !== signature) {
          retry = { signature, key: crypto.randomUUID() };
          decisionKeys.current.set(impact.mappingId, retry);
        }
        const updated = await frameworksApi.upgradeDecision(
          packKey,
          review.current.id,
          impact.mappingId,
          {
            action: choice.action,
            targetRequirementKeys: [...choice.targetRequirementKeys],
            expectedReviewRevision: review.current.revision,
            idempotencyKey: retry.key,
          },
        );
        review.current = { ...review.current, revision: updated.revision };
      }
      await frameworksApi.commitUpgrade(packKey, review.current.id, {
        expectedReviewRevision: review.current.revision,
        idempotencyKey: commitKey.current,
      });
      void client.invalidateQueries({
        queryKey: ["framework-controls", organizationId],
      });
      void client.invalidateQueries({
        queryKey: ["framework-coverage", organizationId],
      });
      onCommitted();
    } catch (caught) {
      setError(failureMessage(caught));
      if (caught instanceof ApiClientError && caught.status === 409)
        setStale(true);
    } finally {
      setSaving(false);
    }
  }

  if (!canManage || !canViewProducts || !canViewEvidence)
    return (
      <SectionCard title="Upgrade access restricted">
        <p className={cn("text-subhead-regular text-fg-muted")}>
          Framework management, product visibility, and evidence visibility are
          required to review migration effects.
        </p>
      </SectionCard>
    );

  return (
    <SectionCard title="Review framework upgrade">
      <p className={cn("mb-4 text-subhead-regular text-fg-muted")}>
        {sourceVersionKey} → {targetVersionKey}. Curated suggestions need your
        decision. An upgrade does not certify compliance.
      </p>
      {preview.isLoading || targetTree.isLoading ? (
        <p role="status" className={cn("text-subhead-regular text-fg-muted")}>
          Loading upgrade diff and target requirements…
        </p>
      ) : null}
      {preview.isError || targetTree.isError ? (
        <div className={cn("grid gap-3")}>
          <p role="alert" className={cn("text-subhead-regular text-danger")}>
            The upgrade preview is unavailable. The current edition remains
            selected.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void preview.refetch();
              void targetTree.refetch();
            }}
          >
            Retry preview
          </Button>
        </div>
      ) : null}
      {baseline ? (
        <>
          <dl
            className={cn(
              "mb-5 grid gap-2 text-caption-1-regular text-fg sm:grid-cols-2 lg:grid-cols-5",
            )}
          >
            {(["added", "removed", "changed", "split", "merged"] as const).map(
              (kind) => (
                <div
                  key={kind}
                  className={cn("rounded-xl bg-surface-muted px-3 py-2")}
                >
                  <dt className={cn("capitalize text-fg-muted")}>{kind}</dt>
                  <dd>{baseline.diff[kind].length}</dd>
                </div>
              ),
            )}
          </dl>
          {(["added", "removed", "changed", "split", "merged"] as const).map(
            (kind) =>
              baseline.diff[kind].length > 0 ? (
                <p
                  key={kind}
                  className={cn(
                    "mb-2 break-words text-caption-1-regular text-fg",
                  )}
                >
                  <strong className={cn("capitalize")}>{kind}:</strong>{" "}
                  {baseline.diff[kind].join(", ")}
                </p>
              ) : null,
          )}
          {!consistent ? (
            <p
              role="alert"
              className={cn("mb-3 text-subhead-regular text-danger")}
            >
              Preview pages disagree. Refresh before continuing.
            </p>
          ) : null}
          <p className={cn("my-4 text-subhead-regular text-fg")}>
            Review {impacts.length} of {baseline.totalImpacts} affected
            mappings.
          </p>
          {impacts.length === 0 ? (
            <p className={cn("text-subhead-regular text-fg-muted")}>
              No active control mappings require migration. You can commit the
              version choice after reviewing the diff.
            </p>
          ) : null}
          <ol className={cn("divide-y divide-border border-y border-border")}>
            {impacts.map((impact) => {
              const choice = choices[impact.mappingId];
              return (
                <li key={impact.mappingId} className={cn("grid gap-3 py-4")}>
                  <div
                    className={cn(
                      "flex flex-wrap items-baseline justify-between gap-2 text-subhead-regular text-fg",
                    )}
                  >
                    <strong>{impact.sourceRequirementKey}</strong>
                    <span
                      className={cn("text-caption-1-regular text-fg-muted")}
                    >
                      Control {impact.controlId.slice(0, 8)} ·{" "}
                      {impact.productIds.length} product scopes ·{" "}
                      {impact.evidenceVersionIds.length} evidence versions
                    </span>
                  </div>
                  <p className={cn("text-caption-1-regular text-fg-muted")}>
                    Suggested successors:{" "}
                    {impact.suggestedTargetKeys.length
                      ? impact.suggestedTargetKeys.join(", ")
                      : "None"}
                    . Suggestions are not equivalence claims.
                  </p>
                  <details className={cn("text-caption-1-regular text-fg")}>
                    <summary
                      className={cn(
                        "cursor-pointer rounded-lg py-1 focus-visible:outline-2 focus-visible:outline-active-500",
                      )}
                    >
                      View control, product scopes, and evidence versions
                    </summary>
                    <div
                      className={cn("mt-2 grid gap-2 break-all text-fg-muted")}
                    >
                      <p>Mapping {impact.mappingId}</p>
                      <Link
                        href={`/frameworks?controlId=${encodeURIComponent(impact.controlId)}`}
                        className={cn(
                          "w-fit text-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-active-500",
                        )}
                      >
                        Open control {impact.controlId}
                      </Link>
                      <p>
                        Product scope IDs:{" "}
                        {impact.productIds.length
                          ? impact.productIds.join(", ")
                          : "None listed"}
                      </p>
                      <p>
                        Evidence versions:{" "}
                        {impact.evidenceVersionIds.length
                          ? impact.evidenceVersionIds.join(", ")
                          : "None linked"}
                      </p>
                    </div>
                  </details>
                  <fieldset className={cn("grid gap-2")}>
                    <legend className={cn("text-caption-1-semibold text-fg")}>
                      Decision for mapping {impact.mappingId.slice(0, 8)}
                    </legend>
                    <label
                      className={cn(
                        "flex items-center gap-2 text-subhead-regular text-fg",
                      )}
                    >
                      <input
                        type="radio"
                        name={`action-${impact.mappingId}`}
                        checked={choice?.action === "map"}
                        onChange={() =>
                          choose(impact.mappingId, {
                            action: "map",
                            targetRequirementKeys:
                              choice?.targetRequirementKeys ?? [],
                          })
                        }
                      />{" "}
                      Map to selected target requirements
                    </label>
                    {choice?.action === "map" ? (
                      <div
                        className={cn(
                          "max-h-52 overflow-y-auto rounded-xl border border-border p-3",
                        )}
                      >
                        {requirements.map((requirement) => (
                          <label
                            key={requirement.requirementKey}
                            className={cn(
                              "flex gap-2 py-1 text-caption-1-regular text-fg",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={choice.targetRequirementKeys.includes(
                                requirement.requirementKey,
                              )}
                              onChange={(event) =>
                                choose(impact.mappingId, {
                                  action: "map",
                                  targetRequirementKeys: event.target.checked
                                    ? [
                                        ...choice.targetRequirementKeys,
                                        requirement.requirementKey,
                                      ]
                                    : choice.targetRequirementKeys.filter(
                                        (key) =>
                                          key !== requirement.requirementKey,
                                      ),
                                })
                              }
                            />
                            <span>
                              {requirement.identifier} —{" "}
                              {requirement.heading ??
                                requirement.requirementKey}
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : null}
                    <label
                      className={cn(
                        "flex items-center gap-2 text-subhead-regular text-fg",
                      )}
                    >
                      <input
                        type="radio"
                        name={`action-${impact.mappingId}`}
                        checked={choice?.action === "leave_gap"}
                        onChange={() =>
                          choose(impact.mappingId, {
                            action: "leave_gap",
                            targetRequirementKeys: [],
                          })
                        }
                      />{" "}
                      Leave a visible gap
                    </label>
                  </fieldset>
                  {choice && !acknowledged.has(impact.mappingId) ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setAcknowledged((current) =>
                          new Set(current).add(impact.mappingId),
                        )
                      }
                    >
                      Confirm refreshed decision
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {preview.hasNextPage ? (
            <Button
              type="button"
              variant="outline"
              className={cn("mt-4")}
              disabled={preview.isFetchingNextPage}
              onClick={() => void preview.fetchNextPage()}
            >
              Load more affected mappings
            </Button>
          ) : null}
          {targetTree.hasNextPage ? (
            <Button
              type="button"
              variant="outline"
              className={cn("mt-4 ml-2")}
              disabled={targetTree.isFetchingNextPage}
              onClick={() => void targetTree.fetchNextPage()}
            >
              Load more target requirements
            </Button>
          ) : null}
          {error ? (
            <p
              role="alert"
              className={cn("mt-4 text-subhead-regular text-danger")}
            >
              {error}
            </p>
          ) : null}
          {stale || !consistent ? (
            <Button
              type="button"
              variant="outline"
              className={cn("mt-4")}
              onClick={() => void refresh()}
            >
              Refresh preview
            </Button>
          ) : null}
          <div className={cn("mt-5 flex flex-wrap items-center gap-3")}>
            <Button
              type="button"
              disabled={!allDecided || stale || saving || !consistent}
              loading={saving}
              onClick={() => void commit()}
            >
              Commit upgrade
            </Button>
            {!allDecided ? (
              <p className={cn("text-caption-1-regular text-fg-muted")}>
                Load every impact and choose a successor or gap for each
                mapping.
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </SectionCard>
  );
}
