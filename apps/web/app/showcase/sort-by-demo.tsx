"use client";

import { SortBy } from "@repo/ui/sort-by";
import { ArrowDownAZ, ArrowUpAZ, Clock3, Flame } from "lucide-react";
import { useState } from "react";

const OPTIONS = [
  { value: "newest", label: "Newest", icon: <Clock3 /> },
  { value: "oldest", label: "Oldest", icon: <Clock3 /> },
  { value: "az", label: "A to Z", icon: <ArrowDownAZ /> },
  { value: "za", label: "Z to A", icon: <ArrowUpAZ /> },
  { value: "popular", label: "Popular", icon: <Flame /> },
];

export function SortByDemo() {
  const [sort, setSort] = useState("newest");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-8">
        <SortBy
          label="Sort by"
          options={OPTIONS}
          value={sort}
          onValueChange={setSort}
          data-testid="sb-controlled"
        />
        <SortBy
          label="Label"
          required
          options={OPTIONS}
          data-testid="sb-empty"
        />
        <SortBy
          label="Label"
          options={OPTIONS}
          defaultValue="az"
          disabled
          data-testid="sb-disabled"
        />
        <SortBy
          options={OPTIONS}
          defaultValue="popular"
          data-testid="sb-nolabel"
        />
      </div>
      <span
        className="text-caption-2-regular text-fg-subtle"
        data-testid="sb-value"
      >
        sort: {sort}
      </span>
    </div>
  );
}
