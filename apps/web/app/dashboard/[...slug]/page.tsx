import { Button } from "@repo/ui/button";
import { Construction } from "lucide-react";
import Link from "next/link";

/**
 * Catch-all for the nav sections the Pencil file lists but does not design.
 *
 * The sidebar is transcribed in full (13 sections, `ZDDN2`), which is the
 * point of the template: it should look like the design. But only Dashboard
 * and Tables have frames, so without this every other item would 404 and the
 * nav would feel broken.
 *
 * Next resolves specific segments before a catch-all, so the real routes
 * under `/dashboard` are unaffected by this file.
 */
export default async function ComingSoonPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const title = (slug.at(-1) ?? "Section")
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">

      <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border bg-canvas px-6 py-24 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-surface text-fg-subtle">
          <Construction aria-hidden="true" className="size-6" />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-h5 text-fg">{title} is not designed yet</h2>
          <p className="max-w-md text-subhead-regular text-fg-muted">
            The sidebar mirrors the Pencil file, which lists this section but
            ships no frame for it. The screens that do have frames are the four
            dashboards and the four table layouts.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild>
            <Link href="/dashboard">Go to E-commerce</Link>
          </Button>
          <Button asChild variant="outline" tone="grey">
            <Link href="/dashboard/tables/basic">See the tables</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
