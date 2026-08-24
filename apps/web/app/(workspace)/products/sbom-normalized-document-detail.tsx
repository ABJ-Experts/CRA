"use client";

import type {
  SbomComponent,
  SbomDependencyTreeQuery,
  SbomDocument,
  SbomNormalizationDiagnostic,
} from "@repo/contracts/sboms";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { SearchInput } from "@repo/ui/input";
import { Tag, type TagProps } from "@repo/ui/tag";
import { ChevronRight, CircleAlert, Network } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import {
  useSbomComponentSearchQuery,
  useSbomDependencyTreeChildrenQueries,
  useSbomDocumentDetailQuery,
} from "../../_features/sboms/sboms.queries";
import { SbomQualityReport } from "./sbom-quality-report";

const SEARCH_DEBOUNCE_MS = 250;
const TREE_ROW_HEIGHT = 44;
const TREE_VIEWPORT_HEIGHT = 352;
const TREE_OVERSCAN_ROWS = 6;
const ROOT_KEY = "__root__";

type TreeRequest = Readonly<{
  key: string;
  query: SbomDependencyTreeQuery;
}>;
type TreePage = Readonly<{
  cursor: string | undefined;
  items: readonly Readonly<{ component: SbomComponent; childCount: number }>[];
  nextCursor: string | null;
}>;
type FlatTreeRow = Readonly<{
  component: SbomComponent;
  childCount: number;
  level: number;
}>;

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function documentTone(state: SbomDocument["state"]): TagProps["tone"] {
  if (state === "completed") return "green";
  if (state === "failed") return "red";
  return "blue";
}

function validationTone(
  status: SbomDocument["validationStatus"],
): TagProps["tone"] {
  if (status === "valid") return "green";
  if (status === "invalid") return "red";
  if (status === "valid_with_warnings") return "orange";
  return "blue";
}

function requestErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "You do not have permission to view normalized SBOM data.";
  }
  if (error instanceof ApiClientError && error.status === 404) {
    return "This normalized SBOM document is unavailable.";
  }
  return "Normalized SBOM data is temporarily unavailable. Try again.";
}

function formatInstant(instant: string | null): string {
  if (instant === null) return "Processing";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(instant));
  } catch {
    return instant;
  }
}

function useDebouncedValue(value: string, delay: number): string {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);

  return debouncedValue;
}

function flattenTree(
  rootItems: readonly Readonly<{
    component: SbomComponent;
    childCount: number;
  }>[],
  childrenByParent: ReadonlyMap<
    string,
    readonly Readonly<{ component: SbomComponent; childCount: number }>[]
  >,
  expandedIds: ReadonlySet<string>,
): readonly FlatTreeRow[] {
  const rows: FlatTreeRow[] = [];
  const stack = [...rootItems].reverse().map((item) => ({ item, level: 1 }));

  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) continue;
    rows.push({ ...next.item, level: next.level });
    if (!expandedIds.has(next.item.component.id)) continue;
    const children = childrenByParent.get(next.item.component.id) ?? [];
    for (const child of [...children].reverse()) {
      stack.push({ item: child, level: next.level + 1 });
    }
  }
  return rows;
}

function mergePage(
  current: TreePage | undefined,
  cursor: string | undefined,
  next: TreePage,
): TreePage {
  if (!current) return next;
  if (
    current.cursor === cursor &&
    current.items === next.items &&
    current.nextCursor === next.nextCursor
  ) {
    return current;
  }
  if (current.cursor === cursor) return next;
  const known = new Set(current.items.map((item) => item.component.id));
  return {
    ...next,
    items: [
      ...current.items,
      ...next.items.filter((item) => !known.has(item.component.id)),
    ],
  };
}

function sameComponentIds(
  left: readonly SbomComponent[],
  right: readonly SbomComponent[],
): boolean {
  return (
    left.length === right.length &&
    left.every((component, index) => component.id === right[index]?.id)
  );
}

function DocumentFact({
  label,
  value,
}: Readonly<{ label: string; value: string | number }>) {
  return (
    <div className="min-w-0">
      <dt className="text-caption-2-uppercase text-fg-subtle">{label}</dt>
      <dd className="mt-1 truncate font-mono text-caption-1-regular text-fg">
        {value}
      </dd>
    </div>
  );
}

