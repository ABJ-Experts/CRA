"use client";

import {
  createSupplierInputSchema,
  supplierDuplicateCandidatesErrorSchema,
  type CreateSupplierInput,
  type SupplierCriticality,
} from "@repo/contracts/suppliers";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { cn } from "@repo/ui/cn";
import { SearchInput } from "@repo/ui/input";
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
  useCreateSupplierMutation,
  useSuppliersQuery,
} from "./suppliers.queries";

const CRITICALITIES: readonly { value: SupplierCriticality; label: string }[] =
  [
    { value: "unknown", label: "Unknown" },
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
    { value: "critical", label: "Critical" },
  ];

type SupplierDraft = Omit<
  CreateSupplierInput,
  "idempotencyKey" | "duplicateCandidateIdsConfirmed"
>;

function emptyDraft(): SupplierDraft {
  return {
    name: "",
    legalName: undefined,
    website: undefined,
    criticality: "unknown",
  };
}

function requestMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You no longer have permission to manage suppliers.";
  if (error instanceof ApiClientError && error.status === 409)
    return "A supplier with a similar name needs your explicit review. Your entered details are preserved.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "You are offline. Your entered supplier details have not been discarded.";
  return error instanceof ApiClientError
    ? error.message
    : "The supplier could not be saved.";
}

function criticalityTone(value: SupplierCriticality): TagProps["tone"] {
  if (value === "critical") return "red";
  if (value === "high" || value === "medium") return "orange";
  return "purple";
}

function CriticalityTag({ value }: Readonly<{ value: SupplierCriticality }>) {
  return (
    <Tag variant="dot" tone={criticalityTone(value)}>
      {value}
    </Tag>
  );
}

