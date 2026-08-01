"use client";

import {
  Alert,
  AlertAction,
  AlertActions,
  AlertCancel,
  AlertContent,
  AlertDescription,
  AlertRoot,
  AlertTitle,
  AlertTrigger,
} from "@repo/ui/alert";
import { Button } from "@repo/ui/button";
import { useState } from "react";

export function AlertDemo() {
  const [log, setLog] = useState<string[]>([]);
  const [controlledOpen, setControlledOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const note = (m: string) => setLog((l) => [m, ...l].slice(0, 4));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Alert
          trigger={
            <Button variant="outline" tone="grey" data-testid="alert-open">
              Open alert
            </Button>
          }
          title="Title Alert"
          description="Description Alert"
          confirmLabel="Active"
          onConfirm={() => note("confirmed")}
          onCancel={() => note("cancelled")}
        />

        <Alert
          trigger={
            <Button variant="outline" tone="grey" data-testid="alert-open-nodesc">
              Title only
            </Button>
          }
          title="Discard your changes?"
          confirmLabel="Discard"
          onConfirm={() => note("discarded")}
        />

        <Alert
          trigger={
            <Button variant="outline" tone="grey" data-testid="alert-open-ack">
              Acknowledge only
            </Button>
          }
          title="Import finished"
          description="428 records were added to your workspace."
          showCancel={false}
          confirmLabel="Got it"
          onConfirm={() => note("acknowledged")}
        />

        <Button
          variant="outline"
          tone="grey"
          onClick={() => setControlledOpen(true)}
          data-testid="alert-open-controlled"
        >
          Controlled + loading
        </Button>
      </div>

      {/* Controlled: `open` is owned here, so the confirm button can show a
          pending state before the dialog closes. */}
      <Alert
        open={controlledOpen}
        onOpenChange={setControlledOpen}
        title="Save and publish?"
        description="Your teammates will be notified once this goes live."
        confirmLabel="Publish"
        loading={saving}
        onConfirm={() => {
          setSaving(true);
          setTimeout(() => {
            setSaving(false);
            setControlledOpen(false);
            note("published");
          }, 900);
        }}
      />

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          composed from the parts, with a longer body
        </span>
        <AlertRoot>
          <AlertTrigger asChild>
            <Button variant="outline" tone="grey" data-testid="alert-open-parts">
              Composed
            </Button>
          </AlertTrigger>
          <AlertContent data-testid="alert-content-parts">
            <AlertTitle>Remove three collaborators?</AlertTitle>
            <AlertDescription>
              They will immediately lose access to every project in this
              workspace, including drafts they created themselves.
            </AlertDescription>
            <AlertActions>
              <AlertCancel>Keep them</AlertCancel>
              <AlertAction onClick={() => note("removed")}>Remove</AlertAction>
            </AlertActions>
          </AlertContent>
        </AlertRoot>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-caption-1-semibold text-fg-muted">Result</span>
        <pre
          data-testid="alert-log"
          className="rounded-xl bg-surface p-3 text-caption-2-regular text-fg"
        >
          {log.length ? log.join("\n") : "No action yet"}
        </pre>
      </div>
    </div>
  );
}
