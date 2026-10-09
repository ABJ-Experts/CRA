"use client";

import {
  deriveProductClassification,
  saveProductClassificationInputSchema,
  type ProductClassification,
  type ProductClassificationAnswers,
  type ProductClassificationPolicy,
  type ProductClassificationHistoryResponse,
} from "@repo/contracts/products";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { useEffect, useRef, useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { ApiClientError } from "../../_lib/http/api-client";
import { productClassificationApi } from "./product-classification.api";
import { useProductClassificationHistory } from "./product-classification.queries";

const emptyAnswers = Object.freeze({
  scope: "undetermined",
  criticalCoreFunction: null,
  classIICoreFunction: null,
  classICoreFunction: null,
} satisfies ProductClassificationAnswers);

const answerLabels = Object.freeze({
  yes: "Yes",
  no: "No",
  undetermined: "Undetermined",
});

const classificationLabels = Object.freeze({
  default: "Default",
  important_class_i: "Important Class I",
  important_class_ii: "Important Class II",
  critical: "Critical",
  out_of_scope: "Out of scope",
  undetermined: "Undetermined",
} satisfies Record<ProductClassification, string>);

type Attempt = Readonly<{
  fingerprint: string;
  key: string;
}>;

function resolveAttempt(
  previous: Attempt | null,
  fingerprint: string,
): Attempt {
  if (previous?.fingerprint === fingerprint) return previous;
  return Object.freeze({ fingerprint, key: crypto.randomUUID() });
}

function question(
  policy: ProductClassificationPolicy,
  key: keyof ProductClassificationAnswers,
): string {
  return (
    policy.questions.find((candidate) => candidate.key === key)?.prompt ?? key
  );
}

function selectClassName(): string {
  return cn(
    "h-10 w-full rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
  );
}

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 409)
    return "This classification changed in another session. Refresh the classification revision before saving.";
  if (
    error instanceof ApiClientError &&
    (error.kind === "network" ||
      error.kind === "invalid_response" ||
      (error.status !== undefined && error.status >= 500))
  )
    return "Classification is temporarily unavailable. Your draft is preserved.";
  if (error instanceof ApiClientError && error.status === 403)
    return "You do not have permission to save this classification.";
  if (error instanceof ApiClientError && error.status === 404)
    return "This classification resource is unavailable.";
  if (error instanceof ApiClientError) return error.message;
  return "Classification could not be saved. Your draft is preserved.";
}

