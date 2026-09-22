"use client";

import {
  archiveSupplierContactInputSchema,
  archiveSupplierInputSchema,
  associateSupplierRequestInputSchema,
  createSupplierContactInputSchema,
  createSupplierResponsibilityInputSchema,
  endSupplierResponsibilityInputSchema,
  supplierRequestParamsSchema,
} from "@repo/contracts/suppliers";
import { Button } from "@repo/ui/button";
import { Tag, type TagProps } from "@repo/ui/tag";
import Link from "next/link";
import { useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { useMocksReady } from "../../_providers/providers";
import { useSession } from "../../_providers/session-provider";
import {
  PageHeading,
  SectionCard,
} from "../../dashboard/_components/dashboard-chrome";
import {
  useArchiveSupplierContactMutation,
  useArchiveSupplierMutation,
  useAssociateSupplierRequestMutation,
  useCreateSupplierContactMutation,
  useCreateSupplierResponsibilityMutation,
  useEndSupplierResponsibilityMutation,
  useSupplierQuery,
} from "./suppliers.queries";
import { SupplierEvidenceRequestPanel } from "../supplier-evidence/supplier-evidence-request-panel";

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to change this supplier.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This supplier changed elsewhere. Refresh the record and retry; your entered details are preserved.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "You are offline. Your entered details have not been discarded.";
  return error instanceof ApiClientError
    ? error.message
    : "The supplier update could not be completed.";
}
function criticalityTone(value: string): TagProps["tone"] {
  return value === "critical"
    ? "red"
    : value === "high" || value === "medium"
      ? "orange"
      : "purple";
}

