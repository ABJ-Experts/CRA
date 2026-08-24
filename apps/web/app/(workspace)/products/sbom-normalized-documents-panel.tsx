"use client";

import type { SbomDocument } from "@repo/contracts/sboms";
import { Button } from "@repo/ui/button";
import { Tag, type TagProps } from "@repo/ui/tag";
import Link from "next/link";
import { useEffect, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { useSbomDocumentsForReleaseQuery } from "../../_features/sboms/sboms.queries";

function stateTone(state: SbomDocument["state"]): TagProps["tone"] {
  if (state === "completed") return "green";
  if (state === "failed") return "red";
  return "blue";
}

function validationTone(
  status: SbomDocument["validationStatus"],
): TagProps["tone"] {
  if (status === "valid") return "green";
  if (status === "invalid") return "red";
  if (status === "valid_with_warnings") return "orange";
  return "blue";
}

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "You do not have permission to view normalized SBOM data.";
  }
  if (error instanceof ApiClientError && error.status === 404) {
    return "The selected release is unavailable.";
  }
  return "Normalized document inventory is temporarily unavailable.";
}

function sameDocumentIds(
  left: readonly SbomDocument[],
  right: readonly SbomDocument[],
): boolean {
  return (
    left.length === right.length &&
    left.every((document, index) => document.id === right[index]?.id)
  );
}

export function SbomNormalizedDocumentsPanel({
  productId,
  releaseId,
  enabled,
}: Readonly<{
  productId: string;
  releaseId: string;
  enabled: boolean;
}>) {
  const [cursor, setCursor] = useState<string | undefined>();
  const [pages, setPages] = useState<readonly SbomDocument[]>([]);
  const documents = useSbomDocumentsForReleaseQuery(
    productId,
    releaseId,
    { limit: 25, cursor },
    enabled && releaseId !== "",
  );
  const rows = pages;

  useEffect(() => {
    setCursor(undefined);
    setPages([]);
  }, [productId, releaseId]);

  useEffect(() => {
    if (!documents.data) return;
    setPages((current) => {
      if (cursor === undefined) {
        return sameDocumentIds(current, documents.data.documents)
          ? current
          : documents.data.documents;
      }
      const known = new Set(current.map((document) => document.id));
      const appended = documents.data.documents.filter(
        (document) => !known.has(document.id),
      );
      return appended.length === 0
        ? current
        : [
        ...current,
        ...appended,
      ];
    });
  }, [cursor, documents.data]);

  return (
    <section
      aria-labelledby="normalized-sbom-documents-heading"
      className="min-w-0 rounded-xl border border-border bg-surface-subtle p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-caption-1-semibold text-fg-muted">
            Evidence graph inventory
          </p>
          <h3
            id="normalized-sbom-documents-heading"
            className="mt-1 text-title-3-semibold text-fg"
          >
            Normalized documents
          </h3>
        </div>
        <Tag variant="cool" size="sm">
          {rows.length}
        </Tag>
      </div>
      {documents.isPending ? (
        <p role="status" className="mt-3 text-caption-1-regular text-fg-muted">
          Loading normalized document inventory...
        </p>
      ) : documents.isError ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2">
          <p className="text-caption-1-regular text-danger">
            {errorMessage(documents.error)}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            tone="grey"
            onClick={() => void documents.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-caption-1-regular text-fg-muted">
          Completed intake will appear here as an immutable normalized graph.
        </p>
      ) : (
        <ul aria-label="Normalized SBOM documents" className="mt-3 grid gap-2">
          {rows.map((document) => (
            <li key={document.id} className="rounded-lg border border-border bg-canvas p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-caption-1-semibold text-fg">
                    {document.format === "cyclonedx" ? "CycloneDX" : "SPDX"}{" "}
                    {document.specificationVersion}
                  </p>
                  <p className="mt-1 text-caption-2-regular text-fg-muted">
                    {document.componentCount} components · depth {document.maximumDepth}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Tag variant="dot" size="sm" tone={stateTone(document.state)}>
                    {titleCase(document.state)}
                  </Tag>
                  <Tag
                    variant="dot"
                    size="sm"
                    tone={validationTone(document.validationStatus)}
                  >
                    {titleCase(document.validationStatus)}
                  </Tag>
                </div>
              </div>
              {document.state === "failed" && document.error ? (
                <p role="alert" className="mt-2 text-caption-2-regular text-danger">
                  {document.error.retryable ? "Retryable: " : ""}
                  {document.error.message}
                </p>
              ) : null}
              <Link
                href={`/products/${productId}/sboms/${document.id}`}
                className="mt-3 inline-flex text-caption-1-semibold text-active-600 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500"
              >
                Open normalized graph
              </Link>
            </li>
          ))}
        </ul>
      )}
      {documents.data?.nextCursor ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          tone="grey"
          className="mt-3"
          onClick={() => setCursor(documents.data?.nextCursor ?? undefined)}
        >
          Load more documents
        </Button>
      ) : null}
    </section>
  );
}
