"use client";
import type {
  PortfolioProductsResponse,
  PortfolioConcentrationResponse,
  PortfolioDetailResponse,
  PortfolioProductRow,
} from "@repo/contracts/dashboard/types";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import Link from "next/link";
import { findingsHref } from "./dashboard-sections";

const cell = "px-4 py-3 text-left align-top text-subhead-regular";
const link =
  "text-active-500 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand";
export function PortfolioState({ state }: { state: string }) {
  return (
    <span>
      {state === "restricted"
        ? "Restricted by current permissions"
        : state === "not_initialized"
          ? "Evidence not recorded"
          : state === "unavailable"
            ? "Source unavailable"
            : state === "stale"
              ? "Stale evidence"
              : state}
    </span>
  );
}
export function PortfolioFindings({
  section,
}: {
  section: PortfolioProductRow["findings"];
}) {
  return "data" in section ? (
    <span>
      {section.data.openCount} open · {section.data.bySeverity.critical}{" "}
      critical · {section.data.bySeverity.high} high ·{" "}
      {section.data.bySeverity.unknown} unknown ·{" "}
      {section.data.suppressedOpenCount} suppressed
      {section.state === "stale" ? " · Stale evidence" : ""}
    </span>
  ) : (
    <PortfolioState state={section.state} />
  );
}
export function PortfolioCoverage({
  data,
}: {
  data: Pick<
    PortfolioProductsResponse,
    "coverage" | "matchingCoverage" | "feedFreshness" | "generatedAt"
  >;
}) {
  return (
    <section
      aria-labelledby="portfolio-coverage"
      className="border-y border-border py-5 text-subhead-regular"
    >
      <h2 id="portfolio-coverage" className="text-h5">
        Evidence coverage
      </h2>
      <p className="mt-2">
        As of{" "}
        <time dateTime={data.generatedAt}>
          {new Date(data.generatedAt).toLocaleString()}
        </time>
        . Reuse is not proof of vulnerability or exploitability.
      </p>
      {"data" in data.coverage ? (
        <>
          <p className="mt-2">
            {data.coverage.data.coveredReleases} of{" "}
            {data.coverage.data.eligibleReleases} eligible releases have
            verified SBOM evidence · {data.coverage.data.missingReleases}{" "}
            missing ·{" "}
            {data.coverage.data.percent === null
              ? "No eligible releases"
              : `${data.coverage.data.percent.toLocaleString()}% covered`}
          </p>
          <p>
            {data.coverage.data.rankableComponents} of{" "}
            {data.coverage.data.totalComponents} component memberships have a
            versioned PURL. Excluded:{" "}
            {data.coverage.data.excludedIdentity.missingPurl} without PURL,{" "}
            {data.coverage.data.excludedIdentity.missingVersion} without
            version, {data.coverage.data.excludedIdentity.invalidPurl} invalid
            PURL, {data.coverage.data.excludedIdentity.versionConflict} version
            conflicts.
          </p>
        </>
      ) : (
        <p>
          SBOM coverage: <PortfolioState state={data.coverage.state} />
        </p>
      )}
      {"data" in data.matchingCoverage ? (
        <p className="mt-2">
          {data.matchingCoverage.data.evaluatedReleases} of{" "}
          {data.matchingCoverage.data.eligibleReleases} releases have completed
          matching evidence; {data.matchingCoverage.data.pendingReleases}{" "}
          pending. Completed evaluation does not establish exhaustive
          vulnerability coverage.
        </p>
      ) : (
        <p>
          Matching coverage:{" "}
          <PortfolioState state={data.matchingCoverage.state} />
        </p>
      )}
      {"data" in data.feedFreshness ? (
        data.feedFreshness.data.length ? (
          <ul
            className="mt-2 flex flex-wrap gap-4"
            aria-label="Intelligence freshness"
          >
            {data.feedFreshness.data.map((feed) => (
              <li key={feed.feedKey}>
                {feed.feedKey}: {feed.freshness} · {feed.status}
              </li>
            ))}
          </ul>
        ) : (
          <p>No intelligence feed evidence recorded.</p>
        )
      ) : (
        <p>
          Intelligence: <PortfolioState state={data.feedFreshness.state} />
        </p>
      )}
      {[data.coverage, data.matchingCoverage, data.feedFreshness].some(
        (section) => section.state === "stale",
      ) ? (
        <p role="status">
          Some source evidence is stale. Absence of findings is not zero
          exposure.
        </p>
      ) : null}
    </section>
  );
}
export function PortfolioProductsTable({
  section,
  onNext,
}: {
  section: PortfolioProductsResponse["products"];
  onNext: (cursor: string) => void;
}) {
  if (!("data" in section))
    return (
      <p>
        Products: <PortfolioState state={section.state} />
      </p>
    );
  if (!section.data.rows.length)
    return <p>No authorized products match this scope.</p>;
  return (
    <section aria-labelledby="portfolio-products">
      <h2 id="portfolio-products" className="text-h5">
        Product comparison
      </h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] border-collapse">
          <caption className="sr-only">Authorized product comparison</caption>
          <thead className="bg-surface">
            <tr>
              {[
                "Product / legal entity",
                "SBOM coverage",
                "Current findings",
                "Support / readiness",
              ].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className={cn(cell, "text-subhead-semibold")}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.data.rows.map((row) => (
              <tr key={row.productId} className="border-t border-border">
                <th scope="row" className={cell}>
                  <Link
                    className={link}
                    href={`/products/${row.productId}/posture`}
                    aria-label={`${row.productName} posture`}
                  >
                    {row.productName}
                  </Link>
                  <p>{row.legalEntityName ?? "No legal entity recorded"}</p>
                  <p>
                    {row.archived ? "Archived product" : "Active product"} ·{" "}
                    {row.classification ?? "Unclassified"}
                  </p>
                </th>
                <td className={cell}>
                  {"data" in row.sbomCoverage ? (
                    `${row.sbomCoverage.data.coveredReleases}/${row.sbomCoverage.data.eligibleReleases} releases · ${row.sbomCoverage.data.percent === null ? "No eligible releases" : `${row.sbomCoverage.data.percent}%`}`
                  ) : (
                    <PortfolioState state={row.sbomCoverage.state} />
                  )}
                </td>
                <td className={cell}>
                  <PortfolioFindings section={row.findings} />
                  {"data" in row.findings ? (
                    <p>
                      <Link
                        className={link}
                        href={findingsHref(undefined, row.productId)}
                      >
                        Open product findings
                      </Link>
                    </p>
                  ) : null}
                </td>
                <td className={cell}>
                  Support: {row.support.state.replaceAll("_", " ")}
                  <p>
                    Readiness:{" "}
                    {"data" in row.readiness ? (
                      row.readiness.data.status.replaceAll("_", " ")
                    ) : (
                      <PortfolioState state={row.readiness.state} />
                    )}
                  </p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {section.data.nextCursor ? (
        <Button
          variant="outline"
          tone="grey"
          className="mt-3"
          onClick={() => onNext(section.data.nextCursor!)}
        >
          Next product page
        </Button>
      ) : null}
    </section>
  );
}
export function PortfolioConcentrationTable({
  section,
  onNext,
  onInspect,
}: {
  section: PortfolioConcentrationResponse["concentration"];
  onNext: (cursor: string) => void;
  onInspect: (ref: string) => void;
}) {
  if (!("data" in section))
    return (
      <p>
        Concentration: <PortfolioState state={section.state} />
      </p>
    );
  if (!section.data.rows.length)
    return (
      <p>
        No shared versioned PURL components in the authorized scope. Review
        missing identity and SBOM coverage before concluding there is no
        exposure.
      </p>
    );
  return (
    <section aria-labelledby="portfolio-concentration">
      <h2 id="portfolio-concentration" className="text-h5">
        Shared-component concentration
      </h2>
      <p className="mt-2 text-subhead-regular">
        Ranked by distinct products, then distinct releases. Separate component
        versions remain separate rows.
      </p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[650px] border-collapse">
          <caption className="sr-only">Shared component concentration</caption>
          <thead className="bg-surface">
            <tr>
              {[
                "Package / exact version",
                "Affected products",
                "Releases",
                "Finding context",
                "Details",
              ].map((label) => (
                <th
                  scope="col"
                  key={label}
                  className={cn(cell, "text-subhead-semibold")}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {section.data.rows.map((row) => (
              <tr key={row.componentRef} className="border-t border-border">
                <th scope="row" className={cn(cell, "max-w-96 break-all")}>
                  {row.packageIdentity}
                  <p>{row.version}</p>
                </th>
                <td className={cn(cell, "tabular-nums")}>{row.productCount}</td>
                <td className={cn(cell, "tabular-nums")}>{row.releaseCount}</td>
                <td className={cell}>
                  <PortfolioFindings section={row.findings} />
                </td>
                <td className={cell}>
                  <Button
                    variant="outline"
                    tone="grey"
                    aria-label={`Inspect ${row.packageIdentity} ${row.version}`}
                    onClick={() => onInspect(row.componentRef)}
                  >
                    Inspect
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {section.data.nextCursor ? (
        <Button
          variant="outline"
          tone="grey"
          className="mt-3"
          onClick={() => onNext(section.data.nextCursor!)}
        >
          Next component page
        </Button>
      ) : null}
    </section>
  );
}
export function PortfolioDetailTable({
  data,
  onNext,
}: {
  data: PortfolioDetailResponse;
  onNext: (cursor: string) => void;
}) {
  const section = data.affectedReleases;
  return (
    <>
      <p className="break-all text-subhead-regular">
        {data.component.packageIdentity} · {data.component.version} ·{" "}
        {data.component.productCount} distinct products ·{" "}
        {data.component.releaseCount} releases
      </p>
      {!("data" in section) ? (
        <p>
          <PortfolioState state={section.state} />
        </p>
      ) : !section.data.rows.length ? (
        <p>No affected releases remain in this scope.</p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[600px] border-collapse">
              <caption className="sr-only">
                Affected products and releases
              </caption>
              <thead className="bg-surface">
                <tr>
                  {["Product / entity", "Release", "Findings"].map((label) => (
                    <th
                      scope="col"
                      key={label}
                      className={cn(cell, "text-subhead-semibold")}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.data.rows.map((row) => (
                  <tr key={row.releaseId} className="border-t border-border">
                    <th scope="row" className={cell}>
                      <Link
                        href={`/products/${row.productId}/posture`}
                        className={link}
                      >
                        {row.productName}
                      </Link>
                      <p>
                        {row.legalEntityName ?? "No legal entity recorded"} ·{" "}
                        {row.archived ? "Archived product" : "Active product"}
                      </p>
                    </th>
                    <td className={cell}>
                      <Link
                        href={`/products/${row.productId}`}
                        className={link}
                      >
                        {row.releaseVersion}
                      </Link>
                      <p>
                        {row.releaseArchived
                          ? "Archived release"
                          : "Active marketed release"}
                      </p>
                    </td>
                    <td className={cell}>
                      <PortfolioFindings section={row.findings} />
                      {"data" in row.findings ? (
                        <p>
                          <Link
                            className={link}
                            href={findingsHref(undefined, row.productId)}
                          >
                            Open product findings
                          </Link>
                        </p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {section.data.nextCursor ? (
            <Button
              variant="outline"
              tone="grey"
              className="mt-3"
              onClick={() => onNext(section.data.nextCursor!)}
            >
              Next affected release page
            </Button>
          ) : null}
        </>
      )}
    </>
  );
}
