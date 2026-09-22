"use client";

import {
  createSupplierEvidenceRequestInputSchema,
  closeSupplierEvidenceRequestInputSchema,
  issueSupplierEvidenceRequestInputSchema,
  previewSupplierEvidenceRequestInputSchema,
  reissueSupplierEvidenceRequestInputSchema,
  revokeSupplierEvidenceRequestInputSchema,
  type SupplierEvidencePreview,
  type PreviewSupplierEvidenceRequestInput,
  type SupplierEvidenceRequestSummary,
} from "@repo/contracts/supplier-evidence";
import { Button } from "@repo/ui/button";
import { Tag } from "@repo/ui/tag";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";
import { useProductsQuery } from "../products/products.queries";
import {
  useCreateSupplierEvidenceRequestMutation,
  useSupplierEvidenceRequestsQuery,
} from "./supplier-evidence.queries";
import { supplierEvidenceApi } from "./supplier-evidence.api";

const SupplierEvidenceReviewPanel = dynamic(
  () =>
    import("./supplier-evidence-review-panel").then(
      (module) => module.SupplierEvidenceReviewPanel,
    ),
  {
    loading: () => (
      <p role="status" className="mt-6 text-caption-1-regular text-fg-muted">
        Loading supplier evidence review…
      </p>
    ),
  },
);

const SupplierEvidenceRemindersPanel = dynamic(
  () =>
    import("./supplier-evidence-reminders-panel").then(
      (module) => module.SupplierEvidenceRemindersPanel,
    ),
  {
    loading: () => (
      <p role="status" className="mt-6 text-caption-1-regular text-fg-muted">
        Loading supplier follow-up…
      </p>
    ),
  },
);

type ItemDraft = Readonly<{
  key: string;
  title: string;
  instructions: string;
  documentClass: string;
}>;
const initialItem = (): ItemDraft => ({
  key: crypto.randomUUID(),
  title: "",
  instructions: "",
  documentClass: "other",
});

