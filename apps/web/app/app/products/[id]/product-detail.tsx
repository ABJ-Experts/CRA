"use client";

import { Button } from "@repo/ui/button";
import { Tag } from "@repo/ui/tag";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { browserApi, jsonRequest } from "../../_lib/browser-api";
import { hasPermission } from "../../_lib/permissions";
import type { PrincipalData, ProductRow, ReleaseRow } from "../../_lib/api";

const TRANSITIONS: Record<string, string[]> = {
  development: ["placed_on_market"],
  placed_on_market: ["in_support", "withdrawn"],
  in_support: ["end_of_support", "withdrawn"],
  end_of_support: ["withdrawn"],
  withdrawn: [],
};

export function ProductDetail({
  product,
  releases,
  principal,
}: {
  product: ProductRow;
  releases: ReleaseRow[];
  principal: PrincipalData | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [placedOnMarketAt, setPlacedOnMarketAt] = useState("");
  const canUpdate = hasPermission(principal, "product:update");
  const canArchive = hasPermission(principal, "product:archive");
  const canUploadSbom = hasPermission(principal, "sbom:upload");
  const lifecycleTransitions = TRANSITIONS[product.lifecycleState] ?? [];

  async function transition(to: string) {
    setBusy(true);
    setError(null);
    const result = await browserApi<ProductRow>(
      `/products/${product.id}/transitions`,
      jsonRequest({
        to,
        placedOnMarketAt:
          to === "placed_on_market" ? new Date(placedOnMarketAt).toISOString() : undefined,
      }),
    );
    if (!result.data) setError(result.error ?? "Could not update the lifecycle.");
    setBusy(false);
    router.refresh();
  }

  async function archive() {
    if (!window.confirm(`Archive ${product.name}? This hides it from active product lists.`))
      return;
    setBusy(true);
    setError(null);
    const result = await browserApi(`/products/${product.id}`, { method: "DELETE" });
    if (result.error) {
      setError(result.error);
      setBusy(false);
      return;
    }
    router.push("/app/products");
    router.refresh();
  }

  async function createRelease(formData: FormData) {
    setBusy(true);
    setError(null);
    const result = await browserApi<{ id: string }>(
      "/releases",
      jsonRequest({
        productId: product.id,
        versionLabel: String(formData.get("versionLabel") ?? ""),
      }),
    );
    if (!result.data) setError(result.error ?? "Could not create the release.");
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-sm text-fg-muted">{product.internalCode}</p>
            <h2 className="mt-1 text-xl font-semibold">{product.name}</h2>
            <p className="mt-1 text-sm text-fg-muted">{product.productType.replaceAll("_", " ")}</p>
          </div>
          <Tag>{product.lifecycleState.replaceAll("_", " ")}</Tag>
        </div>
        {canUpdate && lifecycleTransitions.length ? (
          <div className="mt-5 flex flex-wrap items-end gap-3">
            {lifecycleTransitions.includes("placed_on_market") ? (
              <label className="text-sm">
                Placed on market at
                <input
                  type="datetime-local"
                  value={placedOnMarketAt}
                  onChange={(event) => setPlacedOnMarketAt(event.target.value)}
                  className="mt-1 block rounded-md border border-border bg-canvas px-3 py-2"
                />
              </label>
            ) : null}
            {lifecycleTransitions.map((to) => (
              <Button
                key={to}
                variant="outline"
                disabled={busy || (to === "placed_on_market" && !placedOnMarketAt)}
                onClick={() => void transition(to)}
              >
                {to.replaceAll("_", " ")}
              </Button>
            ))}
          </div>
        ) : null}
        {canArchive ? (
          <Button className="mt-5" variant="outline" disabled={busy} onClick={() => void archive()}>
            Archive product
          </Button>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-danger-fg">
            {error}
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-border p-5">
        <h2 className="text-lg font-semibold">Releases</h2>
        {canUploadSbom ? (
          <form action={createRelease} className="mt-4 flex flex-wrap gap-3">
            <input
              required
              name="versionLabel"
              maxLength={100}
              placeholder="Version, e.g. 1.0.0"
              className="rounded-md border border-border bg-canvas px-3 py-2"
            />
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Add release"}
            </Button>
          </form>
        ) : null}
        <div className="mt-5 space-y-4">
          {releases.length === 0 ? (
            <p className="text-sm text-fg-muted">No releases yet.</p>
          ) : (
            releases.map((release) => (
              <ReleaseCard key={release.id} release={release} canUpload={canUploadSbom} />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ReleaseCard({ release, canUpload }: { release: ReleaseRow; canUpload: boolean }) {
  return (
    <article className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">{release.versionLabel}</h3>
          <p className="text-sm text-fg-muted">
            {release.sbomCount} SBOM{release.sbomCount === 1 ? "" : "s"}
          </p>
        </div>
        <Tag>{release.lifecycleState.replaceAll("_", " ")}</Tag>
      </div>
      {canUpload ? <SbomUpload releaseId={release.id} /> : null}
    </article>
  );
}

function SbomUpload({ releaseId }: { releaseId: string }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    validationStatus: string;
    componentCount: number;
    deduplicated: boolean;
    findingsCreated: number;
    kevFindings: number;
  } | null>(null);

  async function upload() {
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setError("Choose an SBOM file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    const response = await browserApi<{
      ingest: { validationStatus: string; componentCount: number; deduplicated: boolean };
      match: { findingsCreated: number; kevFindings: number };
    }>(
      `/releases/${releaseId}/sbom`,
      jsonRequest({ document: await file.text(), source: "manual_upload" }),
    );
    if (!response.data) {
      setError(response.error ?? "Could not ingest the SBOM.");
      setBusy(false);
      return;
    }
    setResult({ ...response.data.ingest, ...response.data.match });
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="mt-4 rounded-md bg-surface-subtle p-3">
      <label className="block text-sm font-medium">
        Upload CycloneDX JSON/XML or SPDX JSON/tag-value
        <input
          ref={fileInput}
          type="file"
          accept=".json,.xml,.spdx,.tag,text/plain,application/json,application/xml"
          className="mt-2 block w-full text-sm"
        />
      </label>
      <Button className="mt-3" size="sm" disabled={busy} onClick={() => void upload()}>
        {busy ? "Ingesting…" : "Upload SBOM"}
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
      {result ? (
        <p className="mt-2 text-sm text-fg-muted">
          {result.validationStatus.replaceAll("_", " ")} · {result.componentCount} components ·{" "}
          {result.deduplicated ? "existing document reused" : "new document stored"} ·{" "}
          {result.findingsCreated} findings ({result.kevFindings} KEV)
        </p>
      ) : null}
    </div>
  );
}
