import type { ReactNode } from "react";
import { AuthArt } from "./_components/auth-art";
import { AuthQuote } from "./_components/auth-quote";
import { AuthLogo } from "./_components/auth-chrome";
import { AuthFooterSlot } from "./_components/auth-footer-slot";

/**
 * The split shell shared by every Admin Authorization frame.
 *
 * Measured from `a1za5` / `IBYQC` (all four screens are identical here):
 *
 *   canvas   1440x1024
 *   left     480 wide - logo band 120 tall, form column 360 wide at x=60,
 *            footer band 72 tall pinned at the bottom
 *   right    960 wide - art panel with the quote card at (120,90)
 *
 * The design has no mobile variant, so the collapse is defined here: below
 * `lg` the art panel is dropped entirely rather than squeezed, because its
 * composition is tuned to a 960x1024 box and reads as noise at a third of
 * that. The form column keeps its 60px gutters down to `sm`, then 24.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-canvas">
      {/* Form column: fixed 480 once there is room for the art beside it. */}
      <div className="flex min-h-dvh w-full flex-col lg:w-[480px] lg:shrink-0">
        <header className="flex h-30 shrink-0 items-center px-6 sm:px-15">
          <AuthLogo />
        </header>

        {/*
          `justify-center` centres the form in the band between the logo and
          the footer, which is what puts it where the frame does without
          pinning it to a magic offset.
        */}
        <main className="flex flex-1 flex-col justify-center px-6 py-8 sm:px-15">
          <div className="mx-auto w-full max-w-[360px]">{children}</div>
        </main>

        <div className="shrink-0 px-6 sm:px-15">
          <AuthFooterSlot />
        </div>
      </div>

      {/*
        Art column. Everything inside is absolutely positioned so the artwork
        can never drive the page height.

        It matters because AuthArt is an SVG with a 960x1024 viewBox: in flow,
        `height: 100%` against a parent that only has `min-height` is
        indefinite, so the SVG falls back to its intrinsic ratio and grows as
        wide-as-the-column times 1024/960. On a 1425px column that is 1520px
        tall, which forced a scrollbar onto every screen regardless of how
        little the form contained.

        Out of flow, this column simply stretches to the row height, which is
        the taller of the form column and the viewport.

        `aria-hidden` lives on AuthArt; the quote is decorative but readable,
        so it stays in the tree.
      */}
      <div className="relative hidden flex-1 lg:block">
        <div className="absolute inset-0">
          <AuthArt />
        </div>
        <div className="absolute top-[90px] right-[120px] left-[120px]">
          <AuthQuote />
        </div>
      </div>
    </div>
  );
}
