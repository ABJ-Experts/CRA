"use client";

import { DatePicker } from "@repo/ui/date-picker";
import { TimePicker } from "@repo/ui/time-picker";
import { useState } from "react";

export function DatePickerDemo() {
  const [date, setDate] = useState<Date | undefined>(new Date(2022, 6, 4));
  const [time, setTime] = useState("");

  const min = new Date(2022, 0, 1);
  const max = new Date(2026, 11, 31);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
        <DatePicker
          label="Label"
          required
          value={date}
          onValueChange={setDate}
          data-testid="dp-controlled"
        />
        <DatePicker label="Label" required data-testid="dp-empty" />
        <DatePicker
          label="Label"
          required
          error="Something Error Alert"
          data-testid="dp-error"
        />
        <DatePicker label="Label" required disabled data-testid="dp-disabled" />
        <DatePicker
          label="Bounded"
          helperText="2022 to 2026 only"
          fromDate={min}
          toDate={max}
          defaultValue={new Date(2022, 6, 4)}
          data-testid="dp-bounded"
        />
        <DatePicker label="Large" size="xl" data-testid="dp-lg" />
      </div>

      <span className="text-caption-2-regular text-fg-subtle" data-testid="dp-value">
        selected: {date ? date.toDateString() : "none"}
      </span>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <span className="text-caption-1-medium text-fg-subtle">
          Time Picker (hW0yQ&apos;s sibling CaAId): hour / minute / meridiem, with
          the frame&apos;s bottom-aligned columns
        </span>
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <TimePicker
            label="Label"
            required
            value={time}
            onValueChange={setTime}
            data-testid="tp-controlled"
          />
          <TimePicker
            label="24 hour"
            hourCycle={24}
            minuteStep={15}
            helperText="15 minute steps, no AM/PM column"
            data-testid="tp-24"
          />
          <TimePicker
            label="Label"
            required
            error="Something Error Alert"
            data-testid="tp-error"
          />
          <TimePicker label="Label" required disabled data-testid="tp-disabled" />
        </div>
        <span className="text-caption-2-regular text-fg-subtle" data-testid="tp-value">
          time: {time || "(empty)"}
        </span>
      </div>
    </div>
  );
}
