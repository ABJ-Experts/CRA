"use client";

import {
  SUPPLIER_DOCUMENT_BULK_CONFIDENCE_THRESHOLD,
  createManualSupplierDocumentFieldInputSchema,
  decideSupplierDocumentFieldInputSchema,
  startSupplierDocumentExtractionInputSchema,
  supplierDocumentFieldKeySchema,
  type SupplierDocumentSuggestion,
  type SupplierEvidenceInternalSubmission,
} from "@repo/contracts/supplier-evidence";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { useRef, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { evidenceApi } from "../evidence/evidence.api";
import {
  useCreateManualSupplierDocumentFieldMutation,
  useDecideSupplierDocumentFieldMutation,
  useStartSupplierDocumentExtractionMutation,
  useSupplierDocumentExtractionQuery,
} from "./supplier-evidence.queries";

type Props = Readonly<{
  requestId: string;
  requestVersion: number;
  productId: string;
  submission: SupplierEvidenceInternalSubmission;
}>;

function fieldLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to review fields. Your edits are still here.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This document or field changed. Reload the suggestions before retrying; your edits are still here.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "You are offline. Your edits are still here to retry.";
  return error instanceof ApiClientError
    ? error.message
    : "The field action could not be completed. Try again.";
}

/** JS strings use UTF-16, whereas persisted OCR spans index Unicode code points. */
function citedText(
  text: string,
  span: Readonly<{ startOffset: number; endOffset: number; quote: string }>,
) {
  const points = Array.from(text);
  const match = points.slice(span.startOffset, span.endOffset).join("");
  if (match !== span.quote) return null;
  return {
    before: points.slice(0, span.startOffset).join(""),
    match,
    after: points.slice(span.endOffset).join(""),
  };
}

