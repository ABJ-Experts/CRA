"use client";

import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeading } from "../../dashboard/_components/dashboard-chrome";
import { DashboardOnboardingResume } from "../../dashboard/_components/dashboard-onboarding-resume";
import { dashboardNow } from "./dashboard-clock";
import { useDashboardQuery } from "./dashboard.queries";
import { DashboardPagedList } from "./dashboard-pages";
import {
  DashboardCountdown,
  DashboardCoverage,
  DashboardFeeds,
  DashboardFindings,
} from "./dashboard-sections";

export function DashboardContent({ productId }: { productId?: string }) {
  const query = useDashboardQuery(productId);
  const [monotonicNow, setMonotonicNow] = useState(0);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState !== "hidden")
        setMonotonicNow(performance.now());
    };
    update();
    const interval = setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const projection = query.data?.projection;
  const now =
    projection && query.data
      ? dashboardNow(projection.serverNow, query.data.receivedAt, monotonicNow)
      : 0;
  return (
    <div
      data-testid={productId ? "dashboard-posture" : "dashboard-overview"}
      className={cn(
        "flex min-w-0 flex-col gap-6 px-6 py-6 text-fg lg:px-[30px]",
      )}
    >
      <PageHeading
        title={productId ? "Product posture" : "CRA dashboard"}
        subtitle={
          productId
            ? "Product security, support and evidence at a glance."
            : "Regulatory deadlines and the evidence that needs attention."
        }
        actions={
          <Button
            data-testid="dashboard-refresh"
            variant="outline"
            tone="grey"
            disabled={!query.enabled || query.isFetching}
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Refresh dashboard
          </Button>
        }
      />
      {projection ? (
        <DashboardCountdown section={projection.obligations} now={now} />
      ) : null}
      {!productId ? (
        <DashboardOnboardingResume />
      ) : (
        <Link
          className="text-subhead-medium text-active-500 underline underline-offset-4"
          href={`/products/${productId}`}
        >
          Back to product
        </Link>
      )}
      {!query.live ? (
        <section className="rounded-xl border border-border p-6">
          <h2 className="text-h5">Live backend required</h2>
          <p className="mt-3 max-w-prose text-subhead-regular">
            Connect the live backend to see CRA source records. Dashboard
            evidence is unavailable in demo mode.
          </p>
        </section>
      ) : query.sessionLoading ? (
        <p role="status">Loading dashboard access…</p>
      ) : !query.enabled ? (
        <p role="alert">
          Dashboard access is unavailable for the current session and
          organization.
        </p>
      ) : null}
      {query.enabled && query.isLoading ? (
        <p role="status">Loading current CRA evidence…</p>
      ) : null}
      {query.enabled && query.isError ? (
        <p
          role="alert"
          className="rounded-xl border border-border bg-surface p-4 text-subhead-regular"
        >
          {query.stale && projection
            ? `Refresh failed. Displayed evidence is stale. Last successful refresh ${new Date(projection.generatedAt).toLocaleString()}.`
            : "Current dashboard evidence is unavailable. Refresh to try again."}
        </p>
      ) : null}
      {projection ? (
        <>
          {"product" in projection ? (
            <section className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
              <div>
                <h2 className="text-h4">{projection.product.productName}</h2>
                <p className="mt-2 text-subhead-regular">
                  {projection.product.archived
                    ? "Archived product"
                    : "Active product"}{" "}
                  · Classification{" "}
                  {projection.product.classification ?? "not recorded"}
                </p>
              </div>
              <div className="text-subhead-regular">
                <p>
                  Support:{" "}
                  {projection.product.support.state.replaceAll("_", " ")}
                </p>
                {projection.product.support.endsAt ? (
                  <p>
                    Ends{" "}
                    {new Date(
                      projection.product.support.endsAt,
                    ).toLocaleDateString()}
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}
          {("data" in projection.feedFreshness &&
            projection.feedFreshness.data.some(
              (feed) => feed.freshness === "stale" || feed.status === "failed",
            )) ||
          Object.values(projection).some(
            (value) =>
              value &&
              typeof value === "object" &&
              "state" in value &&
              (value.state === "unavailable" || value.state === "stale"),
          ) ? (
            <p
              role="status"
              className="rounded-xl border border-border bg-surface p-4 text-subhead-regular"
            >
              Some sources are unavailable or stale. Review each source state
              before acting.
            </p>
          ) : null}
          {"products" in projection ? (
            <section className="flex flex-wrap gap-6 text-subhead-regular">
              {"data" in projection.products ? (
                <>
                  <p>
                    {projection.products.data.activeProducts} active products
                  </p>
                  <p>
                    {projection.products.data.archivedProducts} archived
                    products
                  </p>
                  <Link href="/products" className="text-active-500 underline">
                    Open product registry
                  </Link>
                </>
              ) : (
                <p>
                  Product summary:{" "}
                  {projection.products.state.replaceAll("_", " ")}
                </p>
              )}
            </section>
          ) : null}
          <p aria-live="polite" className="text-caption-1-regular text-fg">
            {query.stale ? "Stale evidence" : "Last refreshed"}{" "}
            <time dateTime={projection.generatedAt}>
              {new Date(projection.generatedAt).toLocaleString()}
            </time>{" "}
            · Times shown in {Intl.DateTimeFormat().resolvedOptions().timeZone}{" "}
            · Refreshes every 30 seconds while visible.
          </p>
          <DashboardFindings
            section={projection.findings}
            productId={productId}
          />
          <DashboardPagedList
            key={`${query.scope}-obligations`}
            kind="obligations"
            initial={projection}
            scope={query.scope}
            productId={productId}
            now={now}
          />
          <DashboardPagedList
            key={`${query.scope}-readiness`}
            kind="readiness"
            initial={projection}
            scope={query.scope}
            productId={productId}
            now={now}
          />
          <div className="grid gap-6 lg:grid-cols-2">
            <DashboardCoverage section={projection.sbomCoverage} />
            <DashboardFeeds section={projection.feedFreshness} />
          </div>
          <DashboardPagedList
            key={`${query.scope}-ingestion`}
            kind="ingestion"
            initial={projection}
            scope={query.scope}
            productId={productId}
            now={now}
          />
        </>
      ) : null}
    </div>
  );
}
