"use client";

import { applyTheme, getStoredTheme, type Theme } from "@repo/design-system/theme";
import { Button } from "@repo/ui/button";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Mode = Theme;

/**
 * Drives the `data-theme` attribute on <html>, which is what
 * @repo/design-system keys `color-scheme` and its `dark:` variant off.
 *
 * Goes through `applyTheme` rather than setting the attribute directly: the
 * helper also suppresses transitions for the frame of the switch, without
 * which every element carrying `transition-colors` keeps its old palette.
 */
export function ThemeToggle() {
  // Seeded from storage on mount rather than in `useState`, so the server and
  // the first client render agree; the pre-paint script has already applied
  // the visual theme by this point.
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    setMode(getStoredTheme());
  }, []);

  useEffect(() => {
    applyTheme(mode);
  }, [mode]);

  const options: { value: Mode; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  return (
    <div className="flex items-center gap-2" role="group" aria-label="Colour theme">
      {options.map(({ value, label, icon: Icon }) => (
        <Button
          key={value}
          size="sm"
          variant={mode === value ? "fill" : "outline"}
          tone={mode === value ? "primary" : "grey"}
          startIcon={<Icon />}
          aria-pressed={mode === value}
          onClick={() => setMode(value)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}
