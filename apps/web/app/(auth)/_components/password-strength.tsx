"use client";

import { cn } from "@repo/ui/cn";

/**
 * A four-segment strength meter for the set-password screen.
 *
 * Deliberately simple and honest: it scores the things the schema actually
 * enforces plus length, rather than pretending to estimate entropy. A meter
 * that says "strong" for `Passw0rd!` teaches the wrong lesson.
 */
const RULES: { label: string; test: (v: string) => boolean }[] = [
  { label: "at least 8 characters", test: (v) => v.length >= 8 },
  { label: "a number", test: (v) => /[0-9]/.test(v) },
  {
    label: "an upper and lower case letter",
    test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v),
  },
  { label: "12 characters or more", test: (v) => v.length >= 12 },
];

const LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"] as const;
const BARS = [
  "bg-border",
  "bg-brink-red-500",
  "bg-origin-orange-500",
  "bg-cyan-blue-500",
  "bg-origin-green-500",
] as const;

export function PasswordStrength({ value }: { value: string }) {
  const passed = RULES.filter((r) => r.test(value)).length;
  const score = value.length === 0 ? 0 : passed;
  const unmet = RULES.filter((r) => !r.test(value));

  return (
    <div className="flex flex-col gap-2" data-testid="pw-strength">
      <div className="flex items-center gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors duration-200",
              "motion-reduce:transition-none",
              i < score ? BARS[score] : "bg-border",
            )}
          />
        ))}
      </div>
      {/*
        The meter itself is aria-hidden and the reading is given as text, so a
        screen reader gets the verdict rather than four unlabelled bars.
      */}
      <p
        className="text-caption-2-regular text-fg-subtle"
        data-testid="pw-strength-label"
      >
        <span className="text-fg-muted">{LABELS[score]}</span>
        {unmet.length > 0 && value.length > 0
          ? ` — add ${unmet.map((r) => r.label).join(", ")}`
          : ""}
      </p>
    </div>
  );
}
