"use client";

import type {
  VulnerabilityTriageQueueQuery,
  VulnerabilityTriageQueueResponse,
} from "@repo/contracts/vulnerabilities";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { cn } from "@repo/ui/cn";
import { Tag, type TagProps } from "@repo/ui/tag";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  useHasPermission,
  useSession,
} from "../../_providers/session-provider";
import { ApiClientError } from "../../_lib/http/api-client";
import {
  useCreateVulnerabilitySavedViewMutation,
  useDeleteVulnerabilitySavedViewMutation,
  useSetDefaultVulnerabilitySavedViewMutation,
  useUpdateVulnerabilitySavedViewMutation,
  useVulnerabilitySavedViewsQuery,
  useVulnerabilityTriageDetailQuery,
  useVulnerabilityTriageQueueQuery,
} from "./triage.queries";
import { FindingBulkAssessmentAction } from "./finding-bulk-assessment";

const FindingTriageDetail = dynamic(
  () => import("./triage-detail").then((module) => module.FindingTriageDetail),
  {
    loading: () => (
      <p
        role="status"
        className="rounded-xl border border-border p-4 text-caption-1-regular text-fg-muted"
      >
        Loading finding detail…
      </p>
    ),
  },
);
const ROW_HEIGHT = 56;
const VIEWPORT_HEIGHT = 448;
const OVERSCAN = 6;

type QueueRow = VulnerabilityTriageQueueResponse["rows"][number];
type QueueFilters = Omit<VulnerabilityTriageQueueQuery, "cursor" | "limit">;

function requestMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You do not have permission to view findings in this organization.";
  if (error instanceof ApiClientError && error.kind === "network")
    return "The triage queue is offline. Your filters are still available; try again when connected.";
  return "The triage queue is temporarily unavailable. Try again.";
}
function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function severityTone(value: QueueRow["severity"]): TagProps["tone"] {
  return value === "critical"
    ? "red"
    : value === "high" || value === "medium"
      ? "orange"
      : "purple";
}
function rowLabel(row: QueueRow) {
  return `${row.finding.advisoryId}, ${row.product?.name ?? "product unavailable"}, ${row.severity} severity`;
}
function uuid() {
  return crypto.randomUUID();
}
function readIdList(value: string): string[] | undefined {
  const ids = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return ids.length === 0 ? undefined : ids;
}

function useMergedQueue(
  response: VulnerabilityTriageQueueResponse | undefined,
  placeholder: boolean,
  cursor: string | undefined,
  organizationId: string | null,
) {
  const [rows, setRows] = useState<readonly QueueRow[]>([]);
  const [nextCursor, setNextCursor] =
    useState<VulnerabilityTriageQueueResponse["nextCursor"]>(null);
  const scope = useRef(organizationId);
  const scopeChanged = scope.current !== organizationId;
  useEffect(() => {
    if (scope.current === organizationId) return;
    scope.current = organizationId;
    setRows([]);
    setNextCursor(null);
  }, [organizationId]);
  useEffect(() => {
    if (!response || placeholder) return;
    setRows((current) => {
      if (cursor === undefined) return response.rows;
      const known = new Set(current.map((item) => item.finding.id));
      const appended = response.rows.filter(
        (item) => !known.has(item.finding.id),
      );
      return appended.length === 0 ? current : [...current, ...appended];
    });
    setNextCursor(response.nextCursor);
  }, [cursor, placeholder, response]);
  return {
    rows: scopeChanged ? [] : rows,
    nextCursor: scopeChanged ? null : nextCursor,
  };
}