function AddContact({
  supplierId,
  disabled,
}: Readonly<{ supplierId: string; disabled: boolean }>) {
  const create = useCreateSupplierContactMutation(supplierId);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const parsed = createSupplierContactInputSchema.safeParse({
      name,
      email: email.trim() || undefined,
      role: role.trim() || undefined,
      phone: phone.trim() || undefined,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Review the contact fields.",
      );
      return;
    }
    try {
      await create.mutateAsync(parsed.data);
      setName("");
      setEmail("");
      setRole("");
      setPhone("");
      setMessage("Contact added.");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }
  return (
    <form
      className="mt-4 grid gap-3 sm:grid-cols-2"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
        Contact name
        <input
          disabled={disabled}
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
      <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
        Email <span className="text-fg-muted">(optional)</span>
        <input
          disabled={disabled}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
      <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
        Role <span className="text-fg-muted">(optional)</span>
        <input
          disabled={disabled}
          value={role}
          onChange={(event) => setRole(event.target.value)}
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
      <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
        Phone <span className="text-fg-muted">(optional)</span>
        <input
          disabled={disabled}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
      {message ? (
        <p
          role="status"
          className="sm:col-span-2 text-caption-1-regular text-fg-muted"
        >
          {message}
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={disabled || create.isPending}>
          {create.isPending ? "Adding contact…" : "Add contact"}
        </Button>
      </div>
    </form>
  );
}

function ArchiveContact({
  supplierId,
  contactId,
  version,
}: Readonly<{ supplierId: string; contactId: string; version: number }>) {
  const archive = useArchiveSupplierContactMutation(supplierId, contactId);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const parsed = archiveSupplierContactInputSchema.safeParse({
      expectedVersion: version,
      reason,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Provide an archive reason.",
      );
      return;
    }
    try {
      await archive.mutateAsync(parsed.data);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }
  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2"
      onSubmit={(event) => void submit(event)}
    >
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-caption-1-regular text-fg">
        Archive reason
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="h-9 rounded-lg border border-border bg-canvas px-2 text-caption-1-regular text-fg"
        />
      </label>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={archive.isPending}
      >
        Archive contact
      </Button>
      {message ? (
        <p
          role="status"
          className="basis-full text-caption-1-regular text-fg-muted"
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}

function ResponsibilityForm({
  supplierId,
  disabled,
}: Readonly<{ supplierId: string; disabled: boolean }>) {
  const create = useCreateSupplierResponsibilityMutation(supplierId);
  const [productId, setProductId] = useState("");
  const [releaseId, setReleaseId] = useState("");
  const [occurrenceId, setOccurrenceId] = useState("");
  const [provenance, setProvenance] = useState<
    "manual" | "supplier_sbom_request"
  >("manual");
  const [supplierRequestId, setSupplierRequestId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const parsed = createSupplierResponsibilityInputSchema.safeParse({
      productId,
      releaseId,
      occurrenceId,
      provenance,
      supplierRequestId:
        provenance === "supplier_sbom_request" ? supplierRequestId : undefined,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ??
          "Use an exact normalized component occurrence, product, and release.",
      );
      return;
    }
    try {
      await create.mutateAsync(parsed.data);
      setProductId("");
      setReleaseId("");
      setOccurrenceId("");
      setProvenance("manual");
      setSupplierRequestId("");
      setMessage("Responsibility linked to the exact component occurrence.");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }
  return (
    <form
      className="mt-4 grid gap-3 sm:grid-cols-2"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <p className="sm:col-span-2 text-caption-1-regular text-fg-muted">
        Use immutable IDs from the normalized SBOM and finding occurrence.
        Display-name matching is not supported.
      </p>
      <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
        Product ID
        <input
          disabled={disabled}
          required
          value={productId}
          onChange={(event) => setProductId(event.target.value)}
          className="h-10 rounded-xl border border-border bg-canvas px-3 font-mono text-caption-1-regular text-fg"
        />
      </label>
      <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
        Release ID
        <input
          disabled={disabled}
          required
          value={releaseId}
          onChange={(event) => setReleaseId(event.target.value)}
          className="h-10 rounded-xl border border-border bg-canvas px-3 font-mono text-caption-1-regular text-fg"
        />
      </label>
      <label className="flex flex-col gap-1 text-caption-1-regular text-fg sm:col-span-2">
        Component occurrence ID
        <input
          disabled={disabled}
          required
          value={occurrenceId}
          onChange={(event) => setOccurrenceId(event.target.value)}
          className="h-10 rounded-xl border border-border bg-canvas px-3 font-mono text-caption-1-regular text-fg"
        />
      </label>
      <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
        Provenance
        <select
          disabled={disabled}
          value={provenance}
          onChange={(event) =>
            setProvenance(
              event.target.value as "manual" | "supplier_sbom_request",
            )
          }
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        >
          <option value="manual">Manual confirmation</option>
          <option value="supplier_sbom_request">Supplier-SBOM request</option>
        </select>
      </label>
      {provenance === "supplier_sbom_request" ? (
        <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
          Supplier-SBOM request ID
          <input
            disabled={disabled}
            required
            value={supplierRequestId}
            onChange={(event) => setSupplierRequestId(event.target.value)}
            className="h-10 rounded-xl border border-border bg-canvas px-3 font-mono text-caption-1-regular text-fg"
          />
        </label>
      ) : null}
      {message ? (
        <p
          role="status"
          className="sm:col-span-2 text-caption-1-regular text-fg-muted"
        >
          {message}
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={disabled || create.isPending}>
          {create.isPending ? "Linking responsibility…" : "Link responsibility"}
        </Button>
      </div>
    </form>
  );
}

function EndResponsibility({
  supplierId,
  responsibilityId,
  version,
  disabled,
}: Readonly<{
  supplierId: string;
  responsibilityId: string;
  version: number;
  disabled: boolean;
}>) {
  const end = useEndSupplierResponsibilityMutation(
    supplierId,
    responsibilityId,
  );
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const parsed = endSupplierResponsibilityInputSchema.safeParse({
      expectedVersion: version,
      reason,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0]?.message ?? "Provide an end reason.");
      return;
    }
    try {
      await end.mutateAsync(parsed.data);
      setReason("");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }
  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2"
      onSubmit={(event) => void submit(event)}
    >
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-caption-1-regular text-fg">
        End reason
        <input
          disabled={disabled}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className="h-9 rounded-lg border border-border bg-canvas px-2 text-caption-1-regular text-fg"
        />
      </label>
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={disabled || end.isPending}
      >
        End link
      </Button>
      {message ? (
        <p
          role="status"
          className="basis-full text-caption-1-regular text-fg-muted"
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}

function AssociateSupplierRequest({
  supplierId,
  disabled,
}: Readonly<{ supplierId: string; disabled: boolean }>) {
  const [requestId, setRequestId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const associate = useAssociateSupplierRequestMutation(supplierId, requestId);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const params = supplierRequestParamsSchema.safeParse({
      supplierId,
      requestId,
    });
    const input = associateSupplierRequestInputSchema.safeParse({
      idempotencyKey: crypto.randomUUID(),
    });
    if (!params.success || !input.success) {
      setMessage("Enter the exact existing supplier-SBOM request identifier.");
      return;
    }
    try {
      await associate.mutateAsync(input.data);
      setRequestId("");
      setMessage("Supplier-SBOM request associated.");
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-2"
      noValidate
      onSubmit={(event) => void submit(event)}
    >
      <label className="flex min-w-64 flex-1 flex-col gap-1 text-caption-1-regular text-fg">
        Existing supplier-SBOM request ID
        <input
          disabled={disabled}
          required
          value={requestId}
          onChange={(event) => setRequestId(event.target.value)}
          className="h-10 rounded-xl border border-border bg-canvas px-3 font-mono text-caption-1-regular text-fg"
        />
      </label>
      <Button type="submit" disabled={disabled || associate.isPending}>
        {associate.isPending ? "Associating…" : "Associate request"}
      </Button>
      {message ? (
        <p
          role="status"
          className="basis-full text-caption-1-regular text-fg-muted"
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}

export function SupplierDetailContent({
  supplierId,
}: Readonly<{ supplierId: string }>) {
  const { session, permissions, isLoading } = useSession();
  const live =
    useMocksReady() && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const canView = permissions.can_view_suppliers === true;
  const canManage = permissions.can_manage_suppliers === true;
  const enabled = live && (session?.organizations.length ?? 0) > 0 && canView;
  const detail = useSupplierQuery(supplierId, enabled);
  const archive = useArchiveSupplierMutation(supplierId);
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);
  const supplier = detail.data?.supplier;
  async function archiveSupplier() {
    if (!supplier) return;
    setArchiveMessage(null);
    const parsed = archiveSupplierInputSchema.safeParse({
      expectedVersion: supplier.version,
      reason: archiveReason,
      idempotencyKey: crypto.randomUUID(),
    });
    if (!parsed.success) {
      setArchiveMessage(
        parsed.error.issues[0]?.message ?? "Provide an archive reason.",
      );
      return;
    }
    try {
      await archive.mutateAsync(parsed.data);
    } catch (error) {
      setArchiveMessage(errorMessage(error));
    }
  }
  return (
    <main className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
      <PageHeading
        title={supplier?.name ?? "Supplier"}
        subtitle={supplier?.legalName ?? "Internal supplier record"}
        actions={
          <Button asChild type="button" variant="outline" tone="grey">
            <Link href="/suppliers">Back to suppliers</Link>
          </Button>
        }
      />
      {!live ? (
        <SectionCard title="Local data connection required">
          <p className="text-caption-1-regular text-fg-muted">
            Supplier records are available when the CRA API and local Supabase
            stack are enabled.
          </p>
        </SectionCard>
      ) : null}
      {live && isLoading ? (
        <p role="status" className="text-caption-1-regular text-fg-muted">
          Checking supplier access…
        </p>
      ) : null}
      {live && !isLoading && !canView ? (
        <SectionCard title="Supplier access restricted">
          <p className="text-caption-1-regular text-fg-muted">
            You do not have permission to view this internal supplier record.
          </p>
        </SectionCard>
      ) : null}
      {enabled && detail.isLoading ? (
        <p role="status" className="text-caption-1-regular text-fg-muted">
          Loading supplier record…
        </p>
      ) : null}
      {enabled && detail.isError ? (
        <SectionCard title="Supplier unavailable">
          <p role="alert" className="text-caption-1-regular text-danger">
            This supplier could not be loaded. No data has been changed.
          </p>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            onClick={() => void detail.refetch()}
          >
            Retry
          </Button>
        </SectionCard>
      ) : null}
      {supplier ? (
        <>
          <SectionCard title="Supplier status">
            <div className="flex flex-wrap items-center gap-3">
              <Tag variant="dot" tone={criticalityTone(supplier.criticality)}>
                {supplier.criticality} criticality
              </Tag>
              <Tag
                variant="dot"
                tone={supplier.state === "active" ? "green" : "purple"}
              >
                {supplier.state}
              </Tag>
              {supplier.website ? (
                <a
                  href={supplier.website}
                  target="_blank"
                  rel="noreferrer"
                  className="text-caption-1-regular text-link underline"
                >
                  Open website
                </a>
              ) : null}
            </div>
            <p className="mt-3 text-caption-1-regular text-fg-muted">
              {supplier.componentCount} current component links ·{" "}
              {supplier.requestCount} explicitly associated supplier-SBOM
              requests.
            </p>
          </SectionCard>
          <SectionCard title="Contacts">
            <ul className="grid gap-2" aria-label="Supplier contacts">
              {supplier.contacts.length === 0 ? (
                <li className="text-caption-1-regular text-fg-muted">
                  No contacts are recorded.
                </li>
              ) : (
                supplier.contacts.map((contact) => (
                  <li
                    key={contact.id}
                    className="rounded-lg border border-border p-3 text-caption-1-regular text-fg"
                  >
                    <strong>{contact.name}</strong>
                    {contact.role ? ` · ${contact.role}` : ""}
                    <p className="mt-1 text-fg-muted">
                      {contact.email ?? "No email recorded"}
                      {contact.phone ? ` · ${contact.phone}` : ""}
                      {contact.state === "archived" ? " · archived" : ""}
                    </p>
                    {canManage &&
                    supplier.state === "active" &&
                    contact.state === "active" ? (
                      <ArchiveContact
                        supplierId={supplier.id}
                        contactId={contact.id}
                        version={contact.version}
                      />
                    ) : null}
                  </li>
                ))
              )}
            </ul>
            {canManage && supplier.state === "active" ? (
              <AddContact supplierId={supplier.id} disabled={false} />
            ) : null}
          </SectionCard>
          <SectionCard title="Component responsibilities">
            <ul
              className="grid gap-3"
              aria-label="Supplier component responsibilities"
            >
              {supplier.responsibilities.length === 0 ? (
                <li className="text-caption-1-regular text-fg-muted">
                  No component responsibility links are recorded. Findings will
                  show responsibility as unknown.
                </li>
              ) : (
                supplier.responsibilities.map((responsibility) => (
                  <li
                    key={responsibility.id}
                    className="rounded-lg border border-border p-3 text-caption-1-regular text-fg"
                  >
                    <p className="font-mono break-all">
                      {responsibility.canonicalPurl ??
                        responsibility.componentIdentity}
                    </p>
                    <p className="mt-1 text-fg-muted">
                      Version {responsibility.componentVersion ?? "unavailable"}{" "}
                      · {responsibility.state} · release{" "}
                      {responsibility.releaseId}
                    </p>
                    {canManage &&
                    supplier.state === "active" &&
                    responsibility.state === "active" ? (
                      <EndResponsibility
                        supplierId={supplier.id}
                        responsibilityId={responsibility.id}
                        version={responsibility.version}
                        disabled={false}
                      />
                    ) : null}
                  </li>
                ))
              )}
            </ul>
            {canManage && supplier.state === "active" ? (
              <ResponsibilityForm supplierId={supplier.id} disabled={false} />
            ) : null}
          </SectionCard>
          <SectionCard title="Supplier-SBOM request history">
            {supplier.requestHistory.length === 0 ? (
              <p className="text-caption-1-regular text-fg-muted">
                No supplier-SBOM requests have been explicitly associated.
                Historical display names are never guessed or merged.
              </p>
            ) : (
              <ul className="grid gap-2">
                {supplier.requestHistory.map((request) => (
                  <li
                    key={request.id}
                    className="rounded-lg border border-border p-3 text-caption-1-regular text-fg"
                  >
                    <span className="font-medium">
                      {request.supplierDisplayName}
                    </span>
                    <span className="text-fg-muted">
                      {" "}
                      · {request.state} · release {request.releaseId}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {canManage && supplier.state === "active" ? (
              <AssociateSupplierRequest
                supplierId={supplier.id}
                disabled={false}
              />
            ) : null}
          </SectionCard>
          {supplier.state === "active" ? (
            <SupplierEvidenceRequestPanel
              supplierId={supplier.id}
              contacts={supplier.contacts}
              ownerUserId={session?.user.id ?? null}
              readEnabled={
                enabled &&
                permissions.can_view_products === true &&
                permissions.can_view_evidence === true
              }
              disabled={
                !canManage ||
                permissions.can_view_products !== true ||
                permissions.can_upload_evidence !== true
              }
            />
          ) : null}
          {canManage && supplier.state === "active" ? (
            <SectionCard title="Archive supplier">
              <p className="text-caption-1-regular text-fg-muted">
                Archiving retains historic contacts, component responsibility
                links, SBOM requests, and evidence associations.
              </p>
              <label className="mt-3 flex flex-col gap-1 text-caption-1-regular text-fg">
                Archive reason
                <input
                  value={archiveReason}
                  onChange={(event) => setArchiveReason(event.target.value)}
                  className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
                />
              </label>
              {archiveMessage ? (
                <p
                  role="status"
                  className="mt-2 text-caption-1-regular text-fg-muted"
                >
                  {archiveMessage}
                </p>
              ) : null}
              <Button
                className="mt-3"
                variant="outline"
                disabled={archive.isPending}
                onClick={() => void archiveSupplier()}
              >
                {archive.isPending ? "Archiving…" : "Archive supplier"}
              </Button>
            </SectionCard>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