function Diagnostics({
  diagnostics,
}: Readonly<{ diagnostics: readonly SbomNormalizationDiagnostic[] }>) {
  if (diagnostics.length === 0) {
    return (
      <p className="mt-3 text-caption-1-regular text-fg-muted">
        No normalization warnings were retained.
      </p>
    );
  }
  return (
    <ul aria-label="Normalization diagnostics" className="mt-3 grid gap-2">
      {diagnostics.map((diagnostic) => (
        <li
          key={`${diagnostic.severity}-${diagnostic.code}-${diagnostic.location}`}
          className="rounded-lg border border-border bg-canvas p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Tag
              variant="dot"
              size="sm"
              tone={diagnostic.severity === "error" ? "red" : "orange"}
            >
              {titleCase(diagnostic.severity)}
            </Tag>
            <span className="font-mono text-caption-1-semibold text-fg">
              {diagnostic.code}
            </span>
          </div>
          <p className="mt-1 text-caption-1-regular text-fg">
            {diagnostic.message}
          </p>
          <p className="mt-1 break-words font-mono text-caption-2-regular text-fg-muted">
            {diagnostic.location}
          </p>
        </li>
      ))}
    </ul>
  );
}

function ComponentSearch({
  documentId,
  enabled,
}: Readonly<{ documentId: string; enabled: boolean }>) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState<string | undefined>();
  const [pages, setPages] = useState<readonly SbomComponent[]>([]);
  const debouncedValue = useDebouncedValue(value, SEARCH_DEBOUNCE_MS);
  const search = useSbomComponentSearchQuery(
    documentId,
    debouncedValue === ""
      ? { limit: 25, cursor }
      : { q: debouncedValue, limit: 25, cursor },
    enabled,
  );
  const components = pages;

  useEffect(() => {
    setCursor(undefined);
    setPages([]);
  }, [debouncedValue, documentId]);

  useEffect(() => {
    if (!search.data) return;
    setPages((current) => {
      if (cursor === undefined) {
        return sameComponentIds(current, search.data.components)
          ? current
          : search.data.components;
      }
      const known = new Set(current.map((component) => component.id));
      const appended = search.data.components.filter(
        (component) => !known.has(component.id),
      );
      return appended.length === 0 ? current : [...current, ...appended];
    });
  }, [cursor, search.data]);

  return (
    <section aria-labelledby="sbom-component-search-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-caption-1-semibold text-fg-muted">
            Component index
          </p>
          <h2
            id="sbom-component-search-heading"
            className="text-title-3-semibold text-fg"
          >
            Search components
          </h2>
        </div>
        <Tag variant="cool" size="sm">
          {components.length}
        </Tag>
      </div>
      <SearchInput
        aria-label="Search components"
        className="mt-3"
        value={value}
        onValueChange={setValue}
        clearable
        placeholder="Name, version, or package URL"
      />
      {search.isPending ? (
        <p role="status" className="mt-3 text-caption-1-regular text-fg-muted">
          Searching normalized components...
        </p>
      ) : search.isError ? (
        <p role="alert" className="mt-3 text-caption-1-regular text-danger">
          {requestErrorMessage(search.error)}
        </p>
      ) : components.length === 0 ? (
        <p className="mt-3 text-caption-1-regular text-fg-muted">
          No components match this search.
        </p>
      ) : (
        <ul
          aria-label="Normalized components"
          className="mt-3 grid max-h-72 gap-2 overflow-y-auto pr-1"
        >
          {components.map((component) => (
            <li
              key={component.id}
              className="rounded-lg border border-border bg-canvas p-3"
            >
              <p className="truncate text-caption-1-semibold text-fg">
                {component.originalName}
                {component.originalVersion
                  ? ` ${component.originalVersion}`
                  : ""}
              </p>
              <p className="mt-1 truncate font-mono text-caption-2-regular text-fg-muted">
                {component.canonicalPurl ?? component.documentLocalRef}
              </p>
            </li>
          ))}
        </ul>
      )}
      {search.data?.nextCursor ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          tone="grey"
          className="mt-3"
          onClick={() => setCursor(search.data?.nextCursor ?? undefined)}
        >
          Load more components
        </Button>
      ) : null}
    </section>
  );
}

