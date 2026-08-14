"use client";

import { Button } from "@repo/ui/button";

import { useOrganizationSettingsQuery } from "../../_features/organizations/organizations.queries";
import {
  useProductComponentLinksQuery,
  useProductRelationshipGraphQuery,
  useProductVariantRelationshipsQuery,
  useRelationshipPropagationEventsQuery,
  useSoftwareBaselineMembershipsQuery,
  useSoftwareBaselineRevisionsQuery,
} from "../../_features/products/products.queries";
import { ApiClientError } from "../../_lib/http/api-client";
import { ProductRelationshipMutationForms } from "./product-relationship-forms";

type ReleaseOption = Readonly<{ id: string; label: string; version: string }>;

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 403) {
    return "You do not have permission to perform that action.";
  }
  if (error instanceof ApiClientError && error.status === 404) {
    return "This relationship resource is unavailable.";
  }
  if (error instanceof ApiClientError && error.code === "cycle_detected") {
    return "This link would create a cycle and was not recorded.";
  }
  if (error instanceof ApiClientError && error.code === "depth_exceeded") {
    return "This link exceeds the supported relationship depth and was not recorded.";
  }
  if (error instanceof ApiClientError && error.status === 409) {
    return "The relationship graph changed in another session. Reload it before trying again.";
  }
  if (
    error instanceof ApiClientError &&
    (error.kind === "network" ||
      error.kind === "invalid_response" ||
      (error.status !== undefined && error.status >= 500))
  ) {
    return "The relationship registry is temporarily unavailable. Try again.";
  }
  return error instanceof ApiClientError && error.kind === "api"
    ? error.message
    : fallback;
}

function formatInstant(
  instant: string,
  organizationTimezone: string | null,
): string {
  const timeZone = organizationTimezone ?? "UTC";
  try {
    return `${new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(new Date(instant))} (${timeZone})`;
  } catch {
    return instant;
  }
}

function QueryState({
  pending,
  error,
  errorValue,
  onRetry,
  loading,
  failure,
  children,
}: Readonly<{
  pending: boolean;
  error: boolean;
  errorValue: unknown;
  onRetry: () => void;
  loading: string;
  failure: string;
  children: React.ReactNode;
}>) {
  if (pending) {
    return (
      <p
        role="status"
        className="mt-3 rounded-lg bg-surface-subtle px-3 py-2 text-caption-1-regular text-fg-muted"
      >
        {loading}
      </p>
    );
  }
  if (error) {
    return (
      <div
        role="alert"
        className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface-subtle p-3"
      >
        <p className="text-caption-1-regular text-danger">
          {messageFor(errorValue, failure)}
        </p>
        <Button type="button" variant="outline" tone="grey" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}

function History<T extends { id: string }>({
  label,
  empty,
  entries,
  children,
}: Readonly<{
  label: string;
  empty: string;
  entries: readonly T[];
  children: (entry: T) => React.ReactNode;
}>) {
  if (entries.length === 0) {
    return <p className="mt-3 text-caption-1-regular text-fg-muted">{empty}</p>;
  }
  return (
    <ul
      aria-label={label}
      className="mt-3 grid max-h-56 gap-2 overflow-y-auto pr-1"
    >
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="min-w-0 rounded-lg border border-border bg-canvas px-3 py-2 text-caption-1-regular text-fg-muted"
        >
          <span className="block truncate text-fg" title={entry.id}>
            {entry.id}
          </span>
          {children(entry)}
        </li>
      ))}
    </ul>
  );
}

