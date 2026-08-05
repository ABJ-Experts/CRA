"use client";

import { Checkbox } from "@repo/ui/checkbox";
import { useState } from "react";

/**
 * Interactive Checkbox cases. Kept client-side so the showcase page itself
 * can stay a Server Component.
 */
export function CheckboxDemo() {
  const [items, setItems] = useState([true, false, false]);
  const allChecked = items.every(Boolean);
  const someChecked = items.some(Boolean) && !allChecked;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-8">
        <Checkbox label="Checkbox Text" link="Text Link" data-testid="cb-default" />
        <Checkbox label="Checkbox Text" link="Text Link" defaultChecked data-testid="cb-checked" />
        <Checkbox
          label="Checkbox Text"
          link="Text Link"
          checked="indeterminate"
          data-testid="cb-indeterminate"
        />
        <Checkbox label="Checkbox Text" link="Text Link" disabled data-testid="cb-disabled" />
        <Checkbox label="Checkbox Text" disabled defaultChecked data-testid="cb-disabled-checked" />
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          controlled tri-state (parent reflects children)
        </span>
        <Checkbox
          label="Select all"
          checked={allChecked ? true : someChecked ? "indeterminate" : false}
          onCheckedChange={(next) => setItems(items.map(() => next === true))}
          data-testid="cb-parent"
        />
        <div className="flex flex-col gap-2 pl-7">
          {items.map((checked, i) => (
            <Checkbox
              key={i}
              label={`Option ${i + 1}`}
              checked={checked}
              onCheckedChange={(next) =>
                setItems(items.map((v, j) => (i === j ? next === true : v)))
              }
            />
          ))}
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <Checkbox
          label="I accept the terms"
          error="You must accept before continuing"
          data-testid="cb-error"
        />
      </div>
    </div>
  );
}
