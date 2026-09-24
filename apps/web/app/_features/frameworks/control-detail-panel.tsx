"use client";

import type { ControlDetailResponse } from "@repo/contracts/frameworks";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";
import { evidenceApi } from "../evidence/evidence.api";
import { productsApi } from "../products/products.api";
import { controlsApi } from "./controls.api";
import { frameworksApi } from "./frameworks.api";

interface Props {
  readonly organizationId: string;
  readonly controlId: string;
  readonly canManage: boolean;
  readonly canViewProducts: boolean;
  readonly canViewEvidence: boolean;
  readonly activePackKey: string | null;
  readonly activeVersionKey: string | null;
}

type Status = "not_started" | "in_progress" | "implemented";
type MappingDraft = {
  mappingId: string | null;
  requirementKey: string;
  rationale: string;
  productIds: string[];
};
type EditDraft = {
  title: string;
  description: string;
  ownerUserId: string;
  status: Status;
  transitionReason: string;
};

const statusRank: Record<Status, number> = {
  not_started: 0,
  in_progress: 1,
  implemented: 2,
};
const statusLabel: Record<Status, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  implemented: "Implemented",
};
const fieldClass = cn(
  "min-h-10 w-full rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active-500",
);
const labelClass = cn("grid gap-2 text-caption-1-regular text-fg");

function displayError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 409)
      return "This control changed in another session. Review the current version; your input is preserved.";
    if (error.status === 403)
      return "Access was denied. Your input is preserved; ask an administrator to check your permissions.";
    if (error.kind === "network")
      return "The server is unreachable. Your input is preserved; retry when online.";
    if (error.kind === "invalid_request" || error.status === 400)
      return "Check the form values and retry. Your input is preserved.";
    return error.message;
  }
  return "The change failed. Your input is preserved; retry.";
}

function date(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );
}

