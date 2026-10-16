---
name: CRA Sentinel
description: Product-security and EU Cyber Resilience Act compliance operations.
colors:
  canvas: "light-dark(#ffffff, #1b1d1f)"
  surface: "light-dark(#f5f5f5, #26282a)"
  surface-muted: "light-dark(#eeeeee, #2e3133)"
  elevated: "light-dark(#ffffff, #26282a)"
  border: "light-dark(#eeeeee, #2e3133)"
  border-strong: "light-dark(#c6c8cb, #3e4043)"
  foreground: "light-dark(#1b1d1f, #ffffff)"
  foreground-muted: "light-dark(#727880, #898f96)"
  foreground-subtle: "light-dark(#9da2a7, #55585a)"
  primary: "#595fe5"
  primary-hover: "#4a50d6"
  primary-subtle: "light-dark(#ebecff, #232445)"
  on-accent: "light-dark(#ffffff, #232445)"
  danger: "#e5646c"
  success: "#7dc066"
  info: "#59b4d1"
  warning: "#f3935d"
  premium: "#9e57e5"
typography:
  display:
    fontFamily: "Poppins, system-ui, sans-serif"
    fontSize: "3.75rem"
    fontWeight: 600
    lineHeight: 1.5
  headline:
    fontFamily: "Poppins, system-ui, sans-serif"
    fontSize: "2.125rem"
    fontWeight: 500
    lineHeight: 1.5
  title:
    fontFamily: "Poppins, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 500
    lineHeight: 1.5
  body:
    fontFamily: "Poppins, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Poppins, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.5
rounded:
  control: "12px"
  brand-mark: "8px"
  pill: "9999px"
  balloon: "40px 40px 12px 40px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  page: "30px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
  button-outline:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.primary}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "40px"
  card-outlined:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.control}"
    padding: "24px"
  input-field:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "40px"
---

# Design System: CRA Sentinel

## Overview

**Creative North Star: "The Evidence Control Room"**

CRA Sentinel is a sober, high-trust operating environment for regulatory work that may be reviewed years later. The interface uses neutral surfaces, precise borders, and a single verification-blue action language to keep sensitive tasks calm and legible. It supports light, dark, and organization-branded dashboard contexts without altering the structural or status vocabulary.

The system is deliberately restrained rather than austere. Dense tools such as registries, tables, form workflows, and evidence views rely on a compact component scale; new surfaces should nevertheless create generous page-level breathing room and clear visual chapters for scanability. The product has no incumbent decorative-image language, so imagery is not a system default.

**Key Characteristics:**

- Graphite and white surfaces establish concentration before color is introduced.
- Verification Indigo marks the primary path, selected state, focus treatment, and organization accent scope.
- Rounded 12px controls soften a rigorous operational interface without becoming playful.
- Tonal layers and precise borders create hierarchy; conspicuous shadow is reserved for interactive elevation.
- Motion is short, state-led, and disabled for reduced-motion users.

## Colors

Graphite & Verification Indigo: neutral light and dark ramps carry the product; primary and status colors communicate deliberate actions and state rather than decoration.

### Primary

- **Verification Indigo** (`#595fe5`): Default primary fills, selected controls, and dashboard organization-brand fallback.
- **Indigo Commitment** (`#4a50d6`): Hover and active treatment for primary actions; this is the accessible light-theme accent against white text.
- **Indigo Trace** (`light-dark(#ebecff, #232445)`): Low-emphasis primary surfaces, hover states, and active-context support.

### Secondary

- **Signal Cyan** (`#59b4d1`): Information states only.
- **Assurance Green** (`#7dc066`): Success states only.
- **Caution Orange** (`#f3935d`): Warning states only.
- **Exception Red** (`#e5646c`): Error and destructive states only.
- **Royal Purple** (`#9e57e5`): Premium or exceptional status only.

### Neutral

- **Graphite Ink** (`light-dark(#1b1d1f, #ffffff)`): Primary foreground.
- **Paper Canvas** (`light-dark(#ffffff, #1b1d1f)`): Page canvas and outlined-card base.
- **Soft Utility Surface** (`light-dark(#f5f5f5, #26282a)`): Filled surfaces and restrained hover feedback.
- **Selected Surface** (`light-dark(#eeeeee, #2e3133)`): Active navigation and muted-layer emphasis.
- **Quiet Boundary** (`light-dark(#eeeeee, #2e3133)`): Default borders.

### Named Rules

**The Evidence-First Color Rule.** Use color to locate action, state, and risk. Never use it as ornamental fill, and do not use status colors as a substitute for labels or text.

**The Muted-Text Safety Rule.** `fg-muted` is for text at least 18.66px or bold text at least 14px; `fg-subtle` is reserved for disabled and placeholder content. Ordinary body copy uses `fg`.

## Typography

**Display Font:** Poppins (with `system-ui, sans-serif` fallback)

**Body Font:** Poppins (with `system-ui, sans-serif` fallback)

**Label/Mono Font:** Poppins; no separate monospace visual language is currently established.

**Character:** Poppins gives the system a clean, approachable geometric voice while medium and semibold weights keep dense operational content crisp. Typography favors legible, compact hierarchy; new page compositions should add space around content groups rather than inflate controls or body copy.

### Hierarchy

