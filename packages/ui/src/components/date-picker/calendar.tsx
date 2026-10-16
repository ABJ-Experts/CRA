"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, type ChevronProps, type DayPickerProps } from "react-day-picker";
import { cn } from "../../lib/cn";

/**
 * Declared at module scope rather than inline in `components`, so it is a
 * stable component identity across renders (an inline arrow would remount the
 * chevrons on every render) and so its props are typed rather than implicit.
 */
function CalendarChevron({ orientation }: ChevronProps) {
  const Icon = orientation === "left" ? ChevronLeft : ChevronRight;
  return <Icon aria-hidden="true" className="size-4" strokeWidth={1.5} />;
}

/**
 * Calendar - the panel from Pencil frame `hW0yQ` ("Forms/Date Picker"),
 * State=Selecting.
 *
 * Measured:
 *
 *   panel      400x352, radius 12, padding 16, gap 16, centred
 *              #ffffff / #26282a -> `elevated`
 *              shadows 0 8 14 #0000001a and 0 2 7 #0000001a
 *   month row  368x32, gap 16, centred
 *   prev/next  32x32, radius 12, padding 8, 1px `border`
 *   title      16px Medium -> `headline-medium` + `fg`
 *   weekday    32 tall, 12px SemiBold -> `caption-1-semibold` + `fg-subtle`
 *   day cell   368/7 = 52.571 wide, 48 tall, radius 12
 *   in month   14px Regular -> `fg`
 *   outside    #c6c8cb / #3e4043 -> `border-strong`
 *   selected   a 40x40 `active-500` circle inside the cell, white text
 *
 * The selected day being a circle inside a taller rectangular cell is the
 * detail that drives the markup: the cell keeps its 52.571x48 hit area for
 * the grid, and the 40x40 disc is drawn by the button inside it.
 *
 * Built on react-day-picker so the grid semantics come from a tested
 * implementation: `role="grid"`, arrow-key roving between days, PageUp/Down
 * between months, `aria-selected`, and locale-aware week starts.
 */

export type CalendarProps = DayPickerProps & {
  className?: string;
};

export function Calendar({ className, classNames, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays
      // The frame's header reads MO TU WE TH FR SA SU, so the week starts on
      // Monday. Overridable, since this is a locale decision.
      weekStartsOn={1}
      // NOT `items-center`, despite the frame's `alignItems: center`. In CSS
      // that makes every child shrink to its content, so the grid collapsed
      // to 7 x 40px instead of filling the panel's 368px. The month caption
      // centres its own title, which is what the frame's setting was for.
      className={cn("flex flex-col gap-4 p-4", className)}
      classNames={{
        months: "flex flex-col gap-4",
        // `relative` anchors the nav, which is a sibling of the caption and
        // is pulled over it so prev / title / next form one 32px band.
        month: "relative flex flex-col gap-4",

        // Nav is positioned over the caption row so prev / title / next read
        // as one 32px-tall band, which is how the frame lays it out.
        month_caption: "flex h-8 items-center justify-center px-10",
        caption_label: "text-headline-medium text-fg",
        nav: "absolute inset-x-0 top-0 flex h-8 items-center justify-between",
        button_previous: cn(
          "flex size-8 items-center justify-center rounded-xl p-2",
          "border border-border text-fg",
          "transition-colors duration-150 motion-reduce:transition-none",
          "hover:bg-surface",
          "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
          "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        ),
        button_next: cn(
          "flex size-8 items-center justify-center rounded-xl p-2",
          "border border-border text-fg",
          "transition-colors duration-150 motion-reduce:transition-none",
          "hover:bg-surface",
          "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
          "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        ),

        month_grid: "w-full border-collapse",
        weekdays: "flex w-full",
        weekday: cn(
          // `basis-0` with `flex-1` is what makes all seven columns exactly
          // 368/7 = 52.571 wide. Without it the cells shrink to their content
          // (the 40px day disc) and the row stops filling the panel.
          "flex h-8 flex-1 basis-0 items-center justify-center",
          "text-caption-1-semibold text-fg-subtle uppercase"
        ),
        weeks: "flex w-full flex-col",
        week: "flex w-full",

        day: "relative h-12 flex-1 basis-0 p-0 text-center",
        day_button: cn(
          "mx-auto flex size-10 items-center justify-center rounded-full",
          "text-subhead-regular text-fg",
          "transition-colors duration-150 motion-reduce:transition-none",
          "hover:bg-surface",
          "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
          "disabled:pointer-events-none disabled:opacity-40"
        ),

        // The 40x40 disc: `active-500` behind its semantic contrast text.
        selected: cn(
          "[&_button]:bg-active-500 [&_button]:text-on-accent",
          "[&_button:hover]:bg-active-600"
        ),
        today:
          "[&:not([data-selected])_button]:font-semibold [&:not([data-selected])_button]:text-active-500",
        outside: "[&_button]:text-border-strong",
        disabled: "[&_button]:text-fg-subtle",
        hidden: "invisible",

        range_start: "[&_button]:rounded-l-full",
        range_end: "[&_button]:rounded-r-full",
        range_middle: cn(
          "bg-accent-subtle",
          "[&_button]:bg-transparent [&_button]:text-fg [&_button]:rounded-none"
        ),

        ...classNames,
      }}
      components={{ Chevron: CalendarChevron }}
      {...props}
    />
  );
}
