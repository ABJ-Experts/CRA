import type { EvidenceSearchSnippet } from "@repo/contracts/evidence";

/** Extracted document content remains text nodes, even around highlighted terms. */
export function EvidenceSnippet({
  snippet,
}: Readonly<{ snippet: EvidenceSearchSnippet }>) {
  return (
    <p className="text-caption-1-regular text-fg-muted">
      {snippet.segments.map((segment, index) =>
        segment.highlighted ? (
          <mark
            key={`${index}-${segment.text}`}
            className="rounded bg-surface px-0.5 text-fg"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={`${index}-${segment.text}`}>{segment.text}</span>
        ),
      )}
      {snippet.truncated ? <span aria-label="Snippet truncated">…</span> : null}
    </p>
  );
}
