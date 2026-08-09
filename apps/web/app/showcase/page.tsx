import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CheckboxDemo } from "./checkbox-demo";
import { RadioDemo } from "./radio-demo";
import { ComboboxDemo } from "./combobox-demo";
import { FormDemo } from "./form-demo";
import { TagDemo } from "./tag-demo";
import { ChipDemo } from "./chip-demo";
import { TabsDemo } from "./tabs-demo";
import { AlertDemo } from "./alert-demo";
import { ModalDemo } from "./modal-demo";
import { BreadcrumbsDemo } from "./breadcrumbs-demo";
import { PaginationDemo } from "./pagination-demo";
import { AvatarDemo } from "./avatar-demo";
import { CardDemo } from "./card-demo";
import { InputExtrasDemo } from "./input-extras-demo";
import { DatePickerDemo } from "./date-picker-demo";
import { SortByDemo } from "./sort-by-demo";
import { SelectUsersDemo } from "./select-users-demo";
import { EditorDemo } from "./editor-demo";
import { SelectDemo } from "./select-demo";
import { SwitchDemo } from "./switch-demo";
import { ThemeToggle } from "./theme-toggle";

export const metadata: Metadata = {
  title: "Design system showcase",
  description: "Every component variant and state, in light and dark.",
};

const TONES = ["primary", "subPrimary", "grey", "white"] as const;
const SIZES = ["sm", "md", "lg"] as const;

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-h5 text-fg">{title}</h2>
        {note ? (
          <p className="text-subhead-regular text-fg-muted">{note}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-caption-1-medium text-fg-subtle">{label}</span>
      <div className="flex flex-wrap items-center gap-4">{children}</div>
    </div>
  );
}

