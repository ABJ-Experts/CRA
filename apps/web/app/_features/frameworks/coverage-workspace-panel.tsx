"use client";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { requirementCoverageResponseSchema } from "@repo/contracts/frameworks";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import {
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";
import { productsApi } from "../products/products.api";
import { controlsApi } from "./controls.api";

export interface CoverageWorkspacePanelProps {
  readonly organizationId: string;
  readonly packKey: string;
  readonly versionKey: string;
  readonly canManage: boolean;
  readonly canViewProducts: boolean;
  readonly canViewEvidence: boolean;
}

type Coverage = z.output<typeof requirementCoverageResponseSchema>;
type Requirement = Coverage["requirements"][number];
type Filter = "all" | "gaps" | "evidence_backed" | "excluded";
type ApplicabilityDraft = Readonly<{
  requirementKey: string;
  identifier: string;
  state: "applicable" | "not_applicable";
  reason: string;
  expectedRevision: number;
}>;

const inputClass = cn(
  "min-h-10 w-full rounded-xl border border-border bg-canvas px-3 py-2 text-subhead-regular text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active-500",
);

const coverageLabels: Record<Requirement["coverageState"], string> = {
  structural: "Section heading",
  excluded: "Approved not applicable",
  evidence_backed: "Evidence-backed",
  no_mapping: "No mapped control",
  unimplemented: "Control not implemented",
  missing_evidence: "No valid evidence linked",
  expired_evidence: "Evidence expired",
  not_yet_valid_evidence: "Evidence not yet valid",
  quarantined_evidence: "Evidence quarantined",
  unavailable_evidence: "Evidence unavailable",
  stale: "Needs recalculation",
};

const statusLabels: Record<Requirement["controls"][number]["status"], string> =
  {
    not_started: "Not started",
    in_progress: "In progress",
    implemented: "Implemented",
  };

const evidenceLabels: Record<
  Requirement["controls"][number]["evidenceAvailability"],
  string
> = {
  available: "Current evidence",
  missing: "No valid evidence",
  expired: "Expired evidence",
  quarantined: "Quarantined evidence",
  not_yet_valid: "Evidence not yet valid",
  processing: "Evidence processing",
  deletion_pending: "Evidence deletion pending",
  archived: "Archived evidence",
  unavailable: "Unavailable evidence",
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403)
      return "Framework coverage is restricted for this product. No counts are available.";
    if (error.status === 409)
      return "Another session changed this requirement. Your input is preserved; review the latest state and retry.";
    if (error.kind === "network")
      return "The server is unreachable. Your input is preserved; retry when online.";
    if (error.kind === "invalid_request" || error.status === 400)
      return "Check the reason and retry. Your input is preserved.";
    return error.message;
  }
  return "The change failed. Your input is preserved; retry.";
}

function remediation(
  requirement: Requirement,
): { label: string; href: string } | null {
  const action = requirement.remediation;
  if (action.kind === "map_control")
    return {
      label: `Map a control for ${requirement.identifier}`,
      href: `/frameworks?requirementKey=${encodeURIComponent(requirement.requirementKey)}`,
    };
  if (action.kind === "implement_control" && action.controlId)
    return {
      label: `Update control for ${requirement.identifier}`,
      href: `/frameworks?controlId=${encodeURIComponent(action.controlId)}`,
    };
  if (action.kind === "link_evidence" && action.controlId)
    return {
      label: `Link evidence for ${requirement.identifier}`,
      href: `/frameworks?controlId=${encodeURIComponent(action.controlId)}`,
    };
  if (action.kind === "replace_evidence" && action.controlId)
    return {
      label: `Replace evidence for ${requirement.identifier}`,
      href: `/frameworks?controlId=${encodeURIComponent(action.controlId)}`,
    };
  return null;
}

