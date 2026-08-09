"use client";

import {
  Select,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
} from "@repo/ui/select";
import { Globe, MapPin } from "lucide-react";
import { useState } from "react";

const COUNTRIES = [
  "United Kingdom",
  "United States",
  "Germany",
  "France",
  "India",
  "Japan",
  "Brazil",
  "Canada",
  "Australia",
  "Singapore",
];

export function SelectDemo() {
  const [value, setValue] = useState<string>();

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <Select
          label="Label"
          required
          placeholder="Select"
          data-testid="sel-default"
        >
          {COUNTRIES.slice(0, 5).map((c) => (
            <SelectItem key={c} value={c.toLowerCase().replace(/\s+/g, "-")}>
              {c}
            </SelectItem>
          ))}
        </Select>

        <Select
          label="Label"
          required
          placeholder="Select"
          error="Something Error Alert"
          data-testid="sel-error"
        >
          {COUNTRIES.slice(0, 3).map((c) => (
            <SelectItem key={c} value={c.toLowerCase()}>
              {c}
            </SelectItem>
          ))}
        </Select>

        <Select
          label="Label"
          required
          placeholder="Select"
          disabled
          data-testid="sel-disabled"
        >
          <SelectItem value="a">A</SelectItem>
        </Select>

        <Select
          label="With helper"
          placeholder="Select a region"
          helperText="Used for billing and tax."
          data-testid="sel-helper"
        >
          {/* Radix requires SelectLabel to live inside a SelectGroup. */}
          <SelectGroup>
            <SelectLabel>Europe</SelectLabel>
            <SelectItem value="uk" startIcon={<MapPin />}>
              United Kingdom
            </SelectItem>
            <SelectItem value="de" startIcon={<MapPin />}>
              Germany
            </SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Other</SelectLabel>
            <SelectItem value="global" startIcon={<Globe />}>
              Global
            </SelectItem>
            <SelectItem value="none" disabled>
              Unavailable
            </SelectItem>
          </SelectGroup>
        </Select>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          controlled, long list scrolls inside the panel
        </span>
        <div className="max-w-sm">
          <Select
            placeholder="Pick a country"
            value={value}
            onValueChange={setValue}
            data-testid="sel-controlled"
          >
            {COUNTRIES.map((c) => (
              <SelectItem key={c} value={c.toLowerCase().replace(/\s+/g, "-")}>
                {c}
              </SelectItem>
            ))}
          </Select>
        </div>
        <p className="text-caption-2-regular text-fg-subtle">
          selected: <span className="text-fg">{value ?? "none"}</span>
        </p>
      </div>
    </div>
  );
}
