"use client";

import type { TechnicalFileDeclaration } from "@repo/contracts/technical-files";
import { Button } from "@repo/ui/button";
import { useEffect, useMemo, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useIssueTechnicalFileDeclarationMutation,
  useReissueTechnicalFileDeclarationMutation,
  useSaveTechnicalFileDeclarationDraftMutation,
  useTechnicalFileDeclarationDownloadMutation,
  useTechnicalFileDeclarationPreviewQuery,
  useTechnicalFileDeclarationsQuery,
  useTechnicalFileSnapshotsQuery,
} from "./technical-files.queries";

function requestId(): string {
  return crypto.randomUUID();
}

function label(value: string): string {
  return value.replaceAll("_", " ");
}

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "Your declaration-issue permission was removed. Your entered draft remains available; ask an organization owner to restore access before trying again.";
  }
  if (error instanceof ApiClientError && error.status === 409) {
    return "The declaration or its selected snapshot changed. Reload the preview before issuing; your entered details are still here.";
  }
  if (
    error instanceof ApiClientError &&
    (error.kind === "network" || (error.status ?? 0) >= 500)
  ) {
    return "The declaration service is temporarily unavailable. Nothing was replayed and your entered details remain here; retry when the connection is restored.";
  }
  return error instanceof ApiClientError ? error.message : fallback;
}

