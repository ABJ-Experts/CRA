"use client";

import { GaugeChart, RadialBar, StackedBarChart } from "@repo/ui/chart";
import { Avatar } from "@repo/ui/avatar";
import { cn } from "@repo/ui/cn";
import { DeltaBadge, StatCard } from "@repo/ui/stat-card";
import { Tag } from "@repo/ui/tag";
import { SectionCard, Stagger, StaggerItem } from "../_components/dashboard-chrome";

/**
 * Dashboard / Project Manager - Pencil `I4RUTg` (light), `CvTTq` (dark).
 *
 * Frame layout: a 798-wide left column (Tasks Overview 798x423, Total
 * 798x208, Latest Orders 798x724) beside a 282-wide right rail (Performance
 * this Week 282x221, Activities 282x1208). The frame's nine 40px Radialbars
 * are the per-project progress rings.
 */

const SPRINTS = ["S1", "S2", "S3", "S4", "S5", "S6"];
const STAGES = [
  { name: "Design", data: [12, 18, 14, 22, 19, 26] },
  { name: "Build", data: [20, 24, 28, 26, 31, 34] },
  { name: "Review", data: [8, 11, 9, 14, 12, 16] },
];

const PROJECTS = [
  { name: "Design system", owner: "Ada Foster", progress: 82, status: "On track" as const },
  { name: "Checkout rewrite", owner: "Milo Chen", progress: 64, status: "On track" as const },
  { name: "Search relevance", owner: "Ines Duarte", progress: 41, status: "At risk" as const },
  { name: "Mobile onboarding", owner: "Theo Novak", progress: 23, status: "Blocked" as const },
  { name: "Billing migration", owner: "Sana Iqbal", progress: 91, status: "On track" as const },
  { name: "Data warehouse", owner: "Ravi Menon", progress: 57, status: "On track" as const },
  { name: "Accessibility audit", owner: "Nora Blake", progress: 35, status: "At risk" as const },
  { name: "Docs refresh", owner: "Jonas Weber", progress: 76, status: "On track" as const },
  { name: "Perf budget", owner: "Lea Rossi", progress: 12, status: "Blocked" as const },
];

const STATUS_TONE = { "On track": "green", "At risk": "orange", Blocked: "red" } as const;

const ACTIVITIES = [
  { who: "Ada Foster", what: "merged Design tokens v2", when: "12m ago" },
  { who: "Milo Chen", what: "opened Checkout: split payment", when: "48m ago" },
  { who: "Ines Duarte", what: "flagged Search relevance as at risk", when: "2h ago" },
  { who: "Theo Novak", what: "commented on Mobile onboarding", when: "4h ago" },
  { who: "Sana Iqbal", what: "closed Billing migration step 4", when: "6h ago" },
  { who: "Ravi Menon", what: "added 3 tasks to Data warehouse", when: "yesterday" },
];

export default function ProjectDashboardPage() {
  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
      <Stagger className="grid gap-6 xl:grid-cols-[1fr_282px]">
        <div className="flex min-w-0 flex-col gap-6">
          <StaggerItem>
            <SectionCard title="Tasks overview">
              <StackedBarChart
                ariaLabel="Task hours by stage across six sprints"
                categories={SPRINTS}
                series={STAGES}
                height={320}
              />
            </SectionCard>
          </StaggerItem>

          <StaggerItem className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Open tasks" value={248} delta={<DeltaBadge value={-4.1} />} />
            <StatCard label="In review" value={37} delta={<DeltaBadge value={2.6} />} />
            <StatCard label="Shipped" value={1_402} delta={<DeltaBadge value={9.8} />} />
            <StatCard
              label="On-time rate"
              value={94.2}
              format={(n) => `${n.toFixed(1)}%`}
              delta={<DeltaBadge value={1.3} />}
            />
          </StaggerItem>

          <StaggerItem>
            <SectionCard title="Projects">
              <ul className="flex flex-col">
                {PROJECTS.map((p, i) => (
                  <li
                    key={p.name}
                    className={cn(
                      "flex items-center gap-4 py-3",
                      i < PROJECTS.length - 1 && "border-b border-border",
                    )}
                  >
                    {/* The frame's 40px progress ring, one per project. */}
                    <RadialBar
                      ariaLabel={`${p.name}, ${p.progress} percent complete`}
                      value={p.progress}
                      color={p.progress >= 60 ? "success" : p.progress >= 35 ? "warning" : "danger"}
                      height={40}
                      className="w-10 shrink-0"
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-subhead-medium text-fg">{p.name}</span>
                      <span className="truncate text-caption-2-regular text-fg-muted">
                        {p.owner}
                      </span>
                    </div>
                    <span className="shrink-0 text-caption-1-semibold text-fg-muted tabular-nums">
                      {p.progress}%
                    </span>
                    <Tag variant="fill" tone={STATUS_TONE[p.status]} size="sm" className="shrink-0">
                      {p.status}
                    </Tag>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </StaggerItem>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <StaggerItem>
            <SectionCard title="Performance this week">
              <GaugeChart
                ariaLabel="Team performance this week"
                value={72}
                label="Performance"
                height={180}
              />
            </SectionCard>
          </StaggerItem>

          <StaggerItem>
            <SectionCard title="Activities">
              <ul className="flex flex-col gap-4">
                {ACTIVITIES.map((a) => (
                  <li key={`${a.who}-${a.when}`} className="flex gap-3">
                    <Avatar
                      size="sm"
                      fallback={a.who
                        .split(" ")
                        .map((w) => w[0])
                        .join("")}
                      className="shrink-0"
                    />
                    <div className="flex min-w-0 flex-col">
                      <p className="text-caption-1-regular text-fg-muted">
                        <span className="text-subhead-medium text-fg">{a.who}</span> {a.what}
                      </p>
                      <span className="text-caption-2-regular text-fg-subtle">{a.when}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          </StaggerItem>
        </div>
      </Stagger>
    </div>
  );
}
