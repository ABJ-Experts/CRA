"use client";

import { Chip } from "@repo/ui/chip";
import { User } from "lucide-react";
import { useState } from "react";

const INITIAL = ["Ada Lovelace", "Grace Hopper", "Alan Turing", "Katherine Johnson"];

export function ChipDemo() {
  const [people, setPeople] = useState(INITIAL);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <span className="text-caption-1-medium text-fg-subtle">
          removable, with avatar slot
        </span>
        <div className="flex flex-wrap items-center gap-2" data-testid="chip-list">
          {people.map((name) => (
            <Chip
              key={name}
              avatar={
                <span className="flex size-full items-center justify-center bg-surface-muted text-fg-muted">
                  <User aria-hidden="true" className="size-3.5" />
                </span>
              }
              onRemove={() => setPeople((p) => p.filter((n) => n !== name))}
              removeLabel={`Remove ${name}`}
              data-testid={`chip-${name.split(" ")[0]?.toLowerCase()}`}
            >
              {name}
            </Chip>
          ))}
          {people.length === 0 ? (
            <button
              type="button"
              onClick={() => setPeople(INITIAL)}
              className="text-caption-1-medium text-active-500 underline"
            >
              Reset
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Chip data-testid="chip-plain">No avatar, not removable</Chip>
        <Chip disabled onRemove={() => {}} data-testid="chip-disabled">
          Disabled
        </Chip>
        <div className="w-40">
          <Chip onRemove={() => {}} data-testid="chip-truncate">
            A very long chip name that truncates
          </Chip>
        </div>
      </div>
    </div>
  );
}
