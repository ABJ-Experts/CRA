"use client";

import { Button } from "@repo/ui/button";
import { Tag } from "@repo/ui/tag";
import Link from "next/link";
import { useState } from "react";
import { browserApi } from "../_lib/browser-api";
import type { FindingPageData, FindingRow } from "../_lib/api";

function severity(cvss: number | null): string {
  if (cvss === null) return "Unknown";
  if (cvss >= 9) return "Critical";
  if (cvss >= 7) return "High";
  if (cvss >= 4) return "Medium";
  return "Low";
}

export function FindingsQueue({ initial }: { initial: FindingPageData }) {
  const [items, setItems] = useState<FindingRow[]>(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [hasMore, setHasMore] = useState(initial.hasMore);
  const [state, setState] = useState("");
  const [kevOnly, setKevOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchPage(nextCursor?: string | null, append = false) {
    setLoading(true);
    setError(null);
    const query = new URLSearchParams({ limit: "50" });
    if (state) query.set("state", state);
    if (kevOnly) query.set("kevOnly", "true");
    if (nextCursor) query.set("cursor", nextCursor);
    const response = await browserApi<FindingPageData>(`/findings?${query}`);
    if (!response.data) {
      setError(response.error ?? "Could not load findings.");
      setLoading(false);
      return;
    }
    setItems((current) => (append ? [...current, ...response.data!.items] : response.data!.items));
    setCursor(response.data.nextCursor);
    setHasMore(response.data.hasMore);
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap gap-3 rounded-xl border border-border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void fetchPage();
        }}
      >
        <label className="text-sm">
          State
          <select
            value={state}
            onChange={(event) => setState(event.target.value)}
            className="ml-2 rounded border border-border bg-canvas px-2 py-1"
          >
            <option value="">All</option>
            {["open", "in_triage", "awaiting_approval", "closed", "suppressed", "reopened"].map(
              (value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={kevOnly}
            onChange={(event) => setKevOnly(event.target.checked)}
          />{" "}
          KEV only
        </label>
        <Button type="submit" size="sm" disabled={loading}>
          {loading ? "Filtering…" : "Apply filters"}
        </Button>
      </form>
      {error ? (
        <p role="alert" className="text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-caption-1-regular text-fg-muted">
          Nothing to triage. Findings appear once an uploaded SBOM is matched against the advisory
          feed.
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((finding) => (
            <FindingCard key={finding.id} finding={finding} />
          ))}
        </div>
      )}
      {hasMore ? (
        <Button variant="outline" disabled={loading} onClick={() => void fetchPage(cursor, true)}>
          {loading ? "Loading…" : "Load more"}
        </Button>
      ) : null}
    </div>
  );
}

function FindingCard({ finding }: { finding: FindingRow }) {
  return (
    <article className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/app/findings/${finding.id}`}
            className="font-mono text-sm font-semibold underline"
          >
            {finding.advisoryId}
          </Link>
          <Tag>{severity(finding.cvssBase)}</Tag>
          {finding.kevListed ? (
            <Tag tone="red" variant="fill">
              KEV
            </Tag>
          ) : null}
          <Tag>{finding.state.replaceAll("_", " ")}</Tag>
          <Tag>VEX: {finding.vexStatus.replaceAll("_", " ")}</Tag>
        </div>
        <span className="text-sm text-fg-muted">
          {finding.matchMethod} · {Math.round(finding.matchConfidence * 100)}% confidence
        </span>
      </div>
      {finding.lowConfidence ? (
        <p className="mt-2 text-sm text-warning-fg">Low-confidence match: confirm before acting.</p>
      ) : null}
    </article>
  );
}
