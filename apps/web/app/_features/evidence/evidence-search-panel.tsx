"use client";

import {
  evidenceDocumentClassSchema,
  evidenceSearchQuerySchema,
  type EvidenceDocumentVersion,
  type EvidenceSearchQuery,
  type EvidenceSearchResult,
} from "@repo/contracts/evidence";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { useEvidenceSearchQuery } from "./evidence.queries";
import { EvidenceSnippet } from "./evidence-snippet";

type DocumentClass = EvidenceDocumentVersion["documentClass"];

const CLASSES = [
  ["risk_assessment", "Risk assessment"],
  ["test_report", "Test report"],
  ["policy", "Policy"],
  ["procedure", "Procedure"],
  ["supplier_attestation", "Supplier attestation"],
  ["certificate", "Certificate"],
  ["architecture_document", "Architecture document"],
  ["other", "Other"],
] as const satisfies readonly (readonly [DocumentClass, string])[];

const emptySearchQuery = evidenceSearchQuerySchema.parse({ q: "--" });

function requestMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to search this product’s evidence.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "Evidence search is offline. Your query and filters are still available; try again when connected.";
  if (error instanceof ApiClientError && error.kind === "invalid_request")
    return "The search request is invalid. Check the query and try again.";
  return "Evidence search is temporarily unavailable. Your query and filters are still available; try again.";
}

function classLabel(value: string) {
  return value.replaceAll("_", " ");
}

function coverageDescription(
  coverage: Readonly<{ indexed: number; pending: number; unavailable: number }>,
) {
  const states = [
    `${coverage.indexed} indexed`,
    `${coverage.pending} extracting`,
    `${coverage.unavailable} unavailable`,
  ];
  return `Search coverage: ${states.join(", ")}.`;
}

