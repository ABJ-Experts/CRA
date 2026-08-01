"use client";

import { Combobox, type ComboboxOption } from "@repo/ui/combobox";
import { Globe, MapPin } from "lucide-react";
import { useState } from "react";

const COUNTRIES: ComboboxOption[] = [
  { value: "gb", label: "United Kingdom", keywords: ["uk", "britain", "england"], group: "Europe", icon: <MapPin /> },
  { value: "de", label: "Germany", keywords: ["deutschland"], group: "Europe", icon: <MapPin /> },
  { value: "fr", label: "France", group: "Europe", icon: <MapPin /> },
  { value: "es", label: "Spain", keywords: ["espana"], group: "Europe", icon: <MapPin /> },
  { value: "us", label: "United States", keywords: ["usa", "america"], group: "Americas", icon: <Globe /> },
  { value: "ca", label: "Canada", group: "Americas", icon: <Globe /> },
  { value: "br", label: "Brazil", group: "Americas", icon: <Globe /> },
  { value: "in", label: "India", group: "Asia Pacific", icon: <Globe /> },
  { value: "jp", label: "Japan", group: "Asia Pacific", icon: <Globe /> },
  { value: "sg", label: "Singapore", group: "Asia Pacific", icon: <Globe /> },
  { value: "au", label: "Australia", group: "Asia Pacific", icon: <Globe /> },
  { value: "nz", label: "New Zealand", disabled: true, group: "Asia Pacific", icon: <Globe /> },
];

export function ComboboxDemo() {
  const [country, setCountry] = useState("gb");

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <Combobox
          label="Country"
          required
          options={COUNTRIES}
          placeholder="Select"
          searchPlaceholder="Search countries"
          helperText='Try "uk" or "america" to see keyword matching.'
          data-testid="cb-basic"
        />

        <Combobox
          label="Country"
          required
          options={COUNTRIES}
          error="Something Error Alert"
          data-testid="cb-error"
        />

        <Combobox
          label="Country"
          options={COUNTRIES}
          disabled
          placeholder="Select"
          data-testid="cb-disabled"
        />

        <Combobox
          label="Clearable"
          options={COUNTRIES}
          clearable
          value={country}
          onValueChange={setCountry}
          helperText={`selected: ${country || "none"}`}
          data-testid="cb-clearable"
        />
      </div>

      <div className="max-w-md border-t border-border pt-4">
        <span className="mb-2 block text-caption-1-medium text-fg-subtle">size=lg</span>
        <Combobox
          size="lg"
          options={COUNTRIES}
          placeholder="Select a country"
          emptyMessage="Nothing matches that search"
          data-testid="cb-lg"
        />
      </div>
    </div>
  );
}
