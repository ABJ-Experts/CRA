import { ExternalLink, Link2, ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { EvidenceVersionReuse } from "@repo/contracts/evidence";

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

export function EvidenceReusePanel({
  reuse,
}: Readonly<{ reuse: EvidenceReuseDetail }>) {
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
        <h3 id="framework-links-heading" className="text-h5 text-fg">
          Framework mappings
        </h3>
        {reuse.frameworkControls.length === 0 ? (
          <p className="mt-2 text-subhead-regular text-fg-muted">
            No framework mappings are available
          </p>
        ) : (
          <p className="mt-2 text-subhead-regular text-fg-muted">
            Framework mappings are available for this version.
          </p>
        )}
      </section>
    </div>
  );
}