/** Compact product-local search. Authorization and ranking stay server-side. */
export function EvidenceSearchPanel({
  productId,
  enabled,
}: Readonly<{ productId: string; enabled: boolean }>) {
  const [enteredQuery, setEnteredQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [documentClass, setDocumentClass] = useState<DocumentClass | "">("");
  const [includeHistorical, setIncludeHistorical] = useState(false);
  const [pagination, setPagination] = useState<Readonly<{
    scope: string;
    cursor: string;
  }> | null>(null);
  const [loadedResults, setLoadedResults] = useState<
    readonly EvidenceSearchResult[]
  >([]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(enteredQuery), 200);
    return () => window.clearTimeout(timer);
  }, [enteredQuery]);

  useEffect(() => {
    setLoadedResults([]);
  }, [debouncedQuery, documentClass, includeHistorical]);

  const baseParsed = evidenceSearchQuerySchema.safeParse({
    q: debouncedQuery,
    documentClass: documentClass || undefined,
    includeHistorical,
  });
  const scope = baseParsed.success
    ? `${baseParsed.data.q}:${baseParsed.data.documentClass ?? ""}:${baseParsed.data.includeHistorical}`
    : "invalid";
  const cursor = pagination?.scope === scope ? pagination.cursor : undefined;
  const query: EvidenceSearchQuery = baseParsed.success
    ? evidenceSearchQuerySchema.parse({ ...baseParsed.data, cursor })
    : emptySearchQuery;
  const search = useEvidenceSearchQuery(
    productId,
    query,
    enabled && baseParsed.success,
  );
  useEffect(() => {
    if (!search.data) return;
    setLoadedResults((current) => {
      if (!cursor) return search.data.results;
      const known = new Set(current.map((result) => result.versionId));
      const appended = search.data.results.filter(
        (result) => !known.has(result.versionId),
      );
      return appended.length === 0 ? current : [...current, ...appended];
    });
  }, [cursor, search.data]);
  const hasEnteredQuery = enteredQuery.trim().length > 0;
  const queryInvalid = hasEnteredQuery && !baseParsed.success;
  const coverage = search.data?.coverage;
  const incompleteCoverage =
    (coverage?.pending ?? 0) > 0 || (coverage?.unavailable ?? 0) > 0;
  const results = cursor ? loadedResults : (search.data?.results ?? []);

  return (
    <section
      aria-labelledby="evidence-search-heading"
      className="rounded-xl border border-border bg-surface"
    >
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-4 py-3">
        <div>
          <h2
            id="evidence-search-heading"
            className="text-subhead-semibold text-fg"
          >
            Search extracted text
          </h2>
          <p className="text-caption-1-regular text-fg-muted">
            Search only this product’s clean evidence. Extracted content is
            untrusted text.
          </p>
        </div>
        {search.isFetching && search.data ? (
          <span role="status" className="text-caption-1-regular text-fg-muted">
            Updating results…
          </span>
        ) : null}
      </div>
      <div className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(16rem,1fr)_12rem_auto] md:items-end">
        <label className="grid gap-1 text-caption-1-semibold text-fg">
          Search query
          <span className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted"
            />
            <input
              value={enteredQuery}
              onChange={(event) => setEnteredQuery(event.target.value)}
              maxLength={200}
              aria-invalid={queryInvalid || undefined}
              aria-describedby="evidence-search-hint"
              className="w-full rounded-lg border border-border bg-canvas py-2 pl-9 pr-3 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
              placeholder="Search evidence text"
            />
          </span>
        </label>
        <label className="grid gap-1 text-caption-1-semibold text-fg">
          Evidence class
          <select
            value={documentClass}
            onChange={(event) => {
              const value = event.target.value;
              setDocumentClass(
                value === "" ? "" : evidenceDocumentClassSchema.parse(value),
              );
            }}
            className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <option value="">All classes</option>
            {CLASSES.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <Checkbox
          label="Include previous versions"
          checked={includeHistorical}
          onCheckedChange={(checked) => setIncludeHistorical(checked === true)}
          wrapperClassName="min-h-10 justify-end"
          className="focus-visible:ring-2 focus-visible:ring-focus"
        />
      </div>
      <p
        id="evidence-search-hint"
        className="px-4 text-caption-1-regular text-fg-muted"
      >
        Enter 2–200 characters. Previous versions are excluded unless selected.
      </p>
      {queryInvalid ? (
        <p
          role="alert"
          className="px-4 pt-3 text-caption-1-regular text-danger"
        >
          Enter a search query between 2 and 200 characters without control
          characters.
        </p>
      ) : null}
      {search.isLoading ? (
        <p
          role="status"
          className="px-4 py-5 text-subhead-regular text-fg-muted"
        >
          Searching extracted text…
        </p>
      ) : null}
      {search.isError ? (
        <div className="grid gap-3 px-4 py-5">
          <p role="alert" className="text-subhead-regular text-fg-muted">
            {requestMessage(search.error)}
          </p>
          <div>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void search.refetch()}
            >
              Retry search
            </Button>
          </div>
        </div>
      ) : null}
      {!search.isLoading && !search.isError && !hasEnteredQuery ? (
        <p className="px-4 py-5 text-subhead-regular text-fg-muted">
          Enter a query to search extracted evidence text.
        </p>
      ) : null}
      {!search.isLoading &&
      !search.isError &&
      baseParsed.success &&
      search.data ? (
        <div className="grid gap-3 px-4 py-5">
          <p
            aria-live="polite"
            className="text-caption-1-regular text-fg-muted"
          >
            {search.data.totalCount} matching version
            {search.data.totalCount === 1 ? "" : "s"}.{" "}
            {coverageDescription(search.data.coverage)}
          </p>
          {results.length === 0 ? (
            <p className="text-subhead-regular text-fg-muted">
              {incompleteCoverage
                ? "No matching extracted text is available yet. Some eligible evidence is still extracting or unavailable, so this is not a claim that no evidence exists."
                : "No matching extracted text was found in the eligible evidence."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left">
                <thead className="border-b border-border text-caption-1-semibold text-fg-muted">
                  <tr>
                    <th className="px-3 py-2">Document</th>
                    <th className="px-3 py-2">Extracted text</th>
                    <th className="px-3 py-2">Version</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((result) => (
                    <tr
                      key={result.versionId}
                      className="border-b border-border align-top"
                    >
                      <td className="px-3 py-3">
                        <p className="text-subhead-semibold text-fg">
                          {result.title}
                        </p>
                        <p className="text-caption-1-regular text-fg-muted">
                          {result.fileName} · {classLabel(result.documentClass)}
                        </p>
                      </td>
                      <td className="max-w-[34rem] px-3 py-3">
                        <EvidenceSnippet snippet={result.snippet} />
                      </td>
                      <td className="px-3 py-3 text-caption-1-regular text-fg-muted">
                        v{result.versionNumber}
                        {!result.currentVersion ? " · Previous" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {search.data.nextCursor ? (
            <div>
              <Button
                type="button"
                variant="outline"
                tone="grey"
                onClick={() =>
                  setPagination({
                    scope,
                    cursor: search.data?.nextCursor ?? "",
                  })
                }
              >
                Load more results
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