export function ControlDetailPanel({
  organizationId,
  controlId,
  canManage,
  canViewProducts,
  canViewEvidence,
  activePackKey,
  activeVersionKey,
}: Props) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [mappingDraft, setMappingDraft] = useState<MappingDraft | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkProductId, setLinkProductId] = useState("");
  const [linkDocumentId, setLinkDocumentId] = useState("");
  const [linkVersionId, setLinkVersionId] = useState("");
  const [coverageProductId, setCoverageProductId] = useState("");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageError, setMessageError] = useState(false);
  const [busy, setBusy] = useState(false);
  const retry = useRef<{ signature: string; key: string } | null>(null);

  const detail = useQuery({
    queryKey: ["framework-controls", organizationId, "detail", controlId],
    queryFn: ({ signal }) => controlsApi.get(controlId, signal),
    retry: false,
  });
  const owners = useQuery({
    queryKey: ["framework-controls", organizationId, "owner-candidates"],
    queryFn: ({ signal }) => controlsApi.ownerCandidates(undefined, signal),
    enabled: canManage && editing,
    retry: false,
  });
  const products = useInfiniteQuery({
    queryKey: ["framework-controls", organizationId, "products"],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      productsApi.list(
        { page: pageParam, pageSize: 100, archived: false },
        signal,
      ),
    getNextPageParam: (lastPage) =>
      lastPage.products.page < lastPage.products.pageCount
        ? lastPage.products.page + 1
        : undefined,
    enabled: canViewProducts,
    retry: false,
  });
  const productRows =
    products.data?.pages.flatMap((page) => page.products.rows) ?? [];
  const selectedCoverageProduct = coverageProductId || productRows[0]?.id || "";
  const selectedLinkProduct = linkProductId || productRows[0]?.id || "";
  const evidence = useInfiniteQuery({
    queryKey: [
      "framework-controls",
      organizationId,
      "evidence",
      selectedLinkProduct,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      evidenceApi.list(
        selectedLinkProduct,
        { limit: 100, cursor: pageParam },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: canViewEvidence && linking && Boolean(selectedLinkProduct),
    retry: false,
  });
  const evidenceDocuments =
    evidence.data?.pages.flatMap((page) =>
      page.items.map((item) => item.document),
    ) ?? [];
  const selectedDocument = linkDocumentId || evidenceDocuments[0]?.id || "";
  const documentVersions = useQuery({
    queryKey: [
      "framework-controls",
      organizationId,
      "evidence-versions",
      selectedLinkProduct,
      selectedDocument,
    ],
    queryFn: ({ signal }) =>
      evidenceApi.versions(selectedLinkProduct, selectedDocument, signal),
    enabled:
      canViewEvidence &&
      linking &&
      Boolean(selectedLinkProduct && selectedDocument),
    retry: false,
  });
  const evidenceVersions =
    documentVersions.data?.versions.filter((version) => {
      const today = new Date().toISOString().slice(0, 10);
      return (
        version.status === "clean" &&
        version.productIds.includes(selectedLinkProduct) &&
        (version.validFrom === null ||
          version.validFrom.slice(0, 10) <= today) &&
        (version.validUntil === null ||
          version.validUntil.slice(0, 10) >= today)
      );
    }) ?? [];
  const requirements = useInfiniteQuery({
    queryKey: [
      "framework-controls",
      organizationId,
      "mapping-tree",
      activePackKey,
      activeVersionKey,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      if (!activePackKey || !activeVersionKey)
        throw new Error("Select an enabled framework version.");
      return frameworksApi.tree(
        activePackKey,
        activeVersionKey,
        pageParam,
        signal,
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(mappingDraft && activePackKey && activeVersionKey),
    retry: false,
  });
  const requirementRows =
    requirements.data?.pages.flatMap((page) => page.requirements) ?? [];
  const selectedRequirement = requirementRows.find(
    (item) => item.requirementKey === mappingDraft?.requirementKey,
  );
  const coverage = useInfiniteQuery({
    queryKey: [
      "framework-controls",
      organizationId,
      "coverage",
      activePackKey,
      activeVersionKey,
      selectedCoverageProduct,
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      if (!activePackKey || !activeVersionKey || !selectedCoverageProduct)
        throw new Error("Choose a product and framework version.");
      return controlsApi.coverage(
        activePackKey,
        activeVersionKey,
        selectedCoverageProduct,
        pageParam,
        signal,
      );
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(
      canViewProducts &&
      canViewEvidence &&
      activePackKey &&
      activeVersionKey &&
      selectedCoverageProduct,
    ),
    retry: false,
  });

  async function runCommand(
    action: string,
    payload: unknown,
    command: (revision: number, idempotencyKey: string) => Promise<unknown>,
  ): Promise<boolean> {
    if (!detail.data || busy) return false;
    setBusy(true);
    setMessage(null);
    const signature = JSON.stringify([
      organizationId,
      controlId,
      action,
      detail.data.revision,
      payload,
    ]);
    const idempotencyKey =
      retry.current?.signature === signature
        ? retry.current.key
        : crypto.randomUUID();
    retry.current = { signature, key: idempotencyKey };
    try {
      await command(detail.data.revision, idempotencyKey);
      retry.current = null;
      setMessage(`${action} saved.`);
      setMessageError(false);
      void client.invalidateQueries({
        queryKey: ["framework-controls", organizationId],
      });
      return true;
    } catch (error) {
      setMessage(displayError(error));
      setMessageError(true);
      if (error instanceof ApiClientError && error.status === 409) {
        retry.current = null;
        void detail.refetch();
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(control: ControlDetailResponse) {
    setEditDraft({
      title: control.title,
      description: control.description,
      ownerUserId: control.ownerUserId,
      status: control.status,
      transitionReason: "",
    });
    setEditing(true);
    setMessage(null);
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editDraft || !detail.data) return;
    const backward =
      statusRank[editDraft.status] < statusRank[detail.data.status];
    if (backward && !editDraft.transitionReason.trim()) {
      setMessage("Explain why implementation status moved backward.");
      setMessageError(true);
      return;
    }
    const saved = await runCommand(
      "Control",
      editDraft,
      (expectedRevision, idempotencyKey) =>
        controlsApi.update(controlId, {
          title: editDraft.title,
          description: editDraft.description,
          ownerUserId: editDraft.ownerUserId,
          status: editDraft.status,
          ...(backward ? { transitionReason: editDraft.transitionReason } : {}),
          expectedRevision,
          idempotencyKey,
        }),
    );
    if (saved) setEditing(false);
  }

  async function saveMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mappingDraft || !activePackKey || !activeVersionKey) return;
    const { mappingId, ...draft } = mappingDraft;
    const saved = await runCommand(
      "Mapping",
      draft,
      (expectedRevision, idempotencyKey) => {
        const input = {
          packKey: activePackKey,
          versionKey: activeVersionKey,
          requirementKey: draft.requirementKey,
          rationale: draft.rationale,
          productIds: draft.productIds,
          expectedRevision,
          idempotencyKey,
        };
        return mappingId
          ? controlsApi.updateMapping(controlId, mappingId, input)
          : controlsApi.addMapping(controlId, input);
      },
    );
    if (saved) setMappingDraft(null);
  }

  const control = detail.data;
  const coverageRows =
    coverage.data?.pages.flatMap((page) => page.requirements) ?? [];
  if (detail.isLoading)
    return (
      <SectionCard title="Control detail">
        <p role="status" className={cn("text-subhead-regular text-fg-muted")}>
          Loading control…
        </p>
      </SectionCard>
    );
  if (detail.isError || !control)
    return (
      <SectionCard title="Control unavailable">
        <p role="alert" className={cn("text-subhead-regular text-danger")}>
          {displayError(detail.error)}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("mt-3")}
          onClick={() => void detail.refetch()}
        >
          Retry control
        </Button>
      </SectionCard>
    );

  return (
    <div className={cn("grid gap-6")}>
      <SectionCard title={control.title}>
        <div className={cn("flex flex-wrap items-start justify-between gap-3")}>
          <div className={cn("grid gap-2 text-subhead-regular text-fg")}>
            <p className={cn("whitespace-pre-wrap break-words")}>
              {control.description}
            </p>
            <p>Implementation: {statusLabel[control.status]}</p>
            <p>
              {control.ownerActive
                ? "Owner assigned"
                : "Owner needs reassignment"}
            </p>
            <p className={cn("text-caption-1-regular text-fg-muted")}>
              Revision {control.revision} · Updated {date(control.updatedAt)}
            </p>
            {control.archivedAt ? (
              <p>Archived {date(control.archivedAt)}</p>
            ) : null}
          </div>
          {canManage && !control.archivedAt ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => beginEdit(control)}
            >
              Edit control
            </Button>
          ) : null}
        </div>
        {message ? (
          <p
            role={messageError ? "alert" : "status"}
            className={cn(
              "mt-4 text-caption-1-regular",
              messageError ? "text-danger" : "text-fg",
            )}
          >
            {message}
          </p>
        ) : null}
        {editing && editDraft && canManage && !control.archivedAt ? (
          <form
            onSubmit={(event) => void saveEdit(event)}
            className={cn("mt-5 grid gap-4 border-t border-border pt-5")}
          >
            <label className={labelClass}>
              Control title
              <input
                className={fieldClass}
                required
                maxLength={200}
                value={editDraft.title}
                onChange={(event) =>
                  setEditDraft({ ...editDraft, title: event.target.value })
                }
              />
            </label>
            <label className={labelClass}>
              Description
              <textarea
                className={fieldClass}
                required
                maxLength={4000}
                rows={3}
                value={editDraft.description}
                onChange={(event) =>
                  setEditDraft({
                    ...editDraft,
                    description: event.target.value,
                  })
                }
              />
            </label>
            <label className={labelClass}>
              Owner
              <select
                className={fieldClass}
                value={editDraft.ownerUserId}
                onChange={(event) =>
                  setEditDraft({
                    ...editDraft,
                    ownerUserId: event.target.value,
                  })
                }
              >
                {!owners.data?.owners.some(
                  (owner) => owner.id === editDraft.ownerUserId,
                ) ? (
                  <option value={editDraft.ownerUserId}>Recorded owner</option>
                ) : null}
                {owners.data?.owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Implementation status
              <select
                className={fieldClass}
                value={editDraft.status}
                onChange={(event) =>
                  setEditDraft({
                    ...editDraft,
                    status: event.target.value as Status,
                  })
                }
              >
                <option value="not_started">Not started</option>
                <option value="in_progress">In progress</option>
                <option value="implemented">Implemented</option>
              </select>
            </label>
            {statusRank[editDraft.status] < statusRank[control.status] ? (
              <label className={labelClass}>
                Reason for moving status backward
                <input
                  className={fieldClass}
                  required
                  maxLength={1000}
                  value={editDraft.transitionReason}
                  onChange={(event) =>
                    setEditDraft({
                      ...editDraft,
                      transitionReason: event.target.value,
                    })
                  }
                />
              </label>
            ) : null}
            {owners.isError ? (
              <p
                role="alert"
                className={cn("text-caption-1-regular text-danger")}
              >
                Owner choices could not be loaded. Retry before changing the
                owner.
              </p>
            ) : null}
            <div className={cn("flex flex-wrap gap-3")}>
              <Button type="submit" disabled={busy} loading={busy}>
                Save changes
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(false)}
              >
                Close editor
              </Button>
            </div>
          </form>
        ) : null}
        {canManage && !control.archivedAt ? (
          <div className={cn("mt-5 border-t border-border pt-5")}>
            {confirmArchive ? (
              <div className={cn("flex flex-wrap items-center gap-3")}>
                <p className={cn("text-subhead-regular text-fg")}>
                  Archive this control? Historical links remain readable.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void runCommand(
                      "Archive",
                      {},
                      (expectedRevision, idempotencyKey) =>
                        controlsApi.archive(controlId, {
                          expectedRevision,
                          idempotencyKey,
                        }),
                    )
                  }
                >
                  Confirm archive
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmArchive(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmArchive(true)}
              >
                Archive control
              </Button>
            )}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Evidence versions">
        <p className={cn("text-subhead-regular text-fg-muted")}>
          Links pin the exact document version. Availability can change later
          without changing history.
        </p>
        {control.evidenceRestricted ? (
          <p className={cn("mt-3 text-subhead-regular text-fg-muted")}>
            Evidence links are restricted for your role.
          </p>
        ) : null}
        {!control.evidenceRestricted && control.evidenceLinks.length === 0 ? (
          <p className={cn("mt-3 text-subhead-regular text-fg-muted")}>
            No evidence versions linked.
          </p>
        ) : null}
        <ul className={cn("mt-3 divide-y divide-border")}>
          {control.evidenceLinks.map((link) => (
            <li
              key={link.id}
              className={cn(
                "flex flex-wrap items-center justify-between gap-3 py-3 text-subhead-regular text-fg",
              )}
            >
              <div>
                <p>
                  {link.evidenceTitle} · Version {link.evidenceVersionNumber}
                </p>
                <p className={cn("text-caption-1-regular text-fg-muted")}>
                  Evidence: {link.availability[0]?.toUpperCase()}
                  {link.availability.slice(1)} · Product{" "}
                  {productRows.find((product) => product.id === link.productId)
                    ?.name ?? link.productId}
                  {link.endedAt ? " · Ended" : ""}
                </p>
              </div>
              {canManage && !control.archivedAt && !link.endedAt ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void runCommand(
                      "Evidence link",
                      { linkId: link.id },
                      (expectedRevision, idempotencyKey) =>
                        controlsApi.endEvidenceLink(controlId, link.id, {
                          expectedRevision,
                          idempotencyKey,
                        }),
                    )
                  }
                >
                  End link
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {canManage &&
        canViewProducts &&
        canViewEvidence &&
        !control.archivedAt ? (
          <div className={cn("mt-4")}>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLinking(!linking)}
            >
              {linking ? "Close evidence picker" : "Link evidence version"}
            </Button>
            {linking ? (
              <div className={cn("mt-4 grid gap-4")}>
                <label className={labelClass}>
                  Evidence product
                  <select
                    className={fieldClass}
                    value={selectedLinkProduct}
                    onChange={(event) => {
                      setLinkProductId(event.target.value);
                      setLinkDocumentId("");
                      setLinkVersionId("");
                    }}
                  >
                    <option value="">Choose a product</option>
                    {productRows.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Evidence document
                  <select
                    className={fieldClass}
                    value={selectedDocument}
                    onChange={(event) => {
                      setLinkDocumentId(event.target.value);
                      setLinkVersionId("");
                    }}
                  >
                    <option value="">Choose a document</option>
                    {evidenceDocuments.map((document) => (
                      <option key={document.id} value={document.id}>
                        {document.currentVersion.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Clean evidence version
                  <select
                    className={fieldClass}
                    value={linkVersionId}
                    onChange={(event) => setLinkVersionId(event.target.value)}
                  >
                    <option value="">Choose an evidence version</option>
                    {evidenceVersions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {version.title} · Version {version.versionNumber}
                      </option>
                    ))}
                  </select>
                </label>
                {evidence.isError ? (
                  <p
                    role="alert"
                    className={cn("text-caption-1-regular text-danger")}
                  >
                    Evidence could not be loaded. Retry without losing your
                    choice.
                  </p>
                ) : null}
                {documentVersions.isError ? (
                  <p
                    role="alert"
                    className={cn("text-caption-1-regular text-danger")}
                  >
                    Document versions could not be loaded. Retry without losing
                    your choice.
                  </p>
                ) : null}
                {evidence.hasNextPage ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void evidence.fetchNextPage()}
                  >
                    Load more evidence
                  </Button>
                ) : null}
                <Button
                  type="button"
                  disabled={busy || !selectedLinkProduct || !linkVersionId}
                  onClick={() =>
                    void runCommand(
                      "Evidence link",
                      { selectedLinkProduct, linkVersionId },
                      (expectedRevision, idempotencyKey) =>
                        controlsApi.linkEvidence(controlId, {
                          productId: selectedLinkProduct,
                          evidenceVersionId: linkVersionId,
                          expectedRevision,
                          idempotencyKey,
                        }),
                    )
                  }
                >
                  Save evidence link
                </Button>
              </div>
            ) : null}
          </div>
        ) : !canViewEvidence ? (
          <p className={cn("mt-3 text-subhead-regular text-fg-muted")}>
            Evidence access is required to add links.
          </p>
        ) : null}
      </SectionCard>

      <SectionCard title="Requirement mappings">
        <p className={cn("text-subhead-regular text-fg-muted")}>
          Each mapping pins one published requirement version and an explicit
          set of products.
        </p>
        {control.mappings.length === 0 ? (
          <p className={cn("mt-3 text-subhead-regular text-fg-muted")}>
            No requirements mapped yet.
          </p>
        ) : null}
        <ul className={cn("mt-3 divide-y divide-border")}>
          {control.mappings.map((mapping) => (
            <li
              key={mapping.id}
              className={cn("grid gap-2 py-4 text-subhead-regular text-fg")}
            >
              <p className={cn("font-semibold")}>
                {mapping.identifier} · {mapping.heading ?? "Requirement"}
                {mapping.endedAt ? " · Ended" : ""}
              </p>
              <p className={cn("whitespace-pre-wrap break-words")}>
                {mapping.requirementText}
              </p>
              <p>Rationale: {mapping.rationale}</p>
              <p className={cn("text-caption-1-regular text-fg-muted")}>
                Edition {mapping.versionKey} ·{" "}
                {mapping.productsRestricted
                  ? "Product scope restricted"
                  : `Products: ${mapping.productIds.map((id) => productRows.find((product) => product.id === id)?.name ?? id).join(", ")}`}
              </p>
              {canManage && !control.archivedAt && !mapping.endedAt ? (
                <div className={cn("flex flex-wrap gap-3")}>
                  {mapping.packKey === activePackKey &&
                  mapping.versionKey === activeVersionKey ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setMappingDraft({
                          mappingId: mapping.id,
                          requirementKey: mapping.requirementKey,
                          rationale: mapping.rationale,
                          productIds: [...mapping.productIds],
                        })
                      }
                    >
                      Edit mapping
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void runCommand(
                        "Mapping end",
                        { mappingId: mapping.id },
                        (expectedRevision, idempotencyKey) =>
                          controlsApi.endMapping(controlId, mapping.id, {
                            expectedRevision,
                            idempotencyKey,
                          }),
                      )
                    }
                  >
                    End mapping
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {!activePackKey || !activeVersionKey ? (
          <p className={cn("mt-4 text-subhead-regular text-fg-muted")}>
            Enable a framework edition before adding a mapping. Historical
            mappings remain readable.
          </p>
        ) : null}
        {canManage &&
        canViewProducts &&
        activePackKey &&
        activeVersionKey &&
        !control.archivedAt ? (
          <div className={cn("mt-4")}>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setMappingDraft({
                  mappingId: null,
                  requirementKey: "",
                  rationale: "",
                  productIds: [],
                })
              }
            >
              Map requirement
            </Button>
            {mappingDraft ? (
              <form
                onSubmit={(event) => void saveMapping(event)}
                className={cn("mt-4 grid gap-4")}
              >
                <label className={labelClass}>
                  Requirement
                  <select
                    className={fieldClass}
                    required
                    value={mappingDraft.requirementKey}
                    onChange={(event) =>
                      setMappingDraft({
                        ...mappingDraft,
                        requirementKey: event.target.value,
                      })
                    }
                  >
                    <option value="">Choose a requirement</option>
                    {requirementRows.map((requirement) => (
                      <option
                        key={requirement.requirementKey}
                        value={requirement.requirementKey}
                      >
                        {requirement.identifier} ·{" "}
                        {requirement.heading ?? requirement.text.slice(0, 90)}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedRequirement ? (
                  <p
                    className={cn(
                      "whitespace-pre-wrap break-words text-subhead-regular text-fg",
                    )}
                  >
                    {selectedRequirement.text}
                  </p>
                ) : null}
                {requirements.isError ? (
                  <p
                    role="alert"
                    className={cn("text-caption-1-regular text-danger")}
                  >
                    Requirements could not be loaded. Retry without losing your
                    input.
                  </p>
                ) : null}
                {requirements.hasNextPage ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void requirements.fetchNextPage()}
                  >
                    Load more requirements
                  </Button>
                ) : null}
                <label className={labelClass}>
                  Rationale
                  <textarea
                    className={fieldClass}
                    required
                    maxLength={2000}
                    rows={3}
                    value={mappingDraft.rationale}
                    onChange={(event) =>
                      setMappingDraft({
                        ...mappingDraft,
                        rationale: event.target.value,
                      })
                    }
                  />
                </label>
                <fieldset className={cn("grid gap-2")}>
                  <legend className={cn("text-caption-1-regular text-fg")}>
                    Applicable products
                  </legend>
                  <div
                    className={cn(
                      "grid max-h-48 gap-2 overflow-y-auto rounded-xl border border-border p-3",
                    )}
                  >
                    {productRows.map((product) => (
                      <label
                        key={product.id}
                        className={cn(
                          "flex items-center gap-2 text-subhead-regular text-fg",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={mappingDraft.productIds.includes(product.id)}
                          onChange={(event) =>
                            setMappingDraft({
                              ...mappingDraft,
                              productIds: event.target.checked
                                ? [...mappingDraft.productIds, product.id]
                                : mappingDraft.productIds.filter(
                                    (id) => id !== product.id,
                                  ),
                            })
                          }
                        />
                        {product.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                {products.hasNextPage ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void products.fetchNextPage()}
                  >
                    Load more products
                  </Button>
                ) : null}
                {mappingDraft.productIds.length === 0 ? (
                  <p className={cn("text-caption-1-regular text-fg-muted")}>
                    Select at least one product; new products are never included
                    automatically.
                  </p>
                ) : null}
                <div className={cn("flex flex-wrap gap-3")}>
                  <Button
                    type="submit"
                    disabled={
                      busy ||
                      !mappingDraft.requirementKey ||
                      mappingDraft.productIds.length === 0
                    }
                    loading={busy}
                  >
                    Save mapping
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setMappingDraft(null)}
                  >
                    Close picker
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Product coverage">
        <p className={cn("text-subhead-regular text-fg-muted")}>
          Mapped means an active control applies to this product and
          requirement. Implementation and evidence are separate indicators.
        </p>
        {!canViewProducts || !canViewEvidence ? (
          <p className={cn("mt-3 text-subhead-regular text-fg-muted")}>
            Product and evidence permissions are required to read coverage.
          </p>
        ) : null}
        {canViewProducts &&
        canViewEvidence &&
        activePackKey &&
        activeVersionKey ? (
          <>
            <label
              className={cn(
                "mt-4 grid max-w-lg gap-2 text-caption-1-regular text-fg",
              )}
            >
              Coverage product
              <select
                className={fieldClass}
                value={selectedCoverageProduct}
                onChange={(event) => setCoverageProductId(event.target.value)}
              >
                <option value="">Choose a product</option>
                {productRows.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </label>
            {products.hasNextPage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn("mt-3")}
                onClick={() => void products.fetchNextPage()}
              >
                Load more products
              </Button>
            ) : null}
            {coverage.isLoading ? (
              <p
                role="status"
                className={cn("mt-4 text-subhead-regular text-fg-muted")}
              >
                Loading product coverage…
              </p>
            ) : null}
            {coverage.isError ? (
              <div className={cn("mt-4")}>
                <p
                  role="alert"
                  className={cn("text-subhead-regular text-danger")}
                >
                  {displayError(coverage.error)}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn("mt-2")}
                  onClick={() => void coverage.refetch()}
                >
                  Retry coverage
                </Button>
              </div>
            ) : null}
            {coverage.data ? (
              <>
                <ul
                  aria-label="Requirement coverage for selected product"
                  className={cn("mt-4 divide-y divide-border md:hidden")}
                >
                  {coverageRows.map((requirement) => (
                    <li
                      key={requirement.requirementKey}
                      className={cn(
                        "grid min-w-0 gap-2 py-4 text-subhead-regular text-fg",
                      )}
                    >
                      <p className={cn("break-words font-semibold")}>
                        {requirement.identifier}
                      </p>
                      <p className={cn("whitespace-pre-wrap break-words")}>
                        {requirement.text}
                      </p>
                      <p>
                        Mapping:{" "}
                        {requirement.controls.length > 0
                          ? "Mapped"
                          : "Unmapped"}
                      </p>
                      {requirement.controls.map((item) => (
                        <p
                          key={item.id}
                          className={cn("break-words text-fg-muted")}
                        >
                          {item.title} · {statusLabel[item.status]} · Evidence{" "}
                          {item.evidencePresent ? "present" : "absent"}
                          {item.ownerActive ? "" : " · Owner gap"}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
                <div className={cn("mt-4 hidden overflow-x-auto md:block")}>
                  <table
                    className={cn(
                      "w-full min-w-[640px] border-collapse text-left text-subhead-regular text-fg",
                    )}
                  >
                    <caption className={cn("sr-only")}>
                      Requirement coverage for selected product
                    </caption>
                    <thead>
                      <tr
                        className={cn(
                          "border-b border-border text-caption-1-regular text-fg-muted",
                        )}
                      >
                        <th scope="col" className={cn("px-3 py-2 font-medium")}>
                          Requirement
                        </th>
                        <th scope="col" className={cn("px-3 py-2 font-medium")}>
                          Mapping
                        </th>
                        <th scope="col" className={cn("px-3 py-2 font-medium")}>
                          Controls
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {coverageRows.map((requirement) => (
                        <tr
                          key={requirement.requirementKey}
                          className={cn("border-b border-border last:border-0")}
                        >
                          <th
                            scope="row"
                            className={cn("px-3 py-3 align-top font-medium")}
                          >
                            <p>{requirement.identifier}</p>
                            <p
                              className={cn(
                                "max-w-prose whitespace-pre-wrap break-words font-normal",
                              )}
                            >
                              {requirement.text}
                            </p>
                          </th>
                          <td className={cn("px-3 py-3 align-top")}>
                            {requirement.controls.length > 0
                              ? "Mapped"
                              : "Unmapped"}
                          </td>
                          <td className={cn("px-3 py-3 align-top")}>
                            {requirement.controls.length === 0
                              ? "—"
                              : requirement.controls.map((item) => (
                                  <p key={item.id}>
                                    {item.title} · {statusLabel[item.status]} ·
                                    Evidence{" "}
                                    {item.evidencePresent
                                      ? "present"
                                      : "absent"}
                                    {item.ownerActive ? "" : " · Owner gap"}
                                  </p>
                                ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
            {coverage.hasNextPage ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn("mt-4")}
                onClick={() => void coverage.fetchNextPage()}
              >
                Load more coverage
              </Button>
            ) : null}
          </>
        ) : null}
      </SectionCard>
    </div>
  );
}
