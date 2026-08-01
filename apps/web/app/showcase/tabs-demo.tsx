"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { Inbox, Menu, Send, Star } from "lucide-react";

const PANELS = [
  { value: "all", label: "Tab", icon: <Menu />, count: 128 },
  { value: "inbox", label: "Inbox", icon: <Inbox />, count: 7 },
  { value: "starred", label: "Starred", icon: <Star /> },
  { value: "sent", label: "Sent", icon: <Send />, count: 0 },
];

function Panels() {
  return (
    <>
      {PANELS.map((p) => (
        <TabsContent key={p.value} value={p.value}>
          <p className="text-subhead-regular text-fg-muted">
            Panel content for <span className="text-fg">{p.label}</span>.
          </p>
        </TabsContent>
      ))}
    </>
  );
}

function Bar({
  variant,
  size,
  testid,
}: {
  variant: "line" | "fill" | "outline";
  size?: "sm" | "md";
  testid: string;
}) {
  return (
    <Tabs defaultValue="all" variant={variant} size={size} data-testid={testid}>
      <TabsList>
        {PANELS.map((p) => (
          <TabsTrigger
            key={p.value}
            value={p.value}
            icon={p.icon}
            count={p.count}
            data-testid={`${testid}-${p.value}`}
          >
            {p.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <Panels />
    </Tabs>
  );
}

export function TabsDemo() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <span className="text-caption-1-medium text-fg-subtle">
          variant=line, size=sm (design: Default)
        </span>
        <Bar variant="line" size="sm" testid="tabs-line-sm" />
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <span className="text-caption-1-medium text-fg-subtle">
          variant=line, size=md (design: Medium)
        </span>
        <Bar variant="line" size="md" testid="tabs-line-md" />
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <span className="text-caption-1-medium text-fg-subtle">
          variant=fill (segmented: adjacent hairlines form one edge)
        </span>
        <Bar variant="fill" testid="tabs-fill" />
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <span className="text-caption-1-medium text-fg-subtle">
          variant=outline
        </span>
        <Bar variant="outline" testid="tabs-outline" />
      </div>

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        <span className="text-caption-1-medium text-fg-subtle">
          disabled trigger, and count over 99
        </span>
        <Tabs defaultValue="a" variant="outline" data-testid="tabs-edge">
          <TabsList>
            <TabsTrigger value="a" icon={<Menu />} count={4821} data-testid="tabs-edge-a">
              Overflow
            </TabsTrigger>
            <TabsTrigger value="b" disabled icon={<Star />} data-testid="tabs-edge-b">
              Disabled
            </TabsTrigger>
            <TabsTrigger value="c" data-testid="tabs-edge-c">
              No icon
            </TabsTrigger>
          </TabsList>
          <TabsContent value="a">
            <p className="text-subhead-regular text-fg-muted">4821 renders as 99+.</p>
          </TabsContent>
          <TabsContent value="b">
            <p className="text-subhead-regular text-fg-muted">Unreachable.</p>
          </TabsContent>
          <TabsContent value="c">
            <p className="text-subhead-regular text-fg-muted">Icon is optional.</p>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