function dateLabel(value: string | null): string {
  if (!value) return "Not issued";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

type Route =
  "internal_control" | "eu_type_examination" | "full_quality_assurance" | null;

export function TechnicalFileDeclarations({
  productId,
  enabled,
  canView,
  canIssue,
}: {
  productId: string;
  enabled: boolean;
  canView: boolean;
  canIssue: boolean;
}) {
  const snapshots = useTechnicalFileSnapshotsQuery(
    productId,
    enabled && canView,
  );
  const declarations = useTechnicalFileDeclarationsQuery(
    productId,
    enabled && canView,
  );
  const saveDraft = useSaveTechnicalFileDeclarationDraftMutation(productId);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [capacity, setCapacity] = useState("");
  const [place, setPlace] = useState("");
  const [route, setRoute] = useState<Route>(null);
  const [notifiedBodyIdentifier, setNotifiedBodyIdentifier] = useState("");
  const [notifiedBodyName, setNotifiedBodyName] = useState("");
  const [certificateSourceId, setCertificateSourceId] = useState("");
  const [certificateReference, setCertificateReference] = useState("");
  const [certificateVersion, setCertificateVersion] = useState("");
  const [certificateIssuer, setCertificateIssuer] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<TechnicalFileDeclaration | null>(
    null,
  );
  const [reissueFor, setReissueFor] = useState<TechnicalFileDeclaration | null>(
    null,
  );
  const [reissueReason, setReissueReason] = useState("");

  const completeSnapshots = useMemo(
    () =>
      (snapshots.data?.snapshots ?? []).filter(
        (snapshot) =>
          snapshot.status === "current" &&
          snapshot.readinessStatus === "complete",
      ),
    [snapshots.data?.snapshots],
  );

  useEffect(() => {
    if (snapshotId === null && completeSnapshots[0]) {
      setSnapshotId(completeSnapshots[0].id);
    }
  }, [completeSnapshots, snapshotId]);

  const preview = useTechnicalFileDeclarationPreviewQuery(
    productId,
    snapshotId,
    enabled && canView,
  );
  const selectedSnapshot = completeSnapshots.find(
    (snapshot) => snapshot.id === snapshotId,
  );
  const selectedDraft = (declarations.data?.declarations ?? []).find(
    (declaration) =>
      declaration.status === "draft" && declaration.snapshotId === snapshotId,
  );
  const currentIssued = (declarations.data?.declarations ?? []).find(
    (declaration) => declaration.status === "issued",
  );
  const requiresNotifiedBody = route !== null && route !== "internal_control";

  function certificateReferences() {
    if (!requiresNotifiedBody) return [];
    return [
      {
        sourceId: certificateSourceId.trim(),
        reference: certificateReference.trim(),
        version: certificateVersion.trim(),
        issuer: certificateIssuer.trim(),
      },
    ];
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (currentIssued) {
      setMessage(
        "An issued declaration already exists. Use Reissue so the new version retains its mandatory supersession link.",
      );
      return;
    }
    setMessage(null);
    if (!snapshotId || !preview.data) {
      setMessage(
        "Select a complete current snapshot and wait for its declaration preview.",
      );
      return;
    }
    if (capacity.trim() === "") {
      setMessage(
        "Record the responsible signatory's capacity before saving a declaration draft.",
      );
      return;
    }
    if (place.trim() === "") {
      setMessage("Record the place of issue before saving a declaration draft.");
      return;
    }
    if (
      requiresNotifiedBody &&
      (!notifiedBodyIdentifier.trim() ||
        !notifiedBodyName.trim() ||
        !certificateSourceId.trim() ||
        !certificateReference.trim() ||
        !certificateVersion.trim() ||
        !certificateIssuer.trim())
    ) {
      setMessage(
        "Notified-body routes require the body identifier and a complete certificate reference.",
      );
      return;
    }
    try {
      await saveDraft.mutateAsync({
        declarationId: selectedDraft?.id,
        snapshotId,
        expectedVersion:
          selectedDraft?.draftVersion ?? preview.data.preview.expectedVersion,
        signatoryCapacity: capacity.trim(),
        signatoryPlace: place.trim(),
        assessmentRoute: route,
        notifiedBody: requiresNotifiedBody
          ? {
              identifier: notifiedBodyIdentifier.trim(),
              name: notifiedBodyName.trim(),
            }
          : null,
        certificateReferences: certificateReferences(),
        idempotencyKey: requestId(),
      });
      setMessage(
        "Declaration draft saved against the selected immutable snapshot.",
      );
    } catch (error) {
      setMessage(
        messageFor(error, "The declaration draft could not be saved."),
      );
    }
  }

  if (!canView) return null;

  return (
    <section
      aria-labelledby="technical-file-declarations-heading"
      className="rounded-xl border border-border bg-surface-subtle p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="technical-file-declarations-heading"
            className="text-h4 text-fg"
          >
            EU declarations of conformity
          </h2>
          <p className="mt-1 max-w-[75ch] text-subhead-regular text-fg-muted">
            Prepare an Annex V declaration from a complete immutable snapshot.
            Issuing identifies a responsible human signatory; it is not a
            cryptographic or qualified electronic signature.
          </p>
        </div>
        <a
          href="#technical-file-snapshots"
          className="text-subhead-semibold text-link underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          Create a snapshot
        </a>
      </div>

      {message ? (
        <p
          role="status"
          aria-live="polite"
          className="mt-3 text-subhead-regular text-fg-muted"
        >
          {message}
        </p>
      ) : null}

      {snapshots.isPending ? (
        <p role="status" className="mt-4 text-subhead-regular text-fg-muted">
          Loading available snapshots…
        </p>
      ) : snapshots.isError ? (
        <p role="alert" className="mt-4 text-subhead-regular text-danger">
          Snapshots are unavailable. Reload this workspace before preparing a
          declaration.
        </p>
      ) : completeSnapshots.length === 0 ? (
        <p className="mt-4 text-subhead-regular text-fg-muted">
          No complete current snapshot is available. Create one after resolving
          all readiness gaps; declarations never use live mutable facts.
        </p>
      ) : (
        <form onSubmit={save} className="mt-4 grid gap-4" noValidate>
          <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
            Complete technical-file snapshot
            <select
              value={snapshotId ?? ""}
              onChange={(event) => setSnapshotId(event.target.value || null)}
                  disabled={!canIssue || Boolean(currentIssued) || saveDraft.isPending}
              className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {completeSnapshots.map((snapshot) => (
                <option key={snapshot.id} value={snapshot.id}>
                  {label(snapshot.purpose)} · {snapshot.createdAt} ·{" "}
                  {snapshot.payloadSha256.slice(0, 12)}…
                </option>
              ))}
            </select>
          </label>

          {preview.isPending ? (
            <p role="status" className="text-subhead-regular text-fg-muted">
              Checking the declaration facts in this snapshot…
            </p>
          ) : preview.isError || !preview.data ? (
            <p role="alert" className="text-subhead-regular text-danger">
              The declaration preview could not be read. Reload before saving or
              issuing.
            </p>
          ) : (
            <DeclarationPreview preview={preview.data.preview} />
          )}

          {canIssue ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                  Responsible signatory capacity
                  <input
                    value={capacity}
                    onChange={(event) => setCapacity(event.target.value)}
                    disabled={saveDraft.isPending}
                    maxLength={300}
                    required
                    className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  />
                </label>
                <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                  Place of issue
                  <input
                    value={place}
                    onChange={(event) => setPlace(event.target.value)}
                    disabled={saveDraft.isPending}
                    maxLength={300}
                    required
                    className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  />
                </label>
              </div>
              <label className="flex max-w-xl flex-col gap-1 text-caption-1-semibold text-fg">
                Assessment route (optional V2 record)
                <select
                  value={route ?? ""}
                  onChange={(event) =>
                    setRoute((event.target.value || null) as Route)
                  }
                  disabled={saveDraft.isPending}
                  className="rounded-lg border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <option value="">No route recorded (V1)</option>
                  <option value="internal_control">Internal control</option>
                  <option value="eu_type_examination">
                    EU type examination
                  </option>
                  <option value="full_quality_assurance">
                    Full quality assurance
                  </option>
                </select>
              </label>
              {requiresNotifiedBody ? (
                <fieldset className="grid gap-3 rounded-xl border border-border bg-canvas p-3">
                  <legend className="px-1 text-caption-1-semibold text-fg">
                    Notified body and certificate evidence
                  </legend>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                      Four-digit identifier
                      <input
                        value={notifiedBodyIdentifier}
                        onChange={(event) =>
                          setNotifiedBodyIdentifier(event.target.value)
                        }
                        inputMode="numeric"
                        pattern="[0-9]{4}"
                        maxLength={4}
                        required
                        className="rounded-lg border border-border bg-surface-subtle px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                      Notified body name
                      <input
                        value={notifiedBodyName}
                        onChange={(event) =>
                          setNotifiedBodyName(event.target.value)
                        }
                        maxLength={300}
                        required
                        className="rounded-lg border border-border bg-surface-subtle px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                      Certificate source ID
                      <input
                        value={certificateSourceId}
                        onChange={(event) =>
                          setCertificateSourceId(event.target.value)
                        }
                        maxLength={36}
                        required
                        className="rounded-lg border border-border bg-surface-subtle px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                      Certificate reference
                      <input
                        value={certificateReference}
                        onChange={(event) =>
                          setCertificateReference(event.target.value)
                        }
                        maxLength={300}
                        required
                        className="rounded-lg border border-border bg-surface-subtle px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                      Certificate version
                      <input
                        value={certificateVersion}
                        onChange={(event) =>
                          setCertificateVersion(event.target.value)
                        }
                        maxLength={200}
                        required
                        className="rounded-lg border border-border bg-surface-subtle px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-caption-1-semibold text-fg">
                      Certificate issuer
                      <input
                        value={certificateIssuer}
                        onChange={(event) =>
                          setCertificateIssuer(event.target.value)
                        }
                        maxLength={300}
                        required
                        className="rounded-lg border border-border bg-surface-subtle px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      />
                    </label>
                  </div>
                </fieldset>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  loading={saveDraft.isPending}
                  loadingLabel="Saving declaration draft"
                  disabled={Boolean(currentIssued)}
                >
                  Save declaration draft
                </Button>
                {selectedDraft &&
                selectedDraft.missingFacts.length === 0 &&
                selectedDraft.previewDigest !== "0".repeat(64) &&
                selectedSnapshot ? (
                  <Button
                    type="button"
                    variant="outline"
                    tone="grey"
                    onClick={() => setConfirming(selectedDraft)}
                  >
                    Review and issue version {selectedDraft.version}
                  </Button>
                ) : null}
              </div>
            </>
          ) : (
            <p role="alert" className="text-subhead-regular text-danger">
              You can inspect declaration history but do not have permission to
              issue a declaration.
            </p>
          )}
        </form>
      )}

      <DeclarationHistory
        productId={productId}
        declarations={declarations.data?.declarations ?? []}
        loading={declarations.isPending}
        unavailable={declarations.isError}
        canIssue={canIssue}
        onReissue={setReissueFor}
        onMessage={setMessage}
      />
      {confirming && selectedSnapshot ? (
        <IssueConfirmation
          declaration={confirming}
          snapshotSha256={selectedSnapshot.payloadSha256}
          onClose={() => setConfirming(null)}
          onMessage={setMessage}
          productId={productId}
        />
      ) : null}
      {reissueFor && snapshotId ? (
        <ReissueForm
          declaration={reissueFor}
          productId={productId}
          snapshotId={snapshotId}
          capacity={capacity}
          place={place}
          route={route}
          notifiedBody={
            requiresNotifiedBody
              ? {
                  identifier: notifiedBodyIdentifier.trim(),
                  name: notifiedBodyName.trim(),
                }
              : null
          }
          certificateReferences={certificateReferences()}
          reason={reissueReason}
          onReasonChange={setReissueReason}
          onClose={() => setReissueFor(null)}
          onMessage={setMessage}
        />
      ) : null}
    </section>
  );
}

function DeclarationPreview({
  preview,
}: {
  preview: {
    template: { version: string; legalAct: string; annex: string };
    signatory: { name: string };
    snapshotSha256: string;
    expectedVersion: number;
    readinessStatus: string;
    missingFacts: readonly { key: string; label: string; reason: string }[];
    sourceProvenance: readonly {
      key: string;
      label: string;
      status: string;
      value: string | null;
    }[];
  };
}) {
  return (
    <div className="rounded-xl border border-border bg-canvas p-3">
      <p className="text-subhead-semibold text-fg">
        Preview · version {preview.expectedVersion}
      </p>
      <p className="mt-1 text-caption-1-regular text-fg-muted">
        {preview.template.annex} · {preview.template.version} ·{" "}
        {preview.template.legalAct}
      </p>
      <p className="mt-1 text-caption-1-regular text-fg-muted">
        Named signatory: {preview.signatory.name} · snapshot{" "}
        {preview.snapshotSha256.slice(0, 12)}… · readiness{" "}
        {label(preview.readinessStatus)}
      </p>
      {preview.missingFacts.length > 0 ? (
        <ul className="mt-3 grid gap-2" aria-label="Missing declaration facts">
          {preview.missingFacts.map((fact) => (
            <li key={fact.key} className="text-caption-1-regular text-danger">
              <span className="font-semibold">{fact.label}:</span> {fact.reason}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-caption-1-regular text-fg-muted">
          All mandatory facts are present in the selected snapshot.
        </p>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-caption-1-semibold text-fg">
          View source provenance
        </summary>
        <ul className="mt-2 grid gap-2">
          {preview.sourceProvenance.map((source) => (
            <li
              key={source.key}
              className="text-caption-1-regular text-fg-muted"
            >
              <span className="text-fg">{source.label}</span> ·{" "}
              {label(source.status)}
              {source.value ? ` · ${source.value}` : ""}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function DeclarationHistory({
  productId,
  declarations,
  loading,
  unavailable,
  canIssue,
  onReissue,
  onMessage,
}: {
  productId: string;
  declarations: readonly TechnicalFileDeclaration[];
  loading: boolean;
  unavailable: boolean;
  canIssue: boolean;
  onReissue: (declaration: TechnicalFileDeclaration) => void;
  onMessage: (message: string) => void;
}) {
  const download = useTechnicalFileDeclarationDownloadMutation();
  async function downloadDeclaration(declarationId: string) {
    try {
      const response = await download.mutateAsync({ productId, declarationId });
      window.open(
        response.download.downloadUrl,
        "_blank",
        "noopener,noreferrer",
      );
    } catch (error) {
      onMessage(
        messageFor(
          error,
          "The declaration PDF could not be prepared for download.",
        ),
      );
    }
  }
  return (
    <div className="mt-6 border-t border-border pt-4">
      <h3 className="text-h5 text-fg">Version history</h3>
      {loading ? (
        <p role="status" className="mt-2 text-subhead-regular text-fg-muted">
          Loading declaration history…
        </p>
      ) : unavailable ? (
        <p role="alert" className="mt-2 text-subhead-regular text-danger">
          Declaration history is temporarily unavailable. Reload before taking
          an action.
        </p>
      ) : declarations.length === 0 ? (
        <p className="mt-2 text-subhead-regular text-fg-muted">
          No declaration drafts or issued versions exist for this product.
        </p>
      ) : (
        <ul
          className="mt-3 grid gap-3"
          aria-label="Declaration version history"
        >
          {declarations.map((declaration) => (
            <li
              key={declaration.id}
              className="rounded-xl border border-border bg-canvas p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-subhead-semibold text-fg">
                    Version {declaration.version} · {label(declaration.status)}
                  </p>
                  <p className="mt-1 text-caption-1-regular text-fg-muted">
                    Signatory: {declaration.signatory.name},{" "}
                    {declaration.signatory.capacity} ·{" "}
                    {dateLabel(declaration.issuedAt)}
                  </p>
                  {declaration.status !== "draft" ? (
                    <p className="mt-1 text-caption-1-regular text-fg-muted">
                      Immutable PDF SHA-256:{" "}
                      {declaration.issuedArtifact?.sha256}
                    </p>
                  ) : null}
                  {declaration.reissueReason ? (
                    <p className="mt-1 text-caption-1-regular text-fg-muted">
                      Reissue reason: {declaration.reissueReason}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {declaration.status === "issued" ? (
                    <Button
                      type="button"
                      variant="outline"
                      tone="grey"
                      loading={download.isPending}
                      onClick={() => void downloadDeclaration(declaration.id)}
                    >
                      Download PDF
                    </Button>
                  ) : null}
                  {canIssue && declaration.status === "issued" ? (
                    <Button
                      type="button"
                      variant="outline"
                      tone="grey"
                      onClick={() => onReissue(declaration)}
                    >
                      Reissue
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IssueConfirmation({
  declaration,
  snapshotSha256,
  productId,
  onClose,
  onMessage,
}: {
  declaration: TechnicalFileDeclaration;
  snapshotSha256: string;
  productId: string;
  onClose: () => void;
  onMessage: (message: string) => void;
}) {
  const issue = useIssueTechnicalFileDeclarationMutation(
    productId,
    declaration.id,
  );
  const [confirmed, setConfirmed] = useState(false);
  async function confirm() {
    try {
      await issue.mutateAsync({
        expectedVersion: declaration.draftVersion,
        previewDigest: declaration.previewDigest,
        snapshotSha256,
        confirmIssue: true,
        idempotencyKey: requestId(),
      });
      onClose();
      onMessage(
        "Declaration issue was prepared from its immutable payload. The PDF will become available after finalization.",
      );
    } catch (error) {
      onMessage(messageFor(error, "The declaration could not be issued."));
    }
  }
  return (
    <dialog
      open
      aria-modal="true"
      aria-labelledby="issue-declaration-title"
      onCancel={onClose}
      className="fixed inset-0 m-auto w-[min(36rem,calc(100%-2rem))] rounded-xl border border-border bg-canvas p-5 text-fg shadow-lg"
    >
      <h3 id="issue-declaration-title" className="text-h4 text-fg">
        Issue declaration version {declaration.version}?
      </h3>
      <p className="mt-3 text-subhead-regular text-fg-muted">
        You are issuing a legal record bound to snapshot{" "}
        {snapshotSha256.slice(0, 16)}… for signatory{" "}
        {declaration.signatory.name}. This records a named responsible
        signatory, not a cryptographic or qualified electronic signature.
      </p>
      <label className="mt-4 flex items-start gap-2 text-subhead-regular text-fg">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>
          I confirm that I am authorized to issue this exact declaration
          revision from the identified immutable snapshot.
        </span>
      </label>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          tone="grey"
          disabled={issue.isPending}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          loading={issue.isPending}
          loadingLabel="Issuing declaration"
          disabled={!confirmed}
          onClick={() => void confirm()}
        >
          Confirm issue
        </Button>
      </div>
    </dialog>
  );
}

function ReissueForm({
  declaration,
  productId,
  snapshotId,
  capacity,
  place,
  route,
  notifiedBody,
  certificateReferences,
  reason,
  onReasonChange,
  onClose,
  onMessage,
}: {
  declaration: TechnicalFileDeclaration;
  productId: string;
  snapshotId: string;
  capacity: string;
  place: string;
  route: Route;
  notifiedBody: { identifier: string; name: string } | null;
  certificateReferences: {
    sourceId: string;
    reference: string;
    version: string;
    issuer: string;
  }[];
  reason: string;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onMessage: (message: string) => void;
}) {
  const reissue = useReissueTechnicalFileDeclarationMutation(
    productId,
    declaration.id,
  );
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim()) {
      onMessage("Record why this immutable declaration needs a new version.");
      return;
    }
    if (!capacity.trim()) {
      onMessage(
        "Record the new responsible signatory capacity before reissuing.",
      );
      return;
    }
    if (!place.trim()) {
      onMessage("Record the place of issue before reissuing.");
      return;
    }
    try {
      await reissue.mutateAsync({
        snapshotId,
        expectedCurrentVersion: declaration.version,
        reason: reason.trim(),
        signatoryCapacity: capacity.trim(),
        signatoryPlace: place.trim(),
        assessmentRoute: route,
        notifiedBody,
        certificateReferences,
        idempotencyKey: requestId(),
      });
      onClose();
      onMessage(
        "A new declaration draft was created. Review the fresh snapshot preview and explicitly issue it when ready.",
      );
    } catch (error) {
      onMessage(messageFor(error, "The reissue draft could not be created."));
    }
  }
  return (
    <form
      onSubmit={submit}
      className="mt-4 rounded-xl border border-border bg-canvas p-3"
      noValidate
    >
      <h3 className="text-h5 text-fg">Reissue version {declaration.version}</h3>
      <p className="mt-1 text-caption-1-regular text-fg-muted">
        This creates a new version from the selected fresh snapshot; it never
        changes the issued PDF.
      </p>
      <label className="mt-3 flex flex-col gap-1 text-caption-1-semibold text-fg">
        Reason for reissue
        <textarea
          value={reason}
          onChange={(event) => onReasonChange(event.target.value)}
          maxLength={2000}
          rows={3}
          required
          className="rounded-lg border border-border bg-surface-subtle px-3 py-2 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="submit"
          loading={reissue.isPending}
          loadingLabel="Creating reissue draft"
        >
          Create reissue draft
        </Button>
        <Button
          type="button"
          variant="outline"
          tone="grey"
          disabled={reissue.isPending}
          onClick={onClose}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