export function ProductClassificationPanel({
  productId,
  canEdit,
  onDirtyChange,
}: Readonly<{
  productId: string;
  canEdit: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}>) {
  const [page, setPage] = useState(1);
  const history = useProductClassificationHistory(productId, page);
  const [answers, setAnswers] =
    useState<ProductClassificationAnswers>(emptyAnswers);
  const [rationale, setRationale] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const attempt = useRef<Attempt | null>(null);
  const client = useQueryClient();
  const [base, setBase] = useState<ProductClassificationHistoryResponse | null>(
    null,
  );
  useEffect(() => {
    if (!base && history.data) setBase(history.data);
  }, [base, history.data]);

  if (history.isPending)
    return (
      <p role="status" className={cn("text-subhead-regular text-fg-muted")}>
        Loading classification…
      </p>
    );

  if (history.isError || !history.data)
    return (
      <div role="alert" className={cn("flex flex-wrap items-center gap-3")}>
        <p className={cn("text-subhead-regular text-danger")}>
          Classification could not be loaded.
        </p>
        <Button
          type="button"
          variant="outline"
          tone="grey"
          onClick={() => void history.refetch()}
        >
          Retry classification
        </Button>
      </div>
    );

  const { policy, latest, productVersion } = base ?? history.data;
  const runs = history.data.runs;
  const liveResult = deriveProductClassification(answers);
  const hasProductChangedRuns = runs.rows.some(
    (run) => run.productVersion !== history.data.productVersion,
  );

  function setScope(scope: ProductClassificationAnswers["scope"]) {
    setAnswers({
      scope,
      criticalCoreFunction: scope === "in_scope" ? "undetermined" : null,
      classIICoreFunction: null,
      classICoreFunction: null,
    });
    setMessage(null);
    onDirtyChange?.(true);
  }

  function setCritical(
    criticalCoreFunction: NonNullable<
      ProductClassificationAnswers["criticalCoreFunction"]
    >,
  ) {
    setAnswers((current) => ({
      ...current,
      criticalCoreFunction,
      classIICoreFunction:
        criticalCoreFunction === "no" ? "undetermined" : null,
      classICoreFunction: null,
    }));
    setMessage(null);
    onDirtyChange?.(true);
  }

  function setClassII(
    classIICoreFunction: NonNullable<
      ProductClassificationAnswers["classIICoreFunction"]
    >,
  ) {
    setAnswers((current) => ({
      ...current,
      classIICoreFunction,
      classICoreFunction: classIICoreFunction === "no" ? "undetermined" : null,
    }));
    setMessage(null);
    onDirtyChange?.(true);
  }

  function setClassI(
    classICoreFunction: NonNullable<
      ProductClassificationAnswers["classICoreFunction"]
    >,
  ) {
    setAnswers((current) => ({ ...current, classICoreFunction }));
    setMessage(null);
    onDirtyChange?.(true);
  }

  async function save() {
    if (conflict || saving || !canEdit) return;
    setMessage(null);
    const fingerprint = JSON.stringify([
      productId,
      productVersion,
      latest?.revision ?? 0,
      policy.version,
      policy.hash,
      answers,
      rationale.trim(),
    ]);
    attempt.current = resolveAttempt(attempt.current, fingerprint);
    if (rationale.trim().length === 0) {
      setMessage("Classification rationale is required.");
      return;
    }
    const parsed = saveProductClassificationInputSchema.safeParse({
      expectedProductVersion: productVersion,
      expectedRevision: latest?.revision ?? 0,
      policyVersion: policy.version,
      policyHash: policy.hash,
      idempotencyKey: attempt.current.key,
      answers,
      rationale,
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ??
          "Check the classification rationale.",
      );
      return;
    }
    setSaving(true);
    try {
      await productClassificationApi.save(productId, parsed.data);
      attempt.current = null;
      setMessage("Classification saved.");
      onDirtyChange?.(false);
      const refreshed = await history.refetch();
      if (refreshed.data) setBase(refreshed.data);
      await client.invalidateQueries({ queryKey: ["products"] });
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 409)
        setConflict(true);
      setMessage(messageFor(error));
    } finally {
      setSaving(false);
    }
  }

  async function refreshRevision() {
    try {
      const refreshed = await history.refetch();
      if (
        refreshed &&
        typeof refreshed === "object" &&
        "data" in refreshed &&
        refreshed.data &&
        !refreshed.isError &&
        !refreshed.error
      ) {
        setBase(refreshed.data);
        attempt.current = null;
        setConflict(false);
      }
    } catch {
      setMessage(
        "Classification is temporarily unavailable. Your draft is preserved.",
      );
    }
  }

  return (
    <section aria-label="CRA classification" className={cn("grid gap-5")}>
      <div
        className={cn("rounded-xl border border-border bg-surface-subtle p-4")}
      >
        <p className={cn("text-subhead-semibold text-fg")}>
          Customer declaration, engineering provisional
        </p>
        <p className={cn("mt-1 text-caption-1-regular text-fg-muted")}>
          This records human declarations against the referenced CRA sources. It
          does not certify conformity or qualified legal approval.
        </p>
        <p
          role="status"
          className={cn("mt-3 text-subhead-semibold text-fg")}
        >{`Provisional: ${classificationLabels[liveResult]}`}</p>
      </div>
      <p className={cn("text-caption-1-regular text-fg-muted")}>
        Policy {policy.version} · Effective{" "}
        {new Date(`${policy.effectiveDate}T00:00:00Z`).toLocaleDateString(
          undefined,
          { timeZone: "UTC" },
        )}
      </p>
      <ul className={cn("space-y-1 text-caption-1-regular")}>
        {policy.sourceRefs.map((source) => (
          <li key={source.url}>
            <a
              className={cn("underline text-fg focus-visible:outline")}
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {source.title}
            </a>
          </li>
        ))}
      </ul>
      <p className={cn("text-subhead-semibold text-fg")}>
        Latest:{" "}
        {history.data.latest
          ? `Provisional: ${classificationLabels[history.data.latest.classification]}`
          : "Not classified"}
      </p>
      <div className={cn("grid gap-4")}>
        <label className={cn("grid gap-2 text-caption-1-regular text-fg")}>
          {question(policy, "scope")}
          <select
            value={answers.scope}
            onChange={(event) =>
              setScope(
                event.target.value as ProductClassificationAnswers["scope"],
              )
            }
            className={selectClassName()}
            disabled={!canEdit || saving}
          >
            <option value="undetermined">Undetermined</option>
            <option value="in_scope">In scope</option>
            <option value="out_of_scope">Out of scope</option>
          </select>
        </label>
        {answers.scope === "in_scope" ? (
          <label className={cn("grid gap-2 text-caption-1-regular text-fg")}>
            {question(policy, "criticalCoreFunction")}
            <select
              value={answers.criticalCoreFunction ?? "undetermined"}
              onChange={(event) =>
                setCritical(
                  event.target.value as NonNullable<
                    ProductClassificationAnswers["criticalCoreFunction"]
                  >,
                )
              }
              className={selectClassName()}
              disabled={!canEdit || saving}
            >
              {Object.entries(answerLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {answers.scope === "in_scope" &&
        answers.criticalCoreFunction === "no" ? (
          <label className={cn("grid gap-2 text-caption-1-regular text-fg")}>
            {question(policy, "classIICoreFunction")}
            <select
              value={answers.classIICoreFunction ?? "undetermined"}
              onChange={(event) =>
                setClassII(
                  event.target.value as NonNullable<
                    ProductClassificationAnswers["classIICoreFunction"]
                  >,
                )
              }
              className={selectClassName()}
              disabled={!canEdit || saving}
            >
              {Object.entries(answerLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {answers.scope === "in_scope" &&
        answers.criticalCoreFunction === "no" &&
        answers.classIICoreFunction === "no" ? (
          <label className={cn("grid gap-2 text-caption-1-regular text-fg")}>
            {question(policy, "classICoreFunction")}
            <select
              value={answers.classICoreFunction ?? "undetermined"}
              onChange={(event) =>
                setClassI(
                  event.target.value as NonNullable<
                    ProductClassificationAnswers["classICoreFunction"]
                  >,
                )
              }
              className={selectClassName()}
              disabled={!canEdit || saving}
            >
              {Object.entries(answerLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className={cn("grid gap-2 text-caption-1-regular text-fg")}>
          Classification rationale
          <textarea
            maxLength={4000}
            value={rationale}
            onChange={(event) => {
              setRationale(event.target.value);
              setMessage(null);
              onDirtyChange?.(true);
            }}
            className={cn(
              "min-h-24 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            )}
            disabled={!canEdit || saving}
          />
        </label>
      </div>
      {message ? (
        <p
          role={message === "Classification saved." ? "status" : "alert"}
          className={cn(
            "text-subhead-regular",
            message === "Classification saved."
              ? "text-fg-muted"
              : "text-danger",
          )}
        >
          {message}
        </p>
      ) : null}
      {canEdit ? (
        <div className={cn("flex flex-wrap gap-3")}>
          <Button
            type="button"
            onClick={() => void save()}
            loading={saving}
            loadingLabel="Saving classification"
            disabled={conflict || saving}
          >
            Save classification
          </Button>
          {conflict ? (
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void refreshRevision()}
            >
              Refresh classification revision
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className={cn("grid gap-3 border-t border-border pt-5")}>
        <h3 className={cn("text-subhead-semibold text-fg")}>
          Classification history
        </h3>
        {hasProductChangedRuns ? (
          <p className={cn("text-caption-1-regular text-warning")}>
            Product changed since this run.
          </p>
        ) : null}
        {runs.rows.length === 0 ? (
          <p className={cn("text-subhead-regular text-fg-muted")}>
            No classification runs recorded.
          </p>
        ) : (
          <ul className={cn("grid gap-3")} aria-label="Classification runs">
            {runs.rows.map((run) => (
              <li
                key={run.id}
                className={cn("rounded-xl border border-border bg-canvas p-4")}
              >
                <p className={cn("text-subhead-semibold text-fg")}>
                  Provisional: {classificationLabels[run.classification]} ·{" "}
                  {run.id === history.data.latest?.id ? "Latest" : "Superseded"}
                </p>
                <p className={cn("mt-1 text-caption-1-regular text-fg-muted")}>
                  Revision {run.revision} · Engineering provisional · Policy{" "}
                  {run.policySnapshot.version} ·{" "}
                  {new Date(run.createdAt).toLocaleString(undefined, {
                    timeZone: "UTC",
                  })}{" "}
                  UTC
                </p>
                <p
                  className={cn(
                    "mt-2 break-words text-caption-1-regular text-fg",
                  )}
                >
                  {run.rationale}
                </p>
                <dl
                  className={cn(
                    "mt-3 grid gap-3 text-caption-1-regular text-fg",
                  )}
                  aria-label={`Saved answers, revision ${run.revision}`}
                >
                  {run.policySnapshot.questions.map((savedQuestion) => {
                    const answer = run.answers[savedQuestion.key];
                    const label =
                      answer === null
                        ? "Skipped"
                        : savedQuestion.key === "scope"
                          ? {
                              in_scope: "In scope",
                              out_of_scope: "Out of scope",
                              undetermined: "Undetermined",
                            }[run.answers.scope]
                          : answerLabels[answer as keyof typeof answerLabels];
                    return (
                      <div
                        key={savedQuestion.key}
                        className={cn("min-w-0 space-y-1")}
                      >
                        <dt className={cn("break-words text-fg-muted")}>
                          {savedQuestion.prompt}
                        </dt>
                        <dd className={cn("text-caption-1-semibold text-fg")}>
                          {label}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </li>
            ))}
          </ul>
        )}
        {runs.pageCount > 1 ? (
          <div className={cn("flex flex-wrap gap-2")}>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous classification runs
            </Button>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              disabled={page >= runs.pageCount}
              onClick={() =>
                setPage((current) => Math.min(runs.pageCount, current + 1))
              }
            >
              Next classification runs
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
