"use client";

import { Avatar, AvatarGroup } from "@repo/ui/avatar";
import { Building2 } from "lucide-react";

/**
 * A 1x1 transparent GIF stands in for a real photo. It always loads, so the
 * image path is exercised without shipping binaries into the repo.
 */
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==";

export function AvatarDemo() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <span className="text-caption-1-medium text-fg-subtle">
          Default Text: 48 / 80 / 120 with 14 / 20 / 34px initials
        </span>
        <div className="flex items-end gap-4">
          <Avatar name="Ada Foster" data-testid="av-sm" />
          <Avatar name="Ada Foster" size="md" data-testid="av-md" />
          <Avatar name="Ada Foster" size="lg" data-testid="av-lg" />
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          status dot, verified tick, and the Stories ring
        </span>
        <div className="flex items-end gap-4">
          <Avatar name="Ada Foster" status="online" data-testid="av-online" />
          <Avatar name="Bea Ray" status="busy" />
          <Avatar name="Cy Nolan" status="away" />
          <Avatar name="Dee Ives" status="offline" />
          <Avatar name="Ada Foster" verified data-testid="av-verified" />
          <Avatar name="Ada Foster" ring data-testid="av-ring" />
          <Avatar name="Ada Foster" size="lg" verified />
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          fallbacks: no name at all, a custom glyph, and a broken image URL
        </span>
        <div className="flex items-end gap-4">
          <Avatar data-testid="av-empty" />
          <Avatar fallback={<Building2 aria-hidden="true" className="size-1/2" />} />
          <Avatar
            name="Ada Foster"
            src="/definitely-not-a-real-image.png"
            data-testid="av-broken"
          />
          <Avatar name="Ada Foster" src={PIXEL} data-testid="av-image" />
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          the frame&apos;s clustered 2 Image and 3 Image types
        </span>
        <div className="flex items-end gap-4">
          <Avatar images={[PIXEL, PIXEL]} data-testid="av-cluster2" />
          <Avatar images={[PIXEL, PIXEL, PIXEL]} data-testid="av-cluster3" />
          <Avatar images={[PIXEL, PIXEL, PIXEL]} size="md" status="online" />
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          AvatarGroup: overlapping row with a +N overflow
        </span>
        <div className="flex flex-col items-start gap-4">
          <AvatarGroup max={4} total={12} data-testid="av-group">
            <Avatar name="Ada Foster" />
            <Avatar name="Bea Ray" />
            <Avatar name="Cy Nolan" />
            <Avatar name="Dee Ives" />
            <Avatar name="Eli Vance" />
            <Avatar name="Fay Wu" />
          </AvatarGroup>
          <AvatarGroup max={3} size="md">
            <Avatar name="Ada Foster" size="md" />
            <Avatar name="Bea Ray" size="md" />
            <Avatar name="Cy Nolan" size="md" />
          </AvatarGroup>
        </div>
      </div>
    </div>
  );
}
