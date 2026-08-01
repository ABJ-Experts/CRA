import { Tag, TAG_TONES } from "@repo/ui/tag";
import { Hash } from "lucide-react";

/**
 * Server Component on purpose: `Tag` is presentational, so it must stay
 * importable without a client boundary. If this ever needs "use client" the
 * component has regressed.
 */
export function TagDemo() {
  return (
    <div className="flex flex-col gap-6">
      {(["md", "sm"] as const).map((size) => (
        <div key={size} className="flex flex-col gap-3">
          <span className="text-caption-1-medium text-fg-subtle">
            size={size === "md" ? "md (design: Medium)" : "sm (design: Small)"}
          </span>

          <div className="flex flex-wrap items-center gap-3">
            <Tag size={size} icon={<Hash />} data-testid={`tag-cool-${size}`}>
              Tag
            </Tag>
            <Tag
              size={size}
              variant="fill"
              icon={<Hash />}
              data-testid={`tag-fill-${size}`}
            >
              Tag
            </Tag>
            <Tag size={size} variant="dot" data-testid={`tag-dot-${size}`}>
              Tag
            </Tag>
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          tone, variant=fill
        </span>
        <div className="flex flex-wrap items-center gap-3">
          {TAG_TONES.map((tone) => (
            <Tag key={tone} variant="fill" tone={tone} icon={<Hash />}>
              {tone}
            </Tag>
          ))}
        </div>

        <span className="mt-2 text-caption-1-medium text-fg-subtle">
          tone, variant=dot
        </span>
        <div className="flex flex-wrap items-center gap-3">
          {TAG_TONES.map((tone) => (
            <Tag key={tone} variant="dot" tone={tone}>
              {tone}
            </Tag>
          ))}
        </div>
      </div>

      <div className="flex max-w-xs flex-col gap-2 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          long label truncates instead of blowing out the row
        </span>
        <Tag icon={<Hash />} data-testid="tag-truncate">
          A deliberately very long tag label that will not fit
        </Tag>
      </div>
    </div>
  );
}
