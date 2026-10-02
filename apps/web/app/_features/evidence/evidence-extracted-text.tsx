"use client";

import type { EvidenceDocumentVersion } from "@repo/contracts/evidence";
import { Button } from "@repo/ui/button";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useEvidenceExtractedTextQuery,
  useRetryEvidenceExtractionMutation,
} from "./evidence.queries";
import { EvidenceSnippet } from "./evidence-snippet";

function label(value: string) {
  return value.replaceAll("_", " ");
}

function requestMessage(error: unknown) {
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to view extracted evidence text.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "Extracted text is offline. Evidence viewing and downloads are unaffected.";
  return "Extracted text is temporarily unavailable. Evidence viewing and downloads are unaffected.";
}

/** Version-scoped text status preserves the difference between unavailable and no text. */
export function EvidenceExtractedText({
  productId,
  documentId,
  version,
  enabled,
  canRetry,
}: Readonly<{
  productId: string;
  documentId: string;
  version: EvidenceDocumentVersion;
  enabled: boolean;
  canRetry: boolean;
}>) {
  const extractedText = useEvidenceExtractedTextQuery(
    productId,
    documentId,
    version.id,
    enabled && version.status === "clean",
  );
  const retry = useRetryEvidenceExtractionMutation(productId);
  const extraction = extractedText.data?.extractedText.extraction;

  if (version.status !== "clean") return null;
  if (extractedText.isLoading)
    return (
      <p role="status" className="text-caption-1-regular text-fg-muted">
        Loading extraction status…
      </p>
    );
  if (extractedText.isError)
    return (
      <div className="grid gap-2">
        <p role="alert" className="text-caption-1-regular text-fg-muted">
          {requestMessage(extractedText.error)}
        </p>
        <div>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            onClick={() => void extractedText.refetch()}
          >
            Retry status check
          </Button>
        </div>
      </div>
    );
  if (!extraction) return null;
  if (extraction.status === "complete")
    return extractedText.data?.extractedText.snippet ? (
      <div className="grid gap-1">
        <p className="text-caption-1-semibold text-fg">Extracted text</p>
        <EvidenceSnippet snippet={extractedText.data.extractedText.snippet} />
      </div>
    ) : null;
  if (extraction.status === "queued" || extraction.status === "running")
    return (
      <p role="status" className="text-caption-1-regular text-fg-muted">
        Text extraction is {extraction.status}. Evidence preview and download
        remain available.
      </p>
    );

  return (
    <div className="grid gap-2">
      <p className="text-caption-1-regular text-fg-muted">
        Text extraction is unavailable (
        {label(extraction.failureCode ?? "failed")}). Evidence preview and
        download remain available.
      </p>
      {canRetry ? (
        <div>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            loading={retry.isPending}
            loadingLabel="Retrying extraction"
            onClick={() =>
              retry.mutate({
                documentId,
                versionId: version.id,
                idempotencyKey: crypto.randomUUID(),
              })
            }
          >
            Retry extraction
          </Button>
          {retry.isError ? (
            <p role="alert" className="mt-2 text-caption-1-regular text-danger">
              {requestMessage(retry.error)}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