function TriageFilters({
  filters,
  onChange,
}: Readonly<{
  filters: QueueFilters;
  onChange: (next: QueueFilters) => void;
}>) {
  return (
    <div
      className="grid gap-3 rounded-xl border border-border bg-surface-subtle p-4 sm:grid-cols-2 xl:grid-cols-4"
      aria-label="Finding filters"
    >
      <FilterSelect
        label="Severity"
        value={filters.severities?.[0] ?? ""}
        onChange={(value) =>
          onChange({
            ...filters,
            severities:
              value === ""
                ? undefined
                : [value as NonNullable<QueueFilters["severities"]>[number]],
          })
        }
        options={[
          ["", "All severities"],
          ["critical", "Critical"],
          ["high", "High"],
          ["medium", "Medium"],
          ["low", "Low"],
          ["unknown", "Unknown"],
        ]}
      />
      <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
        Product IDs
        <input
          value={filters.productIds?.join(", ") ?? ""}
          onChange={(event) =>
            onChange({ ...filters, productIds: readIdList(event.target.value) })
          }
          placeholder="Comma-separated UUIDs"
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
      <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
        Release IDs
        <input
          value={filters.releaseIds?.join(", ") ?? ""}
          onChange={(event) =>
            onChange({ ...filters, releaseIds: readIdList(event.target.value) })
          }
          placeholder="Comma-separated UUIDs"
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
      <FilterSelect
        label="EPSS"
        value={filters.epssState ?? ""}
        onChange={(value) =>
          onChange({
            ...filters,
            epssState:
              value === "" ? undefined : (value as QueueFilters["epssState"]),
          })
        }
        options={[
          ["", "Any EPSS"],
          ["known", "Known"],
          ["unknown", "Unknown"],
        ]}
      />
      <FilterSelect
        label="Matcher state"
        value={filters.findingStates?.[0] ?? ""}
        onChange={(value) =>
          onChange({
            ...filters,
            findingStates:
              value === ""
                ? undefined
                : [value as NonNullable<QueueFilters["findingStates"]>[number]],
          })
        }
        options={[
          ["", "Any matcher state"],
          ["active", "Active"],
          ["superseded", "Superseded"],
        ]}
      />
      <FilterSelect
        label="Re-evaluation"
        value={filters.reEvaluationStates?.[0] ?? ""}
        onChange={(value) =>
          onChange({
            ...filters,
            reEvaluationStates:
              value === ""
                ? undefined
                : [
                    value as NonNullable<
                      QueueFilters["reEvaluationStates"]
                    >[number],
                  ],
          })
        }
        options={[
          ["", "Any re-evaluation"],
          ["unchanged", "Unchanged"],
          ["materially_changed", "Materially changed"],
          ["review_required", "Review required"],
          ["source_unavailable", "Source unavailable"],
          ["re_evaluating", "Re-evaluating"],
        ]}
      />
      <FilterSelect
        label="KEV"
        value={filters.kevStatuses?.[0] ?? ""}
        onChange={(value) =>
          onChange({
            ...filters,
            kevStatuses:
              value === ""
                ? undefined
                : [value as NonNullable<QueueFilters["kevStatuses"]>[number]],
          })
        }
        options={[
          ["", "Any KEV state"],
          ["listed", "Listed"],
          ["not_listed", "Not listed"],
          ["unavailable", "Unknown"],
        ]}
      />
      <FilterSelect
        label="Assessment"
        value={filters.assessmentStates?.[0] ?? ""}
        onChange={(value) =>
          onChange({
            ...filters,
            assessmentStates:
              value === ""
                ? undefined
                : [
                    value as NonNullable<
                      QueueFilters["assessmentStates"]
                    >[number],
                  ],
          })
        }
        options={[
          ["", "Any assessment"],
          ["unassessed", "Unassessed"],
          ["affected", "Affected"],
          ["not_affected", "Not affected"],
        ]}
      />
      <FilterSelect
        label="VEX status"
        value={filters.vexStatuses?.[0] ?? ""}
        onChange={(value) =>
          onChange({
            ...filters,
            vexStatuses:
              value === ""
                ? undefined
                : [value as NonNullable<QueueFilters["vexStatuses"]>[number]],
          })
        }
        options={[
          ["", "Any VEX status"],
          ["under_investigation", "Under investigation"],
          ["affected", "Affected"],
          ["not_affected", "Not affected"],
          ["fixed", "Fixed"],
        ]}
      />
      <FilterSelect
        label="Approval"
        value={filters.approvalStates?.[0] ?? ""}
        onChange={(value) =>
          onChange({
            ...filters,
            approvalStates:
              value === ""
                ? undefined
                : [
                    value as NonNullable<
                      QueueFilters["approvalStates"]
                    >[number],
                  ],
          })
        }
        options={[
          ["", "Any approval state"],
          ["awaiting_approval", "Awaiting approval"],
          ["approved", "Approved"],
          ["rejected", "Rejected"],
          ["approval_not_required", "Not required"],
        ]}
      />
      <FilterSelect
        label="Reachability"
        value={filters.reachability?.[0] ?? ""}
        onChange={(value) =>
          onChange({
            ...filters,
            reachability:
              value === ""
                ? undefined
                : [value as NonNullable<QueueFilters["reachability"]>[number]],
          })
        }
        options={[
          ["", "Any reachability"],
          ["reachable", "Reachable"],
          ["not_reachable", "Not reachable"],
          ["unknown", "Unknown"],
          ["not_analysed", "Not analysed"],
        ]}
      />
      <FilterSelect
        label="Sort"
        value={filters.sort}
        onChange={(value) =>
          onChange({ ...filters, sort: value as QueueFilters["sort"] })
        }
        options={[
          ["lastEvaluatedAt", "Last evaluated"],
          ["firstDetectedAt", "First detected"],
          ["severity", "Severity"],
          ["epss", "EPSS"],
        ]}
      />
      <FilterSelect
        label="Order"
        value={filters.order}
        onChange={(value) =>
          onChange({ ...filters, order: value as QueueFilters["order"] })
        }
        options={[
          ["desc", "Descending"],
          ["asc", "Ascending"],
        ]}
      />
      <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
        Minimum age (days)
        <input
          type="number"
          min="0"
          value={filters.ageDaysMin ?? ""}
          onChange={(event) =>
            onChange({
              ...filters,
              ageDaysMin:
                event.target.value === ""
                  ? undefined
                  : Number(event.target.value),
            })
          }
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
      <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
        Maximum age (days)
        <input
          type="number"
          min="0"
          value={filters.ageDaysMax ?? ""}
          onChange={(event) =>
            onChange({
              ...filters,
              ageDaysMax:
                event.target.value === ""
                  ? undefined
                  : Number(event.target.value),
            })
          }
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
      <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
        Minimum EPSS
        <input
          type="number"
          min="0"
          max="1"
          step="0.01"
          value={filters.epssMin ?? ""}
          onChange={(event) =>
            onChange({
              ...filters,
              epssMin:
                event.target.value === ""
                  ? undefined
                  : Number(event.target.value),
            })
          }
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
      <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
        Maximum EPSS
        <input
          type="number"
          min="0"
          max="1"
          step="0.01"
          value={filters.epssMax ?? ""}
          onChange={(event) =>
            onChange({
              ...filters,
              epssMax:
                event.target.value === ""
                  ? undefined
                  : Number(event.target.value),
            })
          }
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
      <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
        Assessed-by user IDs
        <input
          value={filters.assessedByUserIds?.join(", ") ?? ""}
          onChange={(event) =>
            onChange({
              ...filters,
              assessedByUserIds: readIdList(event.target.value),
            })
          }
          placeholder="Comma-separated UUIDs"
          className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
        />
      </label>
    </div>
  );
}
function FilterSelect({
  label,
  value,
  onChange,
  options,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
}>) {
  return (
    <label className="flex flex-col gap-1 text-caption-1-regular text-fg">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function SavedViews({
  filters,
  organizationId,
  onApply,
}: Readonly<{
  filters: QueueFilters;
  organizationId: string | null;
  onApply: (view: {
    filters: QueueFilters;
    sort: QueueFilters["sort"];
    order: QueueFilters["order"];
  }) => void;
}>) {
  const canManage = useHasPermission("can_manage_finding_views");
  const savedViews = useVulnerabilitySavedViewsQuery(organizationId, true);
  const create = useCreateVulnerabilitySavedViewMutation();
  const remove = useDeleteVulnerabilitySavedViewMutation();
  const update = useUpdateVulnerabilitySavedViewMutation();
  const setDefault = useSetDefaultVulnerabilitySavedViewMutation();
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const appliedDefaultScope = useRef<string | null>(null);
  const renderedScope = useRef(organizationId);
  const scopeChanged = renderedScope.current !== organizationId;
  useEffect(() => {
    renderedScope.current = organizationId;
  }, [organizationId]);
  const savedViewData = scopeChanged ? undefined : savedViews.data;
  const defaultId = savedViewData?.defaultViewId ?? null;
  useEffect(() => {
    if (appliedDefaultScope.current === organizationId || !savedViewData)
      return;
    appliedDefaultScope.current = organizationId;
    const view = savedViewData.views.find(
      (candidate) => candidate.id === savedViewData.defaultViewId,
    );
    if (!view) return;
    onApply({
      filters: { ...view.filters, sort: view.sort, order: view.order },
      sort: view.sort,
      order: view.order,
    });
  }, [onApply, organizationId, savedViewData]);
  async function createView() {
    if (name.trim() === "") {
      setMessage("Give this saved view a name.");
      return;
    }
    setMessage(null);
    try {
      await create.mutateAsync({
        name: name.trim(),
        filters: withoutQueueControls(filters),
        sort: filters.sort,
        order: filters.order,
        idempotencyKey: uuid(),
      });
      setName("");
    } catch (error) {
      setMessage(
        error instanceof ApiClientError && error.status === 409
          ? "This view already changed. Refresh and try again."
          : "The saved view could not be created. Your filters are unchanged.",
      );
    }
  }
  async function changeDefault(viewId: string | null) {
    setMessage(null);
    try {
      await setDefault.mutateAsync({ viewId, idempotencyKey: uuid() });
    } catch {
      setMessage(
        "Your default could not be updated. The existing default is unchanged.",
      );
    }
  }
  async function deleteView(viewId: string, version: number) {
    setMessage(null);
    try {
      await remove.mutateAsync({
        viewId,
        input: { version, idempotencyKey: uuid() },
      });
    } catch (error) {
      setMessage(
        error instanceof ApiClientError && error.status === 409
          ? "This view changed in another session. Refresh before deleting it."
          : "The saved view could not be deleted.",
      );
    }
  }
  async function updateView(viewId: string, name: string, version: number) {
    setMessage(null);
    try {
      await update.mutateAsync({
        viewId,
        input: {
          name,
          filters: withoutQueueControls(filters),
          sort: filters.sort,
          order: filters.order,
          version,
          idempotencyKey: uuid(),
        },
      });
    } catch (error) {
      setMessage(
        error instanceof ApiClientError && error.status === 409
          ? "This view changed in another session. Refresh before updating it."
          : "The saved view could not be updated. Your filters are unchanged.",
      );
    }
  }
  return (
    <section
      className="rounded-xl border border-border bg-canvas p-4"
      aria-labelledby="saved-views-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            id="saved-views-heading"
            className="text-subhead-semibold text-fg"
          >
            Saved views
          </h2>
          <p className="text-caption-1-regular text-fg-muted">
            Shared with this organization. Your default remains personal.
          </p>
        </div>
        {savedViews.isError ? (
          <p role="status" className="text-caption-1-regular text-warning">
            Saved views are unavailable.
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {savedViewData?.views.length === 0 ? (
          <span className="text-caption-1-regular text-fg-muted">
            No shared views yet.
          </span>
        ) : (
          savedViewData?.views.map((view) => (
            <div
              key={view.id}
              className="flex items-center gap-1 rounded-lg bg-surface-muted p-1"
            >
              <Button
                size="sm"
                variant="gap"
                tone="grey"
                aria-pressed={defaultId === view.id}
                onClick={() =>
                  onApply({
                    filters: {
                      ...view.filters,
                      sort: view.sort,
                      order: view.order,
                    },
                    sort: view.sort,
                    order: view.order,
                  })
                }
              >
                {view.name}
              </Button>
              <Button
                size="sm"
                variant="gap"
                tone="grey"
                loading={setDefault.isPending}
                aria-label={
                  defaultId === view.id
                    ? `Remove ${view.name} as my default`
                    : `Set ${view.name} as my default`
                }
                onClick={() =>
                  void changeDefault(defaultId === view.id ? null : view.id)
                }
              >
                {defaultId === view.id ? "Default" : "Set default"}
              </Button>
              {canManage ? (
                <Button
                  size="sm"
                  variant="gap"
                  tone="grey"
                  loading={update.isPending}
                  aria-label={`Update ${view.name} with current filters`}
                  onClick={() =>
                    void updateView(view.id, view.name, view.version)
                  }
                >
                  Update
                </Button>
              ) : null}
              {canManage ? (
                <Button
                  size="sm"
                  variant="gap"
                  tone="grey"
                  loading={remove.isPending}
                  aria-label={`Delete ${view.name}`}
                  onClick={() => void deleteView(view.id, view.version)}
                >
                  Delete
                </Button>
              ) : null}
            </div>
          ))
        )}
      </div>
      {canManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="saved-view-name">
            Saved view name
          </label>
          <input
            id="saved-view-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Save current filters as…"
            className="h-10 min-w-56 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
          <Button
            size="sm"
            loading={create.isPending}
            onClick={() => void createView()}
          >
            Save view
          </Button>
        </div>
      ) : (
        <p className="mt-3 text-caption-1-regular text-fg-muted">
          You can select a shared view and set your own default. Only authorized
          users can change shared views.
        </p>
      )}
      {message ? (
        <p role="alert" className="mt-2 text-caption-1-regular text-danger">
          {message}
        </p>
      ) : null}
    </section>
  );
}
function withoutQueueControls(filters: QueueFilters) {
  return Object.fromEntries(
    Object.entries(filters).filter(
      ([key]) => key !== "sort" && key !== "order",
    ),
  );
}

export function FindingTriageContent() {
  const { isLoading: sessionLoading, session } = useSession();
  const organizationId = session?.organization?.id ?? null;
  const canView = useHasPermission("can_view_findings");
  const canEdit = useHasPermission("can_edit_findings");
  const [filters, setFilters] = useState<QueueFilters>({
    sort: "lastEvaluatedAt",
    order: "desc",
  });
  const [cursor, setCursor] = useState<
    Exclude<VulnerabilityTriageQueueResponse["nextCursor"], null> | undefined
  >();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedFindingIds, setSelectedFindingIds] = useState<
    readonly string[]
  >([]);
  const [scrollTop, setScrollTop] = useState(0);
  const activeIndex = useRef(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const query = useMemo(
    () => ({ ...filters, cursor, limit: 50 }),
    [cursor, filters],
  );
  useEffect(() => {
    setSelectedFindingIds([]);
    setSelectedId(null);
  }, [organizationId]);
  const queue = useVulnerabilityTriageQueueQuery(
    query,
    organizationId,
    canView && !sessionLoading,
  );
  const { rows, nextCursor } = useMergedQueue(
    queue.data,
    queue.isPlaceholderData,
    cursor,
    organizationId,
  );
  const detail = useVulnerabilityTriageDetailQuery(
    selectedId,
    canView && !sessionLoading,
  );
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    rows.length,
    Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN,
  );
  const visibleRows = rows.slice(start, end);
  const updateFilters = useCallback((next: QueueFilters) => {
    setCursor(undefined);
    setFilters(next);
    activeIndex.current = 0;
    setScrollTop(0);
    setSelectedFindingIds([]);
  }, []);
  const toggleFindingSelection = useCallback((findingId: string) => {
    setSelectedFindingIds((current) =>
      current.includes(findingId)
        ? current.filter((id) => id !== findingId)
        : [...current, findingId],
    );
  }, []);
  const moveFocus = useCallback(
    (index: number) => {
      const next = Math.max(0, Math.min(rows.length - 1, index));
      activeIndex.current = next;
      const viewport = gridRef.current;
      if (viewport) {
        const rowTop = next * ROW_HEIGHT;
        const rowBottom = rowTop + ROW_HEIGHT;
        if (rowTop < viewport.scrollTop) viewport.scrollTop = rowTop;
        else if (rowBottom > viewport.scrollTop + VIEWPORT_HEIGHT)
          viewport.scrollTop = rowBottom - VIEWPORT_HEIGHT;
        requestAnimationFrame(() =>
          globalThis.document
            .getElementById(`finding-row-${rows[next]?.finding.id}`)
            ?.focus(),
        );
      }
    },
    [rows],
  );
  if (sessionLoading)
    return (
      <p role="status" className="p-6 text-subhead-regular text-fg-muted">
        Loading triage workspace…
      </p>
    );
  if (!canView)
    return (
      <div className="p-6">
        <h1 className="text-h5 text-fg">Findings</h1>
        <p role="alert" className="mt-2 text-subhead-regular text-danger">
          You do not have permission to view findings in this organization.
        </p>
      </div>
    );
  return (
    <div className="flex flex-col gap-5 px-6 pb-8 lg:px-[30px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h5 text-fg">Findings</h1>
          <p className="text-subhead-regular text-fg-muted">
            Tenant-scoped vulnerability triage. Filters and pagination run on
            the server.
          </p>
        </div>
        <Button
          variant="outline"
          tone="grey"
          onClick={() =>
            updateFilters({ sort: "lastEvaluatedAt", order: "desc" })
          }
        >
          Clear filters
        </Button>
      </div>
      <SavedViews
        filters={filters}
        organizationId={organizationId}
        onApply={(view) =>
          updateFilters({ ...view.filters, sort: view.sort, order: view.order })
        }
      />
      <TriageFilters filters={filters} onChange={updateFilters} />
      {queue.data?.filterIssues.length ? (
        <div
          role="status"
          className="rounded-xl border border-warning bg-surface-subtle p-3 text-caption-1-regular text-fg"
        >
          <strong>Some filters are unavailable.</strong>
          <ul className="mt-1 list-disc pl-5">
            {queue.data.filterIssues.map((issue) => (
              <li key={`${issue.field}-${issue.referenceId ?? "none"}`}>
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {queue.isError ? (
        <div role="alert" className="rounded-xl border border-danger p-4">
          <p className="text-subhead-regular text-danger">
            {requestMessage(queue.error)}
          </p>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => void queue.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {!queue.isError ? (
        <section
          aria-labelledby="triage-queue-heading"
          className="rounded-xl border border-border bg-canvas"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2
                id="triage-queue-heading"
                className="text-subhead-semibold text-fg"
              >
                Triage queue
              </h2>
              <p
                aria-live="polite"
                className="text-caption-1-regular text-fg-muted"
              >
                {queue.isLoading && rows.length === 0
                  ? "Loading findings…"
                  : `${rows.length} loaded finding${rows.length === 1 ? "" : "s"}`}
              </p>
            </div>
            {queue.isFetching && rows.length > 0 ? (
              <span
                role="status"
                className="text-caption-1-regular text-fg-muted"
              >
                Updating results…
              </span>
            ) : null}
            {canEdit ? (
              <FindingBulkAssessmentAction
                filters={filters}
                selectedFindingIds={selectedFindingIds}
                onApplied={() => setSelectedFindingIds([])}
              />
            ) : null}
          </div>
          {queue.isLoading && rows.length === 0 ? (
            <p role="status" className="p-6 text-subhead-regular text-fg-muted">
              Loading the triage queue…
            </p>
          ) : null}
          {!queue.isLoading && rows.length === 0 ? (
            <EmptyQueue
              filtered={Object.keys(withoutQueueControls(filters)).length > 0}
            />
          ) : null}
          {rows.length > 0 ? (
            <>
              <div
                className="grid grid-cols-[2.5rem_minmax(9rem,1.4fr)_minmax(7rem,1fr)_minmax(6rem,.7fr)_minmax(6rem,.7fr)_minmax(6rem,.7fr)_minmax(7rem,.9fr)] gap-3 border-b border-border px-4 py-2 text-caption-2-uppercase text-fg-subtle"
                aria-hidden="true"
              >
                <span>Select</span>
                <span>Advisory</span>
                <span>Product / release</span>
                <span>Severity</span>
                <span>EPSS / KEV</span>
                <span>Reachability</span>
                <span>VEX / approval</span>
              </div>
              <div
                ref={gridRef}
                role="grid"
                aria-label="Triage findings"
                aria-rowcount={rows.length}
                aria-busy={queue.isFetching}
                tabIndex={-1}
                className="overflow-y-auto outline-none"
                style={{ height: VIEWPORT_HEIGHT }}
                onScroll={(event) =>
                  setScrollTop(event.currentTarget.scrollTop)
                }
              >
                <div
                  style={{
                    height: rows.length * ROW_HEIGHT,
                    position: "relative",
                  }}
                >
                  {visibleRows.map((row, index) => {
                    const rowIndex = start + index;
                    return (
                      <div
                        key={row.finding.id}
                        id={`finding-row-${row.finding.id}`}
                        role="row"
                        aria-rowindex={rowIndex + 1}
                        aria-label={rowLabel(row)}
                        tabIndex={rowIndex === activeIndex.current ? 0 : -1}
                        aria-selected={selectedFindingIds.includes(
                          row.finding.id,
                        )}
                        className={cn(
                          "absolute grid w-full grid-cols-[2.5rem_minmax(9rem,1.4fr)_minmax(7rem,1fr)_minmax(6rem,.7fr)_minmax(6rem,.7fr)_minmax(6rem,.7fr)_minmax(7rem,.9fr)] items-center gap-3 border-b border-border px-4 text-left outline-none focus-visible:bg-surface-muted focus-visible:ring-2 focus-visible:ring-focus",
                          selectedFindingIds.includes(row.finding.id) &&
                            "bg-accent-subtle",
                          rowIndex % 2 === 1 && "bg-surface-subtle",
                        )}
                        style={{
                          top: rowIndex * ROW_HEIGHT,
                          height: ROW_HEIGHT,
                        }}
                        onFocus={() => {
                          activeIndex.current = rowIndex;
                        }}
                        onClick={() => setSelectedId(row.finding.id)}
                        onKeyDown={(event) => {
                          if (event.key === "ArrowDown") {
                            event.preventDefault();
                            moveFocus(rowIndex + 1);
                          }
                          if (event.key === "ArrowUp") {
                            event.preventDefault();
                            moveFocus(rowIndex - 1);
                          }
                          if (event.key === "Home") {
                            event.preventDefault();
                            moveFocus(0);
                          }
                          if (event.key === "End") {
                            event.preventDefault();
                            moveFocus(rows.length - 1);
                          }
                          if (event.key === "Enter") {
                            event.preventDefault();
                            setSelectedId(row.finding.id);
                          }
                          if (event.key === " ") {
                            event.preventDefault();
                            toggleFindingSelection(row.finding.id);
                          }
                        }}
                      >
                        <span role="gridcell">
                          <Checkbox
                            checked={selectedFindingIds.includes(
                              row.finding.id,
                            )}
                            aria-label={`Select ${rowLabel(row)}`}
                            onClick={(event) => event.stopPropagation()}
                            onCheckedChange={() =>
                              toggleFindingSelection(row.finding.id)
                            }
                            className="size-4"
                          />
                        </span>
                        <span
                          role="gridcell"
                          className="min-w-0 truncate font-mono text-caption-1-semibold text-fg"
                        >
                          {row.finding.advisoryId}
                        </span>
                        <span
                          role="gridcell"
                          className="min-w-0 truncate text-caption-1-regular text-fg"
                        >
                          {row.product?.name ?? "Unavailable"}
                          <span className="block truncate text-fg-muted">
                            {row.release?.name ?? "Release unavailable"}
                          </span>
                        </span>
                        <span role="gridcell">
                          <Tag
                            size="sm"
                            variant="dot"
                            tone={severityTone(row.severity)}
                          >
                            {titleCase(row.severity)}
                          </Tag>
                        </span>
                        <span
                          role="gridcell"
                          className="text-caption-1-regular text-fg"
                        >
                          {row.epss === null
                            ? "EPSS unknown"
                            : `EPSS ${(row.epss * 100).toFixed(1)}%`}
                          <span className="block text-fg-muted">
                            KEV {titleCase(row.kevStatus)}
                          </span>
                        </span>
                        <span
                          role="gridcell"
                          className="text-caption-1-regular text-fg"
                        >
                          {row.reachability === null
                            ? "Unknown"
                            : titleCase(row.reachability)}
                        </span>
                        <span
                          role="gridcell"
                          className="text-caption-1-regular text-fg"
                        >
                          {row.vexStatus === null
                            ? "Not assessed"
                            : titleCase(row.vexStatus)}
                          <span className="block text-fg-muted">
                            {row.approvalState === null
                              ? "Approval unavailable"
                              : titleCase(row.approvalState)}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border p-3">
                <p className="text-caption-1-regular text-fg-muted">
                  Use arrow keys to move, Space to select, and Enter to inspect.
                </p>
                {nextCursor ? (
                  <Button
                    size="sm"
                    variant="outline"
                    tone="grey"
                    loading={queue.isFetching}
                    disabled={queue.isFetching}
                    onClick={() => setCursor(nextCursor)}
                  >
                    Load more findings
                  </Button>
                ) : (
                  <span className="text-caption-1-regular text-fg-muted">
                    All loaded findings shown.
                  </span>
                )}
              </div>
            </>
          ) : null}
        </section>
      ) : null}
      {selectedId && detail.isError ? (
        <div
          role="alert"
          className="rounded-xl border border-danger p-4 text-caption-1-regular text-danger"
        >
          Finding detail is temporarily unavailable.{" "}
          <Button size="sm" onClick={() => void detail.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {selectedId && detail.data ? (
        <FindingTriageDetail
          detail={detail.data.detail}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}
function EmptyQueue({ filtered }: Readonly<{ filtered: boolean }>) {
  return (
    <div className="p-8 text-center">
      <h3 className="text-subhead-semibold text-fg">
        {filtered
          ? "No findings match these filters"
          : "No findings need triage"}
      </h3>
      <p className="mt-1 text-caption-1-regular text-fg-muted">
        {filtered
          ? "Clear or adjust filters to see other tenant findings."
          : "All available findings are assessed, or no matching results have arrived yet."}
      </p>
    </div>
  );
}
