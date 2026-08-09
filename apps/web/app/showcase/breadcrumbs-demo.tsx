"use client";

import { BreadcrumbItem, Breadcrumbs } from "@repo/ui/breadcrumbs";
import Link from "next/link";

const DEEP = [
  "Workspace",
  "Projects",
  "Design system",
  "Components",
  "Navigation",
  "Breadcrumbs",
];

export function BreadcrumbsDemo() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-caption-1-medium text-fg-subtle">
          default: 12px under sm, 14px at and above, matching the Mobile and
          Desktop variants
        </span>
        <Breadcrumbs data-testid="bc-basic">
          <BreadcrumbItem asChild>
            <Link href="/showcase">Breadcrumb</Link>
          </BreadcrumbItem>
          <BreadcrumbItem asChild>
            <Link href="/showcase">Breadcrumb</Link>
          </BreadcrumbItem>
          <BreadcrumbItem current data-testid="bc-current">
            Breadcrumb
          </BreadcrumbItem>
        </Breadcrumbs>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          a disabled ancestor is distinct from the current page
        </span>
        <Breadcrumbs data-testid="bc-disabled">
          <BreadcrumbItem asChild>
            <Link href="/showcase">Workspace</Link>
          </BreadcrumbItem>
          <BreadcrumbItem disabled data-testid="bc-disabled-item">
            Archived
          </BreadcrumbItem>
          <BreadcrumbItem current>Report</BreadcrumbItem>
        </Breadcrumbs>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          maxItems=4: the middle collapses behind an expandable ellipsis
        </span>
        <Breadcrumbs maxItems={4} data-testid="bc-collapsed">
          {DEEP.map((label, i) =>
            i === DEEP.length - 1 ? (
              <BreadcrumbItem key={label} current>
                {label}
              </BreadcrumbItem>
            ) : (
              <BreadcrumbItem key={label} asChild>
                <Link href="/showcase">{label}</Link>
              </BreadcrumbItem>
            ),
          )}
        </Breadcrumbs>
      </div>

      <div className="flex max-w-sm flex-col gap-2 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          long labels truncate; the trail wraps rather than overflowing
        </span>
        <Breadcrumbs data-testid="bc-long">
          <BreadcrumbItem asChild>
            <Link href="/showcase">
              A workspace with a deliberately long name
            </Link>
          </BreadcrumbItem>
          <BreadcrumbItem asChild>
            <Link href="/showcase">Another very long section title</Link>
          </BreadcrumbItem>
          <BreadcrumbItem current>Current page, also long</BreadcrumbItem>
        </Breadcrumbs>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          size=sm and size=md forced
        </span>
        <Breadcrumbs size="sm" data-testid="bc-sm">
          <BreadcrumbItem asChild>
            <Link href="/showcase">Breadcrumb</Link>
          </BreadcrumbItem>
          <BreadcrumbItem current>Breadcrumb</BreadcrumbItem>
        </Breadcrumbs>
        <Breadcrumbs size="md" data-testid="bc-md">
          <BreadcrumbItem asChild>
            <Link href="/showcase">Breadcrumb</Link>
          </BreadcrumbItem>
          <BreadcrumbItem current>Breadcrumb</BreadcrumbItem>
        </Breadcrumbs>
      </div>
    </div>
  );
}
