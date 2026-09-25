"use client";

import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { useInfiniteQuery } from "@tanstack/react-query";

import { frameworksApi } from "./frameworks.api";

export function FrameworkCrosswalkPanel({
  organizationId,
  packKey,
  versionKey,
}: Readonly<{
  organizationId: string;
  packKey: string;
  versionKey: string;
}>) {
  const query = useInfiniteQuery({
    queryKey: ["framework-crosswalks", organizationId, packKey, versionKey],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      frameworksApi.crosswalks(packKey, versionKey, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const relations = query.data?.pages.flatMap((page) => page.relations) ?? [];

  if (query.isLoading)
    return (
      <p role="status" className={cn("text-subhead-regular text-fg-muted")}>
        Loading curated crosswalks…
      </p>
    );
  if (query.isError)
    return (
      <div className={cn("grid gap-3")}>
        <p role="alert" className={cn("text-subhead-regular text-danger")}>
          Curated crosswalks are unavailable.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => void query.refetch()}
        >
          Retry crosswalks
        </Button>
      </div>
    );
  if (relations.length === 0)
    return (
      <p className={cn("text-subhead-regular text-fg-muted")}>
        No curated crosswalk is published for this edition.
      </p>
    );

  return (
    <>
      <p className={cn("mb-3 text-caption-1-regular text-fg-muted")}>
        These reviewed relationships suggest where evidence may be relevant. A
        partial, uncertain, or one-way link does not establish equivalence or
        coverage.
      </p>
      <div className={cn("overflow-x-auto")}>
        <table className={cn("w-full min-w-[760px] text-left")}>
          <caption className={cn("sr-only")}>
            Version-specific curated requirement relationships
          </caption>
          <thead
            className={cn(
              "border-b border-border text-caption-1-semibold text-fg-muted",
            )}
          >
            <tr>
              <th scope="col" className={cn("px-3 py-2")}>
                Source
              </th>
              <th scope="col" className={cn("px-3 py-2")}>
                Target
              </th>
              <th scope="col" className={cn("px-3 py-2")}>
                Relationship
              </th>
              <th scope="col" className={cn("px-3 py-2")}>
                Rationale and provenance
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
                <td className={cn("px-3 py-3 break-words")}>
                  {relation.source.packKey} · {relation.source.versionKey} ·{" "}
                  {relation.source.requirementKey}
                </td>
                <td className={cn("px-3 py-3 break-words")}>
                  {relation.target.packKey} · {relation.target.versionKey} ·{" "}
                  {relation.target.requirementKey}
                </td>
                <td className={cn("px-3 py-3 capitalize")}>
                  {relation.relationship.replaceAll("_", " ")} ·{" "}
                  {relation.direction.replaceAll("_", " ")}
                </td>
                <td className={cn("px-3 py-3")}>
                  <p>{relation.rationale}</p>
                  <p className={cn("mt-1 text-fg-muted")}>
                    {relation.provenance}
                  </p>
                </td>
                <td className={cn("px-3 py-3")}>
                  {relation.reviewer}
                  <br />
                  <time
                    dateTime={relation.reviewedAt}
                    className={cn("text-fg-muted")}
                  >
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                    }).format(new Date(relation.reviewedAt))}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          className={cn("mt-4")}
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          Load more crosswalks
        </Button>
      ) : null}
    </>
  );
}
