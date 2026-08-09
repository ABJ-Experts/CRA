import { Avatar } from "@repo/ui/avatar";
import { Button } from "@repo/ui/button";
import {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/card";
import { Tag } from "@repo/ui/tag";
import { ArrowUpRight, Bitcoin, MoreHorizontal } from "lucide-react";

const ACTIVITY = [
  ["Ada Foster", "opened a pull request", "2m"],
  ["Bea Ray", "commented on #418", "18m"],
  ["Cy Nolan", "merged release/1.4", "1h"],
  ["Dee Ives", "closed 3 issues", "3h"],
  ["Eli Vance", "pushed 12 commits", "5h"],
  ["Fay Wu", "created a milestone", "1d"],
];

/**
 * Server Component on purpose: Card is layout only, so it must stay
 * importable without a client boundary. If this ever needs "use client" the
 * component has regressed.
 */
export function CardDemo() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card data-testid="card-outlined">
          <CardHeader
            action={
              <Button
                variant="invisible"
                tone="grey"
                iconOnly
                aria-label="More"
              >
                <MoreHorizontal />
              </Button>
            }
          >
            <CardTitle>Audiences</CardTitle>
            <CardDescription>Last 30 days</CardDescription>
          </CardHeader>
          <CardBody>
            <div className="flex h-24 items-end gap-1">
              {[40, 65, 30, 80, 55, 95, 70].map((h, i) => (
                <span
                  key={i}
                  style={{ height: `${h}%` }}
                  className="flex-1 rounded-sm bg-active-300"
                />
              ))}
            </div>
          </CardBody>
          <CardFooter>
            <Tag variant="dot" tone="green">
              +12.4% vs last month
            </Tag>
          </CardFooter>
        </Card>

        <Card variant="filled" size="sm" data-testid="card-filled">
          <span className="flex size-10 items-center justify-center rounded-full bg-origin-orange-500 text-white">
            <Bitcoin aria-hidden="true" className="size-5" />
          </span>
          <div className="flex flex-col gap-2">
            <CardTitle>Bitcoin</CardTitle>
            <CardDescription>BTC / USD</CardDescription>
          </div>
          <CardFooter className="justify-between">
            <span className="text-h5 text-fg">$64,180</span>
            <Tag variant="fill" tone="green">
              +2.1%
            </Tag>
          </CardFooter>
        </Card>

        <Card variant="primary" data-testid="card-primary">
          <CardHeader>
            <CardTitle>Weekly Summary</CardTitle>
            <CardDescription>Every metric is up</CardDescription>
          </CardHeader>
          <CardBody>
            <div className="flex h-24 items-end gap-2">
              {[30, 50, 45, 70, 60, 90].map((h, i) => (
                <span
                  key={i}
                  style={{ height: `${h}%` }}
                  className="flex-1 rounded-sm bg-white/30"
                />
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Reproduces Recent Activity, including its bottom fade. */}
        <Card className="h-72" data-testid="card-scroll">
          <CardHeader
            action={
              <Button
                variant="invisible"
                tone="grey"
                endIcon={<ArrowUpRight />}
              >
                All
              </Button>
            }
          >
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardBody scrollable data-testid="card-scroll-body">
            <ul className="flex flex-col gap-3 pb-6">
              {ACTIVITY.concat(ACTIVITY).map(([who, what, when], i) => (
                <li key={i} className="flex items-center gap-3">
                  <Avatar name={who} className="size-8 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-subhead-regular text-fg">
                    <span className="text-subhead-medium">{who}</span> {what}
                  </span>
                  <span className="shrink-0 text-caption-2-regular text-fg-subtle">
                    {when}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card interactive asChild data-testid="card-interactive">
          <a href="/showcase">
            <CardHeader
              action={
                <ArrowUpRight
                  aria-hidden="true"
                  className="size-4 text-fg-muted"
                />
              }
            >
              <CardTitle>Whole card is a link</CardTitle>
              <CardDescription>
                asChild plus interactive: hover lifts it, and it takes a focus
                ring from the keyboard.
              </CardDescription>
            </CardHeader>
            <CardBody>
              <p className="text-subhead-regular text-fg-muted">
                The border also steps up to border-strong on hover.
              </p>
            </CardBody>
          </a>
        </Card>
      </div>
    </div>
  );
}