function messageFor(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to issue supplier evidence requests.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This request changed elsewhere. Refresh it before issuing.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "You are offline. The request draft is still here.";
  return error instanceof ApiClientError
    ? error.message
    : "The evidence request could not be completed.";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function RequestActions({
  request,
  onChanged,
}: Readonly<{
  request: SupplierEvidenceRequestSummary;
  onChanged: () => Promise<unknown>;
}>) {
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function reissue() {
    setMessage(null);
    setPending(true);
    try {
      const preview = await supplierEvidenceApi.preview(
        previewSupplierEvidenceRequestInputSchema.parse({
          supplierId: request.supplierId,
          productId: request.productId,
          ownerUserId: request.ownerUserId,
          recipientContactId: request.recipientContactId,
          title: request.currentRevision.title,
          instructions: request.currentRevision.instructions ?? undefined,
          dueAt: request.currentRevision.dueAt,
          disclosureContent:
            request.currentRevision.disclosureContent ?? undefined,
          items: request.currentRevision.items.map((item) => ({
            title: item.title,
            instructions: item.instructions ?? undefined,
            documentClass: item.documentClass,
          })),
        }),
      );
      await supplierEvidenceApi.reissue(
        request.id,
        reissueSupplierEvidenceRequestInputSchema.parse({
          expectedVersion: request.version,
          previewFingerprint: preview.preview.fingerprint,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      await onChanged();
      setMessage(
        "A new invitation was sent and prior active access was revoked.",
      );
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setPending(false);
    }
  }
  async function revoke() {
    if (!request.activeInvitation) return;
    setMessage(null);
    setPending(true);
    try {
      await supplierEvidenceApi.revoke(
        request.id,
        revokeSupplierEvidenceRequestInputSchema.parse({
          invitationId: request.activeInvitation.id,
          reason,
          expectedVersion: request.version,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      await onChanged();
      setReason("");
      setMessage("The active invitation was revoked.");
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setPending(false);
    }
  }
  async function close() {
    setMessage(null);
    setPending(true);
    try {
      await supplierEvidenceApi.close(
        request.id,
        closeSupplierEvidenceRequestInputSchema.parse({
          reason,
          expectedVersion: request.version,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      await onChanged();
      setReason("");
      setMessage(
        "The request was closed. Further supplier submissions are blocked.",
      );
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setPending(false);
    }
  }
  if (request.state !== "open") return null;
  return (
    <div className="mt-3 border-t border-border pt-3">
      <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
        Reason for revocation or closure
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="h-9 rounded-lg border border-border bg-canvas px-2 text-caption-1-regular text-fg"
        />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => void reissue()}
        >
          Reissue invitation
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || !request.activeInvitation}
          onClick={() => void revoke()}
        >
          Revoke invitation
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => void close()}
        >
          Close request
        </Button>
      </div>
      {message ? (
        <p role="status" className="mt-2 text-caption-1-regular text-fg-muted">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function IssuedRequestHistory({
  requests,
  onChanged,
}: Readonly<{
  requests: readonly SupplierEvidenceRequestSummary[];
  onChanged: () => Promise<unknown>;
}>) {
  if (requests.length === 0)
    return (
      <p className="text-caption-1-regular text-fg-muted">
        No scoped evidence requests have been issued for this supplier.
      </p>
    );
  return (
    <ul className="grid gap-2" aria-label="Supplier evidence request history">
      {requests.map((request) => (
        <li
          key={request.id}
          className="rounded-xl border border-border p-3 text-caption-1-regular text-fg"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong>{request.currentRevision.title}</strong>
            <Tag
              variant="dot"
              tone={request.state === "open" ? "green" : "purple"}
            >
              {request.state}
            </Tag>
          </div>
          <p className="mt-1 text-fg-muted">
            Due {formatDate(request.currentRevision.dueAt)} · revision{" "}
            {request.currentRevision.revisionNumber} ·{" "}
            {request.currentRevision.items.length} requested item
            {request.currentRevision.items.length === 1 ? "" : "s"}
          </p>
          {request.activeInvitation ? (
            <p
              role={
                request.activeInvitation.deliveryState === "failed"
                  ? "alert"
                  : "status"
              }
              className="mt-1 text-fg-muted"
            >
              Invitation delivery: {request.activeInvitation.deliveryState}
              {request.activeInvitation.deliveryFailureMessage
                ? ` · ${request.activeInvitation.deliveryFailureMessage}`
                : ""}
            </p>
          ) : null}
          <RequestActions request={request} onChanged={onChanged} />
        </li>
      ))}
    </ul>
  );
}

/** Compact internal flow: create a draft, preview the supplier payload, then issue the pinned revision. */
export function SupplierEvidenceRequestPanel({
  supplierId,
  contacts,
  ownerUserId,
  readEnabled,
  canReview,
  canManage,
  disabled,
}: Readonly<{
  supplierId: string;
  contacts: readonly Readonly<{
    id: string;
    name: string;
    email: string | null;
    state: string;
  }>[];
  ownerUserId: string | null;
  readEnabled: boolean;
  canReview: boolean;
  canManage: boolean;
  disabled: boolean;
}>) {
  const create = useCreateSupplierEvidenceRequestMutation();
  const requests = useSupplierEvidenceRequestsQuery(readEnabled);
  const products = useProductsQuery(
    { page: 1, pageSize: 100, archived: false },
    !disabled,
  );
  const [portalPreview, setPortalPreview] =
    useState<SupplierEvidencePreview | null>(null);
  const [previewInput, setPreviewInput] =
    useState<PreviewSupplierEvidenceRequestInput | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [productId, setProductId] = useState("");
  const [recipientContactId, setRecipientContactId] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [disclosureContent, setDisclosureContent] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [items, setItems] = useState<readonly ItemDraft[]>([initialItem()]);
  const [message, setMessage] = useState<string | null>(null);
  const activeContacts = useMemo(
    () =>
      contacts.filter(
        (contact) => contact.state === "active" && contact.email !== null,
      ),
    [contacts],
  );
  const history = useMemo(
    () =>
      (requests.data?.requests ?? []).filter(
        (request) => request.supplierId === supplierId,
      ),
    [requests.data?.requests, supplierId],
  );

  const content = () => ({
    title,
    instructions: instructions.trim() || undefined,
    dueAt: (() => {
      const parsed = new Date(dueAt);
      return dueAt && !Number.isNaN(parsed.getTime())
        ? parsed.toISOString()
        : "";
    })(),
    disclosureContent: disclosureContent.trim() || undefined,
    items: items.map(
      ({
        title: itemTitle,
        instructions: itemInstructions,
        documentClass,
      }) => ({
        title: itemTitle,
        instructions: itemInstructions.trim() || undefined,
        documentClass,
      }),
    ),
  });
  async function previewRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const previewedInput = previewSupplierEvidenceRequestInputSchema.safeParse({
      ...content(),
      supplierId,
      productId,
      ownerUserId,
      recipientContactId,
    });
    if (!previewedInput.success) {
      setMessage(
        previewedInput.error.issues[0]?.message ??
          "Review the recipient, due date, and requested items.",
      );
      return;
    }
    try {
      const previewed = await supplierEvidenceApi.preview(previewedInput.data);
      setPreviewInput(previewedInput.data);
      setPortalPreview(previewed.preview);
      setMessage(
        "Preview the exact supplier payload below before issuing the invitation.",
      );
    } catch (error) {
      setMessage(messageFor(error));
    }
  }
  async function issueRequest() {
    if (!previewInput || !portalPreview) return;
    setMessage(null);
    setIssuing(true);
    try {
      const created = await create.mutateAsync(
        createSupplierEvidenceRequestInputSchema.parse({
          ...previewInput,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
      const issueInput = issueSupplierEvidenceRequestInputSchema.parse({
        revisionId: created.request.currentRevision.id,
        expectedVersion: created.request.version,
        previewFingerprint: portalPreview.fingerprint,
        idempotencyKey: crypto.randomUUID(),
      });
      await supplierEvidenceApi.issue(created.request.id, issueInput);
      await requests.refetch();
      setMessage(
        "The request was issued. The supplier receives only this approved payload by invitation.",
      );
      setPreviewInput(null);
      setPortalPreview(null);
      setTitle("");
      setInstructions("");
      setDisclosureContent("");
      setDueAt("");
      setItems([initialItem()]);
    } catch (error) {
      setMessage(messageFor(error));
    } finally {
      setIssuing(false);
    }
  }

  return (
    <SectionCard title="Evidence requests">
      <p className="text-caption-1-regular text-fg-muted">
        Issue a scoped supplier portal request. Product, findings, and
        organization data are never disclosed unless explicitly written into the
        approved disclosure text.
      </p>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-2"
        noValidate
        onSubmit={(event) => void previewRequest(event)}
      >
        <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
          Recipient contact
          <select
            required
            disabled={disabled || activeContacts.length === 0}
            value={recipientContactId}
            onChange={(event) => setRecipientContactId(event.target.value)}
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          >
            <option value="">Select an active email contact</option>
            {activeContacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name} · {contact.email}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
          Due date
          <input
            required
            disabled={disabled}
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
        </label>
        <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
          Product
          <select
            required
            disabled={disabled || products.isLoading}
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          >
            <option value="">
              {products.isLoading
                ? "Loading products…"
                : "Select an authorized product"}
            </option>
            {(products.data?.products.rows ?? []).map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} · {product.internalCode}
              </option>
            ))}
          </select>
        </label>
        <p className="flex flex-col gap-1 text-caption-1-regular text-fg">
          <span>Internal owner</span>
          <span className="h-10 rounded-xl border border-border bg-surface px-3 py-2 text-subhead-regular text-fg-muted">
            {ownerUserId
              ? "You will be recorded as the request owner."
              : "Your active session is required."}
          </span>
        </p>
        <label className="sm:col-span-2 flex flex-col gap-1 text-caption-1-regular text-fg">
          Supplier-facing title
          <input
            required
            disabled={disabled}
            maxLength={160}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
        </label>
        <label className="sm:col-span-2 flex flex-col gap-1 text-caption-1-regular text-fg">
          Instructions <span className="text-fg-muted">(supplier-visible)</span>
          <textarea
            disabled={disabled}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            className="min-h-24 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg"
          />
        </label>
        <label className="sm:col-span-2 flex flex-col gap-1 text-caption-1-regular text-fg">
          Approved disclosure text{" "}
          <span className="text-fg-muted">(optional)</span>
          <textarea
            disabled={disabled}
            value={disclosureContent}
            onChange={(event) => setDisclosureContent(event.target.value)}
            className="min-h-20 rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg"
          />
        </label>
        <fieldset className="sm:col-span-2 grid gap-3 rounded-xl border border-border p-3">
          <legend className="px-1 text-caption-1-semibold text-fg">
            Requested evidence items
          </legend>
          {items.map((item, index) => (
            <div
              key={item.key}
              className="grid gap-2 md:grid-cols-[1fr_11rem_auto]"
            >
              <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
                Item {index + 1}
                <input
                  required
                  disabled={disabled}
                  value={item.title}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((value) =>
                        value.key === item.key
                          ? { ...value, title: event.target.value }
                          : value,
                      ),
                    )
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                />
              </label>
              <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
                Class
                <select
                  disabled={disabled}
                  value={item.documentClass}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((value) =>
                        value.key === item.key
                          ? { ...value, documentClass: event.target.value }
                          : value,
                      ),
                    )
                  }
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                >
                  <option value="other">Other</option>
                  <option value="risk_assessment">Risk assessment</option>
                  <option value="technical_documentation">
                    Technical documentation
                  </option>
                  <option value="test_report">Test report</option>
                  <option value="certificate">Certificate</option>
                </select>
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || items.length === 1}
                onClick={() =>
                  setItems((current) =>
                    current.filter((value) => value.key !== item.key),
                  )
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || items.length >= 25}
            onClick={() => setItems((current) => [...current, initialItem()])}
          >
            Add item
          </Button>
        </fieldset>
        {message ? (
          <p
            role="status"
            className="sm:col-span-2 text-caption-1-regular text-fg-muted"
          >
            {message}
          </p>
        ) : null}
        <div className="sm:col-span-2">
          <Button
            type="submit"
            disabled={
              disabled ||
              !ownerUserId ||
              create.isPending ||
              activeContacts.length === 0
            }
          >
            {create.isPending
              ? "Preparing preview…"
              : "Preview supplier payload"}
          </Button>
        </div>
      </form>
      {portalPreview && previewInput ? (
        <section
          aria-labelledby="supplier-evidence-preview"
          className="mt-5 rounded-xl border border-border bg-surface p-4"
        >
          <h3
            id="supplier-evidence-preview"
            className="text-subhead-semibold text-fg"
          >
            Supplier portal preview
          </h3>
          <p className="mt-1 text-caption-1-regular text-fg-muted">
            This is the complete request payload available through the
            invitation.
          </p>
          <dl className="mt-3 grid gap-2 text-caption-1-regular text-fg">
            <div>
              <dt className="text-fg-muted">Title</dt>
              <dd>{portalPreview.portalPayload.title}</dd>
            </div>
            <div>
              <dt className="text-fg-muted">Due</dt>
              <dd>{formatDate(portalPreview.portalPayload.dueAt)}</dd>
            </div>
            {portalPreview.portalPayload.instructions ? (
              <div>
                <dt className="text-fg-muted">Instructions</dt>
                <dd className="whitespace-pre-wrap">
                  {portalPreview.portalPayload.instructions}
                </dd>
              </div>
            ) : null}
            {portalPreview.portalPayload.disclosureContent ? (
              <div>
                <dt className="text-fg-muted">Approved disclosure</dt>
                <dd className="whitespace-pre-wrap">
                  {portalPreview.portalPayload.disclosureContent}
                </dd>
              </div>
            ) : null}
          </dl>
          <ul className="mt-3 grid gap-2">
            {portalPreview.portalPayload.items.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-border p-2 text-caption-1-regular text-fg"
              >
                {item.position + 1}. {item.title}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={issuing || create.isPending}
              onClick={() => void issueRequest()}
            >
              {issuing || create.isPending ? "Issuing…" : "Issue this preview"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={issuing}
              onClick={() => {
                setPreviewInput(null);
                setPortalPreview(null);
                setMessage(
                  "The draft remains editable. Preview again before issuing.",
                );
              }}
            >
              Edit request
            </Button>
          </div>
        </section>
      ) : null}
      <div className="mt-6">
        <h3 className="text-subhead-semibold text-fg">Issued revisions</h3>
        <div className="mt-2">
          {requests.isLoading ? (
            <p role="status" className="text-caption-1-regular text-fg-muted">
              Loading requests…
            </p>
          ) : (
            <IssuedRequestHistory
              requests={history}
              onChanged={async () => {
                await requests.refetch();
              }}
            />
          )}
        </div>
      </div>
      {canReview ? (
        <SupplierEvidenceReviewPanel
          requests={history}
          canReview={canReview}
          enabled={readEnabled}
        />
      ) : null}
      {readEnabled ? (
        <SupplierEvidenceRemindersPanel
          supplierId={supplierId}
          readEnabled={readEnabled}
          canManage={canManage}
        />
      ) : null}
    </SectionCard>
  );
}