export default function ShowcasePage() {
  return (
    <main className="min-h-svh bg-canvas px-8 py-12">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        <header className="flex flex-col gap-4">
          <h1 className="text-h3 text-fg">Design system</h1>
          <p className="text-body text-fg-muted">
            Transcribed from the Pencil file. Every colour resolves to a
            design-system token, so the whole page re-themes from a single
            attribute.
          </p>
          <ThemeToggle />
        </header>

        <Section
          title="Button / Fill"
          note="Primary uses active-500 with active-600 on hover. Sub-primary flips surface between themes."
        >
          {SIZES.map((size) => (
            <Row key={size} label={`size=${size}`}>
              {TONES.map((tone) => (
                <Button
                  key={tone}
                  variant="fill"
                  tone={tone}
                  size={size}
                  data-testid={`fill-${tone}-${size}`}
                >
                  Button
                </Button>
              ))}
              <Button variant="fill" tone="primary" size={size} disabled>
                Disabled
              </Button>
            </Row>
          ))}
        </Section>

        <Section
          title="Button / Outline and Gap"
          note="They differ only in border colour: border vs border-strong."
        >
          {SIZES.map((size) => (
            <Row key={size} label={`size=${size}`}>
              <Button variant="outline" tone="grey" size={size}>
                Outline
              </Button>
              <Button variant="outline" tone="primary" size={size}>
                Outline primary
              </Button>
              <Button variant="gap" tone="grey" size={size}>
                Gap
              </Button>
              <Button variant="outline" tone="grey" size={size} disabled>
                Disabled
              </Button>
            </Row>
          ))}
        </Section>

        <Section
          title="Button / Invisible"
          note="Collapsed padding and reduced height, per the design."
        >
          {SIZES.map((size) => (
            <Row key={size} label={`size=${size}`}>
              <Button variant="invisible" tone="primary" size={size}>
                Primary
              </Button>
              <Button variant="invisible" tone="grey" size={size}>
                Grey
              </Button>
              <Button variant="invisible" tone="grey" size={size} disabled>
                Disabled
              </Button>
            </Row>
          ))}
        </Section>

        <Section
          title="Button / Icons and divider"
          note="The divider is a 1px scrim-white-15 hairline, used on fill variants."
        >
          <Row label="start and end icons">
            <Button startIcon={<ArrowLeft />}>Back</Button>
            <Button endIcon={<ArrowRight />}>Next</Button>
            <Button
              startIcon={<ArrowLeft />}
              endIcon={<ArrowRight />}
              withDivider
            >
              Both
            </Button>
            <Button variant="outline" tone="grey" startIcon={<Plus />}>
              Add item
            </Button>
          </Row>
          <Row label="loading">
            <Button loading>Saving</Button>
            <Button variant="outline" tone="grey" loading>
              Saving
            </Button>
          </Row>
        </Section>

        <Section
          title="Button / Iconic"
          note="Square. Pencil: 32 / 48 / 64 with padding 4 / 12 / 16."
        >
          <Row label="invisible">
            <Button
              iconOnly
              variant="invisible"
              tone="grey"
              size="sm"
              aria-label="Close"
            >
              <X />
            </Button>
            <Button
              iconOnly
              variant="outline"
              tone="primary"
              size="md"
              aria-label="Confirm"
            >
              <Check />
            </Button>
            <Button iconOnly variant="balloon" size="lg" aria-label="New item">
              <Plus />
            </Button>
            <Button
              iconOnly
              variant="fill"
              tone="grey"
              size="sm"
              aria-label="Delete"
              disabled
            >
              <Trash2 />
            </Button>
          </Row>
        </Section>

        <Section
          title="Button / Composition"
          note="asChild renders a link with button styling. fullWidth stretches."
        >
          <Row label="asChild">
            <Button
              asChild
              variant="outline"
              tone="grey"
              endIcon={<ArrowRight />}
            >
              <Link href="/">Back to home</Link>
            </Button>
          </Row>
          <Row label="fullWidth">
            <div className="w-full max-w-sm">
              <Button fullWidth>Full width</Button>
            </div>
          </Row>
          <Row label="className override wins via tailwind-merge">
            <Button
              className="bg-origin-green-500 text-on-success"
              data-testid="override"
            >
              Overridden background
            </Button>
          </Row>
        </Section>

        <Section
          title="Surfaces"
          note="Fixed-colour tones sit on a dark surface in the design."
        >
          <div className="flex flex-wrap items-center gap-4 rounded-xl bg-neutral-light-500 p-6">
            <Button variant="fill" tone="white">
              Fill white
            </Button>
            <Button variant="outline" tone="white">
              Outline white
            </Button>
          </div>
        </Section>

        <Section
          title="Input"
          note="Forms/Password (40px) and Forms/Title (56px). Borders are inset shadows so the 1px to 2px hover never shifts layout."
        >
          <div className="grid gap-6 sm:grid-cols-2">
            <Input
              label="Label"
              required
              placeholder="Enter Password"
              startIcon={<Lock />}
              endIcon={<EyeOff />}
              data-testid="input-default"
            />
            <Input
              label="Label"
              required
              placeholder="Enter Password"
              defaultValue="Filled value"
              startIcon={<Lock />}
              endIcon={<Eye />}
              data-testid="input-filled"
            />
            <Input
              label="Label"
              required
              placeholder="Enter Password"
              startIcon={<Lock />}
              endIcon={<TriangleAlert />}
              error="Something Error Alert"
              data-testid="input-error"
            />
            <Input
              label="Label"
              required
              placeholder="Enter Password"
              startIcon={<Lock />}
              endIcon={<EyeOff />}
              disabled
              data-testid="input-disabled"
            />
            <Input
              label="With helper text"
              placeholder="you@example.com"
              startIcon={<Mail />}
              helperText="We will never share your address."
              data-testid="input-helper"
            />
            <Input
              label="Search"
              hideLabel
              placeholder="Search"
              startIcon={<Search />}
              data-testid="input-search"
            />
          </div>

          <Row label="size=lg (48, Admin Authorization)">
            <div className="w-full max-w-md">
              <Input
                size="lg"
                placeholder="Placeholder"
                data-testid="input-lg"
              />
            </div>
          </Row>

          <Row label="size=xl (56, Forms/Title)">
            <div className="w-full max-w-md">
              <Input
                size="xl"
                placeholder="Enter Title"
                data-testid="input-xl"
              />
            </div>
          </Row>
        </Section>

        <Section
          title="Checkbox"
          note="20px box, radius 6. Unchecked uses surface, checked active-500, disabled surface-muted. Indeterminate included."
        >
          <CheckboxDemo />
        </Section>

        <Section
          title="Switch"
          note="Geometry from the design's 24px icon: 20x16 track, 12px knob, 4px travel. Only the knob transform and track colour animate."
        >
          <SwitchDemo />
        </Section>

        <Section
          title="Radio"
          note="Selected is a 6px active-500 ring over white, matching the design's stroke. One tab stop per group, arrow keys to move."
        >
          <RadioDemo />
        </Section>

        <Section
          title="Select"
          note="Trigger reuses the Input field exactly. Panel is the new elevated token; rows are 44px with r8 and highlight on both hover and arrow-key focus."
        >
          <SelectDemo />
        </Section>

        <Section
          title="Combobox (searchable select)"
          note="Radix Select cannot filter, so this composes Radix Popover with cmdk. Same trigger and panel styling, plus keyword matching, groups, clear and an empty state."
        >
          <ComboboxDemo />
        </Section>

        <Section
          title="Form (Zod + React Hook Form)"
          note="The Zod schema is the single source of truth: field names, value types and every message come from it. Every control above is wired through one FormField."
        >
          <FormDemo />
        </Section>

        <Section
          title="Tag"
          note="Pencil l9QDb. Cool / Fill Color / Dot in Small and Medium. Non-interactive, so it renders a span and stays importable from a Server Component."
        >
          <TagDemo />
        </Section>

        <Section
          title="Chip"
          note="Pencil MbrZH. A removable selection: 24px avatar slot, label, dismiss control. One geometry, one variant per theme."
        >
          <ChipDemo />
        </Section>

        <Section
          title="Tabs"
          note="Pencil o1gsz (the frame is titled Tags, the component inside it is Tab). Line / Fill / Outline with a count pill. Radix supplies roving tabindex, arrow keys and the tab-to-panel wiring."
        >
          <TabsDemo />
        </Section>

        <Section
          title="Alert"
          note="Pencil YsnGb. A 320px centred confirmation dialog on Radix AlertDialog: focus trap, ESC, and the title/description associations come from the primitive. The buttons are our own Button, unmodified."
        >
          <AlertDemo />
        </Section>

        <Section
          title="Modal"
          note="Pencil sjsNr. The frame specifies the chrome, not the body: a 78px title bar (with an optional step rail), a 48px mailbox bar, and an 88px footer. Radix Dialog supplies the focus trap, ESC, outside-click and scroll lock."
        >
          <ModalDemo />
        </Section>

        <Section
          title="Breadcrumbs"
          note="Pencil ZfeDR plus the assembled bar S9VKAU. The last crumb uses the colour the frame labels Disabled, but it is the current page, so the two are separate props here."
        >
          <BreadcrumbsDemo />
        </Section>

        <Section
          title="Pagination"
          note="Pencil SapaF. 40px pills (56 for First / End), current page inverted to fg on canvas. Desktop and mobile layouts ship together and swap in CSS at sm, so neither flashes on first paint."
        >
          <PaginationDemo />
        </Section>

        <Section
          title="Avatar"
          note="Pencil hHuuw. 48 / 80 / 120 with initials, status dot, verified tick, Stories ring and the clustered 2 / 3 image types. Radix Avatar handles the image-to-initials fallback."
        >
          <AvatarDemo />
        </Section>

        <Section
          title="Card"
          note="Pencil qK67c. That frame holds twenty finished dashboard cards; those are app compositions, so what ships here is the chrome they all share: outlined / filled / primary, at 24 or 16 padding, plus the Recent Activity bottom fade."
        >
          <CardDemo />
        </Section>

        <Section
          title="Password and Search"
          note="Pencil nnD8v and mBlqZ. Password is a composition on Input, since all seven of its states are chrome Input already draws. Search is not: it is a pill on `surface` with no resting border."
        >
          <InputExtrasDemo />
        </Section>

        <Section
          title="Date Picker"
          note="Pencil hW0yQ. The trigger is Input's field verbatim; the panel is the frame's 400x352 card with its two stacked shadows. react-day-picker supplies the grid roles and arrow-key navigation, and the date stays typeable."
        >
          <DatePickerDemo />
        </Section>

        <Section
          title="Sort by"
          note="Pencil qyjm1. A compact inline control for a toolbar, not a form: a 22px pill trigger with no resting background. Its panel and rows are the Select's own sm size, which already measures the frame's 34 tall at radius 8."
        >
          <SortByDemo />
        </Section>

        <Section
          title="Select Users and Title"
          note="Pencil js7Em and jK37E. The person picker's panel and rows are the Select's md size unchanged - its padding is already 12 8 11 8, and a 32px avatar makes the row 55 tall - so only the trigger is restyled. Forms/Title turned out to be Input at size=lg, so it ships as a usage, not a component."
        >
          <SelectUsersDemo />
        </Section>

        <Section
          title="Editor"
          note="Pencil sghh7, eGSmU and eOLYP. The three frames are one shell in three configurations, so they are the toolbar and submit props. Bold, italic, underline, quote and code wrap the selection in markdown; the alignment commands fire onFormat but have no meaning in a plain textarea."
        >
          <EditorDemo />
        </Section>
      </div>
    </main>
  );
}