function DependencyTree({
  documentId,
  enabled,
}: Readonly<{ documentId: string; enabled: boolean }>) {
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [cursors, setCursors] = useState<
    Readonly<Record<string, string | undefined>>
  >({});
  const [pages, setPages] = useState<Readonly<Record<string, TreePage>>>({});
  const [scrollTop, setScrollTop] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const requests = useMemo<readonly TreeRequest[]>(
    () => [
      { key: ROOT_KEY, query: { limit: 50, cursor: cursors[ROOT_KEY] } },
      ...[...expandedIds].map((parentComponentId) => ({
        key: parentComponentId,
        query: {
          parentComponentId,
          limit: 50,
          cursor: cursors[parentComponentId],
        },
      })),
    ],
    [cursors, expandedIds],
  );
  const treeQueries = useSbomDependencyTreeChildrenQueries(
    documentId,
    requests.map((request) => request.query),
    enabled,
  );

  useEffect(() => {
    setPages((current) => {
      let changed = false;
      const next = { ...current };
      requests.forEach((request, index) => {
        const result = treeQueries[index];
        if (!result?.data) return;
        const page: TreePage = {
          cursor: request.query.cursor,
          items: result.data.items,
          nextCursor: result.data.nextCursor,
        };
        const merged = mergePage(
          current[request.key],
          request.query.cursor,
          page,
        );
        if (merged !== current[request.key]) {
          next[request.key] = merged;
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [requests, treeQueries]);

  const rootItems = useMemo(() => pages[ROOT_KEY]?.items ?? [], [pages]);
  const childrenByParent = useMemo(
    () =>
      new Map(
        Object.entries(pages)
          .filter(([key]) => key !== ROOT_KEY)
          .map(([key, page]) => [key, page.items]),
      ),
    [pages],
  );
  const rows = useMemo(
    () => flattenTree(rootItems, childrenByParent, expandedIds),
    [childrenByParent, expandedIds, rootItems],
  );
  const firstIndex = Math.max(
    0,
    Math.floor(scrollTop / TREE_ROW_HEIGHT) - TREE_OVERSCAN_ROWS,
  );
  const visibleCount =
    Math.ceil(TREE_VIEWPORT_HEIGHT / TREE_ROW_HEIGHT) + TREE_OVERSCAN_ROWS * 2;
  const visibleRows = rows.slice(firstIndex, firstIndex + visibleCount);
  const treeError = treeQueries.find((query) => query.isError);
  const treePending =
    treeQueries.some((query) => query.isPending) && rootItems.length === 0;

  useEffect(() => {
    if (activeId === null) return;
    document.getElementById(`sbom-treeitem-${activeId}`)?.focus();
  }, [activeId, firstIndex]);

  function toggle(componentId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(componentId)) next.delete(componentId);
      else next.add(componentId);
      return next;
    });
  }

  function loadMore(key: string) {
    const nextCursor = pages[key]?.nextCursor;
    if (!nextCursor) return;
    setCursors((current) => ({ ...current, [key]: nextCursor }));
  }

  function moveActive(currentId: string, direction: -1 | 1) {
    const index = rows.findIndex((row) => row.component.id === currentId);
    const targetIndex = index + direction;
    const target = rows[targetIndex];
    if (!target) return;
    setActiveId(target.component.id);
    const container = treeRef.current;
    if (container) {
      const targetTop = targetIndex * TREE_ROW_HEIGHT;
      const targetBottom = targetTop + TREE_ROW_HEIGHT;
      const nextScrollTop =
        targetTop < container.scrollTop
          ? targetTop
          : targetBottom > container.scrollTop + TREE_VIEWPORT_HEIGHT
            ? targetBottom - TREE_VIEWPORT_HEIGHT
            : container.scrollTop;
      if (nextScrollTop !== container.scrollTop) {
        container.scrollTop = nextScrollTop;
        setScrollTop(nextScrollTop);
      }
    }
  }

  return (
    <section aria-labelledby="sbom-dependency-tree-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-caption-1-semibold text-fg-muted">
            Graph traversal
          </p>
          <h2
            id="sbom-dependency-tree-heading"
            className="text-title-3-semibold text-fg"
          >
            Dependency tree
          </h2>
        </div>
        <Network aria-hidden="true" className="size-5 text-fg-muted" />
      </div>
      {treePending ? (
        <p role="status" className="mt-3 text-caption-1-regular text-fg-muted">
          Loading dependency roots...
        </p>
      ) : treeError ? (
        <p role="alert" className="mt-3 text-caption-1-regular text-danger">
          {requestErrorMessage(treeError.error)}
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-caption-1-regular text-fg-muted">
          This document has no retained dependency roots.
        </p>
      ) : (
        <>
          <div
            ref={treeRef}
            role="tree"
            aria-label="Dependency tree"
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            className="mt-3 overflow-y-auto rounded-xl border border-border bg-canvas outline-none focus-visible:ring-2 focus-visible:ring-active-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            style={{ height: TREE_VIEWPORT_HEIGHT }}
          >
            <div
              style={{
                height: rows.length * TREE_ROW_HEIGHT,
                position: "relative",
              }}
            >
              <div
                style={{
                  transform: `translateY(${firstIndex * TREE_ROW_HEIGHT}px)`,
                }}
              >
                {visibleRows.map((row, index) => {
                  const expanded = expandedIds.has(row.component.id);
                  const hasChildren = row.childCount > 0;
                  return (
                    <button
                      key={row.component.id}
                      id={`sbom-treeitem-${row.component.id}`}
                      type="button"
                      role="treeitem"
                      aria-level={row.level}
                      aria-expanded={hasChildren ? expanded : undefined}
                      tabIndex={
                        activeId === null
                          ? firstIndex + index === 0
                            ? 0
                            : -1
                          : activeId === row.component.id
                            ? 0
                            : -1
                      }
                      onFocus={() => setActiveId(row.component.id)}
                      onClick={() => hasChildren && toggle(row.component.id)}
                      onKeyDown={(event) => {
                        if (event.key === "ArrowDown") {
                          event.preventDefault();
                          moveActive(row.component.id, 1);
                        } else if (event.key === "ArrowUp") {
                          event.preventDefault();
                          moveActive(row.component.id, -1);
                        } else if (event.key === "ArrowRight" && hasChildren) {
                          event.preventDefault();
                          if (!expanded) toggle(row.component.id);
                        } else if (
                          event.key === "ArrowLeft" &&
                          hasChildren &&
                          expanded
                        ) {
                          event.preventDefault();
                          toggle(row.component.id);
                        } else if (
                          (event.key === "Enter" || event.key === " ") &&
                          hasChildren
                        ) {
                          event.preventDefault();
                          toggle(row.component.id);
                        }
                      }}
                      className="flex h-11 w-full min-w-0 items-center gap-2 px-3 text-left outline-none hover:bg-surface focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-active-500"
                      style={{ paddingInlineStart: 12 + (row.level - 1) * 20 }}
                    >
                      {hasChildren ? (
                        <ChevronRight
                          aria-hidden="true"
                          className={cn(
                            "size-4 shrink-0 transition-transform motion-reduce:transition-none",
                            expanded && "rotate-90",
                          )}
                        />
                      ) : (
                        <span aria-hidden="true" className="size-4 shrink-0" />
                      )}
                      <span className="truncate text-caption-1-semibold text-fg">
                        {row.component.originalName}
                        {row.component.originalVersion
                          ? ` ${row.component.originalVersion}`
                          : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          {pages[ROOT_KEY]?.nextCursor ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              tone="grey"
              className="mt-3"
              onClick={() => loadMore(ROOT_KEY)}
            >
              Load more roots
            </Button>
          ) : null}
          {[...expandedIds].map((componentId) =>
            pages[componentId]?.nextCursor ? (
              <Button
                key={componentId}
                type="button"
                size="sm"
                variant="outline"
                tone="grey"
                className="mt-3"
                aria-label={`Load more dependencies for ${rows.find((row) => row.component.id === componentId)?.component.originalName ?? "component"}`}
                onClick={() => loadMore(componentId)}
              >
                Load more dependencies
              </Button>
            ) : null,
          )}
        </>
      )}
    </section>
  );
}

export function SbomNormalizedDocumentDetail({
  productId,
  documentId,
  sourceId,
  canView,
  enabled,
}: Readonly<{
  productId: string;
  documentId: string;
  sourceId?: string;
  canView: boolean;
  enabled: boolean;
}>) {
  const detail = useSbomDocumentDetailQuery(documentId, enabled && canView);
  const document = detail.data?.document;

  if (!canView) {
    return (
      <p role="alert" className="text-subhead-regular text-danger">
        You do not have permission to view normalized SBOM data.
      </p>
    );
  }
  if (detail.isPending) {
    return (
      <p role="status" className="text-subhead-regular text-fg-muted">
        Loading normalized SBOM document...
      </p>
    );
  }
  if (detail.isError || !document) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-border bg-surface-subtle p-4"
      >
        <p className="text-subhead-regular text-danger">
          {requestErrorMessage(detail.error)}
        </p>
        <Button
          type="button"
          variant="outline"
          tone="grey"
          className="mt-3"
          onClick={() => void detail.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }
  if (document.state !== "completed") {
    return (
      <div className="rounded-xl border border-border bg-surface-subtle p-4">
        <Tag variant="dot" tone={documentTone(document.state)} size="sm">
          {titleCase(document.state)}
        </Tag>
        <p className="mt-3 text-subhead-semibold text-fg">
          Normalization is {document.state}.
        </p>
        <p className="mt-1 text-caption-1-regular text-fg-muted">
          Components and graph data remain unavailable until this immutable
          document completes atomically.
        </p>
        {document.state === "failed" && document.error ? (
          <p role="alert" className="mt-3 text-caption-1-regular text-danger">
            {document.error.retryable ? "Retryable: " : ""}
            {document.error.message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <section aria-label="Normalized SBOM document" className="grid gap-4">
      <header className="rounded-xl border border-border bg-surface-subtle p-4">
        <Link
          href={`/products/${productId}`}
          className="text-caption-1-semibold text-active-600 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-active-500"
        >
          Back to product evidence
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-caption-1-semibold text-fg-muted">
              Immutable normalized graph
            </p>
            <h1 className="mt-1 text-title-2-semibold text-fg">
              Normalized SBOM
            </h1>
            <p className="mt-1 text-caption-1-regular text-fg-muted">
              {document.format === "cyclonedx" ? "CycloneDX" : "SPDX"}{" "}
              {document.specificationVersion}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Tag variant="dot" tone={documentTone(document.state)} size="sm">
              {titleCase(document.state)}
            </Tag>
            <Tag
              variant="dot"
              tone={validationTone(document.validationStatus)}
              size="sm"
            >
              {titleCase(document.validationStatus)}
            </Tag>
          </div>
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DocumentFact label="Components" value={document.componentCount} />
          <DocumentFact label="Maximum depth" value={document.maximumDepth} />
          <DocumentFact label="Dependencies" value={document.dependencyCount} />
          <DocumentFact
            label="Completed"
            value={formatInstant(document.completedAt)}
          />
          <DocumentFact
            label="Parser"
            value={`${document.parser.name} ${document.parser.version}`}
          />
          <DocumentFact
            label="Normalizer"
            value={`${document.normalizer.name} ${document.normalizer.version}`}
          />
          <DocumentFact label="Source provenance" value={document.sourceId} />
          <DocumentFact label="Warnings" value={document.warningCount} />
        </dl>
      </header>
      <SbomQualityReport
        sourceId={sourceId ?? document.sourceId}
        enabled={enabled}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface-subtle p-4">
          <div className="flex items-center gap-2">
            <CircleAlert aria-hidden="true" className="size-5 text-fg-muted" />
            <h2 className="text-title-3-semibold text-fg">
              Normalization warnings
            </h2>
          </div>
          <Diagnostics diagnostics={detail.data.diagnostics} />
        </div>
        <div className="rounded-xl border border-border bg-surface-subtle p-4">
          <ComponentSearch documentId={document.id} enabled={enabled} />
        </div>
      </div>
      <div className="rounded-xl border border-border bg-surface-subtle p-4">
        <DependencyTree documentId={document.id} enabled={enabled} />
      </div>
    </section>
  );
}