export function SupplierDocumentExtractionPanel({
  requestId,
  requestVersion,
  productId,
  submission,
}: Props) {
  const extraction = useSupplierDocumentExtractionQuery(
    requestId,
    submission.id,
    productId,
    true,
  );
  const start = useStartSupplierDocumentExtractionMutation(
    requestId,
    submission.id,
    productId,
  );
  const decide = useDecideSupplierDocumentFieldMutation(
    requestId,
    submission.id,
    productId,
  );
  const manual = useCreateManualSupplierDocumentFieldMutation(
    requestId,
    submission.id,
    productId,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [manualKey, setManualKey] =
    useState<(typeof supplierDocumentFieldKeySchema.options)[number]>(
      "certification_held",
    );
  const [manualValue, setManualValue] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const keys = useRef<Record<string, string>>({});

  const firstPage = extraction.data?.pages[0];
  const run = firstPage?.run;
  const sourceCurrent =
    !run ||
    (run.evidenceVersionId === submission.evidenceVersionId &&
      run.evidenceSha256 === submission.sha256);
  const fields =
    extraction.data?.pages.flatMap((page) => page.suggestions) ?? [];
  const selected = fields.find((field) => field.id === selectedId);
  const selectedPage =
    selected?.origin === "ai"
      ? firstPage?.pages.find((page) => page.page === selected.sourceSpan.page)
      : undefined;
  const highlighted =
    selected?.origin === "ai" && selectedPage
      ? citedText(selectedPage.text, selected.sourceSpan)
      : null;

  function pin() {
    return {
      productId,
      expectedRequestVersion: requestVersion,
      expectedSubmissionUpdatedAt: submission.updatedAt,
      expectedEvidenceVersionId: submission.evidenceVersionId,
      expectedSha256: submission.sha256,
    };
  }

  function keyFor(action: string) {
    const existing = keys.current[action];
    if (existing) return existing;
    const next = crypto.randomUUID();
    keys.current = { ...keys.current, [action]: next };
    return next;
  }

  async function startRun() {
    setMessage(null);
    try {
      await start.mutateAsync(
        startSupplierDocumentExtractionInputSchema.parse({
          ...pin(),
          idempotencyKey: keyFor(`start:${run?.id ?? "initial"}`),
        }),
      );
      setMessage("Extraction queued. Manual field entry remains available.");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function showSource(field: SupplierDocumentSuggestion) {
    setSelectedId(field.id);
    setPdfUrl(null);
    setMessage(null);
    if (field.origin !== "ai" || submission.mediaType !== "application/pdf")
      return;
    try {
      const response = await evidenceApi.access(
        productId,
        submission.evidenceDocumentId,
        submission.evidenceVersionId,
        { disposition: "inline", purpose: "supplier field source review" },
      );
      if (
        response.access.previewSupported &&
        response.access.mediaType === "application/pdf"
      ) {
        const url = new URL(
          response.access.deliveryUrl,
          window.location.origin,
        );
        url.hash = `page=${field.sourceSpan.page}`;
        setPdfUrl(url.toString());
      } else {
        setPdfUrl(null);
      }
    } catch (error) {
      setPdfUrl(null);
      setMessage(errorMessage(error));
    }
  }

  async function decideField(
    field: SupplierDocumentSuggestion,
    decision: "confirm" | "reject",
  ) {
    if (
      field.origin !== "ai" ||
      field.status !== "pending" ||
      (decision === "confirm" &&
        field.confidence < SUPPLIER_DOCUMENT_BULK_CONFIDENCE_THRESHOLD)
    )
      return;
    const correctedValue = (values[field.id] ?? field.originalValue).trim();
    const action = `${field.id}:${field.version}:${decision}:${correctedValue}`;
    setMessage(null);
    try {
      await decide.mutateAsync({
        fieldId: field.id,
        input: decideSupplierDocumentFieldInputSchema.parse({
          ...pin(),
          expectedFieldVersion: field.version,
          decision,
          correctedValue: decision === "confirm" ? correctedValue : undefined,
          idempotencyKey: keyFor(action),
        }),
      });
      setMessage(
        decision === "confirm"
          ? "Field confirmed and recorded."
          : "Suggestion rejected; source document unchanged.",
      );
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function createManual() {
    const trimmed = manualValue.trim();
    const action = `manual:${manualKey}:${trimmed}`;
    setMessage(null);
    try {
      await manual.mutateAsync(
        createManualSupplierDocumentFieldInputSchema.parse({
          ...pin(),
          fieldKey: manualKey,
          value: trimmed,
          idempotencyKey: keyFor(action),
        }),
      );
      setManualValue("");
      setMessage("Manual field recorded without an AI citation.");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  return (
    <section
      className="mt-5 min-w-0 border-t border-border pt-4"
      aria-label={`Document fields for ${submission.fileName}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-subhead-semibold text-fg">Document fields</h4>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            Suggestions need a separate decision for each field. They do not
            validate certificates or accept evidence.
          </p>
        </div>
        {!run ||
        run.status === "failed" ||
        run.status === "refused" ||
        !sourceCurrent ? (
          <Button
            type="button"
            variant="outline"
            tone="grey"
            disabled={
              start.isPending || extraction.isLoading || extraction.isError
            }
            onClick={() => void startRun()}
          >
            {start.isPending
              ? "Starting extraction…"
              : run
                ? "Retry suggestions"
                : "Suggest fields"}
          </Button>
        ) : null}
      </div>

      {extraction.isLoading ? (
        <p role="status" className="mt-3 text-caption-1-regular text-fg-muted">
          Loading document fields…
        </p>
      ) : null}
      {extraction.isError ? (
        <div className="mt-3 grid gap-2">
          <p role="alert" className="text-caption-1-regular text-danger">
            Suggestions are unavailable. Manual review remains available.
          </p>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            onClick={() => void extraction.refetch()}
          >
            Retry loading
          </Button>
        </div>
      ) : null}
      {run ? (
        <dl className="mt-3 grid gap-2 text-caption-1-regular text-fg sm:grid-cols-2">
          <div>
            <dt className="text-fg-muted">Extraction</dt>
            <dd>{fieldLabel(run.status)}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Model / prompt</dt>
            <dd>
              {run.model} · {run.promptVersion}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-fg-muted">Extraction run</dt>
            <dd className="break-all">{run.id}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-fg-muted">Pinned evidence version / SHA-256</dt>
            <dd className="break-all">
              {run.evidenceVersionId} · {run.evidenceSha256}
            </dd>
          </div>
        </dl>
      ) : null}
      {!sourceCurrent ? (
        <p role="alert" className="mt-3 text-caption-1-regular text-danger">
          This extraction belongs to an older evidence version. You can start a
          new run or enter current fields manually; older suggestions cannot be
          confirmed.
        </p>
      ) : null}
      {run?.status === "failed" || run?.status === "refused" ? (
        <p role="status" className="mt-3 text-caption-1-regular text-fg">
          Extraction could not finish. Review and enter fields manually.
        </p>
      ) : null}
      {run?.status === "pending" || run?.status === "processing" ? (
        <p role="status" className="mt-3 text-caption-1-regular text-fg">
          Extraction is in progress. Manual review is available now.
        </p>
      ) : null}
      {run?.status === "completed" && fields.length === 0 ? (
        <p className="mt-3 text-caption-1-regular text-fg">
          No supported fields were found. Nothing was inferred without a source
          passage.
        </p>
      ) : null}

      {fields.length > 0 ? (
        <div className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <ul
            className="grid min-w-0 content-start gap-3"
            aria-label="Document field suggestions"
          >
            {fields.map((field) => (
              <li
                key={field.id}
                className={cn(
                  "min-w-0 rounded-xl border border-border bg-canvas p-3",
                  selectedId === field.id && "border-active-500",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-caption-1-semibold text-fg">
                      {fieldLabel(field.fieldKey)}
                    </p>
                    <p className="mt-1 break-words text-subhead-regular text-fg">
                      {field.origin === "ai"
                        ? field.originalValue
                        : field.correctedValue}
                    </p>
                    {field.origin === "ai" ? (
                      <p
                        className={cn(
                          "mt-1 break-words text-caption-1-regular text-fg",
                          field.confidence <
                            SUPPLIER_DOCUMENT_BULK_CONFIDENCE_THRESHOLD &&
                            "rounded bg-warning-surface px-1 text-warning-fg",
                        )}
                      >
                        {Math.round(field.confidence * 100)}% confidence ·{" "}
                        {field.candidateGroup} · page {field.sourceSpan.page},
                        characters {field.sourceSpan.startOffset}–
                        {field.sourceSpan.endOffset}
                        {field.confidence <
                        SUPPLIER_DOCUMENT_BULK_CONFIDENCE_THRESHOLD
                          ? " · Low confidence"
                          : ""}
                      </p>
                    ) : (
                      <p className="mt-1 text-caption-1-regular text-fg">
                        Manual entry · no AI citation
                      </p>
                    )}
                    <p className="mt-1 break-all text-caption-1-regular text-fg-muted">
                      Evidence {field.evidenceVersionId} · SHA-256{" "}
                      {field.evidenceSha256}
                    </p>
                    {field.origin === "ai" ? (
                      <p className="mt-1 break-all text-caption-1-regular text-fg-muted">
                        Run {field.runId} · {field.model} ·{" "}
                        {field.promptVersion}
                      </p>
                    ) : null}
                    {field.evidenceVersionId !== submission.evidenceVersionId ||
                    field.evidenceSha256 !== submission.sha256 ? (
                      <p className="mt-1 text-caption-1-semibold text-danger">
                        Older evidence version; confirmation unavailable.
                      </p>
                    ) : null}
                  </div>
                  <span className="text-caption-1-semibold text-fg">
                    {fieldLabel(field.status)}
                  </span>
                </div>
                {field.origin === "ai" ? (
                  <div className="mt-3 grid gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      tone="grey"
                      className="h-auto min-h-10 max-w-full min-w-0 whitespace-normal py-2 text-center"
                      onClick={() => void showSource(field)}
                    >
                      View source for {field.originalValue}
                    </Button>
                    {field.status === "pending" ? (
                      <>
                        <label className="grid gap-1 text-caption-1-semibold text-fg">
                          Confirmed value for {fieldLabel(field.fieldKey)}
                          <input
                            value={values[field.id] ?? field.originalValue}
                            maxLength={2000}
                            onChange={(event) =>
                              setValues((current) => ({
                                ...current,
                                [field.id]: event.target.value,
                              }))
                            }
                            className="h-10 w-full min-w-0 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            disabled={
                              decide.isPending ||
                              !(
                                values[field.id] ?? field.originalValue
                              ).trim() ||
                              selectedId !== field.id ||
                              !highlighted ||
                              field.confidence <
                                SUPPLIER_DOCUMENT_BULK_CONFIDENCE_THRESHOLD ||
                              field.evidenceVersionId !==
                                submission.evidenceVersionId ||
                              field.evidenceSha256 !== submission.sha256
                            }
                            onClick={() => void decideField(field, "confirm")}
                          >
                            Confirm field
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            tone="grey"
                            disabled={decide.isPending}
                            onClick={() => void decideField(field, "reject")}
                          >
                            Reject suggestion
                          </Button>
                        </div>
                      </>
                    ) : null}
                    {field.correctedValue ? (
                      <p className="text-caption-1-regular text-fg">
                        Recorded value: {field.correctedValue}
                      </p>
                    ) : null}
                    {field.reviewedByUserId && field.reviewedAt ? (
                      <p className="text-caption-1-regular text-fg-muted">
                        Decision by {field.reviewedByUserId} on{" "}
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(field.reviewedAt))}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {selected?.origin === "ai" ? (
            <div
              className="min-w-0 rounded-xl border border-border bg-canvas p-3"
              aria-label="Source passage and verified document"
            >
              <h5 className="text-subhead-semibold text-fg">
                Source · page {selected.sourceSpan.page}
              </h5>
              {highlighted ? (
                <p
                  className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-caption-1-regular text-fg"
                  aria-label="Highlighted extracted passage"
                >
                  {highlighted.before}
                  <mark className="bg-warning-surface text-warning-fg">
                    {highlighted.match}
                  </mark>
                  {highlighted.after}
                </p>
              ) : (
                <p
                  role="alert"
                  className="mt-2 text-caption-1-regular text-danger"
                >
                  The cited passage is unavailable. Do not confirm this
                  suggestion.
                </p>
              )}
              {pdfUrl ? (
                <iframe
                  title={`Verified ${submission.fileName}, page ${selected.sourceSpan.page}`}
                  src={pdfUrl}
                  sandbox="allow-same-origin"
                  referrerPolicy="no-referrer"
                  className="mt-3 h-[32rem] w-full rounded-lg border border-border bg-canvas"
                />
              ) : (
                <p className="mt-3 text-caption-1-regular text-fg-muted">
                  Verified inline PDF preview is unavailable. The extracted
                  passage is shown above.
                </p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      {extraction.hasNextPage ? (
        <div className="mt-4">
          <Button
            type="button"
            variant="outline"
            tone="grey"
            disabled={extraction.isFetchingNextPage}
            onClick={() => void extraction.fetchNextPage()}
          >
            {extraction.isFetchingNextPage
              ? "Loading older fields…"
              : "Load older fields"}
          </Button>
          {extraction.isFetchNextPageError ? (
            <p role="alert" className="mt-2 text-caption-1-regular text-danger">
              Older fields could not be loaded. Your edits are still here; retry
              this page.
            </p>
          ) : null}
        </div>
      ) : null}

      <form
        className="mt-5 grid gap-3 border-t border-border pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void createManual();
        }}
      >
        <h5 className="text-subhead-semibold text-fg">
          Enter a field manually
        </h5>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          <label className="grid gap-1 text-caption-1-semibold text-fg">
            Field
            <select
              value={manualKey}
              onChange={(event) =>
                setManualKey(event.target.value as typeof manualKey)
              }
              className="h-10 w-full min-w-0 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {supplierDocumentFieldKeySchema.options.map((key) => (
                <option key={key} value={key}>
                  {fieldLabel(key)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-caption-1-semibold text-fg">
            Value
            <input
              value={manualValue}
              maxLength={2000}
              onChange={(event) => setManualValue(event.target.value)}
              className="h-10 w-full min-w-0 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            />
          </label>
        </div>
        <div>
          <Button
            type="submit"
            variant="outline"
            tone="grey"
            disabled={!manualValue.trim() || manual.isPending}
          >
            {manual.isPending ? "Recording…" : "Record manual field"}
          </Button>
        </div>
      </form>
      {message ? (
        <p role="status" className="mt-3 text-caption-1-regular text-fg">
          {message}
        </p>
      ) : null}
    </section>
  );
}
