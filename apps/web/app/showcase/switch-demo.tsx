"use client";

import { Switch } from "@repo/ui/switch";
import { useState } from "react";

export function SwitchDemo() {
  const [on, setOn] = useState(true);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-8">
        <Switch label="Toggle Text" link="Text Link" data-testid="sw-off" />
        <Switch
          label="Toggle Text"
          link="Text Link"
          defaultChecked
          data-testid="sw-on"
        />
        <Switch
          label="Toggle Text"
          link="Text Link"
          disabled
          data-testid="sw-disabled"
        />
        <Switch
          label="Toggle Text"
          disabled
          defaultChecked
          data-testid="sw-disabled-on"
        />
      </div>

      <div className="flex flex-wrap items-center gap-8 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">size=md</span>
        <Switch size="md" label="Larger target" data-testid="sw-md" />
        <Switch
          size="md"
          label="Checked"
          defaultChecked
          data-testid="sw-md-on"
        />
      </div>

      <div className="flex max-w-sm flex-col gap-3 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          controlled, label first (settings row)
        </span>
        <Switch
          labelPosition="start"
          label="Email notifications"
          description="Send a digest once a day."
          checked={on}
          onCheckedChange={setOn}
          data-testid="sw-controlled"
        />
        <p className="text-caption-2-regular text-fg-subtle">
          state: <span className="text-fg">{on ? "on" : "off"}</span>
        </p>
      </div>
    </div>
  );
}