- **Display** (600, 60px, 1.5): Large product-level or high-impact headings. The system also exposes 100px and 200px display steps, but they are exceptional rather than general page defaults.
- **Headline** (500, 34px, 1.5): Page and major section headings.
- **Title** (500, 20px, 1.5): Cards, panels, and important local groups.
- **Body** (400, 16px, 1.5): Core explanatory and form-adjacent copy.
- **Subhead** (400/500/600, 14px, 1.5): Operational UI, navigation, controls, and dense table support.
- **Caption** (400/500/600, 12px; 10px for compact counters, 1.5): Supporting metadata and compact labels.

### Named Rules

**The Spacious-Frame Rule.** Preserve the compact type scale inside operational widgets, but use clear page-title separation, 24–30px desktop gutters, and generous section breaks whenever the workflow does not require constant comparison.

## Layout

The dashboard is an app shell with a sticky 64px top navigation and a responsive left rail: 270px expanded, 66px collapsed, and a mobile overlay below the `lg` breakpoint. The default content rhythm is 24px, with 30px horizontal gutters on large screens and 24px around dashboard sections. Cards use 24px internal padding at standard size and 16px in compact contexts.

Pages should prioritize scanability over visual spectacle: establish a clear title or breadcrumb, group related actions close to their records, and keep high-volume tables wide and horizontally honest. At narrow sizes, navigation becomes an overlay and layouts stack instead of compressing interactive targets. New editorial or low-density surfaces may be spacious, but should preserve the app shell, core rhythm, and compact control dimensions.

## Elevation & Depth

Depth is tonal and structural by default: canvas, surface, muted surface, and a 1px border distinguish regions. Elevated overlays use a theme-aware elevated surface. Shadows are not a resting decoration; interactive cards may lift with a large black-30% shadow and a stronger border on hover. This keeps evidence-heavy pages quiet while making actionable containers unmistakable.

### Shadow Vocabulary

- **Interactive Lift** (`shadow-lg` with `rgb(0 0 0 / 0.3)` tint): Hover-only emphasis for whole-card links or buttons.
- **Inset State Ring** (1–2px inset ring): Field hover, focus, and error state without layout shift.

### Named Rules

**The Flat-Until-Actionable Rule.** Static information stays flat or border-defined. Elevation appears only to clarify an overlay, focus, or a genuinely interactive container.

## Shapes

The recurring form is a 12px rounded rectangle (`rounded-xl`) used for buttons, inputs, cards, navigation items, and overlays. Brand marks use 8px corners; search and utility controls may use full pills. The Balloon button is a deliberate exception with `40px 40px 12px 40px` corners and must remain rare. Borders are quiet 1px separators, not heavy containers.

## Components

### Buttons

Compact, clearly actionable, and token-led.

- **Shape:** 12px radius; the Balloon variant is the only asymmetrical exception.
- **Primary:** `active-500` fill with `on-accent` text. Heights are 32px, 40px, 48px, and 56px across the size scale.
- **Hover / Focus:** Background, border, color, and opacity transition over 150ms; keyboard focus uses a 2px `active-500` ring with a canvas offset.
- **Secondary / Ghost:** Outline and Gap variants retain canvas or transparent backgrounds with border or text-led emphasis. Disabled states use `border-strong` and canvas text.

### Cards / Containers

Structured containers for summaries, tables, and tool panels.

- **Corner Style:** 12px radius.
- **Background:** Outlined cards use canvas with a 1px border; filled cards use surface; primary cards use `active-500` with `on-accent` text.
- **Shadow Strategy:** Flat at rest. Interactive cards lift on hover only.
- **Internal Padding:** 24px / 24px gap at standard size; 16px / 16px gap in compact contexts.

### Inputs / Fields

Focused, stable form controls with no reflow between interaction states.

- **Style:** Canvas field, 12px radius, 40px/48px/56px heights, 12–16px horizontal padding.
- **Focus:** A 1px `active-500` inset ring; hover increases the inset ring to 2px using `accent-subtle`.
- **Error / Disabled:** Danger inset ring for errors; surface background with subdued foreground for disabled controls.

### Navigation

The dashboard uses a persistent, permission-aware rail with a sticky top bar.

- **Style:** 64px top bar; 270px expanded sidebar or 66px collapsed rail; sidebar leaves are 56px high and nested leaves are 48px.
- **States:** Active navigation uses `surface-muted` with foreground text; hover uses `surface` and foreground text; keyboard focus uses the primary ring.
- **Responsive Behavior:** Below `lg`, the sidebar becomes an overlay and closes after navigation.

### Tags & Status

Status communication relies on a light/dark surface plus a darker readable foreground and matching border. Use semantic text, iconography where helpful, and color together; never communicate risk or completion through hue alone.

## Do's and Don'ts

### Do:

- **Do** use semantic surface, foreground, border, and status tokens instead of raw utility colors.
- **Do** keep primary actions in Verification Indigo and reserve status ramps for their actual meaning.
- **Do** preserve 12px rounding and compact 32–56px control heights across shared patterns.
- **Do** provide `focus-visible` states and retain `motion-reduce` behavior for every introduced interaction.
- **Do** make new pages spacious at the composition level while preserving dense, scannable operational widgets.

### Don't:

- **Don't** use `fg-muted` for regular-size body copy or `fg-subtle` for active copy.
- **Don't** use large resting shadows or decorative gradients to manufacture hierarchy.
- **Don't** widen organization branding beyond the dashboard accent scope or replace structural/status tokens with tenant colors.
- **Don't** hide layout overflow on `html` or size primary layouts with `100vw`; overlay scroll locking depends on the current document behavior.
