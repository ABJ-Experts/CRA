"use client";

import { Pagination } from "@repo/ui/pagination";
import { useState } from "react";

export function PaginationDemo() {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(15);
  const total = 209;
  const pageCount = Math.ceil(total / size);

  const [far, setFar] = useState(6);
  const [few, setFew] = useState(1);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-caption-1-medium text-fg-subtle">
          full: rows-per-page, range caption, First / End. Resize below 640px to see the mobile
          layout swap in.
        </span>
        <Pagination
          page={page}
          pageCount={pageCount}
          onPageChange={setPage}
          pageSize={size}
          pageSizeOptions={[15, 25, 50, 100]}
          onPageSizeChange={(n) => {
            setSize(n);
            setPage(1);
          }}
          total={total}
          data-testid="pg-full"
        />
        <span className="text-caption-2-regular text-fg-subtle">
          page {page} of {pageCount}, {size} rows
        </span>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          mid-trail: an ellipsis appears on both sides
        </span>
        <Pagination page={far} pageCount={24} onPageChange={setFar} data-testid="pg-mid" />
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          three pages: no ellipsis, and both arrows disable at the ends
        </span>
        <Pagination page={few} pageCount={3} onPageChange={setFew} data-testid="pg-few" />
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          single page, and pageCount=0 (renders nothing)
        </span>
        <Pagination page={1} pageCount={1} onPageChange={() => {}} data-testid="pg-one" />
        <Pagination page={1} pageCount={0} onPageChange={() => {}} data-testid="pg-zero" />
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          showFirstLast=false, and an out-of-range page is clamped
        </span>
        <Pagination
          page={999}
          pageCount={8}
          onPageChange={() => {}}
          showFirstLast={false}
          data-testid="pg-clamped"
        />
      </div>
    </div>
  );
}
