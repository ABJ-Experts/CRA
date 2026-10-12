"use client";
import { portfolioProductsQuerySchema } from "@repo/contracts/dashboard/schemas";
import type { PortfolioProductsQuery } from "@repo/contracts/dashboard/types";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeading } from "../../dashboard/_components/dashboard-chrome";
import {
  usePortfolioProducts,
  usePortfolioConcentration,
  usePortfolioDetail,
} from "./portfolio.queries";
import { portfolioError } from "./portfolio-policy";
import {
  PortfolioCoverage,
  PortfolioProductsTable,
  PortfolioConcentrationTable,
  PortfolioDetailTable,
} from "./portfolio-tables";

export function PortfolioContent() {
  const [draft, setDraft] = useState({
    productId: "",
    legalEntityId: "",
    includeArchived: false,
    productLabel: "",
    entityLabel: "",
  });
  const [filters, setFilters] = useState<Partial<PortfolioProductsQuery>>({
    includeArchived: false,
  });
  const [validation, setValidation] = useState<string | null>(null);
  const [productCursor, setProductCursor] = useState<string>();
  const [componentCursor, setComponentCursor] = useState<string>();
  const [selection, setSelection] = useState<{
    ref: string;
    scope: string;
  } | null>(null);
  const [detailCursor, setDetailCursor] = useState<string>();
  const products = usePortfolioProducts({ ...filters, cursor: productCursor });
  const concentration = usePortfolioConcentration({
    ...filters,
    cursor: componentCursor,
  });
  const activeRef =
    selection?.scope === products.identityScope ? selection.ref : undefined;
  const reset = () => {
    setProductCursor(undefined);
    setComponentCursor(undefined);
    setDetailCursor(undefined);
    setSelection(null);
  };
  const refresh = () => {
    const firstPage =
      productCursor === undefined && componentCursor === undefined;
    reset();
    if (firstPage) {
      void products.refetch();
      void concentration.refetch();
    }
  };
  useEffect(() => {
    reset();
    setFilters({ includeArchived: false });
    setDraft({
      productId: "",
      legalEntityId: "",
      includeArchived: false,
      productLabel: "",
      entityLabel: "",
    });
  }, [products.identityScope, products.enabled]);
  const rows =
    products.data && "data" in products.data.products
      ? products.data.products.data.rows
      : [];
  const productOptions = new Map(
    rows.map((row) => [row.productId, row.productName]),
  );
  const entityOptions = new Map(
    rows.flatMap((row) =>
      row.legalEntityId && row.legalEntityName
        ? [[row.legalEntityId, row.legalEntityName] as const]
        : [],
    ),
  );
  if (products.enabled && draft.productId && draft.productLabel)
    productOptions.set(draft.productId, draft.productLabel);
  if (products.enabled && draft.legalEntityId && draft.entityLabel)
    entityOptions.set(draft.legalEntityId, draft.entityLabel);
  const error = products.error ?? concentration.error;
  const inputClass =
    "min-h-10 w-full rounded-md border border-border bg-canvas px-3 text-subhead-regular text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-6 px-6 py-6 text-fg lg:px-[30px]",
      )}
      data-testid="dashboard-portfolio"
    >
      <PageHeading
        title="Portfolio posture"
        subtitle="Compare authorized products and identify components reused across marketed releases."
        actions={
          <>
            <Link
              href="/dashboard"
              className="text-subhead-medium text-active-500 underline underline-offset-4"
            >
              Dashboard
            </Link>
            <Button
              variant="outline"
              tone="grey"
              disabled={
                !products.enabled ||
                products.isFetching ||
                concentration.isFetching
              }
              loading={products.isFetching || concentration.isFetching}
              onClick={refresh}
            >
              Refresh portfolio
            </Button>
          </>
        }
      />
      <form
        className="grid items-end gap-4 border-b border-border pb-6 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          const result = portfolioProductsQuerySchema.safeParse({
            ...(draft.productId.trim()
              ? { productId: draft.productId.trim() }
              : {}),
            ...(draft.legalEntityId.trim()
              ? { legalEntityId: draft.legalEntityId.trim() }
              : {}),
            includeArchived: draft.includeArchived,
          });
          if (!result.success) {
            setValidation(
              "Enter a valid product or legal entity UUID, or leave the field empty.",
            );
            return;
          }
          setValidation(null);
          reset();
          setFilters(result.data);
        }}
      >
        <label className="flex flex-col gap-2 text-subhead-medium">
          Product
          <select
            aria-label="Product"
            className={inputClass}
            value={draft.productId}
            onChange={(event) =>
              setDraft({
                ...draft,
                productId: event.target.value,
                productLabel: productOptions.get(event.target.value) ?? "",
              })
            }
          >
            <option value="">All authorized products</option>
            {[...productOptions].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2 text-subhead-medium">
          Legal entity
          <select
            aria-label="Legal entity"
            className={inputClass}
            value={draft.legalEntityId}
            onChange={(event) =>
              setDraft({
                ...draft,
                legalEntityId: event.target.value,
                entityLabel: entityOptions.get(event.target.value) ?? "",
              })
            }
          >
            <option value="">All authorized entities</option>
            {[...entityOptions].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-10 items-center gap-3 text-subhead-regular">
          <input
            type="checkbox"
            checked={draft.includeArchived}
            onChange={(event) =>
              setDraft({ ...draft, includeArchived: event.target.checked })
            }
            className="h-4 w-4 accent-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
          />
          Include archived marketed products and releases
        </label>
        <Button type="submit" variant="outline" tone="grey">
          Apply scope
        </Button>
        <p className="text-caption-1-regular sm:col-span-2 lg:col-span-4">
          Filter choices reflect products on this page. Browse product pages to
          see additional choices. Development and withdrawn releases are
          excluded.{" "}
          {filters.includeArchived
            ? "Archived marketed evidence is included."
            : "Archived products and releases are excluded."}
        </p>
      </form>
      {validation ? <p role="alert">{validation}</p> : null}
      {!products.live ? (
        <p role="status">
          Live backend required. Portfolio source evidence is unavailable in
          demo mode.
        </p>
      ) : products.sessionLoading ? (
        <p role="status">Loading portfolio access…</p>
      ) : !products.enabled ? (
        <p role="alert">
          Portfolio access is unavailable for the current session and
          organization.
        </p>
      ) : null}
      {products.enabled && (products.isLoading || concentration.isLoading) ? (
        <p role="status">Loading portfolio evidence…</p>
      ) : null}
      {products.enabled && (products.isError || concentration.isError) ? (
        <div
          role="alert"
          className="rounded-xl border border-border bg-surface p-4 text-subhead-regular"
        >
          <p>{portfolioError(error)}</p>
          {products.stale || concentration.stale ? (
            <p>
              Displayed portfolio evidence is stale. Review the as-of time
              before acting.
            </p>
          ) : null}
          <Button
            className="mt-3"
            variant="outline"
            tone="grey"
            onClick={refresh}
          >
            Retry portfolio
          </Button>
        </div>
      ) : null}
      {products.enabled && products.data ? (
        <>
          <PortfolioCoverage data={products.data} />
          <PortfolioProductsTable
            section={products.data.products}
            onNext={setProductCursor}
          />
        </>
      ) : null}
      {products.enabled && concentration.data ? (
        <PortfolioConcentrationTable
          section={concentration.data.concentration}
          onNext={setComponentCursor}
          onInspect={(ref) => {
            setDetailCursor(undefined);
            setSelection({ ref, scope: products.identityScope });
          }}
        />
      ) : null}
      {products.enabled && activeRef ? (
        <section
          className="border-t border-border pt-6"
          aria-labelledby="portfolio-detail-heading"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="portfolio-detail-heading" className="text-h5">
              Affected products and releases
            </h2>
            <Button
              variant="outline"
              tone="grey"
              onClick={() => setSelection(null)}
            >
              Close component details
            </Button>
          </div>
          <PortfolioDetail
            key={`${products.scope}-${activeRef}`}
            filters={filters}
            componentRef={activeRef}
            cursor={detailCursor}
            onNext={setDetailCursor}
            onRestart={refresh}
          />
        </section>
      ) : null}
      <p className="text-caption-1-regular">
        Refreshes every 30 seconds while visible. All counts describe the
        current authorized scope; absence of evidence is not zero exposure.
      </p>
    </div>
  );
}
function PortfolioDetail({
  filters,
  componentRef,
  cursor,
  onNext,
  onRestart,
}: {
  filters: Partial<PortfolioProductsQuery>;
  componentRef: string;
  cursor?: string;
  onNext: (cursor: string) => void;
  onRestart: () => void;
}) {
  const query = usePortfolioDetail({ ...filters, componentRef, cursor });
  return (
    <>
      {query.isLoading ? <p role="status">Loading affected releases…</p> : null}
      {query.isError ? (
        <div role="alert">
          <p>{portfolioError(query.error)}</p>
          {query.stale ? <p>Displayed affected releases are stale.</p> : null}
          <Button variant="outline" tone="grey" onClick={onRestart}>
            Refresh component reference
          </Button>
        </div>
      ) : null}
      {query.data ? (
        <PortfolioDetailTable data={query.data} onNext={onNext} />
      ) : null}
    </>
  );
}
