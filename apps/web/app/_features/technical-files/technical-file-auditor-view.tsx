"use client";

import { useEffect, useRef, useState } from "react";

import { technicalFilesApi } from "./technical-files.api";
import {
  useRedeemTechnicalFileAuditorGrantMutation,
  useTechnicalFileAuditorManifestQuery,
  useTechnicalFileAuditorSnapshotQuery,
} from "./technical-files.queries";

const unavailable = "This auditor access is unavailable.";

function date(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function TechnicalFileAuditorView({ token }: { token?: string }) {
  const { mutateAsync: redeemAuditorGrant } =
    useRedeemTechnicalFileAuditorGrantMutation();
  const redeemedToken = useRef<string | null>(null);
  const [redeemed, setRedeemed] = useState(!token);
  const [state, setState] = useState<"loading" | "unavailable" | "ready">(token ? "loading" : "ready");
  const snapshot = useTechnicalFileAuditorSnapshotQuery(redeemed && state !== "unavailable");
  const manifest = useTechnicalFileAuditorManifestQuery(redeemed && state !== "unavailable");

  useEffect(() => {
    // React Query mutation state updates rerender this component. A grant token
    // is intentionally single-use, so redeem it only once for this page load.
    if (!token || redeemedToken.current === token) return;
    redeemedToken.current = token;
    void redeemAuditorGrant({ token }).then(() => {
      setRedeemed(true);
      setState("ready");
      // Do not trigger a route remount between redeeming the one-time link and
      // loading its scoped session. The browser history API clears the secret
      // from the address bar without interrupting the current query lifecycle.
      window.history.replaceState(null, "", "/auditor");
    }).catch(() => setState("unavailable"));
  }, [redeemAuditorGrant, token]);

  useEffect(() => {
    if (snapshot.isError || manifest.isError) setState("unavailable");
  }, [manifest.isError, snapshot.isError]);

  if (state === "unavailable") return <main className="mx-auto flex min-h-screen max-w-2xl items-center px-6"><section className="w-full rounded-xl border border-border bg-canvas p-6"><h1 className="text-h3 text-fg">Auditor snapshot access</h1><p role="alert" className="mt-3 text-subhead-regular text-fg">{unavailable}</p><p className="mt-2 text-caption-1-regular text-fg-muted">Ask the granting organization for a new scoped access link if you still need the snapshot.</p></section></main>;
  if (state === "loading" || snapshot.isPending || manifest.isPending || !snapshot.data || !manifest.data) return <main className="mx-auto flex min-h-screen max-w-2xl items-center px-6"><p role="status" className="text-subhead-regular text-fg-muted">Loading the permitted immutable snapshot…</p></main>;

  const view = snapshot.data.snapshot;
  const exportManifest = manifest.data.manifest;
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8 sm:px-6">
      <section aria-labelledby="auditor-snapshot-heading" className="rounded-xl border border-border bg-canvas p-5 sm:p-6">
        <h1 id="auditor-snapshot-heading" className="text-h3 text-fg">Permitted technical-file snapshot</h1>
        <p className="mt-2 max-w-[75ch] text-subhead-regular text-fg-muted">This is a read-only immutable snapshot. It does not provide access to the organization workspace, live records, or other evidence.</p>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2"><div><dt className="text-caption-1-semibold text-fg-muted">Source date</dt><dd className="mt-1 text-subhead-regular text-fg">{date(view.sourceDate)}</dd></div><div><dt className="text-caption-1-semibold text-fg-muted">Revision</dt><dd className="mt-1 text-subhead-regular text-fg">{view.revision} · {view.status}</dd></div><div><dt className="text-caption-1-semibold text-fg-muted">Snapshot integrity hash</dt><dd className="mt-1 break-all text-caption-1-regular text-fg">{view.payloadSha256}</dd></div><div><dt className="text-caption-1-semibold text-fg-muted">Access expires</dt><dd className="mt-1 text-subhead-regular text-fg">{date(view.expiresAt)}</dd></div></dl>
        <div className="mt-6 border-t border-border pt-5"><h2 className="text-h4 text-fg">Export manifest</h2><p className="mt-1 text-caption-1-regular text-fg-muted">Manifest hash: <span className="break-all">{exportManifest.manifestSha256}</span></p><ul className="mt-3 grid gap-2" aria-label="Permitted export artifacts">{exportManifest.artifacts.map((artifact) => <li key={artifact.kind} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-subtle p-3"><span className="text-subhead-regular text-fg">{artifact.kind.replaceAll("_", " ")} · {artifact.sha256}</span>{artifact.kind === "pdf" || artifact.kind === "archive" ? <a href={technicalFilesApi.auditorArtifactPath(artifact.kind)} className="text-subhead-semibold text-link underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">Download {artifact.kind === "pdf" ? "PDF" : "archive"}</a> : null}</li>)}</ul><p className="mt-3 text-caption-1-regular text-fg-muted">Downloads are rechecked when requested. A delivery already started may remain usable only for its short delivery lifetime after access is revoked.</p></div>
        <details className="mt-6 border-t border-border pt-5"><summary className="cursor-pointer text-subhead-semibold text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">View frozen snapshot content</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-subtle p-3 text-caption-1-regular text-fg">{JSON.stringify(view.payload, null, 2)}</pre></details>
      </section>
    </main>
  );
}
