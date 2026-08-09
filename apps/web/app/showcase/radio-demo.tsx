"use client";

import { Radio, RadioGroup } from "@repo/ui/radio";
import { useState } from "react";

export function RadioDemo() {
  const [plan, setPlan] = useState("pro");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-12">
        <RadioGroup defaultValue="b" aria-label="States">
          <Radio
            value="a"
            label="Radio Button Text"
            link="Text Link"
            data-testid="rd-off"
          />
          <Radio
            value="b"
            label="Radio Button Text"
            link="Text Link"
            data-testid="rd-on"
          />
          <Radio
            value="c"
            label="Radio Button Text"
            link="Text Link"
            disabled
            data-testid="rd-disabled"
          />
        </RadioGroup>

        <RadioGroup defaultValue="x" aria-label="Disabled selected">
          <Radio
            value="x"
            label="Disabled selected"
            disabled
            data-testid="rd-disabled-on"
          />
          <Radio value="y" label="Enabled option" />
        </RadioGroup>
      </div>

      <div className="border-t border-border pt-4">
        <RadioGroup
          label="Plan"
          description="Arrow keys move between options; the group is one tab stop."
          value={plan}
          onValueChange={setPlan}
        >
          <Radio
            value="free"
            label="Free"
            description="For personal projects."
          />
          <Radio
            value="pro"
            label="Pro"
            link="Compare plans"
            description="For teams."
          />
          <Radio
            value="enterprise"
            label="Enterprise"
            description="Custom limits."
          />
        </RadioGroup>
        <p className="mt-2 text-caption-2-regular text-fg-subtle">
          selected: <span className="text-fg">{plan}</span>
        </p>
      </div>

      <div className="border-t border-border pt-4">
        <RadioGroup label="Required choice" error="Please select an option">
          <Radio value="1" label="Option 1" />
          <Radio value="2" label="Option 2" />
        </RadioGroup>
      </div>
    </div>
  );
}