function CoverageRow({
  requirement,
  depth,
  open,
  onToggle,
  onKeyDown,
  onApplicability,
  canManage,
  current,
}: Readonly<{
  requirement: Requirement;
  depth: number;
  open: boolean;
  onToggle: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onApplicability: () => void;
  canManage: boolean;
  current: boolean;
}>) {
  const action = remediation(requirement);
  const panelId = `coverage-${requirement.requirementKey}`;
  return (
    <li role="none" className={cn("border-b border-border last:border-0")}>
      <button
        type="button"
        role="treeitem"
        aria-level={depth + 1}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        data-requirement-key={requirement.requirementKey}
        onClick={onToggle}
        onKeyDown={onKeyDown}
        className={cn(
          "flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-3 py-3 text-left text-subhead-regular text-fg hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active-500",
          depth > 0 && "sm:pl-8",
          depth > 1 && "lg:pl-12",
        )}
      >
        <span className={cn("shrink-0 font-semibold")}>
          {requirement.identifier}
        </span>
        <span className={cn("min-w-0 flex-1 break-words")}>
          {requirement.heading ?? requirement.text.slice(0, 100)}
        </span>
        <span className={cn("text-caption-1-regular text-fg-muted")}>
          {current
            ? coverageLabels[requirement.coverageState]
            : "Needs recalculation"}
        </span>
        <span className={cn("text-caption-1-regular text-fg-muted")}>
          {open ? "Hide" : "Details"}
        </span>
      </button>
      {open ? (
        <div
          id={panelId}
          className={cn(
            "grid gap-3 px-3 pb-4 text-subhead-regular text-fg sm:pl-8",
          )}
        >
          <p className={cn("max-w-prose whitespace-pre-wrap break-words")}>
            {requirement.text}
          </p>
          {requirement.applicability.state === "not_applicable" ? (
            <p className={cn("text-caption-1-regular text-fg-muted")}>
              Approved reason: {requirement.applicability.reason}
            </p>
          ) : null}
          {requirement.controls.length > 0 ? (
            <ul
              className={cn("grid gap-2")}
              aria-label={`Controls for ${requirement.identifier}`}
            >
              {requirement.controls.map((control) => (
                <li
                  key={control.id}
                  className={cn(
                    "break-words rounded-lg border border-border px-3 py-2",
                  )}
                >
                  <a
                    className={cn(
                      "text-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-active-500",
                    )}
                    href={`/frameworks?controlId=${encodeURIComponent(control.id)}`}
                  >
                    {control.title}
                  </a>
                  <span className={cn("text-fg-muted")}>
                    {` · ${statusLabels[control.status]} · ${evidenceLabels[control.evidenceAvailability]}`}
                    {control.ownerActive ? "" : " · Owner gap"}
                  </span>
                </li>
              ))}
            </ul>
          ) : requirement.assessable ? (
            <p className={cn("text-caption-1-regular text-fg-muted")}>
              No active control applies to this product and requirement.
            </p>
          ) : null}
          <div className={cn("flex flex-wrap items-center gap-3")}>
            {action ? (
              <a
                className={cn(
                  "text-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-active-500",
                )}
                href={action.href}
              >
                {action.label}
              </a>
            ) : null}
            {canManage && requirement.assessable ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onApplicability}
              >
                {requirement.applicability.state === "not_applicable"
                  ? `Restore ${requirement.identifier} as applicable`
                  : `Mark ${requirement.identifier} not applicable`}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function CoverageWorkspacePanel({
  organizationId,
  packKey,
  versionKey,
  canManage,
  canViewProducts,
  canViewEvidence,
}: CoverageWorkspacePanelProps) {
  const client = useQueryClient();
  const [productId, setProductId] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [draft, setDraft] = useState<ApplicabilityDraft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshAfter, setRefreshAfter] = useState<{
    scope: string;
    time: number;
  } | null>(null);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const permitted = canViewProducts && canViewEvidence;
  const products = useInfiniteQuery({
    queryKey: ["framework-coverage", organizationId, "products"],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      productsApi.list(
        { page: pageParam, pageSize: 100, archived: false },
        signal,
      ),
    getNextPageParam: (page) =>
      page.products.page < page.products.pageCount
        ? page.products.page + 1
        : undefined,
    enabled: permitted,
    retry: false,
  });
  const productRows = useMemo(
    () => products.data?.pages.flatMap((page) => page.products.rows) ?? [],
    [products.data],
  );
  const selectedProductId = productId || productRows[0]?.id || "";
  const selectedScope = `${organizationId}:${selectedProductId}:${packKey}:${versionKey}`;
  const coverageKey = [
    "framework-controls",
    organizationId,
    "coverage",
    packKey,
    versionKey,
    selectedProductId,
    filter,
  ] as const;
  const coverage = useInfiniteQuery({
    queryKey: coverageKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      controlsApi.coverage(
        packKey,
        versionKey,
        selectedProductId,
        pageParam,
        signal,
        filter,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: permitted && Boolean(selectedProductId),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.pages[0]?.calculation.status === "stale" ? 3000 : false,
  });
  const rows = useMemo(
    () => coverage.data?.pages.flatMap((page) => page.requirements) ?? [],
    [coverage.data],
  );
  const firstPage = coverage.data?.pages[0];
  const awaitingRefresh =
    refreshAfter?.scope === selectedScope &&
    coverage.dataUpdatedAt <= refreshAfter.time;
  const current =
    firstPage?.calculation.status === "current" && !awaitingRefresh;
  const depths = useMemo(() => {
    const byKey = new Map(rows.map((row) => [row.requirementKey, row]));
    const depth = (row: Requirement, seen: ReadonlySet<string>): number => {
      if (!row.parentKey || seen.has(row.parentKey)) return 0;
      const parent = byKey.get(row.parentKey);
      return parent
        ? Math.min(4, 1 + depth(parent, new Set([...seen, row.parentKey])))
        : 0;
    };
    return new Map(
      rows.map((row) => [row.requirementKey, depth(row, new Set())]),
    );
  }, [rows]);

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const key = event.currentTarget.dataset.requirementKey;
      if (key)
        setOpen((current) => {
          const next = new Set(current);
          if (event.key === "ArrowRight") next.add(key);
          else next.delete(key);
          return next;
        });
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(
      event.currentTarget
        .closest("[role=tree]")
        ?.querySelectorAll<HTMLButtonElement>("button[role=treeitem]") ?? [],
    );
    const index = buttons.indexOf(event.currentTarget);
    const target =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : index + (event.key === "ArrowDown" ? 1 : -1);
    if (target < 0 || target >= buttons.length) return;
    event.preventDefault();
    buttons[target]?.focus();
  }

  function editApplicability(row: Requirement) {
    setDraft({
      requirementKey: row.requirementKey,
      identifier: row.identifier,
      state:
        row.applicability.state === "applicable"
          ? "not_applicable"
          : "applicable",
      reason:
        row.applicability.state === "not_applicable"
          ? ""
          : (row.applicability.reason ?? ""),
      expectedRevision: row.applicability.revision,
    });
    setMessage(null);
    retry.current = null;
  }

  async function saveApplicability(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !selectedProductId || saving) return;
    const signature = JSON.stringify([
      organizationId,
      packKey,
      versionKey,
      selectedProductId,
      draft,
    ]);
    const idempotencyKey =
      retry.current?.signature === signature
        ? retry.current.key
        : crypto.randomUUID();
    retry.current = { signature, key: idempotencyKey };
    setSaving(true);
    setMessage(null);
    try {
      await controlsApi.updateApplicability(
        packKey,
        versionKey,
        draft.requirementKey,
        {
          productId: selectedProductId,
          state: draft.state,
          ...(draft.state === "not_applicable" ? { reason: draft.reason } : {}),
          expectedRevision: draft.expectedRevision,
          idempotencyKey,
        },
      );
      retry.current = null;
      setDraft(null);
      setRefreshAfter({ scope: selectedScope, time: Date.now() });
      setMessage("Applicability saved. Coverage is being refreshed.");
      await client.invalidateQueries({
        queryKey: [
          "framework-controls",
          organizationId,
          "coverage",
          packKey,
          versionKey,
        ],
      });
    } catch (error) {
      setMessage(errorMessage(error));
      if (error instanceof ApiClientError && error.status === 409) {
        retry.current = null;
        void coverage.refetch();
      }
    } finally {
      setSaving(false);
    }
  }

  if (!permitted)
    return (
      <SectionCard title="Product coverage restricted">
        <p className={cn("text-subhead-regular text-fg-muted")}>
          Product and evidence permissions are required to read coverage. No
          totals are available.
        </p>
      </SectionCard>
    );

  return (
    <section aria-label="Framework coverage" className={cn("grid gap-4")}>
      <SectionCard title="Framework coverage">
        <p className={cn("max-w-3xl text-subhead-regular text-fg-muted")}>
          Review exact requirement gaps for one product and edition.
          Evidence-backed coverage is an operational indicator, not a legal
          conformity decision.
        </p>
        <div className={cn("mt-4 grid gap-4 sm:grid-cols-2")}>
          <label className={cn("grid gap-2 text-caption-1-regular text-fg")}>
            Product
            <select
              className={inputClass}
              value={selectedProductId}
              onChange={(event) => {
                setProductId(event.target.value);
                setDraft(null);
                setMessage(null);
              }}
            >
              {productRows.length === 0 ? (
                <option value="">Choose a product</option>
              ) : null}
              {productRows.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <label className={cn("grid gap-2 text-caption-1-regular text-fg")}>
            Show requirements
            <select
              className={inputClass}
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value as Filter);
                setDraft(null);
                setMessage(null);
              }}
            >
              <option value="all">All requirements</option>
              <option value="gaps">Gaps</option>
              <option value="evidence_backed">Evidence-backed</option>
              <option value="excluded">Approved not applicable</option>
            </select>
          </label>
        </div>
        {products.isLoading ? (
          <p
            role="status"
            className={cn("mt-3 text-caption-1-regular text-fg-muted")}
          >
            Loading products…
          </p>
        ) : null}
        {products.isError ? (
          <p
            role="alert"
            className={cn("mt-3 text-caption-1-regular text-danger")}
          >
            {errorMessage(products.error)}
          </p>
        ) : null}
        {products.isError ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn("mt-3")}
            onClick={() => void products.refetch()}
          >
            Retry products
          </Button>
        ) : null}
        {!products.isLoading &&
        !products.isError &&
        productRows.length === 0 ? (
          <p className={cn("mt-3 text-caption-1-regular text-fg-muted")}>
            No visible active products. Choose or create a product to review
            coverage.
          </p>
        ) : null}
        {products.hasNextPage ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn("mt-3")}
            disabled={products.isFetchingNextPage}
            onClick={() => void products.fetchNextPage()}
          >
            Load more products
          </Button>
        ) : null}
      </SectionCard>
      {selectedProductId ? (
        <SectionCard title="Requirement gaps">
          {coverage.isLoading ? (
            <p
              role="status"
              className={cn("text-subhead-regular text-fg-muted")}
            >
              Loading product coverage…
            </p>
          ) : null}
          {coverage.isError ? (
            <div>
              <p
                role="alert"
                className={cn("text-subhead-regular text-danger")}
              >
                {errorMessage(coverage.error)}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn("mt-3")}
                onClick={() => void coverage.refetch()}
              >
                Retry coverage
              </Button>
            </div>
          ) : null}
          {firstPage && !current ? (
            <div>
              <p
                role="alert"
                className={cn("text-subhead-regular text-fg-muted")}
              >
                Coverage is{" "}
                {awaitingRefresh
                  ? "refreshing after your change"
                  : firstPage.calculation.status === "stale"
                    ? "stale after a source change"
                    : "unavailable"}
                . Earlier counts may no longer be accurate. Recheck before using
                this view.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn("mt-3")}
                onClick={() => void coverage.refetch()}
              >
                Retry calculation
              </Button>
            </div>
          ) : null}
          {current && firstPage.summary ? (
            <div className={cn("grid gap-1 text-subhead-regular text-fg")}>
              <p>
                {firstPage.summary.evidenceBackedRequirements} of{" "}
                {firstPage.summary.applicableRequirements} applicable
                requirements evidence-backed
              </p>
              <p>
                {firstPage.summary.gapRequirements}{" "}
                {firstPage.summary.gapRequirements === 1 ? "gap" : "gaps"} ·{" "}
                {firstPage.summary.excludedRequirements} approved not applicable
              </p>
              <p className={cn("text-caption-1-regular text-fg-muted")}>
                Denominator excludes the two Part headings and approved
                non-applicability. Numbered parent requirements count
                independently.
              </p>
              {firstPage.summary.applicableRequirements > 0 &&
              firstPage.summary.gapRequirements === 0 ? (
                <p role="status">
                  No current evidence gaps for this product and edition.
                </p>
              ) : null}
            </div>
          ) : null}
          {firstPage && rows.length === 0 && current ? (
            <p className={cn("mt-4 text-subhead-regular text-fg-muted")}>
              No requirements match this filter.
            </p>
          ) : null}
          {rows.length > 0 ? (
            <>
              <p className={cn("mt-4 text-caption-1-regular text-fg-muted")}>
                Use Tab to enter the tree, Up and Down to move, Right for
                details, and Left to close.
              </p>
              <ul
                role="tree"
                aria-label="Product requirement coverage"
                className={cn("mt-3 border-y border-border")}
              >
                {rows.map((row) => (
                  <CoverageRow
                    key={row.requirementKey}
                    requirement={row}
                    depth={depths.get(row.requirementKey) ?? 0}
                    open={open.has(row.requirementKey)}
                    onToggle={() =>
                      setOpen((current) => {
                        const next = new Set(current);
                        if (next.has(row.requirementKey))
                          next.delete(row.requirementKey);
                        else next.add(row.requirementKey);
                        return next;
                      })
                    }
                    onKeyDown={moveFocus}
                    onApplicability={() => editApplicability(row)}
                    canManage={canManage && current}
                    current={current}
                  />
                ))}
              </ul>
            </>
          ) : null}
          {coverage.hasNextPage ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn("mt-4")}
              disabled={coverage.isFetchingNextPage}
              onClick={() => void coverage.fetchNextPage()}
            >
              Load more requirements
            </Button>
          ) : null}
          {draft ? (
            <form
              onSubmit={(event) => void saveApplicability(event)}
              className={cn(
                "mt-5 grid max-w-2xl gap-3 rounded-xl border border-border p-4",
              )}
            >
              <h3 className={cn("text-subhead-regular font-semibold text-fg")}>
                {draft.state === "not_applicable"
                  ? `Mark ${draft.identifier} not applicable`
                  : `Restore ${draft.identifier} as applicable`}
              </h3>
              <label
                className={cn("grid gap-2 text-caption-1-regular text-fg")}
              >
                Reason
                <textarea
                  className={inputClass}
                  value={draft.reason}
                  onChange={(event) =>
                    setDraft(
                      (current) =>
                        current && { ...current, reason: event.target.value },
                    )
                  }
                  rows={3}
                  maxLength={2000}
                  required={draft.state === "not_applicable"}
                />
              </label>
              {message ? (
                <p
                  role="alert"
                  className={cn("text-caption-1-regular text-danger")}
                >
                  {message}
                </p>
              ) : null}
              <div className={cn("flex flex-wrap gap-2")}>
                <Button type="submit" disabled={saving} loading={saving}>
                  {draft.state === "not_applicable"
                    ? "Save non-applicability"
                    : "Restore applicability"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDraft(null);
                    setMessage(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : message ? (
            <p
              role="status"
              className={cn("mt-3 text-caption-1-regular text-fg-muted")}
            >
              {message}
            </p>
          ) : null}
        </SectionCard>
      ) : null}
    </section>
  );
}
