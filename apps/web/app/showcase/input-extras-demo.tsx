"use client";

import { PasswordInput, SearchInput } from "@repo/ui/input";
import { useState } from "react";

export function InputExtrasDemo() {
  const [q, setQ] = useState("");
  const [pw, setPw] = useState("");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <span className="text-caption-1-medium text-fg-subtle">
          Password: the frame&apos;s Active Hide / Active Show are the two
          toggle positions
        </span>
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <PasswordInput label="Label" required data-testid="pw-default" />
          <PasswordInput
            label="Label"
            required
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            helperText={`length: ${pw.length}`}
            data-testid="pw-controlled"
          />
          <PasswordInput
            label="Label"
            required
            error="Something Error Alert"
            data-testid="pw-error"
          />
          <PasswordInput
            label="Label"
            required
            disabled
            data-testid="pw-disabled"
          />
          <PasswordInput
            label="No toggle"
            revealable={false}
            data-testid="pw-no-toggle"
          />
          <PasswordInput
            label="Large"
            size="xl"
            defaultVisible
            defaultValue="hunter2"
            data-testid="pw-lg"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          Search: a pill on `surface` with no resting border
        </span>
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <SearchInput aria-label="Search" data-testid="sr-default" />
          <SearchInput
            aria-label="Search"
            clearable
            value={q}
            onValueChange={setQ}
            data-testid="sr-clearable"
          />
          <SearchInput aria-label="Search" error data-testid="sr-error" />
          <SearchInput aria-label="Search" disabled data-testid="sr-disabled" />
          <SearchInput
            aria-label="Search"
            defaultValue="uncontrolled"
            clearable
            data-testid="sr-uncontrolled"
          />
          <SearchInput
            aria-label="Search"
            endAdornment={
              <kbd className="shrink-0 rounded border border-border px-1.5 py-0.5 text-caption-2-regular text-fg-subtle">
                /
              </kbd>
            }
            data-testid="sr-kbd"
          />
        </div>
        <span className="text-caption-2-regular text-fg-subtle">
          query: {q || "(empty)"}
        </span>
      </div>
    </div>
  );
}
