import { cva, type VariantProps } from "class-variance-authority";

/**
 * Tags — Pencil frame `l9QDb` ("Tags").
 *
 * The design encodes `Dark Mode={Off|On} x Type={Cool|Fill Color|Dot} x
 * Size={Small|Medium}`. There is only a Default state: tags are labels, not
 * controls, so there is no hover/disabled axis to model.
 *
 * Measured geometry, straight from the frame:
 *
 * | Type | Size   | h  | radius | padding      | gap | icon/dot |
 * | ---- | ------ | -- | ------ | ------------ | --- | -------- |
 * | Cool | Small  | 22 | 14     | [2,8]        | 4   | 12       |
 * | Cool | Medium | 28 | 14     | [4,12,3,12]  | 4   | 12       |
 * | Fill | Small  | 22 | 14     | [2,8]        | 4   | 12       |
 * | Fill | Medium | 28 | 14     | [4,12,3,12]  | 4   | 12       |
 * | Dot  | Small  | 18 | -      | none         | 4   | 8        |
 * | Dot  | Medium | 21 | -      | none         | 4   | 10       |
 *
 * radius 14 on a 22px pill is >= half the height, so `rounded-full` is the
 * exact same shape and stays correct if the label ever wraps to two lines.
 *
 * Colours resolve to existing semantic tokens with no drift:
 *   Cool bg    #f5f5f5 / #26282a -> `surface`
 *   Cool label #727880 / #898f96 -> `fg-muted`
 *   Dot label  #9da2a7 / #55585a -> `fg-subtle`
 *
 * `Fill Color` has no dark variant in the design, and none is needed: the
 * fill is a 300-level pastel that stays light in both themes, so its label
 * stays ink (`neutral-light-500`) rather than flipping with `fg`.
 */

/** Palette families that ship both a 300 (fill) and a 500 (dot) step. */
export const TAG_TONES = [
  "purple",
  "blue",
  "green",
  "orange",
  "red",
  "indigo",
] as const;

export type TagTone = (typeof TAG_TONES)[number];

export const tagVariants = cva(
  [
    "inline-flex shrink-0 items-center align-middle",
    "rounded-full",
    // Long labels truncate rather than blowing out the row they sit in.
    "max-w-full",
    "[&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        cool: "bg-surface text-fg-muted",
        fill: "text-neutral-light-500",
        dot: "text-fg-subtle",
      },
      size: {
        sm: "gap-1 text-caption-1-medium [&_svg]:size-3",
        md: "gap-1 text-subhead-medium [&_svg]:size-3",
      },
      tone: {
        purple: "",
        blue: "",
        green: "",
        orange: "",
        red: "",
        indigo: "",
      },
    },
    compoundVariants: [
      // Padding belongs to the pill types only. The Dot type is bare text.
      { variant: ["cool", "fill"], size: "sm", class: "px-2 py-0.5" },
      // 4px top / 3px bottom is the design's optical centring for 14px text.
      { variant: ["cool", "fill"], size: "md", class: "px-3 pt-1 pb-[3px]" },

      // `Fill Color` backgrounds: the 300 step of each family.
      // The design ships royal-purple-300 (#d9b7fb); the rest follow the ramp.
      { variant: "fill", tone: "purple", class: "bg-royal-purple-300" },
      { variant: "fill", tone: "blue", class: "bg-cyan-blue-300" },
      { variant: "fill", tone: "green", class: "bg-origin-green-300" },
      { variant: "fill", tone: "orange", class: "bg-origin-orange-300" },
      { variant: "fill", tone: "red", class: "bg-brink-red-300" },
      { variant: "fill", tone: "indigo", class: "bg-active-300" },
    ],
    defaultVariants: { variant: "cool", size: "md", tone: "purple" },
  }
);

/**
 * The Dot type's leading marker. Sized 8px at Small and 10px at Medium, which
 * is why it is not just an `[&_svg]:size-*` rule like the Cool/Fill icon.
 */
export const tagDotVariants = cva("shrink-0 rounded-full", {
  variants: {
    size: { sm: "size-2", md: "size-2.5" },
    tone: {
      // 500 step of each family. cyan-blue-500 is the design's default.
      purple: "bg-royal-purple-500",
      blue: "bg-cyan-blue-500",
      green: "bg-origin-green-500",
      orange: "bg-origin-orange-500",
      red: "bg-brink-red-500",
      indigo: "bg-active-500",
    },
  },
  defaultVariants: { size: "md", tone: "blue" },
});

export type TagVariantProps = VariantProps<typeof tagVariants>;
