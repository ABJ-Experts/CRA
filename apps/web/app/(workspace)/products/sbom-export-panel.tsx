"use client";
import { useState } from "react";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { sbomsApi } from "../../_features/sboms/sboms.api";
import { ApiClientError } from "../../_lib/http/api-client";

function exportError(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403) return "You no longer have permission to export SBOM evidence.";
  if (error instanceof ApiClientError && error.status === 404) return "This SBOM source is unavailable.";
  if (error instanceof ApiClientError && (error.status === 409 || error.status === 422)) return error.message;
  return "The export is temporarily unavailable. Your choices are preserved; retry when the service is available.";
}

export function SbomExportPanel({ documentId, sourceId }: Readonly<{ documentId: string; sourceId: string }>) {
  const [format, setFormat] = useState<"cyclonedx" | "spdx">("cyclonedx");
  const [includeVex, setIncludeVex] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function download() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await sbomsApi.exportDocument(documentId, { sourceId, format, includeVex });
      const artifact = response.export;
      const url = URL.createObjectURL(new Blob([artifact.content], { type: artifact.mediaType }));
      const anchor = document.createElement("a");
      try {
        anchor.href = url;
        anchor.download = artifact.fileName;
        anchor.rel = "noreferrer";
        document.body.append(anchor);
        anchor.click();
        setMessage(`Export prepared. SHA-256: ${artifact.sha256}. ${artifact.vex.status === "included" ? `${artifact.vex.assessmentCount} reviewed VEX assessments included.` : "VEX was not requested."}`);
      } finally {
        anchor.remove();
        // Give the browser's download task time to consume the object URL.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) { setMessage(exportError(error)); }
    finally { setBusy(false); }
  }
  return <section aria-label="SBOM export" className={cn("rounded-xl border border-border bg-surface-subtle p-4")}>
    <h2 className={cn("text-title-3-semibold text-fg")}>Portable SBOM export</h2>
    <p className={cn("mt-2 text-caption-1-regular text-fg-muted")}>Exports this immutable normalized graph. Missing source metadata remains explicit; exporting does not certify inventory completeness or compliance.</p>
    <label className={cn("mt-3 grid gap-2 text-caption-1-semibold text-fg")}>Export format
      <select aria-label="Export format" disabled={busy} value={format} onChange={(event) => { const next = event.target.value === "spdx" ? "spdx" : "cyclonedx"; setFormat(next); if (next === "spdx") setIncludeVex(false); }} className={cn("rounded-lg border border-border bg-canvas p-2 text-subhead-regular text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500")}>
        <option value="cyclonedx">CycloneDX 1.6 JSON</option><option value="spdx">SPDX 2.3 JSON</option>
      </select>
    </label>
    <label className={cn("mt-3 flex items-center gap-2 text-caption-1-regular text-fg")}><input type="checkbox" checked={includeVex} disabled={busy || format === "spdx"} onChange={(event) => setIncludeVex(event.target.checked)} className={cn("focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500")} />Include reviewed VEX</label>
    {format === "spdx" ? <p className={cn("mt-2 text-caption-1-regular text-fg-muted")}>SPDX 2.3 export does not embed VEX. Choose CycloneDX for supported reviewed VEX.</p> : null}
    <Button type="button" className={cn("mt-3")} loading={busy} loadingLabel="Preparing SBOM export" onClick={() => void download()}>Download SBOM export</Button>
    {message ? <p role="status" className={cn("mt-3 break-words text-caption-1-regular text-fg")}>{message}</p> : null}
  </section>;
}
