"use client";

import { Button } from "@repo/ui/button";
import { Editor } from "@repo/ui/editor";
import { SortBy } from "@repo/ui/sort-by";
import { Send } from "lucide-react";
import { useState } from "react";

const SENDERS = [
  { value: "ronald", label: "Ronald Richards" },
  { value: "wade", label: "Wade Warren" },
];

export function EditorDemo() {
  const [one, setOne] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [aligned, setAligned] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-caption-1-medium text-fg-subtle">
          #1 &mdash; toolbar plus a bare send glyph. Every button is a real
          TipTap command, and lights up while the caret is inside matching
          content.
        </span>
        <Editor
          label="Label"
          required
          value={one}
          onValueChange={setOne}
          onSubmit={setSent}
          onFormat={(c) => c.startsWith("align") && setAligned(c)}
          data-testid="ed-1"
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          #2 &mdash; no toolbar, filled primary button
        </span>
        <Editor
          label="Label"
          required
          toolbar={false}
          submit="button"
          onSubmit={setSent}
          data-testid="ed-2"
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          #3 &mdash; toolbar plus a &quot;from&quot; selector beside the button
        </span>
        <Editor
          submit="none"
          submitBefore={
            <div className="flex items-center gap-4">
              <SortBy label="from" options={SENDERS} defaultValue="ronald" />
              <Button
                endIcon={<Send />}
                withDivider
                onClick={() => setSent("(#3)")}
              >
                Send
              </Button>
            </div>
          }
          data-testid="ed-3"
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          error and disabled
        </span>
        <Editor
          label="Label"
          required
          error="Something Error Alert"
          data-testid="ed-error"
        />
        <Editor label="Label" disabled data-testid="ed-disabled" />
      </div>

      <pre
        data-testid="ed-log"
        className="overflow-x-auto rounded-xl bg-surface p-3 text-caption-2-regular text-fg"
      >
        {`html: ${one || "(empty)"}
sent: ${sent === null ? "(nothing)" : sent}
last align command: ${aligned ?? "(none)"}`}
      </pre>
    </div>
  );
}