export function ProductRelationshipSection({
  productId,
  releases,
  canEdit,
  enabled,
  onReload,
}: Readonly<{
  productId: string;
  releases: readonly ReleaseOption[];
  canEdit: boolean;
  enabled: boolean;
  onReload: () => void;
}>) {
  const membershipsQuery = useSoftwareBaselineMembershipsQuery(
    productId,
    enabled,
  );
  const memberships = membershipsQuery.data?.memberships ?? [];
  const selectedBaselineId = memberships[0]?.baselineId ?? "";
  const revisionsQuery = useSoftwareBaselineRevisionsQuery(
    selectedBaselineId,
    enabled && selectedBaselineId.length > 0,
  );
  const variantsQuery = useProductVariantRelationshipsQuery(productId, enabled);
  const componentsQuery = useProductComponentLinksQuery(productId, enabled);
  const graphQuery = useProductRelationshipGraphQuery(productId, enabled);
  const eventsQuery = useRelationshipPropagationEventsQuery(productId, enabled);
  const organizationSettings = useOrganizationSettingsQuery(enabled);
  const timezone = organizationSettings.data?.settings.values?.timezone ?? null;
  const revisions = revisionsQuery.data?.baselines ?? [];
  const variants = variantsQuery.data?.relationships ?? [];
  const components = componentsQuery.data?.links ?? [];
  const graph = graphQuery.data?.graph;
  const events = eventsQuery.data?.events ?? [];

  return (
    <section aria-label="Product relationships" className="grid gap-4">
      <header className="grid gap-4 rounded-xl border border-border bg-surface-subtle p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <p className="text-caption-1-semibold text-fg-muted">
            Relationship ledger
          </p>
          <h2 className="mt-1 text-title-3-semibold text-fg">
            Product relationships
          </h2>
          <p className="mt-1 text-subhead-regular text-fg-muted">
            Review dependency evidence, then make one versioned change at a
            time.
          </p>
          {!canEdit ? (
            <p
              role="status"
              className="mt-3 text-caption-1-regular text-fg-muted"
            >
              You can review relationship history, but cannot change it.
            </p>
          ) : null}
        </div>
        <dl
          aria-label="Relationship overview"
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          <div className="rounded-lg border border-border bg-canvas px-3 py-2">
            <dt className="text-caption-1-regular text-fg-muted">Baselines</dt>
            <dd className="mt-1 text-subhead-semibold text-fg">
              {memberships.length}
            </dd>
          </div>
          <div className="rounded-lg border border-border bg-canvas px-3 py-2">
            <dt className="text-caption-1-regular text-fg-muted">Variants</dt>
            <dd className="mt-1 text-subhead-semibold text-fg">
              {variants.length}
            </dd>
          </div>
          <div className="rounded-lg border border-border bg-canvas px-3 py-2">
            <dt className="text-caption-1-regular text-fg-muted">Components</dt>
            <dd className="mt-1 text-subhead-semibold text-fg">
              {components.length}
            </dd>
          </div>
          <div className="rounded-lg border border-border bg-canvas px-3 py-2">
            <dt className="text-caption-1-regular text-fg-muted">Graph</dt>
            <dd className="mt-1 text-subhead-semibold text-fg">
              v{graph?.graphVersion ?? "—"}
            </dd>
          </div>
        </dl>
      </header>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <section
          aria-label="Software baseline memberships"
          className="min-w-0 rounded-xl border border-border bg-surface-subtle p-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-subhead-semibold text-fg">
              Software baselines
            </h3>
            <span className="text-caption-1-regular text-fg-muted">
              Membership history
            </span>
          </div>
          <QueryState
            pending={membershipsQuery.isPending}
            error={membershipsQuery.isError}
            errorValue={membershipsQuery.error}
            onRetry={() => void membershipsQuery.refetch()}
            loading="Loading baseline memberships…"
            failure="Baseline memberships could not be loaded."
          >
            <History
              label="Software baseline membership history"
              empty="No baseline memberships have been recorded."
              entries={memberships}
            >
              {(membership) => (
                <>
                  <span className="block break-all">
                    Baseline {membership.baselineId} · revision{" "}
                    {membership.baselineRevisionNumber}
                  </span>
                  <span>
                    {formatInstant(membership.effectiveStartsAt, timezone)}
                    {membership.effectiveEndsAt
                      ? ` to ${formatInstant(membership.effectiveEndsAt, timezone)}`
                      : " · active"}
                  </span>
                </>
              )}
            </History>
          </QueryState>
          {selectedBaselineId ? (
            <div className="mt-4 border-t border-border pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h4 className="text-caption-1-semibold text-fg">
                  Revision history
                </h4>
                <span className="text-caption-1-regular text-fg-muted">
                  Selected baseline
                </span>
              </div>
              <QueryState
                pending={revisionsQuery.isPending}
                error={revisionsQuery.isError}
                errorValue={revisionsQuery.error}
                onRetry={() => void revisionsQuery.refetch()}
                loading="Loading baseline revisions…"
                failure="Baseline revisions could not be loaded."
              >
                <History
                  label="Software baseline revision history"
                  empty="No baseline revisions have been recorded."
                  entries={revisions}
                >
                  {(revision) => (
                    <>
                      <span className="block">
                        {revision.identifier} · revision{" "}
                        {revision.revisionNumber}
                      </span>
                      <span>
                        {formatInstant(revision.effectiveStartsAt, timezone)}
                        {revision.effectiveEndsAt
                          ? ` to ${formatInstant(revision.effectiveEndsAt, timezone)}`
                          : " · active"}
                      </span>
                    </>
                  )}
                </History>
              </QueryState>
            </div>
          ) : null}
        </section>
        <section
          aria-label="Variant relationships"
          className="min-w-0 rounded-xl border border-border bg-surface-subtle p-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-subhead-semibold text-fg">
              Variant relationships
            </h3>
            <span className="text-caption-1-regular text-fg-muted">
              Product and release variants
            </span>
          </div>
          <QueryState
            pending={variantsQuery.isPending}
            error={variantsQuery.isError}
            errorValue={variantsQuery.error}
            onRetry={() => void variantsQuery.refetch()}
            loading="Loading variant relationships…"
            failure="Variant relationships could not be loaded."
          >
            <History
              label="Variant relationship history"
              empty="No variant relationships have been recorded."
              entries={variants}
            >
              {(variant) => (
                <>
                  <span className="block break-all">
                    {variant.sourceType === "base_release"
                      ? `Base release ${variant.sourceReleaseId}`
                      : `Baseline revision ${variant.baselineRevisionId}`}{" "}
                    → variant release {variant.targetReleaseId}
                  </span>
                  <span>
                    {formatInstant(variant.effectiveStartsAt, timezone)}
                    {variant.effectiveEndsAt
                      ? ` to ${formatInstant(variant.effectiveEndsAt, timezone)}`
                      : " · active"}
                  </span>
                </>
              )}
            </History>
          </QueryState>
        </section>
        <section
          aria-label="Embedded component links"
          className="min-w-0 rounded-xl border border-border bg-surface-subtle p-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-subhead-semibold text-fg">
              Embedded components
            </h3>
            <span className="text-caption-1-regular text-fg-muted">
              Dependency records
            </span>
          </div>
          <QueryState
            pending={componentsQuery.isPending}
            error={componentsQuery.isError}
            errorValue={componentsQuery.error}
            onRetry={() => void componentsQuery.refetch()}
            loading="Loading component links…"
            failure="Component links could not be loaded."
          >
            <History
              label="Embedded component link history"
              empty="No embedded component links have been recorded."
              entries={components}
            >
              {(link) => (
                <>
                  <span className="block break-all">
                    Component {link.componentProductId}
                    {link.componentReleaseId
                      ? ` · release ${link.componentReleaseId}`
                      : ""}{" "}
                    · quantity {link.quantity}
                  </span>
                  <span>
                    {formatInstant(link.effectiveStartsAt, timezone)}
                    {link.effectiveEndsAt
                      ? ` to ${formatInstant(link.effectiveEndsAt, timezone)}`
                      : " · active"}
                  </span>
                </>
              )}
            </History>
          </QueryState>
        </section>
        <section
          aria-label="Relationship graph"
          className="min-w-0 rounded-xl border border-border bg-surface-subtle p-4"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-subhead-semibold text-fg">Dependency graph</h3>
            <span className="text-caption-1-regular text-fg-muted">
              Live topology
            </span>
          </div>
          <QueryState
            pending={graphQuery.isPending}
            error={graphQuery.isError}
            errorValue={graphQuery.error}
            onRetry={() => void graphQuery.refetch()}
            loading="Loading relationship graph…"
            failure="Relationship graph could not be loaded."
          >
            {graph ? (
              <>
                <p className="mt-2 text-caption-1-regular text-fg-muted">
                  Graph version {graph.graphVersion} · {graph.nodes.length}{" "}
                  nodes · {graph.links.length} links · evaluated{" "}
                  {formatInstant(graph.evaluatedAt, timezone)}
                </p>
                {graph.links.length === 0 ? (
                  <p className="mt-2 text-caption-1-regular text-fg-muted">
                    This product has no active dependencies or dependents.
                  </p>
                ) : (
                  <ul
                    aria-label="Relationship graph links"
                    className="mt-3 grid max-h-48 gap-1 overflow-y-auto pr-1 text-caption-1-regular text-fg-muted"
                  >
                    {graph.links.map((link) => (
                      <li key={link.id} className="break-all">
                        {link.parentProductId} → {link.componentProductId} ·
                        embedded
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="mt-2 text-caption-1-regular text-fg-muted">
                No dependency graph is available yet.
              </p>
            )}
          </QueryState>
        </section>
      </div>
      <section
        aria-label="Relationship propagation events"
        className="rounded-xl border border-border bg-surface-subtle p-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-subhead-semibold text-fg">Propagation status</h3>
          <span className="text-caption-1-regular text-fg-muted">
            Durable processing activity
          </span>
        </div>
        <QueryState
          pending={eventsQuery.isPending}
          error={eventsQuery.isError}
          errorValue={eventsQuery.error}
          onRetry={() => void eventsQuery.refetch()}
          loading="Loading relationship propagation events…"
          failure="Relationship propagation events could not be loaded."
        >
          <History
            label="Relationship propagation events"
            empty="No relationship propagation events have been recorded."
            entries={events}
          >
            {(event) => (
              <>
                <span className="block">
                  {event.deliveryState.replaceAll("_", " ")}
                  {event.deliveryState === "dead_letter"
                    ? " · requires attention"
                    : ""}
                </span>
                <span>
                  Graph version {event.graphVersion} ·{" "}
                  {formatInstant(event.occurredAt, timezone)}
                </span>
              </>
            )}
          </History>
        </QueryState>
      </section>
      {canEdit ? (
        <ProductRelationshipMutationForms
          productId={productId}
          releases={releases}
          graphVersion={graph?.graphVersion ?? 0}
          memberships={memberships}
          variants={variants}
          components={components}
          organizationTimezone={timezone}
          onReload={onReload}
        />
      ) : null}
    </section>
  );
}
