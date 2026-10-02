"use client";

import { ExternalLink, Link2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { EvidenceVersionReuse } from "@repo/contracts/evidence";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { useInfiniteQuery } from "@tanstack/react-query";

import { frameworksApi } from "../frameworks/frameworks.api";

export type EvidenceReuseDetail = EvidenceVersionReuse;

function sourceStatus(status: string): string {
  switch (status) {
    case "stale":
      return "Stale — review needed";
    case "unavailable":
      return "Unavailable";
    default:
      return "Current";
  }
}

function controlStatus(status: string): string {
  switch (status) {
    case "implemented":
      return "Implemented";
    case "in_progress":
      return "In progress";
    default:
      return "Not started";
  }
}

function requirementIdentity(
  reference: Readonly<{
    packKey: string;
    versionKey: string;
    requirementKey: string;
  }>,
): string {
  return JSON.stringify([
    reference.packKey,
    reference.versionKey,
    reference.requirementKey,
  ]);
}

export function EvidenceReusePanel({
  reuse,
  productId,
  evidenceVersionId,
}: Readonly<{
  reuse: EvidenceReuseDetail;
  productId?: string;
  evidenceVersionId?: string | null;
}>) {
  const crosswalks = useInfiniteQuery({
    queryKey: [
      "evidence-crosswalk-reuse",
      productId ?? "none",
      evidenceVersionId ?? "none",
    ],
    enabled: Boolean(productId && evidenceVersionId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      frameworksApi.crosswalkEvidenceReuse(
        evidenceVersionId!,
        productId!,
        pageParam,
        signal,
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const relations =
    crosswalks.data?.pages.flatMap((page) => page.relations) ?? [];
  const directlyMapped = new Set(
    reuse.frameworkControls.flatMap((control) =>
      control.requirements.map(requirementIdentity),
    ),
  );
  return (
    <div className="grid gap-5" aria-label="Evidence reuse details">
      <section aria-labelledby="technical-file-links-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="technical-file-links-heading" className="text-h5 text-fg">
            Technical-file reuse
          </h3>
          <span className="text-caption-1-regular text-fg-muted">
            {reuse.technicalFileLinks.length} authorized link
            {reuse.technicalFileLinks.length === 1 ? "" : "s"}
          </span>
        </div>
        {reuse.technicalFileLinks.length === 0 ? (
          <p className="mt-2 text-subhead-regular text-fg-muted">
            This version is not linked to an accessible technical-file section.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left">
              <thead className="border-b border-border text-caption-1-semibold text-fg-muted">
                <tr>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Section</th>
                  <th className="px-3 py-2">Linked version</th>
                  <th className="px-3 py-2">Review</th>
                  <th className="px-3 py-2">
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {reuse.technicalFileLinks.map((link) => (
                  <tr
                    key={`${link.sectionId}-${link.linkedVersionId}`}
                    className="border-b border-border align-top"
                  >
                    <td className="px-3 py-3 text-subhead-regular text-fg">
                      {link.productName}
                    </td>
                    <td className="px-3 py-3">
                      <p className="text-subhead-regular text-fg">
                        {link.sectionHeading}
                      </p>
                      <p className="text-caption-1-regular text-fg-muted">
                        {link.sectionKey}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-subhead-regular text-fg">
                      Version {link.linkedVersionNumber}
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1 text-caption-1-regular text-fg">
                        {link.status === "current" ? (
                          <Link2 aria-hidden="true" className="size-4" />
                        ) : (
                          <ShieldAlert
                            aria-hidden="true"
                            className={`size-4 ${link.status === "stale" ? "text-warning" : "text-danger"}`}
                          />
                        )}
                        {sourceStatus(link.status)}
                      </span>
                      {link.reviewedAt ? (
                        <p className="mt-1 text-caption-1-regular text-fg-muted">
                          Reviewed{" "}
                          {new Intl.DateTimeFormat(undefined, {
                            dateStyle: "medium",
                          }).format(new Date(link.reviewedAt))}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={link.navigationPath}
                        className="inline-flex items-center gap-1 text-caption-1-semibold text-active-500 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      >
                        Open technical file
                        <ExternalLink aria-hidden="true" className="size-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section aria-labelledby="framework-links-heading">
        <h3 id="framework-links-heading" className={cn("text-h5 text-fg")}>
          Framework mappings
        </h3>
        {reuse.frameworkControls.length === 0 ? (
          <p className={cn("mt-2 text-subhead-regular text-fg-muted")}>
            No framework mappings are available
          </p>
        ) : (
          <div className={cn("mt-3 overflow-x-auto")}>
            <table className={cn("w-full min-w-[620px] text-left")}>
              <thead
                className={cn(
                  "border-b border-border text-caption-1-semibold text-fg-muted",
                )}
              >
                <tr>
                  <th className={cn("px-3 py-2")}>Control</th>
                  <th className={cn("px-3 py-2")}>Implementation</th>
                  <th className={cn("px-3 py-2")}>Mapped requirements</th>
                  <th className={cn("px-3 py-2")}>Evidence version</th>
                  <th className={cn("px-3 py-2")}>
                    <span className={cn("sr-only")}>Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {reuse.frameworkControls.map((link) => (
                  <tr
                    key={link.evidenceLinkId}
                    className={cn("border-b border-border align-top")}
                  >
                    <td
                      className={cn("px-3 py-3 text-subhead-regular text-fg")}
                    >
                      {link.controlTitle}
                    </td>
                    <td
                      className={cn("px-3 py-3 text-subhead-regular text-fg")}
                    >
                      {controlStatus(link.controlStatus)}
                    </td>
                    <td
                      className={cn("px-3 py-3 text-subhead-regular text-fg")}
                    >
                      {link.requirements.length === 0 ? (
                        <span className={cn("text-fg-muted")}>
                          No active mapping for this product
                        </span>
                      ) : (
                        <>
                          <ul className={cn("grid gap-1")}>
                            {link.requirements.map((requirement) => (
                              <li
                                key={`${requirement.packKey}:${requirement.versionKey}:${requirement.requirementKey}`}
                              >
                                <span>{requirement.identifier}</span>
                                {requirement.heading ? (
                                  <span className={cn("ml-2 text-fg-muted")}>
                                    {requirement.heading}
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                          {link.requirementsHasMore ? (
                            <p
                              className={cn(
                                "mt-2 text-caption-1-regular text-fg-muted",
                              )}
                            >
                              More mappings are available in the control
                              library.
                            </p>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 font-mono text-caption-1-regular text-fg",
                      )}
                      title={link.evidenceVersionId}
                    >
                      {link.evidenceVersionId.slice(0, 8)}
                    </td>
                    <td className={cn("px-3 py-3")}>
                      <Link
                        href={link.navigationPath}
                        className={cn(
                          "inline-flex items-center gap-1 text-caption-1-semibold text-active-500 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                        )}
                      >
                        Open control
                        <ExternalLink
                          aria-hidden="true"
                          className={cn("size-3.5")}
                        />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {reuse.frameworkControlsHasMore ? (
              <p className={cn("mt-2 text-caption-1-regular text-fg-muted")}>
                Showing the first 100 authorized control links.
              </p>
            ) : null}
          </div>
        )}
      </section>
      {productId && evidenceVersionId ? (
        <section aria-labelledby="cross-framework-reuse-heading">
          <h3
            id="cross-framework-reuse-heading"
            className={cn("text-h5 text-fg")}
          >
            Cross-framework relevance
          </h3>
          <p className={cn("mt-2 text-subhead-regular text-fg-muted")}>
            Curated relationships show where this exact evidence version may be
            relevant. They do not add a control mapping or certify a standard.
          </p>
          <p className={cn("mt-2 text-caption-1-regular text-fg-muted")}>
            A direct control mapping can be on either side of a bidirectional
            relationship. Directly mapped labels reflect only the control links
            shown above.
          </p>
          {crosswalks.isLoading ? (
            <p
              role="status"
              className={cn("mt-3 text-subhead-regular text-fg-muted")}
            >
              Checking applicable requirements…
            </p>
          ) : null}
          {crosswalks.isError ? (
            <div className={cn("mt-3 grid gap-3")}>
              <p
                role="alert"
                className={cn("text-subhead-regular text-danger")}
              >
                Cross-framework relevance is unavailable for this product.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void crosswalks.refetch()}
              >
                Retry relevance
              </Button>
            </div>
          ) : null}
          {crosswalks.data ? (
            <p className={cn("mt-3 text-caption-1-regular text-fg-muted")}>
              {crosswalks.data.pages.every((page) => page.evidenceValid)
                ? "Evidence version is currently valid."
                : "Evidence version needs validity review before reuse."}
            </p>
          ) : null}
          {crosswalks.data && relations.length === 0 ? (
            <p className={cn("mt-3 text-subhead-regular text-fg-muted")}>
              No applicable curated relationships are available for this
              evidence version and product.
            </p>
          ) : null}
          {crosswalks.data && relations.length > 0 ? (
            <>
              <div className={cn("mt-3 overflow-x-auto")}>
                <table className={cn("w-full min-w-[700px] text-left")}>
                  <caption className={cn("sr-only")}>
                    Applicable curated requirement relationships
                  </caption>
                  <thead
                    className={cn(
                      "border-b border-border text-caption-1-semibold text-fg-muted",
                    )}
                  >
                    <tr>
                      <th scope="col" className={cn("px-3 py-2")}>
                        Crosswalk source
                      </th>
                      <th scope="col" className={cn("px-3 py-2")}>
                        Crosswalk target
                      </th>
                      <th scope="col" className={cn("px-3 py-2")}>
                        Relationship
                      </th>
                      <th scope="col" className={cn("px-3 py-2")}>
                        Review
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {relations.map((relation) => (
                      <tr
                        key={relation.id}
                        className={cn(
                          "border-b border-border align-top text-caption-1-regular text-fg",
                        )}
                      >
                        <td className={cn("px-3 py-3")}>
                          {relation.source.packKey} ·{" "}
                          {relation.source.versionKey} ·{" "}
                          {relation.source.requirementKey}
                          {directlyMapped.has(
                            requirementIdentity(relation.source),
                          ) ? (
                            <span
                              className={cn(
                                "ml-2 text-caption-1-semibold text-fg",
                              )}
                            >
                              Directly mapped
                            </span>
                          ) : null}
                        </td>
                        <td className={cn("px-3 py-3")}>
                          {relation.target.packKey} ·{" "}
                          {relation.target.versionKey} ·{" "}
                          {relation.target.requirementKey}
                          {directlyMapped.has(
                            requirementIdentity(relation.target),
                          ) ? (
                            <span
                              className={cn(
                                "ml-2 text-caption-1-semibold text-fg",
                              )}
                            >
                              Directly mapped
                            </span>
                          ) : null}
                        </td>
                        <td className={cn("px-3 py-3 capitalize")}>
                          {relation.relationship.replaceAll("_", " ")} ·{" "}
                          {relation.direction.replaceAll("_", " ")}
                        </td>
                        <td className={cn("px-3 py-3")}>
                          {relation.reviewer}
                          <br />
                          {relation.provenance}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {crosswalks.hasNextPage ? (
                <Button
                  type="button"
                  variant="outline"
                  className={cn("mt-4")}
                  disabled={crosswalks.isFetchingNextPage}
                  onClick={() => void crosswalks.fetchNextPage()}
                >
                  Load more applicable requirements
                </Button>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