function SupplierCreateForm({
  onCreated,
}: Readonly<{ onCreated: () => void }>) {
  const create = useCreateSupplierMutation();
  const [draft, setDraft] = useState<SupplierDraft>(emptyDraft);
  const [candidateIds, setCandidateIds] = useState<readonly string[]>([]);
  const [candidates, setCandidates] = useState<
    readonly {
      id: string;
      name: string;
      criticality: SupplierCriticality;
      state: "active" | "archived";
    }[]
  >([]);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const input = {
      ...draft,
      legalName: draft.legalName?.trim() || undefined,
      website: draft.website?.trim() || undefined,
      duplicateCandidateIdsConfirmed: [...candidateIds],
      idempotencyKey: crypto.randomUUID(),
    };
    const parsed = createSupplierInputSchema.safeParse(input);
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ??
          "Review the supplier details and try again.",
      );
      return;
    }
    try {
      await create.mutateAsync(parsed.data);
      setDraft(emptyDraft());
      setCandidates([]);
      setCandidateIds([]);
      setMessage("Supplier registry record created.");
      onCreated();
    } catch (error) {
      const candidatesResult =
        error instanceof ApiClientError
          ? supplierDuplicateCandidatesErrorSchema.safeParse(error.payload)
          : undefined;
      if (candidatesResult?.success)
        setCandidates(candidatesResult.data.details.candidates);
      setMessage(requestMessage(error));
    }
  }

  return (
    <SectionCard title="Add supplier">
      <form
        className="grid gap-4 sm:grid-cols-2"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
          Supplier name
          <input
            required
            value={draft.name}
            onChange={(event) =>
              setDraft((current) => ({ ...current, name: event.target.value }))
            }
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
        </label>
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
          Criticality
          <select
            value={draft.criticality}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                criticality: event.target.value as SupplierCriticality,
              }))
            }
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          >
            {CRITICALITIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
          Legal name <span className="text-fg-muted">(optional)</span>
          <input
            value={draft.legalName ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                legalName: event.target.value,
              }))
            }
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
        </label>
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
          Website <span className="text-fg-muted">(optional)</span>
          <input
            type="url"
            value={draft.website ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                website: event.target.value,
              }))
            }
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
        </label>
        {candidates.length > 0 ? (
          <fieldset className="sm:col-span-2 rounded-xl border border-warning bg-surface-subtle p-3">
            <legend className="px-1 text-subhead-semibold text-fg">
              Review similar suppliers
            </legend>
            <p className="text-caption-1-regular text-fg-muted">
              Names are not unique. Open an existing record or explicitly
              confirm every candidate before creating a separate record.
            </p>
            <ul
              className="mt-3 grid gap-2"
              aria-label="Similar supplier candidates"
            >
              {candidates.map((candidate) => (
                <li
                  key={candidate.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-canvas p-2"
                >
                  <Checkbox
                    checked={candidateIds.includes(candidate.id)}
                    onCheckedChange={(checked) =>
                      setCandidateIds((current) =>
                        checked === true
                          ? [...new Set([...current, candidate.id])]
                          : current.filter((id) => id !== candidate.id),
                      )
                    }
                    label={`Confirm separate from ${candidate.name}`}
                  />
                  <Link
                    href={`/suppliers/${candidate.id}`}
                    className="text-caption-1-regular text-link underline"
                  >
                    Open {candidate.name}
                  </Link>
                </li>
              ))}
            </ul>
          </fieldset>
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
          <Button type="submit" disabled={create.isPending}>
            {create.isPending
              ? "Saving supplier…"
              : candidates.length > 0
                ? "Create separately"
                : "Create supplier"}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

export function SuppliersRegistryContent() {
  const { session, permissions, isLoading } = useSession();
  const live =
    useMocksReady() && process.env.NEXT_PUBLIC_ENABLE_MOCKS === "false";
  const canView = permissions.can_view_suppliers === true;
  const canManage = permissions.can_manage_suppliers === true;
  const enabled = live && (session?.organizations.length ?? 0) > 0 && canView;
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const list = useSuppliersQuery(
    { search: search.trim() || undefined, includeArchived },
    enabled,
  );

  return (
    <main className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeading
        title="Supplier registry"
        subtitle="Internal supplier responsibility records. Supplier portal access and immutable SBOM evidence remain separate."
      />
      {!live ? (
        <SectionCard title="Local data connection required">
          <p className="text-caption-1-regular text-fg-muted">
            Supplier registry data is available when the CRA API and local
            Supabase stack are enabled.
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
            You do not have permission to view internal supplier records.
          </p>
        </SectionCard>
      ) : null}
      {enabled ? (
        <>
          {canManage ? (
            <SupplierCreateForm onCreated={() => void list.refetch()} />
          ) : (
            <SectionCard title="Supplier access">
              <p className="text-caption-1-regular text-fg-muted">
                You can review supplier records but cannot create or change
                them.
              </p>
            </SectionCard>
          )}
          <SectionCard title="Suppliers">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="min-w-[16rem] flex-1 text-caption-1-regular text-fg">
                Search suppliers
                <SearchInput
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Name or legal name"
                  className="mt-1"
                />
              </label>
              <Checkbox
                checked={includeArchived}
                onCheckedChange={(checked) =>
                  setIncludeArchived(checked === true)
                }
                label="Include archived"
              />
            </div>
            {list.isLoading ? (
              <p
                role="status"
                className="mt-4 text-caption-1-regular text-fg-muted"
              >
                Loading suppliers…
              </p>
            ) : null}
            {list.isError ? (
              <div className="mt-4">
                <p role="alert" className="text-caption-1-regular text-danger">
                  Supplier records are unavailable. No data has been changed.
                </p>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  onClick={() => void list.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : null}
            {!list.isLoading &&
            !list.isError &&
            list.data?.suppliers.items.length === 0 ? (
              <p className="mt-4 text-caption-1-regular text-fg-muted">
                No suppliers match this view. Add a supplier only after checking
                likely duplicates.
              </p>
            ) : null}
            {list.data && list.data.suppliers.items.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-caption-1-regular">
                  <thead>
                    <tr className="text-fg-muted">
                      <th className="border-b border-border px-3 py-2 font-medium">
                        Supplier
                      </th>
                      <th className="border-b border-border px-3 py-2 font-medium">
                        Criticality
                      </th>
                      <th className="border-b border-border px-3 py-2 font-medium">
                        Components
                      </th>
                      <th className="border-b border-border px-3 py-2 font-medium">
                        Requests
                      </th>
                      <th className="border-b border-border px-3 py-2 font-medium">
                        State
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.data.suppliers.items.map((supplier) => (
                      <tr
                        key={supplier.id}
                        className={cn(
                          "text-fg",
                          supplier.state === "archived" && "text-fg-muted",
                        )}
                      >
                        <td className="border-b border-border px-3 py-3">
                          <Link
                            href={`/suppliers/${supplier.id}`}
                            className="font-medium text-link underline"
                          >
                            {supplier.name}
                          </Link>
                          {supplier.legalName ? (
                            <p className="mt-1 text-fg-muted">
                              {supplier.legalName}
                            </p>
                          ) : null}
                        </td>
                        <td className="border-b border-border px-3 py-3">
                          <CriticalityTag value={supplier.criticality} />
                        </td>
                        <td className="border-b border-border px-3 py-3">
                          {supplier.componentCount}
                        </td>
                        <td className="border-b border-border px-3 py-3">
                          {supplier.requestCount}
                        </td>
                        <td className="border-b border-border px-3 py-3">
                          {supplier.state === "archived"
                            ? "Archived"
                            : "Active"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </SectionCard>
        </>
      ) : null}
    </main>
  );
}
